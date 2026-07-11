from __future__ import annotations

import argparse
import json
import tempfile
import unittest
from pathlib import Path

from tools.gemma_bakeoff import dry_run
from tools.model_bakeoff_eval import compare, percentile95


def training_row(index: int, split: str) -> dict:
    return {
        "id": f"row-{split}-{index}",
        "lineageId": f"lineage-{split}-{index}",
        "split": split,
        "messages": [
            {"role": "system", "content": "system"},
            {"role": "user", "content": "{}"},
            {"role": "assistant", "content": "{}"},
        ],
        "metadata": {},
    }


class ModelBakeoffTests(unittest.TestCase):
    def test_pilot_dry_run_enforces_75_15_and_no_lineage_overlap(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, rows in (
                ("pilot_train.jsonl", [training_row(index, "train") for index in range(75)]),
                ("pilot_validation.jsonl", [training_row(index, "validation") for index in range(15)]),
            ):
                (root / name).write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
            result = dry_run(root, final=False)
        self.assertEqual(result["errors"], [])
        self.assertEqual(result["train"], 75)
        self.assertEqual(result["validation"], 15)

    def test_promotion_requires_every_hard_and_human_gate(self) -> None:
        baseline = {"name": "gemini", "averageCompletenessPct": 98}
        candidate = {
            "name": "gemma",
            "schemaValidityPct": 100,
            "verdictPreservationPct": 100,
            "unsupportedFactRefs": 0,
            "unsupportedRuleRefs": 0,
            "unsupportedNumericClaims": 0,
            "averageCompletenessPct": 98,
            "patternsRespectedPct": 100,
            "p95LatencySeconds": 119,
            "errorRatePct": 0,
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            baseline_path = root / "baseline.json"
            candidate_path = root / "candidate.json"
            human_path = root / "human.json"
            baseline_path.write_text(json.dumps(baseline), encoding="utf-8")
            candidate_path.write_text(json.dumps(candidate), encoding="utf-8")
            human_path.write_text(json.dumps({"baselineMean": 4.2, "candidateMean": 4.1}), encoding="utf-8")
            result = compare(argparse.Namespace(baseline=baseline_path, candidate=candidate_path, human_scores=human_path))
        self.assertTrue(result["promote"])
        candidate["verdictPreservationPct"] = 99
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            baseline_path = root / "baseline.json"
            candidate_path = root / "candidate.json"
            baseline_path.write_text(json.dumps(baseline), encoding="utf-8")
            candidate_path.write_text(json.dumps(candidate), encoding="utf-8")
            result = compare(argparse.Namespace(baseline=baseline_path, candidate=candidate_path, human_scores=None))
        self.assertFalse(result["promote"])

    def test_percentile_uses_observed_upper_tail(self) -> None:
        self.assertEqual(percentile95([1, 2, 3, 4, 5]), 5)


if __name__ == "__main__":
    unittest.main()
