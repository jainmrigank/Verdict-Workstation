#!/usr/bin/env python3
"""Strictly audit and optionally approve the 120 gold candidates."""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

APP_ROOT = Path(__file__).resolve().parents[1]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from tools.evaluate_llm import fact_paths, narrative_items


CANDIDATES_PATH = APP_ROOT / "data" / "training" / "contract_fixtures.jsonl"
RULEBOOK_PATH = APP_ROOT / "data" / "reference" / "varsity_rulebook.json"
REVIEW_CHECKS = ("verdict", "grounding", "rules", "coverage", "gaps")
REQUIRED_ARRAYS = {
    "decision": ("nextActions", "avoid", "priceDrivers", "risks", "dataGaps"),
    "chart": ("trend", "momentum", "volume", "volatility", "levels", "patterns"),
    "company": (
        "businessModel", "quality", "profitability", "balanceSheet", "cashFlow",
        "valuation", "sectorDrivers", "catalysts", "risks", "dataGaps",
    ),
    "portfolio": ("positionFit", "concentration", "sizing", "holdingActions", "risks"),
}
NUMBER_PATTERN = re.compile(r"(?<![A-Za-z0-9])-?\d[\d,]*(?:\.\d+)?")
DIRECT_ACTION_PATTERN = re.compile(
    r"^(?:immediately\s+)?(?:buy|sell)\b|^(?:execute|place)\s+(?:the\s+)?(?:buy|sell)\b",
    re.IGNORECASE,
)


def read_candidates(path: Path = CANDIDATES_PATH) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def write_candidates(rows: list[dict[str, Any]], path: Path = CANDIDATES_PATH) -> None:
    payload = "".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n" for row in rows)
    temporary = path.with_suffix(".jsonl.tmp")
    temporary.write_text(payload, encoding="utf-8")
    temporary.replace(path)


def audit_candidate(row: dict[str, Any], *, require_synthetic: bool = True) -> list[str]:
    errors: list[str] = []
    candidate_id = str(row.get("id") or "missing-id")
    facts = row.get("facts")
    output = row.get("output")
    retrieved_rules = set(row.get("retrievedRuleIds") or [])
    if not isinstance(facts, dict) or not isinstance(output, dict):
        return [f"{candidate_id}: facts and output must be objects"]
    if require_synthetic and not str((facts.get("instrument") or {}).get("symbol") or "").startswith("TEST:"):
        errors.append(f"{candidate_id}: instrument must remain synthetic")
    expected_verdict = str((facts.get("deterministicAnalysis") or {}).get("verdict") or "")
    action = str((facts.get("userContext") or {}).get("action") or "")
    data_state = str((facts.get("dataQuality") or {}).get("state") or "")
    if action not in {"Buy", "Sell"}:
        errors.append(f"{candidate_id}: unsupported action {action!r}")
    if not expected_verdict:
        errors.append(f"{candidate_id}: deterministic verdict is missing")

    for section, arrays in REQUIRED_ARRAYS.items():
        section_value = output.get(section)
        if not isinstance(section_value, dict):
            errors.append(f"{candidate_id}: missing {section} section")
            continue
        if not str(section_value.get("summary") or "").strip():
            errors.append(f"{candidate_id}: {section}.summary is empty")
        for key in arrays:
            if section == "chart" and key == "patterns" and not require_synthetic and not bool((facts.get("uiOptions") or {}).get("patternsEnabled")):
                if not isinstance(section_value.get(key), list):
                    errors.append(f"{candidate_id}: {section}.{key} must be an array")
                continue
            if not isinstance(section_value.get(key), list) or not section_value[key]:
                errors.append(f"{candidate_id}: {section}.{key} must be populated")

    reasoning = output.get("reasoning") if isinstance(output.get("reasoning"), dict) else {}
    coach = output.get("coach") if isinstance(output.get("coach"), dict) else {}
    if not isinstance(reasoning.get("steps"), list) or not reasoning["steps"]:
        errors.append(f"{candidate_id}: reasoning.steps must be populated")
    if not isinstance(coach.get("questionsBeforeAction"), list) or not coach["questionsBeforeAction"]:
        errors.append(f"{candidate_id}: coach.questionsBeforeAction must be populated")

    verdict_texts = [
        str((output.get("decision") or {}).get("summary") or ""),
        str(coach.get("verdictSummary") or ""),
    ]
    if expected_verdict and any(expected_verdict.lower() not in text.lower() for text in verdict_texts):
        errors.append(f"{candidate_id}: deterministic verdict is not preserved in decision and coach summaries")

    holding_actions = (output.get("portfolio") or {}).get("holdingActions") or []
    if action and not any(action.lower() in str(item.get("text") or "").lower() for item in holding_actions if isinstance(item, dict)):
        errors.append(f"{candidate_id}: portfolio action does not match {action}")
    if expected_verdict.casefold() == "needs input":
        action_items = [
            *((output.get("decision") or {}).get("nextActions") or []),
            *holding_actions,
        ]
        direct_actions = [
            str(item.get("text") or "").strip()
            for item in action_items
            if isinstance(item, dict) and DIRECT_ACTION_PATTERN.search(str(item.get("text") or "").strip())
        ]
        if direct_actions:
            errors.append(
                f"{candidate_id}: Needs Input cannot issue a direct Buy/Sell instruction: {direct_actions[:2]}"
            )

    allowed_paths = fact_paths(facts)
    indian_listing = str((facts.get("instrument") or {}).get("symbol") or "").upper().startswith(("NSE:", "BSE:"))
    for index, item in enumerate(narrative_items(output)):
        text = str(item.get("text") or "").strip()
        fact_refs = item.get("factRefs") or []
        rule_refs = item.get("ruleRefs") or []
        if not text:
            errors.append(f"{candidate_id}: narrative item {index} has no text")
        if not fact_refs:
            errors.append(f"{candidate_id}: narrative item {index} has no factRefs")
        unsupported_facts = [ref for ref in fact_refs if ref not in allowed_paths]
        if unsupported_facts:
            errors.append(f"{candidate_id}: unsupported factRefs {unsupported_facts}")
        if not rule_refs:
            errors.append(f"{candidate_id}: narrative item {index} has no ruleRefs")
        unsupported_rules = [ref for ref in rule_refs if ref not in retrieved_rules]
        if unsupported_rules:
            errors.append(f"{candidate_id}: unsupported ruleRefs {unsupported_rules}")
        if indian_listing and "$" in text:
            errors.append(f"{candidate_id}: unsupported dollar currency marker in narrative item {index}")

    warnings = output.get("warnings")
    if not isinstance(warnings, list):
        errors.append(f"{candidate_id}: warnings must be an array")
    elif data_state == "incomplete" and not warnings:
        errors.append(f"{candidate_id}: incomplete evidence requires an explicit warning")
    patterns_enabled = bool((facts.get("uiOptions") or {}).get("patternsEnabled"))
    patterns = ((output.get("chart") or {}).get("patterns") or []) if isinstance(output.get("chart"), dict) else []
    if not require_synthetic and not patterns_enabled and patterns:
        errors.append(f"{candidate_id}: chart.patterns must be empty when patterns are disabled")
    return errors


