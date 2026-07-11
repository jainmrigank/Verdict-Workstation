from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from tools.llm_dataset import (
    GeminiQuotaError,
    cerebras_json,
    configure_gemini_pacing,
    expand_to_target,
    expansion_schedule,
    pace_gemini_request,
    parse_gemini_quota_error,
    parse_cerebras_quota_error,
    provider_row,
    strict_output_schema,
)
from tools.reasoning_dataset import (
    audit_gold,
    build_facts,
    create_evaluation_seal,
    generate_gold,
    normalise_output_contract,
    validate_manifest,
    verify_evaluation_seal,
)


def gold_row(index: int, split: str) -> dict:
    return {
        "id": f"gold-{index:03d}",
        "lineageId": f"gold-{index:03d}",
        "split": split,
        "reviewStatus": "approved",
        "facts": {
            "schemaVersion": "analysis-facts.v1",
            "instrument": {"symbol": f"NSE:TEST{index}", "type": "equity"},
            "userContext": {"action": "Buy"},
            "deterministicAnalysis": {"verdict": "Wait and Watch"},
            "technicalEvidence": {},
            "fundamentalEvidence": {},
            "portfolioEvidence": {},
            "dataQuality": {"state": "complete"},
            "uiOptions": {"patternsEnabled": True},
        },
        "retrievedRuleIds": [],
        "retrievedRuleSet": {"schemaVersion": "retrieved-rule-set.v1", "corpusVersion": "test", "mode": "training", "rules": []},
        "output": {"decision": {}, "chart": {}, "company": {}, "portfolio": {}, "reasoning": {}, "coach": {}, "warnings": []},
    }


