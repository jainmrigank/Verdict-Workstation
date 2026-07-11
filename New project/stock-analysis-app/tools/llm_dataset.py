#!/usr/bin/env python3
"""Create, expand, and export the grounded analyst training dataset."""

from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import os
import random
import re
import sys
import threading
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


APP_ROOT = Path(__file__).resolve().parents[1]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from tools.approve_candidates import audit_candidate, unsupported_numeric_claims
from server.llm_analysis import static_retrieved_rule_set


TRAINING_ROOT = APP_ROOT / "data" / "training"
FIXTURES_PATH = TRAINING_ROOT / "contract_fixtures.jsonl"
GOLD_PATH = TRAINING_ROOT / "reasoning_gold.jsonl"
EXPANDED_PATH = TRAINING_ROOT / "expanded_examples.jsonl"
SPLIT_ROOT = TRAINING_ROOT / "provider"
VERTEX_ROOT = TRAINING_ROOT / "vertex"
OUTPUT_SCHEMA = json.loads((APP_ROOT / "schemas" / "llm_analysis_v1.schema.json").read_text(encoding="utf-8"))
SPLIT_TARGETS = {"train": 900, "validation": 150, "eval": 150}
GOLD_TARGETS = {"train": 75, "validation": 15, "eval": 30}
DESCENDANTS_PER_GOLD = {"train": 11, "validation": 9, "eval": 4}


class GeminiQuotaError(RuntimeError):
    """Structured Gemini quota failure used by resumable dataset commands."""

    def __init__(
        self,
        message: str,
        *,
        metric: str = "",
        quota_id: str = "",
        dimensions: dict[str, str] | None = None,
        limit: int | None = None,
        retry_after_seconds: float | None = None,
        scope: str = "hard",
    ) -> None:
        super().__init__(message)
        self.metric = metric
        self.quota_id = quota_id
        self.dimensions = dimensions or {}
        self.limit = limit
        self.retry_after_seconds = retry_after_seconds
        self.scope = scope

    @property
    def is_short_window(self) -> bool:
        return self.scope == "short_window" and self.retry_after_seconds is not None

    def as_dict(self) -> dict[str, Any]:
        return {
            "message": str(self),
            "metric": self.metric,
            "quotaId": self.quota_id,
            "dimensions": self.dimensions,
            "limit": self.limit,
            "retryAfterSeconds": self.retry_after_seconds,
            "scope": self.scope,
        }


ProviderQuotaError = GeminiQuotaError


GEMINI_PACING_RPM = 0.0
GEMINI_LAST_REQUEST_AT = 0.0
GEMINI_PACING_LOCK = threading.Lock()


def configure_gemini_pacing(rpm: float) -> None:
    global GEMINI_PACING_RPM, GEMINI_LAST_REQUEST_AT
    GEMINI_PACING_RPM = max(0.0, rpm)
    GEMINI_LAST_REQUEST_AT = 0.0


def pace_gemini_request() -> None:
    global GEMINI_LAST_REQUEST_AT
    if GEMINI_PACING_RPM <= 0:
        return
    minimum_interval = 60.0 / GEMINI_PACING_RPM
    with GEMINI_PACING_LOCK:
        now = time.monotonic()
        if GEMINI_LAST_REQUEST_AT <= 0:
            GEMINI_LAST_REQUEST_AT = now
            return
        wait = max(0.0, GEMINI_LAST_REQUEST_AT + minimum_interval - now)
        if wait:
            time.sleep(wait)
        GEMINI_LAST_REQUEST_AT = time.monotonic()


def _retry_seconds(value: Any) -> float | None:
    if isinstance(value, str):
        match = re.fullmatch(r"([0-9]+(?:\.[0-9]+)?)s", value.strip())
        return float(match.group(1)) if match else None
    if isinstance(value, dict):
        seconds = float(value.get("seconds") or 0)
        nanos = float(value.get("nanos") or 0)
        return seconds + nanos / 1_000_000_000
    return None


def parse_gemini_quota_error(detail: str) -> GeminiQuotaError:
    message = detail[:1000]
    metric = ""
    quota_id = ""
    dimensions: dict[str, str] = {}
    retry_after: float | None = None
    limit: int | None = None
    try:
        payload = json.loads(detail)
        error = payload[0].get("error") if isinstance(payload, list) and payload else payload.get("error")
        if isinstance(error, dict):
            message = str(error.get("message") or message)
            for item in error.get("details") or []:
                if not isinstance(item, dict):
                    continue
                item_type = str(item.get("@type") or "")
                if item_type.endswith("RetryInfo"):
                    retry_after = _retry_seconds(item.get("retryDelay"))
                if item_type.endswith("QuotaFailure"):
                    violation = next((value for value in item.get("violations") or [] if isinstance(value, dict)), {})
                    metric = str(violation.get("quotaMetric") or "")
                    quota_id = str(violation.get("quotaId") or "")
                    dimensions = {
                        str(key): str(value)
                        for key, value in (violation.get("quotaDimensions") or {}).items()
                    }
                    quota_value = violation.get("quotaValue")
                    if quota_value is not None:
                        limit = int(float(quota_value))
    except (json.JSONDecodeError, AttributeError, TypeError, ValueError):
        pass
    if retry_after is None:
        retry_match = re.search(r"retry in\s+([0-9]+(?:\.[0-9]+)?)s", message, flags=re.IGNORECASE)
        retry_after = float(retry_match.group(1)) if retry_match else None
    limit_match = re.search(r"limit:\s*(\d+)", message, flags=re.IGNORECASE)
    if limit_match:
        limit = int(limit_match.group(1))
    lowered = f"{metric} {quota_id} {message}".lower()
    daily_tokens = ("per_day", "perday", "daily", "requests_per_day")
    minute_tokens = ("per_minute", "perminute", "requests_per_minute")
    if any(token in lowered for token in daily_tokens):
        scope = "daily"
    elif any(token in lowered for token in minute_tokens):
        scope = "short_window"
    elif retry_after is not None and retry_after <= 600:
        scope = "short_window"
    else:
        scope = "hard"
    return GeminiQuotaError(
        message,
        metric=metric,
        quota_id=quota_id,
        dimensions=dimensions,
        limit=limit,
        retry_after_seconds=retry_after,
        scope=scope,
    )


