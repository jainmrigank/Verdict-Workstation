from __future__ import annotations

import argparse
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools.gemma_bakeoff import dry_run
from tools.model_bakeoff_eval import compare, percentile95
from tools.teacher_bakeoff import run as run_teacher_bakeoff


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
    def test_teacher_bakeoff_checkpoints_candidate_without_mutating_baseline(self) -> None:
        baseline = {
            "id": "gold-one",
            "split": "train",
            "facts": {
                "userContext": {"action": "Buy"},
                "deterministicAnalysis": {"verdict": "Wait and Watch"},
                "uiOptions": {"patternsEnabled": False},
            },
            "retrievedRuleIds": [],
            "retrievedRuleSet": {"rules": []},
            "output": {"decision": {"summary": "Baseline"}},
        }
        candidate_output = {"decision": {"summary": "Candidate"}}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            gold_path = root / "gold.jsonl"
            gold_path.write_text(json.dumps(baseline) + "\n", encoding="utf-8")
            with (
                patch("tools.teacher_bakeoff.GOLD_PATH", gold_path),
                patch("tools.teacher_bakeoff.OUTPUT_ROOT", root / "reports"),
                patch("tools.teacher_bakeoff.generate_output", return_value=candidate_output),
                patch("tools.teacher_bakeoff.normalise_output_contract", side_effect=lambda output, _facts, _rules: output),
                patch("tools.teacher_bakeoff.row_audit_errors", return_value=[]),
            ):
                result = run_teacher_bakeoff("cerebras", 1, 0)
            stored_baseline = json.loads(gold_path.read_text(encoding="utf-8"))
            candidate_path = Path(result["candidatePath"])
            stored_candidate = json.loads(candidate_path.read_text(encoding="utf-8"))
        self.assertEqual(result["automatedPasses"], 1)
        self.assertEqual(stored_baseline["output"]["decision"]["summary"], "Baseline")
        self.assertEqual(stored_candidate["output"]["decision"]["summary"], "Candidate")
        self.assertEqual(stored_candidate["candidateTeacher"]["provider"], "cerebras")

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