class ReasoningDatasetTests(unittest.TestCase):
    def test_cerebras_strict_request_uses_isolated_key_and_schema(self) -> None:
        response = MagicMock()
        response.read.return_value = json.dumps(
            {"choices": [{"message": {"content": json.dumps({"status": "ok"})}}]}
        ).encode("utf-8")
        response.__enter__.return_value = response
        schema = {
            "type": "object",
            "properties": {"status": {"type": "string"}},
            "required": ["status"],
        }
        configure_gemini_pacing(0)
        with (
            patch.dict("tools.llm_dataset.os.environ", {"CEREBRAS_API_KEY": "test-cerebras-key"}, clear=False),
            patch("tools.llm_dataset.urlopen", return_value=response) as urlopen,
        ):
            result = cerebras_json({"task": "test"}, "Return JSON.", schema=schema)
        request = urlopen.call_args.args[0]
        body = json.loads(request.data.decode("utf-8"))
        self.assertEqual(result, {"status": "ok"})
        self.assertEqual(body["model"], "gpt-oss-120b")
        self.assertTrue(body["response_format"]["json_schema"]["strict"])
        self.assertFalse(body["response_format"]["json_schema"]["schema"]["additionalProperties"])
        self.assertEqual(request.headers["Authorization"], "Bearer test-cerebras-key")

    def test_cerebras_quota_parser_uses_rate_limit_headers(self) -> None:
        daily = parse_cerebras_quota_error(
            '{"error":{"message":"Daily request limit reached"}}',
            {
                "x-ratelimit-remaining-requests-day": "0",
                "x-ratelimit-limit-requests-day": "100",
                "x-ratelimit-reset-requests-day": "3600",
                "retry-after": "60",
            },
        )
        self.assertEqual(daily.scope, "daily")
        self.assertEqual(daily.limit, 100)
        self.assertEqual(daily.retry_after_seconds, 60)
        self.assertEqual(daily.quota_id, "cerebras-requests-day")

    def test_strict_schema_closes_every_nested_object(self) -> None:
        schema = {
            "type": "object",
            "properties": {
                "nested": {
                    "type": "object",
                    "properties": {"value": {"type": "string"}},
                }
            },
        }
        strict = strict_output_schema(schema)
        self.assertFalse(strict["additionalProperties"])
        self.assertFalse(strict["properties"]["nested"]["additionalProperties"])
        self.assertNotIn("additionalProperties", schema)

    def test_quota_parser_distinguishes_short_and_daily_limits(self) -> None:
        short = parse_gemini_quota_error(
            json.dumps(
                {
                    "error": {
                        "message": "Quota exceeded. limit: 20, retry in 43.5s.",
                        "details": [
                            {
                                "@type": "type.googleapis.com/google.rpc.QuotaFailure",
                                "violations": [
                                    {
                                        "quotaMetric": "generativelanguage.googleapis.com/generate_content_free_tier_requests",
                                        "quotaId": "GenerateRequestsPerMinutePerProjectPerModel-FreeTier",
                                        "quotaDimensions": {"model": "gemini-3.5-flash"},
                                        "quotaValue": "20",
                                    }
                                ],
                            },
                            {"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "43.5s"},
                        ],
                    }
                }
            )
        )
        self.assertEqual(short.scope, "short_window")
        self.assertEqual(short.limit, 20)
        self.assertEqual(short.retry_after_seconds, 43.5)
        self.assertIn("free_tier_requests", short.metric)
        self.assertIn("PerMinute", short.quota_id)
        self.assertEqual(short.dimensions["model"], "gemini-3.5-flash")

        daily = parse_gemini_quota_error(
            json.dumps(
                {
                    "error": {
                        "message": "Daily quota exhausted. limit: 100",
                        "details": [
                            {
                                "@type": "type.googleapis.com/google.rpc.QuotaFailure",
                                "violations": [
                                    {
                                        "quotaMetric": "generativelanguage.googleapis.com/generate_content_free_tier_requests",
                                        "quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
                                    }
                                ],
                            }
                        ],
                    }
                }
            )
        )
        self.assertEqual(daily.scope, "daily")
        self.assertIsNone(daily.retry_after_seconds)

    def test_gemini_pacer_holds_requests_to_configured_rpm(self) -> None:
        configure_gemini_pacing(15)
        with (
            patch("tools.llm_dataset.time.monotonic", side_effect=[100.0, 101.0, 104.0]),
            patch("tools.llm_dataset.time.sleep") as sleep,
        ):
            pace_gemini_request()
            pace_gemini_request()
        sleep.assert_called_once_with(3.0)

    def test_output_contract_normalises_refs_action_and_verdict_without_changing_claims(self) -> None:
        facts = {
            "userContext": {"action": "Buy"},
            "deterministicAnalysis": {"verdict": "Wait and Watch"},
            "technicalEvidence": {"trend": "mixed"},
        }
        output = {
            "decision": {"summary": "Evidence is mixed.", "nextActions": [{"text": "Wait.", "factRefs": ["facts.technicalEvidence.trend"], "ruleRefs": []}]},
            "portfolio": {"holdingActions": [{"text": "Start only after confirmation.", "factRefs": ["facts.userContext.action"], "ruleRefs": []}]},
            "coach": {"verdictSummary": "Evidence is mixed."},
        }
        rules = {
            "rules": [
                {"id": "decision-rule", "appliesTo": ["decision"]},
                {"id": "portfolio-rule", "appliesTo": ["portfolio"]},
            ]
        }
        result = normalise_output_contract(output, facts, rules)
        self.assertEqual(result["decision"]["nextActions"][0]["factRefs"], ["technicalEvidence.trend"])
        self.assertEqual(result["decision"]["nextActions"][0]["ruleRefs"], ["decision-rule"])
        self.assertIn("Buy action:", result["portfolio"]["holdingActions"][0]["text"])
        self.assertIn("Wait and Watch", result["decision"]["summary"])
        self.assertIn("Wait and Watch", result["coach"]["verdictSummary"])
        self.assertEqual(output["decision"]["summary"], "Evidence is mixed.")

    def test_public_manifest_has_exact_leak_proof_split(self) -> None:
        result = validate_manifest()
        self.assertEqual(result["errors"], [])
        self.assertEqual(result["instruments"], 63)
        self.assertEqual(result["splits"], {"train": 75, "validation": 15, "eval": 30})

    def test_expansion_schedule_assigns_exact_descendants_by_gold_split(self) -> None:
        rows = [
            *[gold_row(index, "train") for index in range(75)],
            *[gold_row(100 + index, "validation") for index in range(15)],
            *[gold_row(200 + index, "eval") for index in range(30)],
        ]
        schedule = expansion_schedule(rows)
        self.assertEqual(len(schedule), 1080)
        self.assertEqual(sum(seed["split"] == "train" for seed, _ in schedule), 825)
        self.assertEqual(sum(seed["split"] == "validation" for seed, _ in schedule), 135)
        self.assertEqual(sum(seed["split"] == "eval" for seed, _ in schedule), 120)

    def test_provider_export_contains_full_ruleset_and_chat_contract(self) -> None:
        exported = provider_row(gold_row(1, "train"))
        self.assertEqual([message["role"] for message in exported["messages"]], ["system", "user", "assistant"])
        prompt = json.loads(exported["messages"][1]["content"])
        self.assertEqual(prompt["retrievedRuleSet"]["schemaVersion"], "retrieved-rule-set.v1")
        self.assertEqual(exported["lineageId"], "gold-001")

    def test_quota_stop_preserves_existing_expansion_file(self) -> None:
        rows = [
            *[gold_row(index, "train") for index in range(75)],
            *[gold_row(100 + index, "validation") for index in range(15)],
            *[gold_row(200 + index, "eval") for index in range(30)],
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "expanded.jsonl"
            with (
                patch("tools.llm_dataset.EXPANDED_PATH", path),
                patch("tools.llm_dataset.approved_gold", return_value=rows),
                patch("tools.llm_dataset.gemini_expand", side_effect=GeminiQuotaError("quota")),
            ):
                result = expand_to_target(1200, 2)
            self.assertTrue(result["quotaExhausted"])
            self.assertEqual(result["expanded"], 0)
            self.assertFalse(path.exists())

    def test_real_facts_use_public_sources_and_synthetic_user_context(self) -> None:
        instrument = {
            "id": "nse-example",
            "symbol": "NSE:EXAMPLE",
            "name": "Example Ltd",
            "instrumentType": "equity",
            "sectorHint": "Industrials",
        }
        candles = [
            {"date": f"2026-01-{(index % 28) + 1:02d}", "open": 100 + index, "high": 102 + index, "low": 99 + index, "close": 101 + index, "volume": 1000 + index}
            for index in range(60)
        ]
        snapshot = {
            "capturedAt": "2026-07-11T00:00:00+00:00",
            "source": "yahoo",
            "sourceUrls": ["https://query1.finance.yahoo.com/example"],
            "candles": candles,
            "fundamentals": {"name": "Example Ltd", "sector": "Industrials", "returnOnEquity": 0.2, "debtToEquity": 30},
            "warnings": [],
        }
        facts = build_facts(instrument, snapshot, "Sell")
        self.assertEqual(facts["instrument"]["publicSourceUrls"], snapshot["sourceUrls"])
        self.assertEqual(facts["userContext"]["action"], "Sell")
        self.assertNotIn("clientId", json.dumps(facts))

    def test_generation_retries_same_case_after_short_quota(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            snapshot_path = root / "snapshots.json"
            snapshot_path.write_text(
                json.dumps({"one": {"source": "yahoo", "sourceUrls": ["https://example.test"], "capturedAt": "2026-07-11T00:00:00+00:00"}}),
                encoding="utf-8",
            )
            quota = GeminiQuotaError("wait", retry_after_seconds=2, scope="short_window")
            with (
                patch("tools.reasoning_dataset.SNAPSHOT_PATH", snapshot_path),
                patch("tools.reasoning_dataset.GOLD_PATH", root / "gold.jsonl"),
                patch("tools.reasoning_dataset.PROGRESS_PATH", root / "progress.json"),
                patch("tools.reasoning_dataset.QUARANTINE_ROOT", root / "quarantine"),
                patch("tools.reasoning_dataset.manifest", return_value={"instruments": [{"id": "one", "actions": ["Buy"], "split": "train"}]}),
                patch("tools.reasoning_dataset.build_facts", return_value={"uiOptions": {"patternsEnabled": True}}),
                patch("tools.reasoning_dataset.retrieve_rule_set", return_value={"rules": []}),
                patch("tools.reasoning_dataset.generate_output", side_effect=[quota, {"decision": {}}]) as generate,
                patch("tools.reasoning_dataset.row_audit_errors", return_value=[]),
                patch("tools.reasoning_dataset.time.sleep") as sleep,
            ):
                result = generate_gold(rpm=15, max_wait_seconds=10)
        self.assertEqual(result["generated"], 1)
        self.assertFalse(result["quotaExhausted"])
        self.assertEqual(generate.call_count, 2)
        sleep.assert_called_once_with(3)

    def test_generation_stops_cleanly_on_hard_quota(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            snapshot_path = root / "snapshots.json"
            snapshot_path.write_text(
                json.dumps({"one": {"source": "yahoo", "sourceUrls": ["https://example.test"], "capturedAt": "2026-07-11T00:00:00+00:00"}}),
                encoding="utf-8",
            )
            quota = GeminiQuotaError("daily", metric="requests_per_day", scope="daily")
            with (
                patch("tools.reasoning_dataset.SNAPSHOT_PATH", snapshot_path),
                patch("tools.reasoning_dataset.GOLD_PATH", root / "gold.jsonl"),
                patch("tools.reasoning_dataset.PROGRESS_PATH", root / "progress.json"),
                patch("tools.reasoning_dataset.QUARANTINE_ROOT", root / "quarantine"),
                patch("tools.reasoning_dataset.manifest", return_value={"instruments": [{"id": "one", "actions": ["Buy"], "split": "train"}]}),
                patch("tools.reasoning_dataset.build_facts", return_value={"uiOptions": {"patternsEnabled": True}}),
                patch("tools.reasoning_dataset.retrieve_rule_set", return_value={"rules": []}),
                patch("tools.reasoning_dataset.generate_output", side_effect=quota),
                patch("tools.reasoning_dataset.time.sleep") as sleep,
            ):
                result = generate_gold()
                progress = json.loads((root / "progress.json").read_text(encoding="utf-8"))
        self.assertTrue(result["quotaExhausted"])
        self.assertEqual(result["generated"], 0)
        self.assertEqual(progress["lastQuotaResponse"]["scope"], "daily")
        sleep.assert_not_called()

    def test_second_audit_failure_is_quarantined_without_losing_progress(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            snapshot_path = root / "snapshots.json"
            snapshot_path.write_text(
                json.dumps({"one": {"source": "yahoo", "sourceUrls": ["https://example.test"], "capturedAt": "2026-07-11T00:00:00+00:00"}}),
                encoding="utf-8",
            )
            with (
                patch("tools.reasoning_dataset.SNAPSHOT_PATH", snapshot_path),
                patch("tools.reasoning_dataset.GOLD_PATH", root / "gold.jsonl"),
                patch("tools.reasoning_dataset.PROGRESS_PATH", root / "progress.json"),
                patch("tools.reasoning_dataset.QUARANTINE_ROOT", root / "quarantine"),
                patch("tools.reasoning_dataset.manifest", return_value={"instruments": [{"id": "one", "actions": ["Buy"], "split": "train"}]}),
                patch("tools.reasoning_dataset.build_facts", return_value={"uiOptions": {"patternsEnabled": True}}),
                patch("tools.reasoning_dataset.retrieve_rule_set", return_value={"rules": []}),
                patch("tools.reasoning_dataset.generate_output", return_value={}),
                patch("tools.reasoning_dataset.repair_output", return_value={}),
                patch("tools.reasoning_dataset.row_audit_errors", side_effect=[["bad"], ["still bad"]]),
            ):
                result = generate_gold()
                partial_audit = audit_gold([], require_complete=False)
        self.assertEqual(result["generated"], 0)
        self.assertEqual(result["quarantined"], ["gold-one-buy"])
        self.assertTrue(any("quarantined" in error.lower() for error in partial_audit["errors"]))

    def test_generation_repairs_once_and_resumes_with_max_new(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            snapshot_path = root / "snapshots.json"
            snapshot_path.write_text(
                json.dumps(
                    {
                        case_id: {"source": "yahoo", "sourceUrls": ["https://example.test"], "capturedAt": "2026-07-11T00:00:00+00:00"}
                        for case_id in ("one", "two")
                    }
                ),
                encoding="utf-8",
            )
            instruments = [
                {"id": case_id, "actions": ["Buy"], "split": "train"}
                for case_id in ("one", "two")
            ]
            gold_path = root / "gold.jsonl"
            patches = (
                patch("tools.reasoning_dataset.SNAPSHOT_PATH", snapshot_path),
                patch("tools.reasoning_dataset.GOLD_PATH", gold_path),
                patch("tools.reasoning_dataset.PROGRESS_PATH", root / "progress.json"),
                patch("tools.reasoning_dataset.QUARANTINE_ROOT", root / "quarantine"),
                patch("tools.reasoning_dataset.manifest", return_value={"instruments": instruments}),
                patch("tools.reasoning_dataset.build_facts", return_value={"uiOptions": {"patternsEnabled": True}}),
                patch("tools.reasoning_dataset.retrieve_rule_set", return_value={"rules": []}),
                patch("tools.reasoning_dataset.generate_output", return_value={}),
                patch("tools.reasoning_dataset.repair_output", return_value={"decision": {}}),
                patch("tools.reasoning_dataset.row_audit_errors", side_effect=[["bad"], [], []]),
            )
            with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6], patches[7], patches[8], patches[9]:
                first = generate_gold(max_new=1)
                second = generate_gold(max_new=1)
                progress = json.loads((root / "progress.json").read_text(encoding="utf-8"))
        self.assertEqual(first["generated"], 1)
        self.assertEqual(second["generated"], 1)
        self.assertEqual(progress["completedCases"], 2)
        self.assertEqual(len(progress["completedCaseIds"]), 2)

    def test_evaluation_seal_detects_tampering(self) -> None:
        rows = []
        for index in range(30):
            row = gold_row(index, "eval")
            row["provenance"] = {"instrumentId": f"instrument-{index}", "source": "yahoo", "kind": "public-market-snapshot"}
            rows.append(row)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            gold_path = root / "gold.jsonl"
            seal_path = root / "seal.json"
            gold_path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
            clean_audit = {"examples": 30, "splits": {"train": 0, "validation": 0, "eval": 30}, "errors": []}
            with (
                patch("tools.reasoning_dataset.GOLD_PATH", gold_path),
                patch("tools.reasoning_dataset.EVALUATION_SEAL_PATH", seal_path),
                patch("tools.reasoning_dataset.audit_gold", return_value=clean_audit),
            ):
                created = create_evaluation_seal()
                verified = verify_evaluation_seal(rows)
                rows[0]["output"] = {"tampered": True}
                tampered = verify_evaluation_seal(rows)
        self.assertEqual(created["sealed"], 30)
        self.assertTrue(verified["verified"])
        self.assertFalse(tampered["verified"])
        self.assertTrue(any("content hash" in error for error in tampered["errors"]))


if __name__ == "__main__":
    unittest.main()
