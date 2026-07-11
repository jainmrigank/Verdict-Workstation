from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools.llm_dataset import GeminiQuotaError, expand_to_target, expansion_schedule, provider_row
from tools.reasoning_dataset import build_facts, validate_manifest


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


if __name__ == "__main__":
    unittest.main()
