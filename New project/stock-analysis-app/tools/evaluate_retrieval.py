#!/usr/bin/env python3
"""Evaluate reviewed Varsity retrieval cases against the current local index."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


APP_ROOT = Path(__file__).resolve().parents[1]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from server.llm_analysis import load_local_env, retrieve_rule_set


DEFAULT_CASES = APP_ROOT / "data" / "reference" / "retrieval_eval.json"


def case_context(case: dict[str, Any]) -> dict[str, Any]:
    return {
        "schemaVersion": "analysis-facts.v1",
        "instrument": {
            "symbol": f"TEST:{case['id']}",
            "type": case.get("instrumentType") or "unknown",
            "sector": case.get("sector") or "",
        },
        "userContext": {
            "action": case.get("action") or "Buy",
            "horizon": case.get("horizon") or "1-3y",
        },
        "deterministicAnalysis": {"retrievalQuestion": case.get("query") or ""},
        "technicalEvidence": {},
        "fundamentalEvidence": {},
        "portfolioEvidence": {},
        "dataQuality": {"state": case.get("dataState") or "complete"},
        "uiOptions": {"requestedAreas": case.get("requestedAreas") or []},
    }


def evaluate(cases: list[dict[str, Any]]) -> dict[str, Any]:
    results = []
    modes: dict[str, int] = {}
    for case in cases:
        rule_set = retrieve_rule_set(case_context(case))
        modes[rule_set["mode"]] = modes.get(rule_set["mode"], 0) + 1
        returned_ids = [rule["id"] for rule in rule_set["rules"]]
        returned_modules = [rule["module"] for rule in rule_set["rules"]]
        expected_ids = case.get("expectedRuleIds") or []
        expected_modules = case.get("expectedModules") or []
        hit = bool(set(expected_ids) & set(returned_ids) or set(expected_modules) & set(returned_modules))
        results.append(
            {
                "id": case["id"],
                "hit": hit,
                "mode": rule_set["mode"],
                "expectedRuleIds": expected_ids,
                "expectedModules": expected_modules,
                "returnedIds": returned_ids,
                "returnedModules": returned_modules,
            }
        )
    hits = sum(result["hit"] for result in results)
    recall = round(hits / len(results) * 100, 2) if results else 0.0
    return {
        "cases": len(results),
        "hits": hits,
        "top10RecallPct": recall,
        "passesTarget": recall >= 90.0,
        "modes": modes,
        "failures": [result for result in results if not result["hit"]],
    }


def main() -> int:
    load_local_env()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", type=Path, default=DEFAULT_CASES)
    args = parser.parse_args()
    payload = json.loads(args.cases.read_text(encoding="utf-8"))
    result = evaluate(payload.get("cases") or [])
    print(json.dumps(result, indent=2))
    return 0 if result["passesTarget"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
