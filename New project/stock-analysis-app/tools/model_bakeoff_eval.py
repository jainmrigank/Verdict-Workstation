#!/usr/bin/env python3
"""Run and compare Gemini/Gemma responses against the sealed bake-off gates."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import statistics
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen


APP_ROOT = Path(__file__).resolve().parents[1]
if str(APP_ROOT) not in os.sys.path:
    os.sys.path.insert(0, str(APP_ROOT))

from server.llm_analysis import (
    ANALYSIS_PROMPT_VERSION,
    COMPACT_ANALYSIS_PROMPT_VERSION,
    analysis_prompt,
    compact_analysis_prompt,
    expand_compact_analysis,
    lexical_rule_set,
    normalise_analysis,
    parse_provider_json,
    prepare_provider_analysis,
    semantic_analysis_errors,
    validate_analysis,
    validate_compact_analysis,
    validate_raw_analysis,
)
from tools.approve_candidates import unsupported_numeric_claims
from tools.evaluate_llm import fact_paths, narrative_items
from tools.gemma_bakeoff import current_git_commit, sha256_file, write_json_atomic
from tools.llm_dataset import (
    GeminiQuotaError,
    approved_gold,
    configure_gemini_pacing,
    estimated_provider_cost,
    load_local_env,
    pace_gemini_request,
    parse_gemini_quota_error,
    provider_row,
    provider_usage_snapshot,
    read_jsonl,
    record_provider_usage,
    reset_provider_usage,
    write_jsonl,
)
from tools.reasoning_dataset import verify_evaluation_seal


PROVIDER_ROOT = APP_ROOT / "data" / "training" / "provider"
REPORT_ROOT = APP_ROOT / "data" / "generated" / "model_eval"
EVALUATION_CONSUMPTION_PATH = REPORT_ROOT / "sealed-evaluation-consumption.json"
EVALUATOR_VERSION = "model-bakeoff-evaluator.v3"
HUMAN_DIMENSIONS = ("usefulness", "clarity", "grounding", "actionability")
SECTION_ARRAYS = {
    "decision": ("nextActions", "avoid", "priceDrivers", "risks", "dataGaps"),
    "chart": ("trend", "momentum", "volume", "volatility", "levels", "patterns"),
    "company": ("businessModel", "quality", "profitability", "balanceSheet", "cashFlow", "valuation", "sectorDrivers", "catalysts", "risks", "dataGaps"),
    "portfolio": ("positionFit", "concentration", "sizing", "holdingActions", "risks"),
}


class TransientProviderError(RuntimeError):
    """Provider failure that may succeed when retried without changing input."""


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
            "baseUrl": (
                args.base_url
                or os.environ.get("GEMINI_BASE_URL")
                or os.environ.get("LLM_BASE_URL")
                or "https://generativelanguage.googleapis.com/v1beta/openai"
            ).rstrip("/"),
            "apiKey": key,
            "model": args.model or os.environ.get("LLM_MODEL") or os.environ.get("GEMINI_DATASET_MODEL") or "gemini-3.5-flash",
            "provider": "gemini",
        }
    if args.provider == "openai":
        key = os.environ.get("OPENAI_DATASET_API_KEY") or os.environ.get("OPENAI_API_KEY")
        if not key:
            raise RuntimeError("OPENAI_API_KEY is required.")
        return {
            "baseUrl": (args.base_url or os.environ.get("OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/"),
            "apiKey": key,
            "model": args.model or os.environ.get("OPENAI_DATASET_MODEL") or "gpt-5.4-mini",
            "provider": "openai",
        }
    base_url = (args.base_url or os.environ.get("LOCAL_LLM_BASE_URL") or "http://127.0.0.1:8080/v1").rstrip("/")
    if (urlsplit(base_url).hostname or "").casefold() not in {"127.0.0.1", "localhost", "::1"}:
        raise RuntimeError("Local bake-off endpoints must be bound to loopback.")
    return {
        "baseUrl": base_url,
        "apiKey": os.environ.get("LOCAL_LLM_API_KEY") or "local-only",
        "model": args.model or os.environ.get("LOCAL_LLM_MODEL") or ("default_model" if args.runtime.casefold() == "mlx" else "gemma-bakeoff"),
        "provider": "local",
    }


def safe_base_url(value: str) -> str:
    parsed = urlsplit(value)
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))


def generation_profile(args: argparse.Namespace, provider: str) -> dict[str, Any]:
    reasoning_effort = getattr(args, "reasoning_effort", "minimal")
    requested = {
        "temperature": args.temperature,
        "maxOutputTokens": args.max_output_tokens,
        "reasoningEffort": reasoning_effort,
        "seed": args.seed,
        "responseFormat": "json_object",
    }
    applied: dict[str, Any] = {"maxOutputTokens": args.max_output_tokens}
    unsupported: list[str] = []
    if provider == "gemini":
        applied["temperature"] = args.temperature
        applied["reasoningEffort"] = reasoning_effort
    elif provider == "openai":
        if reasoning_effort == "minimal":
            raise RuntimeError("OpenAI evaluations require --reasoning-effort none, low, medium, high, or xhigh.")
        applied["reasoningEffort"] = reasoning_effort
        if reasoning_effort == "none":
            applied["temperature"] = args.temperature
        else:
            unsupported.append("temperature")
    else:
        applied["temperature"] = args.temperature
        unsupported.append("reasoningEffort")
    if provider == "local" and args.runtime.casefold() == "mlx":
        unsupported.append("responseFormat")
    else:
        applied["responseFormat"] = "json_object"
    if args.seed is not None:
        if provider == "local":
            applied["seed"] = args.seed
        else:
            unsupported.append("seed")
    return {"requested": requested, "applied": applied, "unsupported": unsupported}


def evaluation_fingerprint(payload: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def response_content_hash(results: list[dict[str, Any]], *, include_runtime_metadata: bool = True) -> str:
    reviewed_content = []
    for item in results:
        content = {"id": item.get("id"), "raw": item.get("raw"), "error": item.get("error")}
        if include_runtime_metadata:
            content.update(
                {
                    "latencySeconds": item.get("latencySeconds"),
                    "repairs": item.get("repairs"),
                }
            )
        reviewed_content.append(content)
    return evaluation_fingerprint({"responses": reviewed_content})


def call_chat(
    messages: list[dict[str, str]],
    settings: dict[str, str],
    timeout: float,
    profile: dict[str, Any],
) -> str:
    if settings["provider"] == "gemini":
        pace_gemini_request()
    body = {
        "model": settings["model"],
        "messages": messages,
    }
    if "temperature" in profile["applied"]:
        body["temperature"] = profile["applied"]["temperature"]
    token_field = "max_completion_tokens" if settings["provider"] == "openai" else "max_tokens"
    body[token_field] = profile["applied"]["maxOutputTokens"]
    if profile["applied"].get("responseFormat") == "json_object":
        body["response_format"] = {"type": "json_object"}
    if "seed" in profile["applied"]:
        body["seed"] = profile["applied"]["seed"]
    if "reasoningEffort" in profile["applied"]:
        body["reasoning_effort"] = profile["applied"]["reasoningEffort"]
    request = Request(
        f"{settings['baseUrl']}/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={"Authorization": f"Bearer {settings['apiKey']}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
        if settings["provider"] == "openai":
            record_provider_usage(payload)
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        if exc.code == 429 and settings["provider"] == "gemini":
            raise parse_gemini_quota_error(detail) from exc
        if exc.code in {500, 502, 503, 504}:
            raise TransientProviderError(f"Provider HTTP {exc.code}: {detail[:500]}") from exc
        raise RuntimeError(f"Provider HTTP {exc.code}: {detail[:500]}") from exc
    except (URLError, TimeoutError) as exc:
        raise TransientProviderError(f"Provider unavailable: {exc}") from exc
    choice = (payload.get("choices") or [{}])[0]
    content = str(((choice.get("message") or {}).get("content") or ""))
    if not content.strip():
        finish_reason = str(choice.get("finish_reason") or "unknown")
        raise RuntimeError(f"Provider returned empty content (finish_reason={finish_reason}).")
    return content


def parse_training_facts(row: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    messages = row.get("messages") or []
    user = next((message.get("content") for message in messages if message.get("role") == "user"), "{}")
    payload = json.loads(user)
    facts = payload.get("facts") or {}
    rule_set = payload.get("retrievedRuleSet")
    if isinstance(rule_set, dict) and isinstance(rule_set.get("rules"), list):
        return facts, rule_set
    return facts, lexical_rule_set(facts)


def row_output_contract(row: dict[str, Any]) -> str:
    return str((row.get("metadata") or {}).get("outputContract") or "llm-analysis.v1")


NON_COMPANY_INSTRUMENT_TYPES = {"etf", "fund", "index", "mutual fund", "mutual_fund"}
NON_COMPANY_APPLICABILITY_TERMS = (
    "not applicable",
    "non-applicable",
    "not an operating",
    "not a single company",
    "no single company",
    "not a standalone",
    "issuer-style",
    "company-style",
    "operating-company",
    "not meaningful",
    "no issuer",
)


def non_company_applicability_errors(analysis: dict[str, Any], facts: dict[str, Any]) -> list[str]:
    instrument_type = str((facts.get("instrument") or {}).get("type") or "").strip().casefold()
    if instrument_type not in NON_COMPANY_INSTRUMENT_TYPES:
        return []
    errors: list[str] = []
    company = analysis.get("company") or {}
    coach = analysis.get("coach") or {}
    for path, text in (
        ("company.summary", str(company.get("summary") or "")),
        ("coach.companySummary", str(coach.get("companySummary") or "")),
    ):
        if not any(term in text.casefold() for term in NON_COMPANY_APPLICABILITY_TERMS):
            errors.append(f"{path} must explain that operating-company fundamentals are non-applicable")
    return errors


def completeness(analysis: dict[str, Any], facts: dict[str, Any]) -> float:
    patterns_enabled = bool((facts.get("uiOptions") or {}).get("patternsEnabled"))
    instrument_type = str((facts.get("instrument") or {}).get("type") or "").strip().casefold()
    non_company = instrument_type in NON_COMPANY_INSTRUMENT_TYPES
    total = 0
    populated = 0
    for section, arrays in SECTION_ARRAYS.items():
        section_value = analysis.get(section) or {}
        total += 1
        populated += int(bool(str(section_value.get("summary") or "").strip()))
        for array in arrays:
            if section == "chart" and array == "patterns" and not patterns_enabled:
                continue
            if section == "company" and non_company:
                continue
            total += 1
            populated += int(bool(section_value.get(array)))
    total += 2
    populated += int(bool((analysis.get("reasoning") or {}).get("steps")))
    populated += int(bool((analysis.get("coach") or {}).get("questionsBeforeAction")))
    for key in ("verdictSummary", "chartSummary", "companySummary"):
        total += 1
        populated += int(bool(str((analysis.get("coach") or {}).get(key) or "").strip()))
    return populated / total * 100 if total else 0.0


def evaluate_response(row: dict[str, Any], raw: str, latency: float, repairs: int, error: str = "") -> dict[str, Any]:
    facts, rule_set = parse_training_facts(row)
    rule_ids = {str(rule.get("id")) for rule in rule_set.get("rules") or [] if isinstance(rule, dict)}
    sources = [
        {"id": rule.get("id"), "module": rule.get("module"), "chapter": rule.get("chapter"), "pages": (rule.get("source") or {}).get("pages"), "sourceUrl": (rule.get("source") or {}).get("url")}
        for rule in rule_set.get("rules") or []
        if isinstance(rule, dict)
    ]
    schema_errors: list[str] = [error] if error else []
    semantic_errors: list[str] = []
    unsupported_facts: list[str] = []
    unsupported_rules: list[str] = []
    unsupported_numbers: list[float] = []
    verdict_preserved = False
    complete = 0.0
    patterns_respected = False
    parsed: dict[str, Any] = {}
    if not error:
        try:
            provider_value = parse_provider_json(raw)
            if row_output_contract(row) == "llm-analysis-compact.v1":
                schema_errors = validate_compact_analysis(provider_value)
                if not schema_errors:
                    provider_value = expand_compact_analysis(provider_value)
            if not schema_errors:
                parsed = prepare_provider_analysis(provider_value, facts, rule_set)
                schema_errors = validate_raw_analysis(parsed)
            if not schema_errors:
                analysis = normalise_analysis(parsed, "bakeoff", sources)
                schema_errors.extend(validate_analysis(analysis))
                semantic_errors = semantic_analysis_errors(parsed, facts, rule_set)
                semantic_errors.extend(non_company_applicability_errors(parsed, facts))
                allowed_facts = fact_paths(facts)
                for item in narrative_items(parsed):
                    unsupported_facts.extend(ref for ref in item.get("factRefs") or [] if ref not in allowed_facts)
                    unsupported_rules.extend(ref for ref in item.get("ruleRefs") or [] if ref not in rule_ids)
                verdict = str((facts.get("deterministicAnalysis") or {}).get("verdict") or "")
                verdict_texts = [
                    str((parsed.get("decision") or {}).get("summary") or ""),
                    str((parsed.get("coach") or {}).get("verdictSummary") or ""),
                ]
                verdict_preserved = bool(
                    verdict
                    and all(verdict.casefold() in text.casefold() for text in verdict_texts)
                    and not any("contradicts the deterministic verdict" in item for item in semantic_errors)
                )
                complete = completeness(parsed, facts)
                patterns = (parsed.get("chart") or {}).get("patterns") or []
                patterns_respected = bool((facts.get("uiOptions") or {}).get("patternsEnabled")) or not patterns
                unsupported_numbers = unsupported_numeric_claims({"facts": facts, "output": parsed})
        except (json.JSONDecodeError, ValueError) as exc:
            schema_errors = [str(exc)]
    return {
        "id": row.get("id"),
        "latencySeconds": round(latency, 3),
        "repairs": repairs,
        "error": error,
        "schemaValid": not schema_errors,
        "schemaErrors": schema_errors,
        "semanticValid": not schema_errors and not semantic_errors and not error,
        "semanticErrors": semantic_errors,
        "verdictPreserved": verdict_preserved,
        "unsupportedFactRefs": sorted(set(unsupported_facts)),
        "unsupportedRuleRefs": sorted(set(unsupported_rules)),
        "unsupportedNumericClaims": unsupported_numbers,
        "completenessPct": round(complete, 2),
        "patternsRespected": patterns_respected,
        "applicabilityRespected": not non_company_applicability_errors(parsed, facts) if parsed else False,
        "raw": raw,
    }


def verify_sealed_provider_rows(rows: list[dict[str, Any]]) -> None:
    verification = verify_evaluation_seal()
    if not verification["verified"]:
        raise RuntimeError("Evaluation seal verification failed: " + "; ".join(verification["errors"]))
    provider_ids = {str(row.get("id") or "") for row in rows}
    if provider_ids != set(verification["evaluationIds"]):
        raise RuntimeError("Provider evaluation rows do not match the sealed evaluation IDs.")
    expected_rows = {
        str(row["id"]): provider_row(row)
        for row in approved_gold()
        if row.get("split") == "eval"
    }
    changed = [
        str(row["id"])
        for row in rows
        if json.dumps(row, sort_keys=True, separators=(",", ":"))
        != json.dumps(expected_rows.get(str(row["id"])), sort_keys=True, separators=(",", ":"))
    ]
    if changed:
        raise RuntimeError(f"Provider evaluation content differs from the sealed approved rows: {changed[:12]}")


GENERATION_BINDING_FIELDS = (
    "provider",
    "model",
    "baseUrl",
    "split",
    "caseIds",
    "datasetFileSha256",
    "generationProfile",
    "runtime",
    "modelArtifactHash",
    "quantization",
    "promptVersion",
    "runtimeSourceHash",
    "groundingSourceHash",
    "expectedCases",
    "sealedAuthorization",
)
REUSE_BINDING_FIELDS = tuple(
    field
    for field in GENERATION_BINDING_FIELDS
    if field not in {"caseIds", "expectedCases", "sealedAuthorization", "runtimeSourceHash", "groundingSourceHash"}
)


def generation_binding(config: dict[str, Any]) -> dict[str, Any]:
    return {field: config.get(field) for field in GENERATION_BINDING_FIELDS}


def response_needs_retry(row: dict[str, Any]) -> bool:
    return (
        bool(row.get("error"))
        or row.get("schemaValid") is False
        or row.get("semanticValid") is False
    )


def reusable_responses(
    source_name: str,
    split: str,
    rows: list[dict[str, Any]],
    run_config: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    if not source_name:
        return {}
    if split == "eval":
        raise RuntimeError("Sealed evaluation responses cannot be imported from another run.")
    source_config_path = REPORT_ROOT / f"{source_name}-{split}-config.json"
    source_responses_path = REPORT_ROOT / f"{source_name}-{split}-responses.jsonl"
    source_report_path = REPORT_ROOT / f"{source_name}-{split}-report.json"
    if not source_config_path.is_file() or not source_responses_path.is_file() or not source_report_path.is_file():
        raise RuntimeError(f"Reusable response run {source_name!r} is incomplete.")
    source_config = json.loads(source_config_path.read_text(encoding="utf-8"))
    source_report = json.loads(source_report_path.read_text(encoding="utf-8"))
    source_binding = {field: source_config.get(field) for field in REUSE_BINDING_FIELDS}
    target_binding = {field: run_config.get(field) for field in REUSE_BINDING_FIELDS}
    if source_binding != target_binding:
        raise RuntimeError(f"Reusable response run {source_name!r} has incompatible generation inputs.")
    source_fingerprint = source_config.get("fingerprint")
    source_response_list = read_jsonl(source_responses_path)
    source_rows = {str(item.get("id")): item for item in source_response_list}
    expected_ids = {str(row.get("id")) for row in rows}
    if not source_rows or not set(source_rows).issubset(expected_ids):
        raise RuntimeError(f"Reusable response run {source_name!r} contains case IDs outside the target run.")
    if source_report.get("evaluationFingerprint") != source_fingerprint:
        raise RuntimeError(f"Reusable response run {source_name!r} has a report/config fingerprint mismatch.")
    legacy_hash = source_config.get("evaluatorVersion") == "model-bakeoff-evaluator.v2"
    source_response_hash = response_content_hash(
        source_response_list,
        include_runtime_metadata=not legacy_hash,
    )
    if source_report.get("responseContentHash") != source_response_hash:
        raise RuntimeError(f"Reusable response run {source_name!r} has modified response content.")
    if list(source_report.get("caseIds") or []) != list(source_config.get("caseIds") or []):
        raise RuntimeError(f"Reusable response run {source_name!r} has a report/config case-order mismatch.")
    reused: dict[str, dict[str, Any]] = {}
    for row in rows:
        row_id = str(row["id"])
        if row_id not in source_rows:
            continue
        source = source_rows[row_id]
        if source.get("evaluationFingerprint") != source_fingerprint:
            raise RuntimeError(f"Reusable response {row_id!r} is not bound to its source configuration.")
        raw = str(source.get("raw") or "")
        evaluated = evaluate_response(
            row,
            raw,
            float(source.get("latencySeconds") or 0),
            int(source.get("repairs") or 0),
            "" if raw.strip() else str(source.get("error") or ""),
        )
        if response_needs_retry(evaluated):
            continue
        evaluated["evaluationFingerprint"] = run_config["fingerprint"]
        evaluated["reusedFrom"] = source_name
        if isinstance(source.get("providerUsage"), dict):
            evaluated["providerUsage"] = source["providerUsage"]
        if source.get("estimatedCostUsd") is not None:
            evaluated["estimatedCostUsd"] = source["estimatedCostUsd"]
        reused[row_id] = evaluated
    return reused


def sealed_eval_authorization(args: argparse.Namespace) -> dict[str, Any]:
    comparison_path = getattr(args, "validation_comparison", None)
    role = str(getattr(args, "evaluation_role", "") or "")
    if not args.allow_sealed_eval or not comparison_path or not role:
        raise RuntimeError(
            "Sealed evaluation requires --allow-sealed-eval, --validation-comparison, and --evaluation-role."
        )
    comparison = json.loads(Path(comparison_path).read_text(encoding="utf-8"))
    if comparison.get("schemaVersion") != "model-bakeoff-comparison.v2" or not comparison.get("promote"):
        raise RuntimeError("Sealed evaluation is blocked until the validation comparison passes every promotion gate.")
    expected_provider = "gemini" if role == "gemini" else "local"
    if args.provider != expected_provider:
        raise RuntimeError(f"Evaluation role {role!r} requires provider {expected_provider!r}.")
    registry = (
        json.loads(EVALUATION_CONSUMPTION_PATH.read_text(encoding="utf-8"))
        if EVALUATION_CONSUMPTION_PATH.exists()
        else {"schemaVersion": "sealed-evaluation-consumption.v1", "roles": {}}
    )
    if role in (registry.get("roles") or {}):
        raise RuntimeError(f"The sealed evaluation role {role!r} has already been consumed.")
    return {
        "role": role,
        "validationComparisonPath": str(Path(comparison_path).resolve()),
        "validationComparisonHash": sha256_file(Path(comparison_path)),
    }


def run(args: argparse.Namespace) -> dict[str, Any]:
    reset_provider_usage()
    sealed_authorization = sealed_eval_authorization(args) if args.split == "eval" else None
    input_name = "eval.jsonl" if args.split == "eval" else "pilot_validation.jsonl"
    input_path = PROVIDER_ROOT / input_name
    rows = read_jsonl(input_path)
    expected = 30 if args.split == "eval" else 15
    if len(rows) != expected:
        raise RuntimeError(f"Expected {expected} {args.split} rows, found {len(rows)}.")
    requested_ids = [value.strip() for value in args.case_ids.split(",") if value.strip()]
    if requested_ids:
        if args.split == "eval":
            raise RuntimeError("Sealed evaluation runs cannot be subsetted.")
        available = {str(row.get("id")) for row in rows}
        missing = sorted(set(requested_ids) - available)
        if missing:
            raise RuntimeError(f"Unknown validation case IDs: {missing}")
        requested = set(requested_ids)
        rows = [row for row in rows if str(row.get("id")) in requested]
    if args.split == "eval":
        verify_sealed_provider_rows(rows)
    output_contracts = {row_output_contract(row) for row in rows}
    if len(output_contracts) != 1:
        raise RuntimeError(f"Evaluation rows contain mixed output contracts: {sorted(output_contracts)}")
    output_contract = next(iter(output_contracts))
    prompt_version = (
        COMPACT_ANALYSIS_PROMPT_VERSION
        if output_contract == "llm-analysis-compact.v1"
        else ANALYSIS_PROMPT_VERSION
    )
    settings = provider_settings(args)
    profile = generation_profile(args, settings["provider"])
    configure_gemini_pacing(args.rpm if args.provider == "gemini" else 0)
    REPORT_ROOT.mkdir(parents=True, exist_ok=True)
    responses_path = REPORT_ROOT / f"{args.name}-{args.split}-responses.jsonl"
    config_path = REPORT_ROOT / f"{args.name}-{args.split}-config.json"
    review_path = REPORT_ROOT / f"{args.name}-{args.split}-human-review.json"
    run_config = {
        "schemaVersion": "model-bakeoff-config.v2",
        "name": args.name,
        "provider": args.provider,
        "model": settings["model"],
        "baseUrl": safe_base_url(settings["baseUrl"]),
        "split": args.split,
        "caseIds": [str(row["id"]) for row in rows],
        "datasetFileSha256": sha256_file(input_path),
        "generationProfile": profile,
        "runtime": args.runtime or (
            "gemini-openai-compatible"
            if args.provider == "gemini"
            else "openai-chat-completions"
            if args.provider == "openai"
            else "local-openai-compatible"
        ),
        "modelArtifactHash": args.model_artifact_hash,
        "quantization": args.quantization,
        "gitCommit": current_git_commit(),
        "promptVersion": prompt_version,
        "outputContract": output_contract,
        "evaluatorVersion": EVALUATOR_VERSION,
        "evaluatorSourceHash": sha256_file(Path(__file__)),
        "evaluationHelperSourceHash": sha256_file(APP_ROOT / "tools" / "evaluate_llm.py"),
        "runtimeSourceHash": sha256_file(APP_ROOT / "server" / "llm_analysis.py"),
        "groundingSourceHash": sha256_file(APP_ROOT / "tools" / "approve_candidates.py"),
        "expectedCases": expected,
        "promotable": not requested_ids and len(rows) == expected,
        "sealedAuthorization": sealed_authorization,
        "reuseResponsesFrom": str(getattr(args, "reuse_responses_from", "") or ""),
    }
    run_config["generationFingerprint"] = evaluation_fingerprint(generation_binding(run_config))
    run_config["fingerprint"] = evaluation_fingerprint(run_config)
    if config_path.exists():
        existing_config = json.loads(config_path.read_text(encoding="utf-8"))
        if existing_config.get("fingerprint") != run_config["fingerprint"]:
            raise RuntimeError(
                f"Evaluation name {args.name!r} already belongs to a different configuration; choose a new --name."
            )
    else:
        write_json_atomic(config_path, run_config)
    reused = reusable_responses(run_config["reuseResponsesFrom"], args.split, rows, run_config)
    existing = {str(row.get("id")): row for row in read_jsonl(responses_path)} if responses_path.exists() else {}
    existing = {**reused, **existing}
    unexpected_existing = sorted(set(existing) - {str(row["id"]) for row in rows})
    if unexpected_existing:
        raise RuntimeError(f"Response checkpoint contains unexpected case IDs: {unexpected_existing[:12]}")
    stale_existing = sorted(
        row_id for row_id, row in existing.items()
        if row.get("evaluationFingerprint") != run_config["fingerprint"]
    )
    if stale_existing:
        raise RuntimeError(f"Response checkpoint is not bound to this evaluation configuration: {stale_existing[:12]}")
    if args.retry_errors:
        existing = {row_id: row for row_id, row in existing.items() if not response_needs_retry(row)}
    quota_waited = 0.0
    quota_stop: dict[str, Any] | None = None
    provider_stop: dict[str, Any] | None = None
    transient_retries = 0

    def quota_call(messages: list[dict[str, str]]) -> str:
        nonlocal quota_waited, quota_stop, transient_retries
        provider_attempt = 0
        while True:
            try:
                return call_chat(messages, settings, args.timeout, profile)
            except GeminiQuotaError as exc:
                retry = (exc.retry_after_seconds or 0) + 1
                can_wait = (
                    args.wait_on_short_quota
                    and exc.is_short_window
                    and retry > 1
                    and quota_waited + retry <= args.max_wait_seconds
                )
                if not can_wait:
                    quota_stop = exc.as_dict()
                    raise
                time.sleep(retry)
                quota_waited += retry
            except TransientProviderError:
                provider_attempt += 1
                if provider_attempt >= args.provider_retries:
                    raise
                transient_retries += 1
                time.sleep(args.retry_backoff_seconds * provider_attempt)

    for row in rows:
        row_id = str(row["id"])
        if row_id in existing:
            continue
        facts, rule_set = parse_training_facts(row)
        prompt_builder = compact_analysis_prompt if output_contract == "llm-analysis-compact.v1" else analysis_prompt
        messages = prompt_builder(facts, rule_set)
        usage_before = provider_usage_snapshot()
        started = time.perf_counter()
        raw = ""
        error = ""
        repairs = 0
        try:
            raw = quota_call(messages)
            first = evaluate_response(row, raw, time.perf_counter() - started, repairs)
            if not first["schemaValid"] or not first["semanticValid"]:
                repairs = 1
                repair_messages = prompt_builder(
                    facts,
                    rule_set,
                    f"The previous response failed raw {output_contract} validation: "
                    + "; ".join([*first["schemaErrors"], *first["semanticErrors"]][:12])
                    + ". Return one complete corrected JSON object only.",
                    raw,
                )
                raw = quota_call(repair_messages)
        except GeminiQuotaError as exc:
            error = str(exc)
        except TransientProviderError as exc:
            error = str(exc)
            provider_stop = {"caseId": row_id, "message": error}
        except RuntimeError as exc:
            error = str(exc)
        evaluated = evaluate_response(row, raw, time.perf_counter() - started, repairs, error)
        usage_after = provider_usage_snapshot()
        case_usage = {key: usage_after[key] - usage_before.get(key, 0) for key in usage_after}
        evaluated["providerUsage"] = case_usage
        evaluated["estimatedCostUsd"] = (
            estimated_provider_cost(settings["provider"], case_usage)
            if settings["provider"] == "openai"
            else None
        )
        evaluated["evaluationFingerprint"] = run_config["fingerprint"]
        existing[row_id] = evaluated
        write_jsonl(responses_path, [existing[str(item["id"])] for item in rows if str(item["id"]) in existing])
        if quota_stop or provider_stop:
            break
    if existing:
        write_jsonl(responses_path, [existing[str(item["id"])] for item in rows if str(item["id"]) in existing])
    results = [existing[str(row["id"])] for row in rows if str(row["id"]) in existing]
    count = len(results)
    responses_hash = response_content_hash(results)
    provider_usage = {
        key: sum(int((item.get("providerUsage") or {}).get(key) or 0) for item in results)
        for key in provider_usage_snapshot()
    }
    response_costs = [float(item["estimatedCostUsd"]) for item in results if item.get("estimatedCostUsd") is not None]
    report = {
        "schemaVersion": "model-bakeoff-report.v2",
        "name": args.name,
        "provider": args.provider,
        "model": settings["model"],
        "split": args.split,
        "cases": count,
        "expectedCases": expected,
        "caseIds": [str(row["id"]) for row in rows],
        "promotable": run_config["promotable"] and count == expected,
        "schemaValidityPct": round(sum(item["schemaValid"] for item in results) / count * 100, 2) if count else 0,
        "semanticValidityPct": round(sum(item["semanticValid"] for item in results) / count * 100, 2) if count else 0,
        "semanticErrors": sum(len(item["semanticErrors"]) for item in results),
        "verdictPreservationPct": round(sum(item["verdictPreserved"] for item in results) / count * 100, 2) if count else 0,
        "unsupportedFactRefs": sum(len(item["unsupportedFactRefs"]) for item in results),
        "unsupportedRuleRefs": sum(len(item["unsupportedRuleRefs"]) for item in results),
        "unsupportedNumericClaims": sum(len(item["unsupportedNumericClaims"]) for item in results),
        "averageCompletenessPct": round(statistics.mean(item["completenessPct"] for item in results), 2) if count else 0,
        "minimumCompletenessPct": round(min((item["completenessPct"] for item in results), default=0), 2),
        "patternsRespectedPct": round(sum(item["patternsRespected"] for item in results) / count * 100, 2) if count else 0,
        "applicabilityRespectedPct": round(sum(item["applicabilityRespected"] for item in results) / count * 100, 2) if count else 0,
        "p95LatencySeconds": round(percentile95([item["latencySeconds"] for item in results]), 3),
        "errorRatePct": round(sum(bool(item["error"]) for item in results) / count * 100, 2) if count else 100,
        "quotaStop": quota_stop,
        "providerStop": provider_stop,
        "quotaWaitedSeconds": round(quota_waited, 3),
        "transientRetries": transient_retries,
        "providerUsage": provider_usage,
        "estimatedCostUsd": (
            round(sum(response_costs), 6)
            if response_costs
            else estimated_provider_cost(settings["provider"], provider_usage)
            if settings["provider"] == "openai"
            else None
        ),
        "generationProfile": profile,
        "evaluationFingerprint": run_config["fingerprint"],
        "generationFingerprint": run_config["generationFingerprint"],
        "responseContentHash": responses_hash,
        "datasetFileSha256": run_config["datasetFileSha256"],
        "runtime": run_config["runtime"],
        "modelArtifactHash": args.model_artifact_hash,
        "quantization": args.quantization,
        "gitCommit": run_config["gitCommit"],
        "promptVersion": ANALYSIS_PROMPT_VERSION,
        "evaluatorVersion": EVALUATOR_VERSION,
        "evaluatorSourceHash": run_config["evaluatorSourceHash"],
        "evaluationHelperSourceHash": run_config["evaluationHelperSourceHash"],
        "runtimeSourceHash": run_config["runtimeSourceHash"],
        "groundingSourceHash": run_config["groundingSourceHash"],
        "reusedCases": sum(bool(item.get("reusedFrom")) for item in results),
        "generatedAt": datetime.now(UTC).isoformat(),
        "responsesPath": str(responses_path),
        "configPath": str(config_path),
        "humanReviewPath": str(review_path),
    }
    report_path = REPORT_ROOT / f"{args.name}-{args.split}-report.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    if count == expected:
        review_template = {
            "schemaVersion": "model-human-review.v1",
            "name": args.name,
            "evaluationFingerprint": run_config["fingerprint"],
            "responseContentHash": responses_hash,
            "dimensions": list(HUMAN_DIMENSIONS),
            "cases": [
                {
                    "id": str(row["id"]),
                    "scores": {"usefulness": None, "clarity": None, "grounding": None, "actionability": None},
                    "notes": "",
                }
                for row in rows
            ],
        }
        if review_path.exists():
            existing_review = json.loads(review_path.read_text(encoding="utf-8"))
            has_scores = any(
                any(value is not None for value in (case.get("scores") or {}).values())
                for case in existing_review.get("cases") or []
            )
            if has_scores and existing_review.get("responseContentHash") != responses_hash:
                raise RuntimeError("Completed human review is bound to different response content; use a new evaluation name.")
            if not has_scores:
                write_json_atomic(review_path, review_template)
        else:
            write_json_atomic(review_path, review_template)
        if sealed_authorization:
            registry = (
                json.loads(EVALUATION_CONSUMPTION_PATH.read_text(encoding="utf-8"))
                if EVALUATION_CONSUMPTION_PATH.exists()
                else {"schemaVersion": "sealed-evaluation-consumption.v1", "roles": {}}
            )
            registry.setdefault("roles", {})[sealed_authorization["role"]] = {
                "name": args.name,
                "evaluationFingerprint": run_config["fingerprint"],
                "responseContentHash": responses_hash,
                "validationComparisonHash": sealed_authorization["validationComparisonHash"],
                "consumedAt": datetime.now(UTC).isoformat(),
            }
            write_json_atomic(EVALUATION_CONSUMPTION_PATH, registry)
    return {**report, "reportPath": str(report_path)}


def human_review_summary(path: Path, report: dict[str, Any]) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("evaluationFingerprint") != report.get("evaluationFingerprint"):
        raise RuntimeError(f"Human review fingerprint does not match report {report.get('name')!r}.")
    if payload.get("responseContentHash") != report.get("responseContentHash"):
        raise RuntimeError(f"Human review response hash does not match report {report.get('name')!r}.")
    cases = payload.get("cases") or []
    expected_ids = list(report.get("caseIds") or [])
    if [str(case.get("id")) for case in cases] != expected_ids:
        raise RuntimeError(f"Human review case IDs do not match report {report.get('name')!r}.")
    values: dict[str, list[float]] = {dimension: [] for dimension in HUMAN_DIMENSIONS}
    for case in cases:
        scores = case.get("scores") or {}
        for dimension in HUMAN_DIMENSIONS:
            value = scores.get(dimension)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not 1 <= float(value) <= 5:
                raise RuntimeError(f"Human review {case.get('id')} has no valid 1-5 {dimension} score.")
            values[dimension].append(float(value))
    means = {dimension: round(statistics.mean(scores), 3) for dimension, scores in values.items()}
    return {"cases": len(cases), "dimensionMeans": means, "overallMean": round(statistics.mean(means.values()), 3)}


def compatibility_errors(reports: list[dict[str, Any]]) -> list[str]:
    errors: list[str] = []
    reference = reports[0]
    required_integrity = (
        "datasetFileSha256", "promptVersion", "evaluatorVersion", "evaluatorSourceHash",
        "evaluationHelperSourceHash", "runtimeSourceHash", "groundingSourceHash",
        "evaluationFingerprint", "responseContentHash",
    )
    for report in reports:
        if report.get("schemaVersion") != "model-bakeoff-report.v2":
            errors.append(f"{report.get('name')}: stale report schema")
        if not report.get("promotable"):
            errors.append(f"{report.get('name')}: report is not a complete promotable run")
        if report.get("cases") != report.get("expectedCases"):
            errors.append(f"{report.get('name')}: incomplete case count")
        for field in required_integrity:
            if not report.get(field):
                errors.append(f"{report.get('name')}: missing integrity field {field}")
    for field in (
        "split", "caseIds", "datasetFileSha256", "promptVersion", "evaluatorVersion", "evaluatorSourceHash",
        "evaluationHelperSourceHash", "runtimeSourceHash", "groundingSourceHash", "expectedCases",
    ):
        if any(report.get(field) != reference.get(field) for report in reports[1:]):
            errors.append(f"comparison mismatch: {field}")
    requested = (reference.get("generationProfile") or {}).get("requested")
    if any((report.get("generationProfile") or {}).get("requested") != requested for report in reports[1:]):
        errors.append("comparison mismatch: generationProfile.requested")
    gemini, untuned, tuned = reports
    if gemini.get("provider") != "gemini":
        errors.append("gemini slot must contain a Gemini provider report")
    for role, report in (("untuned", untuned), ("tuned", tuned)):
        if report.get("provider") != "local":
            errors.append(f"{role} slot must contain a local provider report")
        for field in ("runtime", "model", "modelArtifactHash", "quantization"):
            if not report.get(field):
                errors.append(f"{role} report is missing {field}")
    if untuned.get("modelArtifactHash") == tuned.get("modelArtifactHash"):
        errors.append("untuned and tuned reports must use different model artifacts")
    return errors


def compare(args: argparse.Namespace) -> dict[str, Any]:
    gemini = json.loads(args.gemini.read_text(encoding="utf-8"))
    untuned = json.loads(args.untuned.read_text(encoding="utf-8"))
    tuned = json.loads(args.tuned.read_text(encoding="utf-8"))
    reports = [gemini, untuned, tuned]
    compatibility = compatibility_errors(reports)
    reviews = {
        "gemini": human_review_summary(args.gemini_human, gemini),
        "untuned": human_review_summary(args.untuned_human, untuned),
        "tuned": human_review_summary(args.tuned_human, tuned),
    }
    tuned_human = reviews["tuned"]
    gemini_human = reviews["gemini"]
    untuned_human = reviews["untuned"]
    high_is_good = ("schemaValidityPct", "semanticValidityPct", "verdictPreservationPct", "patternsRespectedPct", "applicabilityRespectedPct")
    low_is_good = ("semanticErrors", "unsupportedFactRefs", "unsupportedRuleRefs", "unsupportedNumericClaims", "errorRatePct")
    no_automated_regression = (
        all(float(tuned.get(metric, 0)) >= float(untuned.get(metric, 0)) for metric in high_is_good)
        and all(float(tuned.get(metric, 999999)) <= float(untuned.get(metric, 999999)) for metric in low_is_good)
        and float(tuned.get("minimumCompletenessPct", 0)) >= float(untuned.get("minimumCompletenessPct", 0)) - 0.5
    )
    automated_improvement = (
        any(float(tuned.get(metric, 0)) > float(untuned.get(metric, 0)) for metric in high_is_good)
        or any(float(tuned.get(metric, 999999)) < float(untuned.get(metric, 999999)) for metric in low_is_good)
        or float(tuned.get("minimumCompletenessPct", 0)) >= float(untuned.get("minimumCompletenessPct", 0)) + 1
    )
    human_improvement = tuned_human["overallMean"] >= untuned_human["overallMean"] + 0.1
    gates = {
        "compatibleCompleteRuns": not compatibility,
        "schemaValidity": tuned.get("schemaValidityPct") == 100,
        "semanticValidity": tuned.get("semanticValidityPct") == 100 and tuned.get("semanticErrors") == 0,
        "verdictPreservation": tuned.get("verdictPreservationPct") == 100,
        "groundedFacts": tuned.get("unsupportedFactRefs") == 0 and tuned.get("unsupportedNumericClaims") == 0,
        "groundedRules": tuned.get("unsupportedRuleRefs") == 0,
        "perCaseCompleteness": tuned.get("minimumCompletenessPct", 0) >= 95,
        "patterns": tuned.get("patternsRespectedPct") == 100,
        "applicability": tuned.get("applicabilityRespectedPct") == 100,
        "latency": tuned.get("p95LatencySeconds", 999) <= 120,
        "reliability": tuned.get("errorRatePct", 100) == 0,
        "humanDimensions": all(value >= 4 for value in tuned_human["dimensionMeans"].values()),
        "humanGeminiParity": tuned_human["overallMean"] >= 4 and tuned_human["overallMean"] >= gemini_human["overallMean"] - 0.2,
        "noUntunedRegression": no_automated_regression,
        "measurableUntunedImprovement": automated_improvement or human_improvement,
    }
    return {
        "schemaVersion": "model-bakeoff-comparison.v2",
        "promote": all(gates.values()),
        "gates": gates,
        "compatibilityErrors": compatibility,
        "reports": {"gemini": gemini.get("name"), "untuned": untuned.get("name"), "tuned": tuned.get("name")},
        "human": reviews,
    }


def main() -> int:
    load_local_env()
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    run_parser = subparsers.add_parser("run")
    run_parser.add_argument("--name", required=True)
    run_parser.add_argument("--provider", choices=("gemini", "openai", "local"), required=True)
    run_parser.add_argument("--model", default="")
    run_parser.add_argument("--base-url", default="")
    run_parser.add_argument("--split", choices=("validation", "eval"), default="validation")
    run_parser.add_argument("--allow-sealed-eval", action="store_true")
    run_parser.add_argument("--validation-comparison", type=Path)
    run_parser.add_argument("--evaluation-role", choices=("gemini", "untuned", "tuned"), default="")
    run_parser.add_argument("--timeout", type=float, default=120)
    run_parser.add_argument("--temperature", type=float, default=0.1)
    run_parser.add_argument("--max-output-tokens", type=int, default=8192)
    run_parser.add_argument(
        "--reasoning-effort",
        choices=("none", "minimal", "low", "medium", "high", "xhigh"),
        default="minimal",
    )
    run_parser.add_argument("--seed", type=int)
    run_parser.add_argument("--rpm", type=float, default=15)
    run_parser.add_argument("--wait-on-short-quota", action=argparse.BooleanOptionalAction, default=True)
    run_parser.add_argument("--max-wait-seconds", type=float, default=600)
    run_parser.add_argument("--provider-retries", type=int, default=3)
    run_parser.add_argument("--retry-backoff-seconds", type=float, default=2)
    run_parser.add_argument("--retry-errors", action=argparse.BooleanOptionalAction, default=True)
    run_parser.add_argument(
        "--reuse-responses-from",
        default="",
        help="Reuse valid raw validation responses from a generation-compatible run and retry only invalid rows.",
    )
    run_parser.add_argument("--runtime", default="")
    run_parser.add_argument("--model-artifact-hash", default="")
    run_parser.add_argument("--quantization", default="")
    run_parser.add_argument("--case-ids", default="", help="Comma-separated validation IDs for runtime smoke tests.")
    compare_parser = subparsers.add_parser("compare")
    compare_parser.add_argument("--gemini", type=Path, required=True)
    compare_parser.add_argument("--untuned", type=Path, required=True)
    compare_parser.add_argument("--tuned", type=Path, required=True)
    compare_parser.add_argument("--gemini-human", type=Path, required=True)
    compare_parser.add_argument("--untuned-human", type=Path, required=True)
    compare_parser.add_argument("--tuned-human", type=Path, required=True)
    compare_parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = run(args) if args.command == "run" else compare(args)
    if args.command == "compare" and args.output:
        write_json_atomic(args.output, result)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
