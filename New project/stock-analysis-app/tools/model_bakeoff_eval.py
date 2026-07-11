#!/usr/bin/env python3
"""Run and compare Gemini/Gemma responses against the sealed bake-off gates."""

from __future__ import annotations

import argparse
import json
import os
import statistics
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


APP_ROOT = Path(__file__).resolve().parents[1]
if str(APP_ROOT) not in os.sys.path:
    os.sys.path.insert(0, str(APP_ROOT))

from server.llm_analysis import normalise_analysis, validate_analysis
from tools.approve_candidates import unsupported_numeric_claims
from tools.evaluate_llm import fact_paths, narrative_items
from tools.llm_dataset import load_local_env, read_jsonl, write_jsonl


PROVIDER_ROOT = APP_ROOT / "data" / "training" / "provider"
REPORT_ROOT = APP_ROOT / "data" / "generated" / "model_eval"
SECTION_ARRAYS = {
    "decision": ("nextActions", "avoid", "priceDrivers", "risks", "dataGaps"),
    "chart": ("trend", "momentum", "volume", "volatility", "levels", "patterns"),
    "company": ("businessModel", "quality", "profitability", "balanceSheet", "cashFlow", "valuation", "sectorDrivers", "catalysts", "risks", "dataGaps"),
    "portfolio": ("positionFit", "concentration", "sizing", "holdingActions", "risks"),
}


def percentile95(values: list[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, int((len(ordered) - 1) * 0.95 + 0.999)))]


def provider_settings(args: argparse.Namespace) -> dict[str, str]:
    if args.provider == "gemini":
        key = os.environ.get("GEMINI_API_KEY") or os.environ.get("LLM_API_KEY")
        if not key:
            raise RuntimeError("GEMINI_API_KEY or LLM_API_KEY is required.")
        return {
            "baseUrl": (args.base_url or os.environ.get("GEMINI_BASE_URL") or "https://generativelanguage.googleapis.com/v1beta/openai").rstrip("/"),
            "apiKey": key,
            "model": args.model or os.environ.get("GEMINI_DATASET_MODEL") or os.environ.get("LLM_MODEL") or "gemini-3.5-flash",
        }
    return {
        "baseUrl": (args.base_url or os.environ.get("LOCAL_LLM_BASE_URL") or "http://127.0.0.1:8080/v1").rstrip("/"),
        "apiKey": os.environ.get("LOCAL_LLM_API_KEY") or "local-only",
        "model": args.model or os.environ.get("LOCAL_LLM_MODEL") or "gemma-bakeoff",
    }