def _header_value(headers: Any, name: str) -> str:
    value = headers.get(name) if headers is not None and hasattr(headers, "get") else None
    return str(value or "")


def parse_cerebras_quota_error(detail: str, headers: Any = None) -> ProviderQuotaError:
    message = detail[:1000]
    try:
        payload = json.loads(detail)
        error = payload.get("error") if isinstance(payload, dict) else None
        if isinstance(error, dict):
            message = str(error.get("message") or message)
        elif isinstance(payload, dict):
            message = str(payload.get("message") or message)
    except (json.JSONDecodeError, AttributeError, TypeError):
        pass
    retry_after = _retry_seconds(_header_value(headers, "retry-after"))
    if retry_after is None:
        raw_retry = _header_value(headers, "retry-after")
        try:
            retry_after = float(raw_retry) if raw_retry else None
        except ValueError:
            retry_after = None
    remaining_day = _header_value(headers, "x-ratelimit-remaining-requests-day")
    remaining_minute = _header_value(headers, "x-ratelimit-remaining-tokens-minute")
    reset_day = _header_value(headers, "x-ratelimit-reset-requests-day")
    reset_minute = _header_value(headers, "x-ratelimit-reset-tokens-minute")
    dimensions = {
        key: value
        for key, value in {
            "remainingRequestsDay": remaining_day,
            "remainingTokensMinute": remaining_minute,
            "resetRequestsDay": reset_day,
            "resetTokensMinute": reset_minute,
        }.items()
        if value
    }
    if remaining_day == "0":
        scope = "daily"
        quota_id = "cerebras-requests-day"
        raw_limit = _header_value(headers, "x-ratelimit-limit-requests-day")
    elif remaining_minute == "0" or retry_after is not None:
        scope = "short_window"
        quota_id = "cerebras-tokens-minute"
        raw_limit = _header_value(headers, "x-ratelimit-limit-tokens-minute")
    else:
        scope = "hard"
        quota_id = "cerebras-unknown"
        raw_limit = ""
    try:
        limit = int(float(raw_limit)) if raw_limit else None
    except ValueError:
        limit = None
    return ProviderQuotaError(
        message,
        metric="cerebras-inference",
        quota_id=quota_id,
        dimensions=dimensions,
        limit=limit,
        retry_after_seconds=retry_after,
        scope=scope,
    )


def strict_output_schema(schema: dict[str, Any]) -> dict[str, Any]:
    strict = json.loads(json.dumps(schema))
    unsupported = {"$schema", "$id", "minLength"}

    def visit(value: Any) -> None:
        if isinstance(value, dict):
            for key in unsupported:
                value.pop(key, None)
            if value.get("type") == "object":
                value["additionalProperties"] = False
            for item in value.values():
                visit(item)
        elif isinstance(value, list):
            for item in value:
                visit(item)

    visit(strict)
    return strict


def dataset_provider_name(provider: str | None = None) -> str:
    selected = (provider or os.environ.get("DATASET_LLM_PROVIDER") or "gemini").strip().lower()
    if selected not in {"gemini", "cerebras"}:
        raise RuntimeError(f"Unsupported dataset provider: {selected!r}")
    return selected


def dataset_provider_metadata(provider: str | None = None) -> dict[str, str]:
    selected = dataset_provider_name(provider)
    if selected == "cerebras":
        model = os.environ.get("CEREBRAS_DATASET_MODEL") or "gpt-oss-120b"
    else:
        model = os.environ.get("GEMINI_DATASET_MODEL") or os.environ.get("LLM_MODEL") or "gemini-3.5-flash"
    return {"provider": selected, "model": model}

ACTIONS = ["Buy", "Sell"]
INSTRUMENT_TYPES = ["equity", "etf", "index", "fund", "unknown"]
HORIZONS = ["3-6m", "6-12m", "1-3y", "3y+"]
TRENDS = ["rising", "mixed", "falling"]
DATA_STATES = ["complete", "incomplete"]
RISK_PROFILES = ["conservative", "balanced", "balanced aggressive", "aggressive"]


