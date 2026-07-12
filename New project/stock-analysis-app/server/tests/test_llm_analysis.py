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
    validate_analysis,
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

    def test_malformed_provider_output_gets_one_constrained_repair(self) -> None:
        ANALYSIS_CACHE.clear()
        config = {"provider": "openai_compatible", "model": "repair-model", "api_key": "test", "base_url": "https://example.invalid"}
        with patch("server.llm_analysis.call_provider", side_effect=["not-json", json.dumps(raw_analysis())]) as provider:
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