def call_chat(messages: list[dict[str, str]], settings: dict[str, str], timeout: float) -> str:
    body = {
        "model": settings["model"],
        "temperature": 0.15,
        "response_format": {"type": "json_object"},
        "messages": messages,
        "max_tokens": 4096,
    }
    request = Request(
        f"{settings['baseUrl']}/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={"Authorization": f"Bearer {settings['apiKey']}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Provider HTTP {exc.code}: {detail[:500]}") from exc
    except (URLError, TimeoutError) as exc:
        raise RuntimeError(f"Provider unavailable: {exc}") from exc
    return str((((payload.get("choices") or [{}])[0].get("message") or {}).get("content") or ""))


def parse_training_facts(row: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    messages = row.get("messages") or []
    user = next((message.get("content") for message in messages if message.get("role") == "user"), "{}")
    payload = json.loads(user)
    return payload.get("facts") or {}, payload.get("retrievedRuleSet") or {}


def completeness(analysis: dict[str, Any], patterns_enabled: bool) -> float:
    total = 0
    populated = 0
    for section, arrays in SECTION_ARRAYS.items():
        section_value = analysis.get(section) or {}
        total += 1
        populated += int(bool(str(section_value.get("summary") or "").strip()))
        for array in arrays:
            if section == "chart" and array == "patterns" and not patterns_enabled:
                continue
            total += 1
            populated += int(bool(section_value.get(array)))
    total += 2
    populated += int(bool((analysis.get("reasoning") or {}).get("steps")))
    populated += int(bool((analysis.get("coach") or {}).get("questionsBeforeAction")))
    return populated / total * 100 if total else 0.0


def evaluate_response(row: dict[str, Any], raw: str, latency: float, repairs: int, error: str = "") -> dict[str, Any]:
    facts, rule_set = parse_training_facts(row)
    rule_ids = {str(rule.get("id")) for rule in rule_set.get("rules") or [] if isinstance(rule, dict)}
    sources = [
        {"id": rule.get("id"), "module": rule.get("module"), "chapter": rule.get("chapter"), "pages": (rule.get("source") or {}).get("pages"), "sourceUrl": (rule.get("source") or {}).get("url")}
        for rule in rule_set.get("rules") or []
        if isinstance(rule, dict)
    ]
    schema_errors: list[str] = []
    unsupported_facts: list[str] = []
    unsupported_rules: list[str] = []
    unsupported_numbers: list[float] = []
    verdict_preserved = False
    complete = 0.0
    patterns_respected = False
    parsed: dict[str, Any] = {}
    if not error:
        try:
            parsed = json.loads(raw)
            analysis = normalise_analysis(parsed, "bakeoff", sources)
            schema_errors = validate_analysis(analysis)
            allowed_facts = fact_paths(facts)
            for item in narrative_items(analysis):
                unsupported_facts.extend(ref for ref in item.get("factRefs") or [] if ref not in allowed_facts)
                unsupported_rules.extend(ref for ref in item.get("ruleRefs") or [] if ref not in rule_ids)
            verdict = str((facts.get("deterministicAnalysis") or {}).get("verdict") or "")
            verdict_texts = [str((analysis.get("decision") or {}).get("summary") or ""), str((analysis.get("coach") or {}).get("verdictSummary") or "")]
            verdict_preserved = bool(verdict and all(verdict.casefold() in text.casefold() for text in verdict_texts))
            complete = completeness(analysis, bool((facts.get("uiOptions") or {}).get("patternsEnabled")))
            patterns = (analysis.get("chart") or {}).get("patterns") or []
            patterns_respected = bool((facts.get("uiOptions") or {}).get("patternsEnabled")) or not patterns
            unsupported_numbers = unsupported_numeric_claims({"facts": facts, "output": analysis})
        except (json.JSONDecodeError, ValueError) as exc:
            schema_errors = [str(exc)]
    return {
        "id": row.get("id"),
        "latencySeconds": round(latency, 3),
        "repairs": repairs,
        "error": error,
        "schemaValid": not schema_errors,
        "schemaErrors": schema_errors,
        "verdictPreserved": verdict_preserved,
        "unsupportedFactRefs": sorted(set(unsupported_facts)),
        "unsupportedRuleRefs": sorted(set(unsupported_rules)),
        "unsupportedNumericClaims": unsupported_numbers,
        "completenessPct": round(complete, 2),
        "patternsRespected": patterns_respected,
        "raw": raw,
    }


def run(args: argparse.Namespace) -> dict[str, Any]:
    if args.split == "eval" and not args.allow_sealed_eval:
        raise RuntimeError("The 30-case evaluation set is sealed. Pass --allow-sealed-eval only for the final promotion run.")
    input_name = "eval.jsonl" if args.split == "eval" else "pilot_validation.jsonl"
    rows = read_jsonl(PROVIDER_ROOT / input_name)
    expected = 30 if args.split == "eval" else 15
    if len(rows) != expected:
        raise RuntimeError(f"Expected {expected} {args.split} rows, found {len(rows)}.")
    settings = provider_settings(args)
    REPORT_ROOT.mkdir(parents=True, exist_ok=True)
    responses_path = REPORT_ROOT / f"{args.name}-{args.split}-responses.jsonl"
    existing = {str(row.get("id")): row for row in read_jsonl(responses_path)} if responses_path.exists() else {}
    for row in rows:
        row_id = str(row["id"])
        if row_id in existing:
            continue
        messages = [{"role": message["role"], "content": message["content"]} for message in row["messages"][:2]]
        started = time.perf_counter()
        raw = ""
        error = ""
        repairs = 0
        try:
            raw = call_chat(messages, settings, args.timeout)
            first = evaluate_response(row, raw, time.perf_counter() - started, repairs)
            if not first["schemaValid"]:
                repairs = 1
                repair_messages = [*messages, {"role": "assistant", "content": raw}, {"role": "user", "content": "The response failed schema validation. Return one complete corrected JSON object only."}]
                raw = call_chat(repair_messages, settings, args.timeout)
        except RuntimeError as exc:
            error = str(exc)
        evaluated = evaluate_response(row, raw, time.perf_counter() - started, repairs, error)
        existing[row_id] = evaluated
        write_jsonl(responses_path, list(existing.values()))
    results = [existing[str(row["id"])] for row in rows if str(row["id"]) in existing]
    count = len(results)
    report = {
        "schemaVersion": "model-bakeoff-report.v1",
        "name": args.name,
        "provider": args.provider,
        "model": settings["model"],
        "split": args.split,
        "cases": count,
        "schemaValidityPct": round(sum(item["schemaValid"] for item in results) / count * 100, 2) if count else 0,
        "verdictPreservationPct": round(sum(item["verdictPreserved"] for item in results) / count * 100, 2) if count else 0,
        "unsupportedFactRefs": sum(len(item["unsupportedFactRefs"]) for item in results),
        "unsupportedRuleRefs": sum(len(item["unsupportedRuleRefs"]) for item in results),
        "unsupportedNumericClaims": sum(len(item["unsupportedNumericClaims"]) for item in results),
        "averageCompletenessPct": round(statistics.mean(item["completenessPct"] for item in results), 2) if count else 0,
        "patternsRespectedPct": round(sum(item["patternsRespected"] for item in results) / count * 100, 2) if count else 0,
        "p95LatencySeconds": round(percentile95([item["latencySeconds"] for item in results]), 3),
        "errorRatePct": round(sum(bool(item["error"]) for item in results) / count * 100, 2) if count else 100,
        "generatedAt": datetime.now(UTC).isoformat(),
        "responsesPath": str(responses_path),
    }
    report_path = REPORT_ROOT / f"{args.name}-{args.split}-report.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return {**report, "reportPath": str(report_path)}


def compare(args: argparse.Namespace) -> dict[str, Any]:
    baseline = json.loads(args.baseline.read_text(encoding="utf-8"))
    candidate = json.loads(args.candidate.read_text(encoding="utf-8"))
    human = json.loads(args.human_scores.read_text(encoding="utf-8")) if args.human_scores else {}
    baseline_human = float(human.get("baselineMean") or 0)
    candidate_human = float(human.get("candidateMean") or 0)
    gates = {
        "schemaValidity": candidate.get("schemaValidityPct") == 100,
        "verdictPreservation": candidate.get("verdictPreservationPct") == 100,
        "groundedFacts": candidate.get("unsupportedFactRefs") == 0 and candidate.get("unsupportedNumericClaims") == 0,
        "groundedRules": candidate.get("unsupportedRuleRefs") == 0,
        "completeness": candidate.get("averageCompletenessPct", 0) >= 95,
        "patterns": candidate.get("patternsRespectedPct") == 100,
        "latency": candidate.get("p95LatencySeconds", 999) <= 120,
        "reliability": candidate.get("errorRatePct", 100) == 0,
        "humanQuality": candidate_human >= 4 and candidate_human >= baseline_human - 0.2,
        "noMaterialRegression": candidate.get("averageCompletenessPct", 0) >= baseline.get("averageCompletenessPct", 0) - 0.5,
    }
    return {"promote": all(gates.values()), "gates": gates, "baseline": baseline.get("name"), "candidate": candidate.get("name")}


def main() -> int:
    load_local_env()
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    run_parser = subparsers.add_parser("run")
    run_parser.add_argument("--name", required=True)
    run_parser.add_argument("--provider", choices=("gemini", "local"), required=True)
    run_parser.add_argument("--model", default="")
    run_parser.add_argument("--base-url", default="")
    run_parser.add_argument("--split", choices=("validation", "eval"), default="validation")
    run_parser.add_argument("--allow-sealed-eval", action="store_true")
    run_parser.add_argument("--timeout", type=float, default=120)
    compare_parser = subparsers.add_parser("compare")
    compare_parser.add_argument("--baseline", type=Path, required=True)
    compare_parser.add_argument("--candidate", type=Path, required=True)
    compare_parser.add_argument("--human-scores", type=Path)
    args = parser.parse_args()
    result = run(args) if args.command == "run" else compare(args)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
