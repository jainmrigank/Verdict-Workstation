from __future__ import annotations

import unittest

from tools.review_candidates import REVIEW_CHECKS, apply_review
from tools.llm_dataset import generate_candidates
from tools.approve_candidates import audit_candidates


class CandidateReviewTests(unittest.TestCase):
    def setUp(self) -> None:
        self.rows = [
            {
                "id": "gold-candidate-001",
                "reviewStatus": "pending",
                "reviewNotes": "",
                "output": {"decision": {"summary": "Original"}},
            }
        ]

    def test_approval_requires_every_human_check(self) -> None:
        with self.assertRaisesRegex(ValueError, "Complete every review check"):
            apply_review(
                self.rows,
                {
                    "id": "gold-candidate-001",
                    "status": "approved",
                    "output": {"decision": {"summary": "Reviewed"}},
                    "checks": {"verdict": True},
                },
            )

    def test_review_updates_output_notes_and_status(self) -> None:
        candidate = apply_review(
            self.rows,
            {
                "id": "gold-candidate-001",
                "status": "approved",
                "output": {"decision": {"summary": "Reviewed"}},
                "reviewNotes": "Grounded and concise.",
                "checks": {name: True for name in REVIEW_CHECKS},
            },
        )
        self.assertEqual(candidate["reviewStatus"], "approved")
        self.assertEqual(candidate["reviewNotes"], "Grounded and concise.")
        self.assertEqual(candidate["output"]["decision"]["summary"], "Reviewed")
        self.assertTrue(all(candidate["humanReview"]["checks"].values()))

    def test_gold_candidates_cover_all_analysis_dimensions(self) -> None:
        rows = generate_candidates(120)
        self.assertEqual({row["facts"]["userContext"]["action"] for row in rows}, {"Buy", "Sell"})
        self.assertEqual(
            {row["facts"]["instrument"]["type"] for row in rows},
            {"equity", "etf", "index", "fund", "unknown"},
        )
        self.assertEqual({row["facts"]["technicalEvidence"]["trend"] for row in rows}, {"rising", "mixed", "falling"})
        self.assertEqual({row["facts"]["dataQuality"]["state"] for row in rows}, {"complete", "incomplete"})
        self.assertEqual(len({row["facts"]["userContext"]["horizon"] for row in rows}), 4)
        self.assertEqual(len({row["facts"]["userContext"]["riskProfile"] for row in rows}), 4)
        self.assertEqual(audit_candidates(rows)["errors"], [])
        for row in rows:
            if row["facts"]["instrument"]["type"] != "equity":
                self.assertIn("not directly applicable", row["output"]["company"]["summary"])


if __name__ == "__main__":
    unittest.main()
