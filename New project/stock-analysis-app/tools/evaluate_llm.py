#!/usr/bin/env python3
"""Run deterministic schema, grounding, and completeness checks."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

APP_ROOT = Path(__file__).resolve().parents[1]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from server.llm_analysis import normalise_analysis, validate_analysis


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def fact_paths(value: Any, prefix: str = "") -> set[str]:
    paths: set[str] = set()
    if isinstance(value, dict):
        for key, item in value.items():
            path = f"{prefix}.{key}" if prefix else str(key)
            paths.add(path)
            paths.update(fact_paths(item, path))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            paths.update(fact_paths(item, f"{prefix}.{index}"))
    return paths


def narrative_items(value: Any):
    if isinstance(value, dict):
        if isinstance(value.get("text"), str):
            yield value
        for item in value.values():
            yield from narrative_items(item)
    elif isinstance(value, list):
        for item in value:
            yield from narrative_items(item)


def evaluate(rows: list[dict[str, Any]]) -> dict[str, Any]:
    schema_failures = 0
    unsupported_refs = 0
    empty_summaries = 0
    reviewed = 0
    for row in rows:
        reviewed += int(row.get("reviewStatus") == "approved")
        facts = row.get("facts") or {}
        output = normalise_analysis(row.get("output") or {}, "evaluation", [])
        schema_failures += int(bool(validate_analysis(output)))
        allowed_paths = fact_paths(facts)
        for item in narrative_items(output):
            unsupported_refs += sum(ref not in allowed_paths for ref in item.get("factRefs") or [])
        for section in ("decision", "chart", "company", "portfolio"):
            empty_summaries += int(not str((output.get(section) or {}).get("summary") or "").strip())
    count = len(rows)
    return {
        "examples": count,
        "approvedGold": reviewed,
        "schemaValidityPct": round((count - schema_failures) / count * 100, 2) if count else 0,
        "unsupportedFactRefs": unsupported_refs,
        "emptyRequiredSummaries": empty_summaries,
        "passesAutomatedGate": bool(count and not schema_failures and not unsupported_refs and not empty_summaries),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    result = evaluate(read_jsonl(args.path))
    print(json.dumps(result, indent=2))
    return 0 if result["passesAutomatedGate"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
