from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from server.llm_analysis import (
    ANALYSIS_CACHE,
    RULEBOOK_PATH,
    analysis_context_fingerprint,
    build_index,
    context_fingerprint,
    generate_analysis,
    lexical_retrieve,
    normalise_analysis,
    retrieve_rule_set,
    validate_analysis,
)


def facts() -> dict:
    return {
        "schemaVersion": "analysis-facts.v1",
        "generatedAt": "2026-07-10T00:00:00+00:00",
        "instrument": {"symbol": "NSE:TEST", "type": "equity", "sector": "Banking"},
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
    item = {"text": "Use the supplied evidence.", "tone": "neutral", "factRefs": ["deterministicAnalysis.verdict"], "ruleRefs": []}
    return {
        "decision": {"summary": "Decision summary", "nextActions": [item], "avoid": [item], "priceDrivers": [item], "risks": [item], "dataGaps": []},
        "chart": {"summary": "Chart summary", "trend": [item], "momentum": [], "volume": [], "volatility": [], "levels": [], "patterns": []},
        "company": {"summary": "Company summary", "businessModel": [], "quality": [item], "profitability": [], "balanceSheet": [], "cashFlow": [], "valuation": [], "sectorDrivers": [], "catalysts": [], "risks": [], "dataGaps": []},
        "portfolio": {"summary": "Portfolio summary", "positionFit": [item], "concentration": [], "sizing": [], "holdingActions": [], "risks": []},
        "reasoning": {"steps": [{**item, "evidence": "Evidence", "implication": "Implication", "action": "Action"}]},
        "coach": {"verdictSummary": "Verdict", "chartSummary": "Chart", "companySummary": "Company", "questionsBeforeAction": [item]},
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

    def test_retrieved_rule_set_has_versioned_filters_and_bounded_rules(self) -> None:
        rule_set = retrieve_rule_set(facts(), limit=10)
        self.assertEqual(rule_set["schemaVersion"], "retrieved-rule-set.v1")
        self.assertEqual(rule_set["filters"]["instrumentType"], "equity")
        self.assertEqual(rule_set["filters"]["action"], "buy")
        self.assertLessEqual(len(rule_set["rules"]), 10)
        self.assertTrue(all("principle" in rule and "source" in rule for rule in rule_set["rules"]))

    def test_normalised_output_passes_runtime_validation(self) -> None:
        analysis = normalise_analysis(raw_analysis(), "fingerprint", [])
        self.assertEqual(validate_analysis(analysis), [])
        self.assertEqual(analysis["schemaVersion"], "llm-analysis.v1")

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
