from __future__ import annotations

import unittest

from tools.review_candidates import REVIEW_CHECKS, apply_review
from tools.llm_dataset import generate_candidates
from tools.approve_candidates import audit_candidate, audit_candidates, unsupported_numeric_claims


class CandidateReviewTests(unittest.TestCase):
    def test_needs_input_rejects_direct_trade_instruction(self) -> None:
        row = generate_candidates(1)[0]
        row["id"] = "test-direct-action"
        row["facts"]["userContext"]["action"] = "Sell"
        row["facts"]["deterministicAnalysis"]["verdict"] = "Needs Input"
        row["output"]["decision"]["summary"] = "Needs Input before deciding."
        row["output"]["coach"]["verdictSummary"] = "Needs Input before deciding."
        row["output"]["portfolio"]["holdingActions"] = [
            {"text": "Sell the position now.", "factRefs": ["userContext.action"], "ruleRefs": ["test"]}
        ]
        errors = audit_candidate(row)
        self.assertTrue(any("cannot issue a direct Buy/Sell instruction" in error for error in errors))

    def test_needs_input_allows_sell_intent_to_remain_unconfirmed(self) -> None:
        row = generate_candidates(1)[0]
        row["id"] = "test-unconfirmed-action"
        row["facts"]["userContext"]["action"] = "Sell"
        row["facts"]["deterministicAnalysis"]["verdict"] = "Needs Input"
        row["output"]["decision"]["summary"] = "Needs Input before deciding."
        row["output"]["coach"]["verdictSummary"] = "Needs Input before deciding."
        row["output"]["portfolio"]["holdingActions"] = [
            {
                "text": "Sell remains unconfirmed; review the evidence first.",
                "factRefs": ["userContext.action"],
                "ruleRefs": ["test"],
            }
        ]
        errors = audit_candidate(row)
        self.assertFalse(any("cannot issue a direct Buy/Sell instruction" in error for error in errors))

    def test_needs_input_rejects_conditional_execution_instruction(self) -> None:
        row = generate_candidates(1)[0]
        row["id"] = "test-conditional-action"
        row["facts"]["userContext"]["action"] = "Buy"
        row["facts"]["deterministicAnalysis"]["verdict"] = "Needs Input"
        row["output"]["decision"]["summary"] = "Needs Input before deciding."
        row["output"]["coach"]["verdictSummary"] = "Needs Input before deciding."
        row["output"]["portfolio"]["holdingActions"] = [
            {"text": "Buy only after missing evidence is supplied.", "factRefs": ["userContext.action"], "ruleRefs": ["test"]}
        ]
        errors = audit_candidate(row)
        self.assertTrue(any("cannot issue a direct Buy/Sell instruction" in error for error in errors))

    def test_numeric_grounding_ignores_indicator_suffixes_and_range_hyphens(self) -> None:
        row = {
            "facts": {
                "technicalEvidence": {"rsi14": 44.28},
                "userContext": {"horizon": "6-12m"},
            },
            "output": {
                "decision": {
                    "nextActions": [
                        {
                            "text": "RSI14 is 44.28 for the 6-12 month horizon.",
                            "factRefs": ["technicalEvidence.rsi14", "userContext.horizon"],
                            "ruleRefs": ["test"],
                        }
                    ]
                }
            },
        }
        self.assertEqual(unsupported_numeric_claims(row), [])
        row["output"]["decision"]["nextActions"][0]["text"] += " Estimated position value is 25.5%."
        self.assertEqual(unsupported_numeric_claims(row), [25.5])

    def test_candidate_approval_runs_numeric_grounding_gate(self) -> None:
        rows = generate_candidates(120)
        rows[0]["output"]["decision"]["summary"] += " Invented level 9999."
        result = audit_candidates(rows)
        self.assertTrue(any("unsupported numeric claims" in error for error in result["errors"]))

    def test_indian_listing_rejects_invented_dollar_currency(self) -> None:
        row = generate_candidates(1)[0]
        row["facts"]["instrument"]["symbol"] = "NSE:TEST"
        row["output"]["decision"]["nextActions"][0]["text"] = "Keep risk within $1000."
        errors = audit_candidate(row)
        self.assertTrue(any("unsupported dollar currency marker" in error for error in errors))

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
