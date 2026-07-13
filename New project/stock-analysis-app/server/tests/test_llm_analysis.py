from __future__ import annotations

import json
import sqlite3
import tempfile
import threading
import time
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from server.llm_analysis import (
    ANALYSIS_CACHE,
    ANALYSIS_CACHE_LOCK,
    ANALYSIS_INFLIGHT,
    RULEBOOK_PATH,
    analysis_prompt,
    analysis_context_fingerprint,
    build_index,
    call_provider,
    corpus_version,
    context_fingerprint,
    generate_analysis,
    local_endpoint_is_loopback,
    lexical_retrieve,
    normalise_analysis,
    provider_timeout,
    provider_version,
    retrieve_rule_set,
    semantic_analysis_errors,
    validate_analysis,
    validate_raw_analysis,
)


def facts() -> dict:
    return {
        "schemaVersion": "analysis-facts.v1",
        "generatedAt": "2026-07-10T00:00:00+00:00",
        "instrument": {"symbol": "NSE:TEST", "type": "equity", "sector": "Financials", "industry": "Bank - Private"},
        "userContext": {"action": "Buy", "horizon": "1-3y", "riskProfile": "balanced"},
        "deterministicAnalysis": {"verdict": "Wait and Watch", "confidence": "Medium"},
        "technicalEvidence": {"trend": "mixed", "rsi14": 52, "volume": "normal"},
        "fundamentalEvidence": {"debtEquity": 0.5, "roce": 16, "pe": 20},
        "portfolioEvidence": {"weight": 0, "riskBudget": 1000},
        "signals": [],
        "reasoningTrace": [],
        "dataQuality": {"state": "complete", "missing": []},
        "uiOptions": {"patternsEnabled": True},
    }


def raw_analysis() -> dict:
    item = {
        "text": "Use the supplied evidence.",
        "tone": "neutral",
        "factRefs": ["deterministicAnalysis.verdict"],
        "ruleRefs": ["pdf-m13-c1-introduction-to-financial-modelling"],
    }
    step = {**item, "evidence": "Evidence", "implication": "Implication", "action": "Action"}
    return {
        "decision": {"summary": "Wait and Watch: decision summary", "nextActions": [item], "avoid": [item], "priceDrivers": [item], "risks": [item], "dataGaps": []},
        "chart": {"summary": "Chart summary", "trend": [item], "momentum": [], "volume": [], "volatility": [], "levels": [], "patterns": []},
        "company": {"summary": "Company summary", "businessModel": [], "quality": [item], "profitability": [], "balanceSheet": [], "cashFlow": [], "valuation": [], "sectorDrivers": [], "catalysts": [], "risks": [], "dataGaps": []},
        "portfolio": {"summary": "Portfolio summary", "positionFit": [item], "concentration": [], "sizing": [], "holdingActions": [], "risks": []},
        "reasoning": {"steps": [step, step, step]},
        "coach": {"verdictSummary": "Wait and Watch: verdict summary", "chartSummary": "Chart", "companySummary": "Company", "questionsBeforeAction": [item, item, item]},
        "warnings": [],
    }