def numeric_values(value: Any) -> list[float]:
    values: list[float] = []
    if isinstance(value, dict):
        for item in value.values():
            values.extend(numeric_values(item))
    elif isinstance(value, list):
        for item in value:
            values.extend(numeric_values(item))
    elif isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value)):
        values.append(float(value))
    elif isinstance(value, str):
        values.extend(float(match.replace(",", "")) for match in NUMBER_PATTERN.findall(value))
    return values


def unsupported_numeric_claims(row: dict[str, Any]) -> list[float]:
    allowed = numeric_values(row.get("facts") or {})
    unsupported: list[float] = []
    for narrative in narrative_items(row.get("output") or {}):
        for raw in NUMBER_PATTERN.findall(str(narrative.get("text") or "")):
            claimed = float(raw.replace(",", ""))
            if claimed in {0.0, 1.0, 14.0, 20.0, 50.0, 100.0}:
                continue
            if not any(abs(claimed - value) <= max(0.02, abs(value) * 0.005) for value in allowed):
                unsupported.append(claimed)
    return unsupported


def audit_candidates(rows: list[dict[str, Any]]) -> dict[str, Any]:
    errors: list[str] = []
    rulebook = json.loads(RULEBOOK_PATH.read_text(encoding="utf-8"))
    known_rules = {str(rule.get("id")) for rule in rulebook.get("rules") or [] if isinstance(rule, dict)}
    ids = [str(row.get("id") or "") for row in rows]
    if len(rows) != 120:
        errors.append(f"Expected 120 candidates, found {len(rows)}")
    if len(set(ids)) != len(ids):
        errors.append("Candidate IDs are not unique")
    fingerprints = [
        json.dumps(row.get("facts") or {}, sort_keys=True, separators=(",", ":"))
        for row in rows
    ]
    if len(set(fingerprints)) != len(fingerprints):
        errors.append("Candidate fact bundles are not unique")
    for row in rows:
        unknown_rules = sorted(set(row.get("retrievedRuleIds") or []) - known_rules)
        if unknown_rules:
            errors.append(f"{row.get('id')}: retrievedRuleIds are not in the Varsity rulebook: {unknown_rules}")
        errors.extend(audit_candidate(row))
    return {
        "candidates": len(rows),
        "passed": len(rows) if not errors else len(rows) - len({error.split(":", 1)[0] for error in errors if ":" in error}),
        "failed": len(errors),
        "errors": errors,
    }


def approve_candidates(rows: list[dict[str, Any]]) -> dict[str, Any]:
    result = audit_candidates(rows)
    if result["errors"]:
        raise RuntimeError(f"Approval blocked by {len(result['errors'])} audit failures.")
    reviewed_at = datetime.now(UTC).isoformat()
    for row in rows:
        row["reviewStatus"] = "approved"
        row["reviewNotes"] = "Codex-assisted strict audit passed at the user's explicit request."
        row["reviewAudit"] = {
            "reviewerType": "codex-assisted",
            "requestedByUser": True,
            "method": "strict-grounding-v1",
            "checks": {name: True for name in REVIEW_CHECKS},
            "reviewedAt": reviewed_at,
        }
    write_candidates(rows)
    return {**result, "approved": len(rows), "reviewerType": "codex-assisted"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--approve", action="store_true", help="Write approved statuses after every strict check passes.")
    parser.add_argument(
        "--requested-by-user",
        action="store_true",
        help="Required with --approve so delegated provenance is explicit.",
    )
    args = parser.parse_args()
    rows = read_candidates()
    if args.approve:
        if not args.requested_by_user:
            raise SystemExit("--approve requires --requested-by-user.")
        result = approve_candidates(rows)
    else:
        result = audit_candidates(rows)
    print(json.dumps(result, indent=2))
    return 0 if not result["errors"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
