#!/usr/bin/env python3
"""Compare a candidate teacher against accepted public-market gold cases."""

from __future__ import annotations

import argparse
import copy
import json
import statistics
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


APP_ROOT = Path(__file__).resolve().parents[1]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from tools.llm_dataset import (
    GOLD_PATH,
    ProviderQuotaError,
    configure_gemini_pacing,
    dataset_provider_metadata,
    load_local_env,
    read_jsonl,
    write_jsonl,
)
from tools.reasoning_dataset import generate_output, normalise_output_contract, repair_output, row_audit_errors


OUTPUT_ROOT = APP_ROOT / "data" / "generated" / "teacher_bakeoff"


def narrative_texts(value: Any) -> list[str]:
    texts: list[str] = []
    if isinstance(value, dict):
        if isinstance(value.get("text"), str):
            texts.append(value["text"].strip())
        for item in value.values():
            texts.extend(narrative_texts(item))
    elif isinstance(value, list):
        for item in value:
            texts.extend(narrative_texts(item))
    return [text for text in texts if text]


def output_metrics(output: dict[str, Any]) -> dict[str, Any]:
    texts = narrative_texts(output)
    normalised = [" ".join(text.casefold().split()) for text in texts]
    summaries = [
        str((output.get(section) or {}).get("summary") or "").strip()
        for section in ("decision", "chart", "company", "portfolio")
    ]
    return {
        "narrativeItems": len(texts),
        "meanItemWords": round(statistics.mean(len(text.split()) for text in texts), 2) if texts else 0,
        "duplicateNarratives": len(normalised) - len(set(normalised)),
        "populatedSummaries": sum(bool(summary) for summary in summaries),
        "outputBytes": len(json.dumps(output, ensure_ascii=False)),
    }


def run(provider: str, limit: int, rpm: float) -> dict[str, Any]:
    metadata = dataset_provider_metadata(provider)
    baseline_rows = read_jsonl(GOLD_PATH)[:limit]
    if not baseline_rows:
        raise RuntimeError("Generate at least one accepted gold case before running a teacher bake-off.")
    configure_gemini_pacing(rpm)
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    candidate_path = OUTPUT_ROOT / f"{provider}-candidates.jsonl"
    candidates = {str(row.get("id")): row for row in read_jsonl(candidate_path)}
    quota: dict[str, Any] | None = None

    for baseline in baseline_rows:
        row_id = str(baseline["id"])
        if row_id in candidates and not candidates[row_id].get("candidateAuditErrors"):
            continue
        facts = baseline["facts"]
        rule_set = baseline["retrievedRuleSet"]
        output: dict[str, Any] | None = None
        repairs = 0
        try:
            output = generate_output(facts, rule_set, provider=provider)
            candidate = copy.deepcopy(baseline)
            candidate["output"] = normalise_output_contract(output, facts, rule_set)
            errors = row_audit_errors(candidate)
            if errors:
                repairs = 1
                output = repair_output(facts, rule_set, output, errors, provider=provider)
                candidate["output"] = normalise_output_contract(output, facts, rule_set)
                errors = row_audit_errors(candidate)
        except ProviderQuotaError as exc:
            quota = exc.as_dict()
            break
        except RuntimeError as exc:
            candidate = copy.deepcopy(baseline)
            errors = [str(exc)]

        candidate["reviewStatus"] = "teacher-candidate"
        candidate["reviewNotes"] = "Parallel teacher output; not approved gold."
        candidate["candidateTeacher"] = metadata
        candidate["candidateRepairs"] = repairs
        candidate["candidateAuditErrors"] = errors
        candidate["baselineMetrics"] = output_metrics(baseline["output"])
        candidate["candidateMetrics"] = output_metrics(candidate["output"])
        candidates[row_id] = candidate
        write_jsonl(candidate_path, [candidates[key] for key in sorted(candidates)])

    compared = [candidates[str(row["id"])] for row in baseline_rows if str(row["id"]) in candidates]
    passed = [row for row in compared if not row.get("candidateAuditErrors")]
    report = {
        "schemaVersion": "teacher-bakeoff-report.v1",
        "generatedAt": datetime.now(UTC).isoformat(),
        "candidateTeacher": metadata,
        "requestedCases": len(baseline_rows),
        "comparedCases": len(compared),
        "automatedPasses": len(passed),
        "repairs": sum(int(row.get("candidateRepairs") or 0) for row in compared),
        "quotaStop": quota,
        "candidatePath": str(candidate_path),
        "needsHumanReview": [str(row["id"]) for row in passed],
        "failures": {
            str(row["id"]): row.get("candidateAuditErrors")
            for row in compared
            if row.get("candidateAuditErrors")
        },
    }
    report_path = OUTPUT_ROOT / f"{provider}-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {**report, "reportPath": str(report_path)}


def main() -> int:
    load_local_env()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--provider", choices=("cerebras", "gemini"), default="cerebras")
    parser.add_argument("--limit", type=int, default=3)
    parser.add_argument("--rpm", type=float, default=2)
    args = parser.parse_args()
    result = run(args.provider, max(1, args.limit), max(0.1, args.rpm))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["automatedPasses"] == result["requestedCases"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