class LlmAnalysisTests(unittest.TestCase):
    def test_context_fingerprint_is_stable(self) -> None:
        self.assertEqual(context_fingerprint(facts()), context_fingerprint(facts()))

    def test_analysis_fingerprint_ignores_request_time_but_keeps_market_time(self) -> None:
        first = facts()
        second = facts()
        second["generatedAt"] = "2026-07-11T00:00:00+00:00"
        self.assertEqual(analysis_context_fingerprint(first), analysis_context_fingerprint(second))
        second["instrument"]["marketDataGeneratedAt"] = "2026-07-11T00:00:00+00:00"
        self.assertNotEqual(analysis_context_fingerprint(first), analysis_context_fingerprint(second))

    def test_rulebook_contains_derived_rules_without_raw_source_text(self) -> None:
        payload = json.loads(RULEBOOK_PATH.read_text(encoding="utf-8"))
        self.assertFalse(payload["rawSourceTextStored"])
        self.assertGreaterEqual(len(payload["rules"]), 150)

    def test_lexical_retrieval_returns_bounded_rules(self) -> None:
        rules = lexical_retrieve(facts(), limit=10)
        self.assertGreater(len(rules), 0)
        self.assertLessEqual(len(rules), 10)
        self.assertTrue(all(rule.get("id") for rule in rules))

    def test_sector_rules_require_matching_sector_or_industry(self) -> None:
        industrial = facts()
        industrial["instrument"].update({"sector": "Industrials", "industry": "Civil Construction"})
        industrial_ids = {rule["id"] for rule in lexical_retrieve(industrial, limit=50)}
        self.assertNotIn("web-sector-analysis-information-technology", industrial_ids)
        self.assertNotIn("web-sector-analysis-automobiles-part-1", industrial_ids)

        technology = facts()
        technology["instrument"].update({"sector": "Information Technology", "industry": "Software & Consulting"})
        technology_ids = {rule["id"] for rule in lexical_retrieve(technology, limit=50)}
        self.assertIn("web-sector-analysis-information-technology", technology_ids)

        automobile = facts()
        automobile["instrument"].update({"sector": "Consumer Discretionary", "industry": "Automobiles - Passenger Cars"})
        automobile_ids = {rule["id"] for rule in lexical_retrieve(automobile, limit=50)}
        self.assertIn("web-sector-analysis-automobiles-part-1", automobile_ids)

    def test_retrieved_rule_set_has_versioned_filters_and_bounded_rules(self) -> None:
        rule_set = retrieve_rule_set(facts(), limit=10)
        self.assertEqual(rule_set["schemaVersion"], "retrieved-rule-set.v1")
        self.assertEqual(rule_set["filters"]["instrumentType"], "equity")
        self.assertEqual(rule_set["filters"]["action"], "buy")
        self.assertLessEqual(len(rule_set["rules"]), 10)
        self.assertTrue(all("principle" in rule and "source" in rule for rule in rule_set["rules"]))

    def test_normalised_output_passes_runtime_validation(self) -> None:
        self.assertEqual(validate_raw_analysis(raw_analysis()), [])
        analysis = normalise_analysis(raw_analysis(), "fingerprint", [])
        self.assertEqual(validate_analysis(analysis), [])
        self.assertEqual(analysis["schemaVersion"], "llm-analysis.v1")

    def test_raw_validation_rejects_shape_that_normalisation_could_fill(self) -> None:
        malformed = {"decision": {"verdict": "Wait and Watch", "explanation": "Incomplete"}}
        errors = validate_raw_analysis(malformed)
        self.assertIn("chart is required", errors)
        self.assertTrue(any(error.startswith("decision.summary") for error in errors))

    def test_raw_validation_rejects_unknown_reasoning_and_coach_fields(self) -> None:
        output = raw_analysis()
        output["reasoning"]["hiddenRationale"] = "discard me"
        output["coach"]["replacementVerdict"] = "Buy"
        errors = validate_raw_analysis(output)
        self.assertTrue(any("reasoning contains unsupported fields" in error for error in errors))
        self.assertTrue(any("coach contains unsupported fields" in error for error in errors))

    def test_semantic_validation_rejects_empty_refs_numbers_and_verdict_contradiction(self) -> None:
        output = raw_analysis()
        output["decision"]["nextActions"][0]["factRefs"] = []
        output["decision"]["summary"] = "Wait and Watch is wrong; Buy now at 9999."
        output["coach"]["verdictSummary"] = "Do not follow Wait and Watch."
        errors = semantic_analysis_errors(output, facts(), {"rules": []})
        self.assertTrue(any("factRefs must not be empty" in error for error in errors))
        self.assertTrue(any("unsupported number 9999" in error for error in errors))
        self.assertTrue(any("contradicts the deterministic verdict" in error for error in errors))

    def test_semantic_validation_binds_numbers_to_refs_and_preserves_sign_and_verdict_action(self) -> None:
        supplied = facts()
        supplied["technicalEvidence"]["changePct"] = -10.04
        output = raw_analysis()
        output["decision"]["nextActions"][0].update(
            {
                "text": "P/E is 20 and the position has a +10.04% gain.",
                "factRefs": ["deterministicAnalysis.verdict", "technicalEvidence.changePct"],
            }
        )
        output["decision"]["summary"] = "Wait and Watch is recorded, but Buy immediately."
        errors = semantic_analysis_errors(output, supplied, {"rules": [{"id": "pdf-m13-c1-introduction-to-financial-modelling"}]})
        self.assertTrue(any("unsupported number 20 for its factRefs" in error for error in errors))
        self.assertTrue(any("unsupported number 10.04 for its factRefs" in error for error in errors))
        self.assertTrue(any("direct trade action" in error for error in errors))

    def test_production_prompt_includes_exact_output_schema(self) -> None:
        messages = analysis_prompt(facts(), {"schemaVersion": "retrieved-rule-set.v1", "rules": []})
        user = json.loads(messages[1]["content"])
        self.assertEqual(user["facts"], facts())
        self.assertIn("technicalEvidence.rsi14", user["validFactRefs"])
        self.assertNotIn("facts.technicalEvidence.rsi14", user["validFactRefs"])
        self.assertIn("decision", user["outputSchema"]["properties"])
        self.assertEqual(user["outputSchema"]["title"], "LlmAnalysisV1")
        self.assertTrue(any("exactly one concise item" in requirement for requirement in user["requirements"]))
        self.assertTrue(any("exact deterministic verdict" in requirement for requirement in user["requirements"]))
        self.assertTrue(any("never facts.technicalEvidence.ltp" in requirement for requirement in user["requirements"]))
        self.assertTrue(any("portfolio.holdingActions" in requirement for requirement in user["requirements"]))

    def test_repair_prompt_contains_bounded_previous_response(self) -> None:
        messages = analysis_prompt(
            facts(),
            {"schemaVersion": "retrieved-rule-set.v1", "rules": []},
            "schema failed",
            "bad response",
        )
        repair = json.loads(messages[1]["content"])["repair"]
        self.assertEqual(repair["previousResponse"], "bad response")
        self.assertIn("schema failed", repair["validationErrors"])

    def test_unconfigured_provider_returns_non_destructive_setup_state(self) -> None:
        response = generate_analysis(facts(), None)
        self.assertFalse(response["configured"])
        self.assertNotIn("analysis", response)

    def test_valid_provider_output_is_cached_by_fact_fingerprint(self) -> None:
        ANALYSIS_CACHE.clear()
        config = {"provider": "openai_compatible", "model": "test-model", "api_key": "test", "base_url": "https://example.invalid"}
        with patch("server.llm_analysis.call_provider", return_value=json.dumps(raw_analysis())) as provider:
            first = generate_analysis(facts(), config)
            second = generate_analysis(facts(), config)
        self.assertTrue(first["ok"])
        self.assertFalse(first["cached"])
        self.assertTrue(second["cached"])
        self.assertEqual(provider.call_count, 1)

    def test_malformed_provider_output_gets_one_constrained_repair(self) -> None:
        ANALYSIS_CACHE.clear()
        config = {"provider": "openai_compatible", "model": "repair-model", "api_key": "test", "base_url": "https://example.invalid"}
        with patch("server.llm_analysis.call_provider", side_effect=["not-json", json.dumps(raw_analysis())]) as provider:
            response = generate_analysis(facts(), config)
        self.assertTrue(response["ok"])
        self.assertEqual(provider.call_count, 2)

    def test_wrong_provider_shape_gets_one_constrained_repair(self) -> None:
        ANALYSIS_CACHE.clear()
        config = {"provider": "openai_compatible", "model": "repair-shape", "api_key": "test", "base_url": "https://example.invalid"}
        wrong_shape = {"decision": {"verdict": "Wait and Watch", "explanation": "Incomplete"}}
        with patch(
            "server.llm_analysis.call_provider",
            side_effect=[json.dumps(wrong_shape), json.dumps(raw_analysis())],
        ) as provider:
            response = generate_analysis(facts(), config)
        self.assertTrue(response["ok"])
        self.assertEqual(provider.call_count, 2)

    def test_local_provider_requires_loopback_and_versions_artifact(self) -> None:
        local = {"provider": "openai_compatible", "model": "gemma", "base_url": "http://127.0.0.1:8080/v1", "api_key": "local"}
        remote = {**local, "base_url": "https://models.example.com/v1"}
        self.assertTrue(local_endpoint_is_loopback(local))
        self.assertFalse(local_endpoint_is_loopback(remote))
        with patch.dict(
            "os.environ",
            {"LLM_PROVIDER": "local", "LOCAL_MODEL_ARTIFACT_HASH": "abc123", "LOCAL_MODEL_QUANTIZATION": "Q8_0", "LOCAL_LLM_TIMEOUT_SECONDS": "999"},
            clear=False,
        ):
            self.assertIn("abc123", provider_version(local))
            self.assertIn("Q8_0", provider_version(local))
            self.assertEqual(provider_timeout(local), 120)
        with patch.dict("os.environ", {"LLM_PROVIDER": "local"}, clear=False):
            with self.assertRaisesRegex(RuntimeError, "loopback"):
                call_provider([], remote)

    def test_local_failure_can_fall_back_to_gemini_without_caching_as_local(self) -> None:
        ANALYSIS_CACHE.clear()
        config = {"provider": "openai_compatible", "model": "gemma", "api_key": "local", "base_url": "http://127.0.0.1:8080/v1"}
        with (
            patch.dict(
                "os.environ",
                {"LLM_PROVIDER": "local", "LOCAL_LLM_FALLBACK": "gemini", "GEMINI_API_KEY": "test-key", "GEMINI_FALLBACK_MODEL": "gemini-test"},
                clear=False,
            ),
            patch("server.llm_analysis.call_provider", side_effect=[RuntimeError("local unavailable"), json.dumps(raw_analysis())]),
        ):
            response = generate_analysis(facts(), config)
        self.assertTrue(response["ok"])
        self.assertTrue(response["fallbackUsed"])
        self.assertEqual(response["model"], "gemini-test")
        self.assertEqual(ANALYSIS_CACHE, {})

    def test_invalid_local_output_can_fall_back_to_valid_gemini(self) -> None:
        ANALYSIS_CACHE.clear()
        config = {"provider": "openai_compatible", "model": "gemma", "api_key": "local", "base_url": "http://127.0.0.1:8080/v1"}
        with (
            patch.dict(
                "os.environ",
                {"LLM_PROVIDER": "local", "LOCAL_LLM_FALLBACK": "gemini", "GEMINI_API_KEY": "test-key", "GEMINI_FALLBACK_MODEL": "gemini-test"},
                clear=False,
            ),
            patch(
                "server.llm_analysis.call_provider",
                side_effect=["not-json", "still-not-json", json.dumps(raw_analysis())],
            ) as provider,
        ):
            response = generate_analysis(facts(), config)
        self.assertTrue(response["ok"])
        self.assertTrue(response["fallbackUsed"])
        self.assertEqual(provider.call_count, 3)
        self.assertEqual(ANALYSIS_CACHE, {})

    def test_duplicate_inflight_request_reuses_completed_cache(self) -> None:
        ANALYSIS_CACHE.clear()
        ANALYSIS_INFLIGHT.clear()
        config = {"provider": "openai_compatible", "model": "test", "api_key": "test", "base_url": "https://example.invalid"}
        key = f"{provider_version(config)}:{corpus_version()}:{analysis_context_fingerprint(facts())}"
        event = threading.Event()
        ANALYSIS_INFLIGHT[key] = event

        def complete() -> None:
            time.sleep(0.02)
            with ANALYSIS_CACHE_LOCK:
                ANALYSIS_CACHE[key] = {"ok": True, "cached": False}
            event.set()

        thread = threading.Thread(target=complete)
        thread.start()
        response = generate_analysis(facts(), config)
        thread.join()
        self.assertTrue(response["cached"])
        self.assertTrue(response["coalesced"])
        ANALYSIS_INFLIGHT.clear()

    def test_semantic_index_refresh_is_atomic_and_resumable(self) -> None:
        vector = [0.01] * 768
        old_rules = [
            {"id": "old-rule", "module": "Test", "chapter": "Old", "title": "Old", "principle": "Old rule"},
        ]
        new_rules = [
            *old_rules,
            {"id": "new-rule", "module": "Test", "chapter": "New", "title": "New", "principle": "New rule"},
        ]
        with tempfile.TemporaryDirectory() as directory:
            index_path = Path(directory) / "rules.sqlite3"
            staging_path = Path(directory) / "rules.build.sqlite3"
            with (
                patch("server.llm_analysis.INDEX_PATH", index_path),
                patch("server.llm_analysis.INDEX_STAGING_PATH", staging_path),
                patch("server.llm_analysis.load_rules", return_value=old_rules),
                patch("server.llm_analysis._gemini_embedding", return_value=vector),
            ):
                self.assertTrue(build_index(include_embeddings=True)["complete"])
            with closing(sqlite3.connect(index_path)) as connection:
                old_corpus = dict(connection.execute("SELECT key, value FROM metadata"))["corpus_version"]

            with (
                patch("server.llm_analysis.INDEX_PATH", index_path),
                patch("server.llm_analysis.INDEX_STAGING_PATH", staging_path),
                patch("server.llm_analysis.load_rules", return_value=new_rules),
                patch("server.llm_analysis._gemini_embedding", return_value=None),
            ):
                interrupted = build_index(include_embeddings=True)
            self.assertFalse(interrupted["complete"])
            self.assertTrue(staging_path.exists())
            with closing(sqlite3.connect(index_path)) as connection:
                self.assertEqual(dict(connection.execute("SELECT key, value FROM metadata"))["corpus_version"], old_corpus)

            with (
                patch("server.llm_analysis.INDEX_PATH", index_path),
                patch("server.llm_analysis.INDEX_STAGING_PATH", staging_path),
                patch("server.llm_analysis.load_rules", return_value=new_rules),
                patch("server.llm_analysis._gemini_embedding", return_value=vector) as embed,
            ):
                resumed = build_index(include_embeddings=True)
            self.assertTrue(resumed["complete"])
            self.assertEqual(embed.call_count, 1)
            self.assertFalse(staging_path.exists())
            with closing(sqlite3.connect(index_path)) as connection:
                metadata = dict(connection.execute("SELECT key, value FROM metadata"))
                self.assertEqual(metadata["build_status"], "complete")
                self.assertEqual(metadata["embedded_count"], "2")


if __name__ == "__main__":
    unittest.main()