def load_local_env() -> None:
    env_path = APP_ROOT.parent / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text("".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n" for row in rows), encoding="utf-8")
    temporary.replace(path)


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def item(text: str, tone: str, facts: list[str], rules: list[str]) -> dict[str, Any]:
    return {"text": text, "tone": tone, "factRefs": facts, "ruleRefs": rules}


def candidate_output(facts: dict[str, Any], rule_ids: list[str]) -> dict[str, Any]:
    verdict = facts["deterministicAnalysis"]["verdict"]
    action = facts["userContext"]["action"]
    trend = facts["technicalEvidence"]["trend"]
    instrument_type = facts["instrument"]["type"]
    complete = facts["dataQuality"]["state"] == "complete"
    tone = "positive" if trend == "rising" and complete else "negative" if trend == "falling" else "neutral"
    gap_subject = "company and price" if instrument_type == "equity" else "instrument and price"
    gap = f"The available {gap_subject} evidence is sufficient for a structured review." if complete else "Important evidence is missing, so confidence must remain limited until it is refreshed."
    if verdict == "Needs Input":
        next_text = "Do not commit capital or change the holding until the missing evidence is resolved and the deterministic analysis can be rerun."
    elif verdict == "Buy in Tranches":
        next_text = "Stage the proposed capital in tranches and keep the deterministic invalidation visible before each addition."
    elif verdict == "Reduce":
        next_text = "Follow the deterministic reduction plan without turning a risk-control decision into an attempt to recover the loss immediately."
    else:
        next_text = f"Follow the deterministic {verdict} decision and review it against the stated invalidation before changing capital."
    avoid_text = "Do not override the current plan because of one candle, one ratio, or the desire to recover a loss quickly."
    supporting_evidence = "business quality and valuation" if instrument_type == "equity" else "underlying exposure, liquidity, tracking, and valuation"
    driver_text = f"The {trend} price trend is the main timing clue, but it needs agreement from volume and {supporting_evidence}."
    company_applicable = instrument_type == "equity"
    if company_applicable:
        company_text = "Use profitability, balance-sheet strength, cash conversion, valuation, and sector drivers together before raising conviction."
        company_items = {
            "businessModel": "Confirm how the business creates value before interpreting its ratios.",
            "quality": company_text,
            "profitability": "Profitability should be durable and supported by operating evidence rather than one period.",
            "balanceSheet": "Debt and liquidity determine how well the business can absorb a weak cycle.",
            "cashFlow": "Cash generation should support reported profit before earnings quality is treated as strong.",
            "valuation": "Valuation needs growth and quality support; a low multiple is not automatically cheap.",
            "sectorDrivers": "Sector-specific operating drivers can matter more than generic ratios.",
            "catalysts": "Treat only supplied filings or operating improvements as catalysts.",
            "risks": "Missing or weakening business evidence can cap upside even when price momentum improves.",
        }
    else:
        company_text = f"Company-style fundamentals are not directly applicable to this {instrument_type}; evaluate its mandate, underlying exposure, costs, tracking, liquidity, and concentration instead."
        company_items = {
            "businessModel": f"Treat the {instrument_type} structure, mandate, benchmark, and underlying exposure as its business context.",
            "quality": "Judge portfolio construction, replication quality, governance, liquidity, and consistency with the stated mandate.",
            "profitability": "Issuer profitability is not directly applicable; inspect the quality and earnings exposure of the underlying holdings when that data is available.",
            "balanceSheet": "A company balance sheet is not directly applicable; use underlying credit quality, leverage exposure, and counterparty structure where relevant.",
            "cashFlow": "Company cash flow is not directly applicable; assess distributions, underlying cash generation, and fund flows only when supplied.",
            "valuation": "Use NAV, premium or discount, underlying portfolio valuation, and costs rather than a standalone company multiple.",
            "sectorDrivers": "Rates, index composition, sector weights, flows, and mandate-specific drivers can change future returns.",
            "catalysts": "Rebalancing, flows, rate changes, tracking improvement, and changes in underlying holdings are relevant only when supplied.",
            "risks": "Tracking error, liquidity, concentration, costs, and underlying exposure can weaken the case even when the chart improves.",
        }
    portfolio_text = "Keep the position size consistent with risk capacity and total portfolio concentration."
    refs = ["deterministicAnalysis.verdict", "technicalEvidence.trend", "dataQuality.state"]
    rules = rule_ids
    return {
        "decision": {
            "summary": f"This {action.lower()} review keeps the app's {verdict} verdict and explains the evidence that should govern the next action.",
            "nextActions": [item(next_text, "positive" if complete else "neutral", refs, rules)],
            "avoid": [item(avoid_text, "negative", refs, rules)],
            "priceDrivers": [item(driver_text, tone, refs, rules)],
            "risks": [item("Downside risk rises when the chart, business evidence, or position size stops supporting the thesis.", "negative", refs, rules)],
            "dataGaps": [item(gap, "neutral" if complete else "negative", ["dataQuality.state"], rules)],
        },
        "chart": {
            "summary": f"The chart trend is {trend}; treat it as timing evidence rather than a guaranteed forecast.",
            "trend": [item(driver_text, tone, ["technicalEvidence.trend"], rules)],
            "momentum": [item("Momentum must confirm the broader trend before it deserves more weight.", "neutral", ["technicalEvidence.rsi14"], rules)],
            "volume": [item("Volume should confirm that price movement has enough participation to be dependable.", "neutral", ["technicalEvidence.averageVolume20"], rules)],
            "volatility": [item("Position size and invalidation distance should allow for normal volatility without accepting unlimited downside.", "neutral", ["technicalEvidence.atrPct"], rules)],
            "levels": [item("Use the supplied support, resistance, and invalidation levels as review points, not precise predictions.", "neutral", ["technicalEvidence.support", "technicalEvidence.resistance"], rules)],
            "patterns": [item("Any detected pattern requires location, volume, and follow-through confirmation.", "neutral", ["uiOptions.patternsEnabled"], rules)],
        },
        "company": {
            "summary": company_text,
            "businessModel": [item(company_items["businessModel"], "neutral", ["instrument.type"], rules)],
            "quality": [item(company_items["quality"], tone, ["fundamentalEvidence.quality"] if company_applicable else ["instrument.type"], rules)],
            "profitability": [item(company_items["profitability"], "neutral", ["fundamentalEvidence.roce"] if company_applicable else ["instrument.type"], rules)],
            "balanceSheet": [item(company_items["balanceSheet"], "neutral", ["fundamentalEvidence.debtEquity"] if company_applicable else ["instrument.type"], rules)],
            "cashFlow": [item(company_items["cashFlow"], "neutral", ["fundamentalEvidence.cashFlowQuality"] if company_applicable else ["instrument.type"], rules)],
            "valuation": [item(company_items["valuation"], "neutral", ["fundamentalEvidence.pe"] if company_applicable else ["instrument.type"], rules)],
            "sectorDrivers": [item(company_items["sectorDrivers"], "neutral", ["instrument.sector"], rules)],
            "catalysts": [item(company_items["catalysts"], "neutral", ["fundamentalEvidence.updates"] if company_applicable else ["instrument.type"], rules)],
            "risks": [item(company_items["risks"], "negative", ["dataQuality.state", "instrument.type"], rules)],
            "dataGaps": [item(gap, "neutral" if complete else "negative", ["dataQuality.state"], rules)],
        },
        "portfolio": {
            "summary": portfolio_text,
            "positionFit": [item(portfolio_text, "neutral", ["portfolioEvidence.weight"], rules)],
            "concentration": [item("A large single-position weight magnifies company-specific mistakes.", "negative", ["portfolioEvidence.weight"], rules)],
            "sizing": [item("Size new or additional capital from the risk budget and invalidation distance.", "neutral", ["portfolioEvidence.riskBudget"], rules)],
            "holdingActions": [item(f"For a {action.lower()} review, follow the app verdict rather than treating the action label as a broker order.", "neutral", ["userContext.action"], rules)],
            "risks": [item("Do not let one position threaten emergency or goal-linked capital.", "negative", ["userContext.riskProfile"], rules)],
        },
        "reasoning": {
            "steps": [
                {
                    **item("Connect the authoritative verdict to current price, business, portfolio, and data-quality evidence.", tone, refs, rules),
                    "evidence": f"The deterministic verdict is {verdict}, the trend is {trend}, and data is {facts['dataQuality']['state']}.",
                    "implication": "Conviction should rise only when independent evidence agrees and material data gaps are closed.",
                    "action": next_text,
                }
            ]
        },
        "coach": {
            "verdictSummary": f"The {verdict} verdict remains authoritative; use the explanation to execute it with discipline.",
            "chartSummary": f"The {trend} chart needs confirmation from levels, volume, and risk controls.",
            "companySummary": company_text,
            "questionsBeforeAction": [item("What evidence would invalidate the current thesis, and is the resulting loss affordable?", "neutral", refs, rules)],
        },
        "warnings": [] if complete else ["Some evidence is missing; do not fill the gap with assumptions."],
    }


def candidate_rule_ids(instrument_type: str, trend: str, complete: bool) -> list[str]:
    process_rule = "process_process_before_outcome" if complete else "process_objectivity_facts"
    chart_rule = {
        "rising": "pdf-m2-c13-moving-averages",
        "mixed": "pdf-m2-c11-the-support-and-resistance",
        "falling": "pdf-m2-c12-volumes",
    }[trend]
    instrument_rule = {
        "equity": "pdf-m3-c12-the-investment-due-diligence",
        "fund": "pdf-m11-c8-the-mutual-fund-fact-sheet",
        "etf": "pdf-m11-c16-index-funds",
        "index": "pdf-m11-c16-index-funds",
        "unknown": "process_flexible_stand_aside",
    }[instrument_type]
    return list(dict.fromkeys([process_rule, chart_rule, instrument_rule]))


def generate_candidates(count: int = 120) -> list[dict[str, Any]]:
    combinations = list(itertools.product(ACTIONS, INSTRUMENT_TYPES, HORIZONS, TRENDS, DATA_STATES, RISK_PROFILES))
    random.Random(560).shuffle(combinations)
    rows: list[dict[str, Any]] = []
    for index, (action, instrument_type, horizon, trend, data_state, risk_profile) in enumerate(combinations[:count]):
        if data_state == "incomplete":
            verdict = "Needs Input"
        elif action == "Sell":
            verdict = "Hold and Watch" if trend != "falling" else "Reduce"
        else:
            verdict = "Buy in Tranches" if trend == "rising" else "Wait and Watch"
        facts = {
            "schemaVersion": "analysis-facts.v1",
            "generatedAt": "2026-01-01T00:00:00+00:00",
            "instrument": {"symbol": f"TEST:{index + 1:03d}", "type": instrument_type, "sector": "Synthetic sector"},
            "userContext": {"action": action, "horizon": horizon, "riskProfile": risk_profile, "capital": 100000},
            "deterministicAnalysis": {"verdict": verdict, "confidence": "High" if data_state == "complete" else "Low"},
            "technicalEvidence": {"trend": trend, "rsi14": 55, "averageVolume20": 100000, "atrPct": 2.4, "support": 95, "resistance": 110},
            "fundamentalEvidence": {"quality": "mixed", "roce": 15, "debtEquity": 0.4, "cashFlowQuality": "available", "pe": 20, "updates": []},
            "portfolioEvidence": {"weight": 8 if action == "Sell" else 0, "riskBudget": 1000},
            "signals": [],
            "reasoningTrace": [],
            "dataQuality": {"state": data_state, "missing": [] if data_state == "complete" else ["fundamentals"]},
            "uiOptions": {"patternsEnabled": index % 2 == 0},
        }
        rule_ids = candidate_rule_ids(instrument_type, trend, data_state == "complete")
        rows.append(
            {
                "id": f"gold-candidate-{index + 1:03d}",
                "reviewStatus": "pending",
                "reviewNotes": "",
                "facts": facts,
                "retrievedRuleIds": rule_ids,
                "output": candidate_output(facts, rule_ids),
            }
        )
    return rows


def extract_chat_content(payload: dict[str, Any]) -> str:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        raise RuntimeError("The provider returned no response choices.")
    message = choices[0].get("message") if isinstance(choices[0], dict) else None
    content = message.get("content") if isinstance(message, dict) else None
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(str(part.get("text") or "") for part in content if isinstance(part, dict))
    raise RuntimeError("The provider returned an unreadable response body.")


def gemini_json(prompt: dict[str, Any], system_prompt: str, temperature: float = 0.2) -> dict[str, Any]:
    api_key = os.environ.get("GEMINI_DATASET_API_KEY") or os.environ.get("GEMINI_API_KEY") or os.environ.get("LLM_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY or LLM_API_KEY is required for Gemini dataset work.")
    model = os.environ.get("GEMINI_DATASET_MODEL") or os.environ.get("LLM_MODEL") or "gemini-3.5-flash"
    base_url = (
        os.environ.get("GEMINI_BASE_URL")
        or os.environ.get("LLM_BASE_URL")
        or "https://generativelanguage.googleapis.com/v1beta/openai"
    ).rstrip("/")
    body: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
        ],
        "response_format": {"type": "json_object"},
        "temperature": temperature,
    }
    max_tokens = os.environ.get("GEMINI_DATASET_MAX_TOKENS")
    if max_tokens:
        body["max_tokens"] = int(max_tokens)
    retryable = {429, 500, 502, 503, 504}
    attempts = max(1, int(os.environ.get("GEMINI_DATASET_ATTEMPTS") or 1))
    timeout = max(10.0, float(os.environ.get("GEMINI_DATASET_TIMEOUT") or 120))
    for attempt in range(attempts):
        pace_gemini_request()
        request = Request(
            f"{base_url}/chat/completions",
            data=json.dumps(body).encode("utf-8"),
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
            parsed = json.loads(extract_chat_content(payload))
            if not isinstance(parsed, dict):
                raise RuntimeError("Gemini JSON response must be an object.")
            return parsed
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            if exc.code == 429:
                raise parse_gemini_quota_error(detail) from exc
            if exc.code not in retryable or attempt == attempts - 1:
                raise RuntimeError(f"Gemini returned HTTP {exc.code}: {detail[:1000]}") from exc
        except URLError as exc:
            if attempt == attempts - 1:
                raise RuntimeError(f"Could not reach Gemini: {exc.reason}") from exc
        except (TimeoutError, json.JSONDecodeError) as exc:
            if attempt == attempts - 1:
                raise RuntimeError(f"Gemini returned an invalid or timed-out response: {exc}") from exc
        time.sleep(5 * (attempt + 1))
    raise RuntimeError("Gemini request failed after retries.")


def cerebras_json(
    prompt: dict[str, Any],
    system_prompt: str,
    temperature: float = 0.2,
    *,
    schema: dict[str, Any] | None = None,
) -> dict[str, Any]:
    api_key = os.environ.get("CEREBRAS_API_KEY")
    if not api_key:
        raise RuntimeError("CEREBRAS_API_KEY is required for Cerebras dataset work.")
    model = os.environ.get("CEREBRAS_DATASET_MODEL") or "gpt-oss-120b"
    base_url = (os.environ.get("CEREBRAS_BASE_URL") or "https://api.cerebras.ai/v1").rstrip("/")
    response_format: dict[str, Any]
    if schema:
        response_format = {
            "type": "json_schema",
            "json_schema": {
                "name": "llm_analysis_v1",
                "strict": True,
                "schema": strict_output_schema(schema),
            },
        }
    else:
        response_format = {"type": "json_object"}
    body: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
        ],
        "response_format": response_format,
        "temperature": temperature,
        "reasoning_effort": os.environ.get("CEREBRAS_REASONING_EFFORT") or "medium",
        "max_completion_tokens": int(os.environ.get("CEREBRAS_MAX_COMPLETION_TOKENS") or 12000),
        "seed": int(os.environ.get("CEREBRAS_DATASET_SEED") or 560),
    }
    timeout = max(10.0, float(os.environ.get("CEREBRAS_DATASET_TIMEOUT") or 120))
    pace_gemini_request()
    request = Request(
        f"{base_url}/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "stock-analysis-agent/1.0",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
        parsed = json.loads(extract_chat_content(payload))
        if not isinstance(parsed, dict):
            raise RuntimeError("Cerebras JSON response must be an object.")
        return parsed
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        if exc.code == 429:
            raise parse_cerebras_quota_error(detail, exc.headers) from exc
        raise RuntimeError(f"Cerebras returned HTTP {exc.code}: {detail[:1000]}") from exc
    except URLError as exc:
        raise RuntimeError(f"Could not reach Cerebras: {exc.reason}") from exc
    except (TimeoutError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Cerebras returned an invalid or timed-out response: {exc}") from exc


def dataset_json(
    prompt: dict[str, Any],
    system_prompt: str,
    temperature: float = 0.2,
    *,
    provider: str | None = None,
    schema: dict[str, Any] | None = None,
) -> dict[str, Any]:
    selected = dataset_provider_name(provider)
    if selected == "cerebras":
        return cerebras_json(prompt, system_prompt, temperature, schema=schema)
    return gemini_json(prompt, system_prompt, temperature)


def gemini_expand(seed: dict[str, Any], count: int) -> list[dict[str, Any]]:
    seed_payload = {
        **seed,
        "retrievedRuleSet": static_retrieved_rule_set(seed.get("retrievedRuleIds") or [], seed.get("facts") or {}),
    }
    prompt = {
        "task": f"Create {count} diverse synthetic financial-analysis examples based on the approved seed. Preserve the schemas, use synthetic instruments only, and never include personal portfolio data.",
        "seed": seed_payload,
        "output": "Return a JSON object with an examples array. Each example needs facts, retrievedRuleIds, and output.",
        "analysisOutputSchema": OUTPUT_SCHEMA,
    }
    parsed = dataset_json(
        prompt,
        "You generate grounded supervised fine-tuning examples for a financial decision-support model. Preserve deterministic verdicts and never invent facts.",
        temperature=0.35,
    )
    return [example for example in parsed.get("examples") or [] if isinstance(example, dict)]


def gemini_preflight(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    compact_rows = [
        {
            "id": row.get("id"),
            "facts": row.get("facts"),
            "retrievedRuleIds": row.get("retrievedRuleIds"),
            "retrievedRuleSet": static_retrieved_rule_set(row.get("retrievedRuleIds") or [], row.get("facts") or {}),
            "output": row.get("output"),
        }
        for row in rows
    ]
    prompt = {
        "task": "Review each candidate for supervised fine-tuning quality. Do not approve it; return an advisory verdict only.",
        "criteria": [
            "The deterministic verdict is preserved without contradiction.",
            "Every numerical or company-specific claim is supported by a fact reference.",
            "Rule references are relevant to the statement.",
            "Applicable sections are complete, concise, and actionable.",
            "Missing or non-applicable evidence is stated honestly.",
        ],
        "scoring": "Score grounding, clarity, completeness, and verdictSafety from 1 (unacceptable) to 5 (excellent).",
        "candidates": compact_rows,
        "output": {
            "reviews": [
                {
                    "id": "candidate id",
                    "verdict": "pass or needs_changes",
                    "scores": {"grounding": 5, "clarity": 5, "completeness": 5, "verdictSafety": 5},
                    "issues": ["specific issue"],
                    "suggestedReviewNotes": "short note for the human reviewer",
                }
            ]
        },
    }
    parsed = dataset_json(
        prompt,
        "You are a strict financial-analysis dataset evaluator. Treat the supplied facts as the only source of company and numerical truth.",
        temperature=0.0,
    )
    reviews = parsed.get("reviews")
    if not isinstance(reviews, list):
        raise RuntimeError("Gemini preflight response is missing its reviews array.")
    return {
        str(review["id"]): review
        for review in reviews
        if isinstance(review, dict) and review.get("id")
    }


def preflight_candidates(limit: int, batch_size: int, path: Path = GOLD_PATH) -> dict[str, int]:
    rows = read_jsonl(path)
    selected = rows if limit <= 0 else rows[:limit]
    reviewed = 0
    unavailable = 0
    for offset in range(0, len(selected), batch_size):
        batch = selected[offset : offset + batch_size]
        try:
            reviews = gemini_preflight(batch)
        except RuntimeError as exc:
            reviews = {}
            unavailable += len(batch)
            for row in batch:
                row["modelReview"] = {
                    "verdict": "unavailable",
                    "scores": {},
                    "issues": [str(exc)],
                    "suggestedReviewNotes": "Gemini preflight is optional. Continue with human review or retry later.",
                    "model": os.environ.get("GEMINI_DATASET_MODEL") or os.environ.get("LLM_MODEL") or "gemini-3.5-flash",
                    "reviewedAt": datetime.now(UTC).isoformat(),
                }
        for row in batch:
            review = reviews.get(str(row.get("id")))
            if review:
                row["modelReview"] = {
                    **review,
                    "model": os.environ.get("GEMINI_DATASET_MODEL") or os.environ.get("LLM_MODEL") or "gemini-3.5-flash",
                    "reviewedAt": datetime.now(UTC).isoformat(),
                }
                reviewed += 1
        write_jsonl(path, rows)
    return {"candidates": len(rows), "modelReviewed": reviewed, "preflightUnavailable": unavailable}


def row_fingerprint(row: dict[str, Any]) -> str:
    content = {"facts": row.get("facts") or {}, "output": row.get("output") or {}}
    return hashlib.sha256(json.dumps(content, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def approved_gold() -> list[dict[str, Any]]:
    rows = [row for row in read_jsonl(GOLD_PATH) if row.get("reviewStatus") == "approved"]
    split_counts = {split: sum(row.get("split") == split for row in rows) for split in GOLD_TARGETS}
    if split_counts != GOLD_TARGETS:
        raise RuntimeError(f"Approved reasoning-gold gate failed. Expected {GOLD_TARGETS}, found {split_counts}.")
    return rows


def expansion_schedule(gold: list[dict[str, Any]]) -> list[tuple[dict[str, Any], int]]:
    schedule: list[tuple[dict[str, Any], int]] = []
    for seed in sorted(gold, key=lambda row: str(row.get("id") or "")):
        split = str(seed.get("split") or "")
        for ordinal in range(1, DESCENDANTS_PER_GOLD[split] + 1):
            schedule.append((seed, ordinal))
    return schedule


def prepare_expanded_row(raw: dict[str, Any], seed: dict[str, Any], ordinal: int) -> dict[str, Any]:
    facts = raw.get("facts") if isinstance(raw.get("facts"), dict) else {}
    rule_ids = [str(value) for value in raw.get("retrievedRuleIds") or seed.get("retrievedRuleIds") or []]
    output = raw.get("output") if isinstance(raw.get("output"), dict) else {}
    if not bool((facts.get("uiOptions") or {}).get("patternsEnabled")) and isinstance(output.get("chart"), dict):
        output["chart"]["patterns"] = []
    lineage_id = str(seed["id"])
    return {
        "id": f"synthetic-{lineage_id}-{ordinal:02d}",
        "lineageId": lineage_id,
        "split": seed["split"],
        "reviewStatus": "gemini-generated",
        "reviewNotes": "Passed strict automated expansion audit; not human-approved gold.",
        "facts": facts,
        "retrievedRuleIds": rule_ids,
        "retrievedRuleSet": static_retrieved_rule_set(rule_ids, facts),
        "output": output,
        "provenance": {
            "kind": "gemini-synthetic-descendant",
            "parentGoldId": lineage_id,
            "generatedAt": datetime.now(UTC).isoformat(),
            "model": os.environ.get("GEMINI_DATASET_MODEL") or os.environ.get("LLM_MODEL") or "gemini-3.5-flash",
        },
    }


def expand_to_target(target: int, batch_size: int) -> dict[str, Any]:
    if target != 1200:
        raise RuntimeError("The leak-proof expansion contract currently requires exactly 1,200 examples.")
    gold = approved_gold()
    expanded = read_jsonl(EXPANDED_PATH)
    existing_ids = {str(row.get("id") or "") for row in expanded}
    fingerprints = {row_fingerprint(row) for row in [*gold, *expanded]}
    schedule = expansion_schedule(gold)
    generated = 0
    quota_exhausted = False
    index = 0
    while index < len(schedule):
        seed, ordinal = schedule[index]
        expected_id = f"synthetic-{seed['id']}-{ordinal:02d}"
        if expected_id in existing_ids:
            index += 1
            continue
        ordinals = [ordinal]
        lookahead = index + 1
        while lookahead < len(schedule) and len(ordinals) < max(1, batch_size):
            next_seed, next_ordinal = schedule[lookahead]
            if next_seed["id"] != seed["id"] or f"synthetic-{seed['id']}-{next_ordinal:02d}" in existing_ids:
                break
            ordinals.append(next_ordinal)
            lookahead += 1
        try:
            new_rows = gemini_expand(seed, len(ordinals))
        except GeminiQuotaError:
            quota_exhausted = True
            break
        if len(new_rows) != len(ordinals):
            raise RuntimeError(f"Gemini returned {len(new_rows)} rows for {len(ordinals)} requested descendants of {seed['id']}.")
        prepared = [prepare_expanded_row(raw, seed, current_ordinal) for raw, current_ordinal in zip(new_rows, ordinals)]
        batch_fingerprints: set[str] = set()
        for row in prepared:
            audit_errors = audit_candidate(row, require_synthetic=False)
            unsupported_numbers = unsupported_numeric_claims(row)
            if unsupported_numbers:
                audit_errors.append(f"{row['id']}: unsupported numeric claims {unsupported_numbers[:8]}")
            fingerprint = row_fingerprint(row)
            if fingerprint in fingerprints or fingerprint in batch_fingerprints:
                audit_errors.append(f"{row['id']}: duplicate global content fingerprint")
            if audit_errors:
                raise RuntimeError(f"Gemini expansion failed strict audit: {'; '.join(audit_errors[:12])}")
            batch_fingerprints.add(fingerprint)
        expanded.extend(prepared)
        fingerprints.update(batch_fingerprints)
        existing_ids.update(str(row["id"]) for row in prepared)
        generated += len(prepared)
        write_jsonl(EXPANDED_PATH, expanded)
        index = lookahead
    split_counts = {split: sum(row.get("split") == split for row in expanded) for split in SPLIT_TARGETS}
    return {
        "gold": len(gold),
        "expanded": len(expanded),
        "examples": len(gold) + len(expanded),
        "generated": generated,
        "quotaExhausted": quota_exhausted,
        "expandedSplits": split_counts,
        "complete": len(expanded) == 1080,
        "path": str(EXPANDED_PATH),
    }


TRAINING_SYSTEM_PROMPT = (
    "You are the grounded analyst inside Stock Analysis Agent. Supplied facts and the deterministic verdict are authoritative. "
    "Use only the supplied RetrievedRuleSetV1 guidance and return complete LlmAnalysisV1 JSON."
)


def training_prompt(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "facts": row["facts"],
        "retrievedRuleSet": row.get("retrievedRuleSet") or static_retrieved_rule_set(row.get("retrievedRuleIds") or [], row["facts"]),
        "instruction": "Return LlmAnalysisV1 JSON. Preserve deterministic facts and verdict.",
    }


def provider_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "lineageId": row.get("lineageId") or row["id"],
        "split": row["split"],
        "messages": [
            {"role": "system", "content": TRAINING_SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps(training_prompt(row), ensure_ascii=False, separators=(",", ":"))},
            {"role": "assistant", "content": json.dumps(row["output"], ensure_ascii=False, separators=(",", ":"))},
        ],
        "metadata": {
            "reviewStatus": row.get("reviewStatus"),
            "corpusVersion": (row.get("retrievedRuleSet") or {}).get("corpusVersion"),
            "retrievalMode": (row.get("retrievedRuleSet") or {}).get("mode"),
            "instrumentType": (row.get("facts") or {}).get("instrument", {}).get("type"),
            "action": (row.get("facts") or {}).get("userContext", {}).get("action"),
        },
    }


def vertex_row(row: dict[str, Any]) -> dict[str, Any]:
    provider = provider_row(row)
    system = provider["messages"][0]["content"]
    user = provider["messages"][1]["content"]
    assistant = provider["messages"][2]["content"]
    return {
        "contents": [
            {"role": "user", "parts": [{"text": f"SYSTEM:\n{system}\n\nUSER:\n{user}"}]},
            {"role": "model", "parts": [{"text": assistant}]},
        ]
    }


def validate_lineage(rows: list[dict[str, Any]], expected: dict[str, int]) -> None:
    counts = {split: sum(row.get("split") == split for row in rows) for split in expected}
    if counts != expected:
        raise RuntimeError(f"Split gate failed. Expected {expected}, found {counts}.")
    lineage_splits: dict[str, set[str]] = {}
    for row in rows:
        lineage_splits.setdefault(str(row.get("lineageId") or row.get("id") or ""), set()).add(str(row.get("split") or ""))
    leaked = sorted(lineage for lineage, splits in lineage_splits.items() if len(splits) > 1)
    if leaked:
        raise RuntimeError(f"Lineage leakage across splits: {leaked[:12]}")


def export_provider(*, pilot: bool = False) -> dict[str, int]:
    gold = approved_gold()
    if pilot:
        splits = {
            "pilot_train": [row for row in gold if row["split"] == "train"],
            "pilot_validation": [row for row in gold if row["split"] == "validation"],
        }
        validate_lineage([*splits["pilot_train"], *splits["pilot_validation"]], {"train": 75, "validation": 15})
    else:
        from tools.reasoning_dataset import verify_evaluation_seal

        seal = verify_evaluation_seal(gold)
        if not seal["verified"]:
            raise RuntimeError("Final export blocked by evaluation seal: " + "; ".join(seal["errors"]))
        expanded = read_jsonl(EXPANDED_PATH)
        rows = [*gold, *expanded]
        if len(expanded) != 1080:
            raise RuntimeError(f"Export blocked: expected 1,080 audited descendants, found {len(expanded)}.")
        validate_lineage(rows, SPLIT_TARGETS)
        fingerprints = [row_fingerprint(row) for row in rows]
        if len(set(fingerprints)) != len(fingerprints):
            raise RuntimeError("Export blocked by duplicate global content fingerprints.")
        splits = {split: [row for row in rows if row["split"] == split] for split in SPLIT_TARGETS}
    for name, split_rows in splits.items():
        write_jsonl(SPLIT_ROOT / f"{name}.jsonl", [provider_row(row) for row in split_rows])
        if not pilot:
            write_jsonl(VERTEX_ROOT / f"{name}.jsonl", [vertex_row(row) for row in split_rows])
    return {name: len(rows) for name, rows in splits.items()}


def main() -> int:
    load_local_env()
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    fixtures = subparsers.add_parser("fixtures")
    fixtures.add_argument("--count", type=int, default=120)
    expand = subparsers.add_parser("expand")
    expand.add_argument("--target", type=int, default=1200)
    expand.add_argument("--batch-size", type=int, default=4)
    preflight = subparsers.add_parser("preflight")
    preflight.add_argument("--limit", type=int, default=0, help="Review this many candidates; 0 reviews all.")
    preflight.add_argument("--batch-size", type=int, default=4)
    preflight.add_argument("--fixtures", action="store_true", help="Review contract fixtures instead of real reasoning gold.")
    export = subparsers.add_parser("export")
    export.add_argument("--pilot", action="store_true", help="Export only the 75/15 approved-gold pilot train and validation files.")
    args = parser.parse_args()
    if args.command == "fixtures":
        rows = generate_candidates(args.count)
        write_jsonl(FIXTURES_PATH, rows)
        print(json.dumps({"fixtures": len(rows), "path": str(FIXTURES_PATH)}, indent=2))
    elif args.command == "expand":
        print(json.dumps(expand_to_target(args.target, max(1, args.batch_size)), indent=2))
    elif args.command == "preflight":
        path = FIXTURES_PATH if args.fixtures else GOLD_PATH
        print(json.dumps(preflight_candidates(args.limit, max(1, args.batch_size), path), indent=2))
    elif args.command == "export":
        print(json.dumps(export_provider(pilot=args.pilot), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
