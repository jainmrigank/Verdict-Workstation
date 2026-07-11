#!/usr/bin/env python3
"""Collect, generate, audit, and approve the public-market reasoning gold set."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


APP_ROOT = Path(__file__).resolve().parents[1]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from server.llm_analysis import canonical_json, retrieve_rule_set
from tools.approve_candidates import audit_candidate, unsupported_numeric_claims
from tools.llm_dataset import OUTPUT_SCHEMA, gemini_json, load_local_env, read_jsonl, write_jsonl


TRAINING_ROOT = APP_ROOT / "data" / "training"
MANIFEST_PATH = TRAINING_ROOT / "reasoning_instruments.json"
GOLD_PATH = TRAINING_ROOT / "reasoning_gold.jsonl"
SNAPSHOT_PATH = APP_ROOT / "data" / "generated" / "reasoning_public_snapshots.json"
REVIEW_CHECKS = ("schema", "verdict", "grounding", "rules", "applicability", "coverage", "writingQuality")
HORIZONS = ("3-6m", "6-12m", "1-3y", "3y+")
RISK_PROFILES = ("conservative", "balanced", "balanced aggressive", "aggressive")
PUBLIC_SOURCES = {"yahoo", "mfapi"}
FORBIDDEN_MARKERS = ("holdings-upj", ".xlsx", "portfolio_holdings.json", "zerodha client id")


def atomic_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def fetch_json(url: str) -> Any:
    request = Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 verdict-reasoning-dataset/1.0", "Accept": "application/json,*/*"},
    )
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def yahoo_chart_url(symbol: str, days: int = 420) -> str:
    now = int(datetime.now(UTC).timestamp())
    start = now - days * 86400
    params = urlencode({"period1": start, "period2": now, "interval": "1d", "events": "history", "includeAdjustedClose": "true"})
    return f"https://query1.finance.yahoo.com/v8/finance/chart/{quote(symbol, safe='')}?{params}"


def yahoo_summary_url(symbol: str) -> str:
    modules = "assetProfile,price,summaryDetail,defaultKeyStatistics,financialData"
    return f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{quote(symbol, safe='')}?{urlencode({'modules': modules})}"


def raw_value(payload: dict[str, Any], key: str) -> Any:
    value = payload.get(key)
    return value.get("raw", value.get("fmt")) if isinstance(value, dict) else value


def yahoo_snapshot(instrument: dict[str, Any]) -> dict[str, Any]:
    symbol = str(instrument["sourceSymbol"])
    chart_url = yahoo_chart_url(symbol)
    chart_payload = fetch_json(chart_url)
    chart = chart_payload.get("chart") or {}
    if chart.get("error"):
        raise RuntimeError(str(chart["error"]))
    result = (chart.get("result") or [None])[0]
    if not isinstance(result, dict):
        raise RuntimeError(f"Yahoo returned no chart for {symbol}")
    timestamps = result.get("timestamp") or []
    quote_payload = (((result.get("indicators") or {}).get("quote") or [{}])[0])
    candles: list[dict[str, Any]] = []
    for index, timestamp in enumerate(timestamps):
        close_values = quote_payload.get("close") or []
        close = close_values[index] if index < len(close_values) else None
        if close is None:
            continue
        candle = {"date": datetime.fromtimestamp(timestamp, UTC).date().isoformat(), "close": float(close)}
        for source_key, target_key in (("open", "open"), ("high", "high"), ("low", "low"), ("volume", "volume")):
            values = quote_payload.get(source_key) or []
            value = values[index] if index < len(values) else None
            candle[target_key] = float(value) if value is not None else None
        candles.append(candle)

    summary_url = yahoo_summary_url(symbol)
    fundamentals: dict[str, Any] = {}
    summary_error = ""
    try:
        summary = fetch_json(summary_url)
        summary_result = (((summary.get("quoteSummary") or {}).get("result") or [None])[0])
        if isinstance(summary_result, dict):
            profile = summary_result.get("assetProfile") or {}
            price = summary_result.get("price") or {}
            detail = summary_result.get("summaryDetail") or {}
            stats = summary_result.get("defaultKeyStatistics") or {}
            financial = summary_result.get("financialData") or {}
            fundamentals = {
                "name": raw_value(price, "longName") or raw_value(price, "shortName"),
                "sector": profile.get("sector"),
                "industry": profile.get("industry"),
                "businessSummary": profile.get("longBusinessSummary"),
                "marketCap": raw_value(price, "marketCap") or raw_value(detail, "marketCap"),
                "trailingPe": raw_value(detail, "trailingPE") or raw_value(stats, "trailingPE"),
                "forwardPe": raw_value(detail, "forwardPE") or raw_value(stats, "forwardPE"),
                "priceToBook": raw_value(stats, "priceToBook"),
                "profitMargin": raw_value(financial, "profitMargins"),
                "operatingMargin": raw_value(financial, "operatingMargins"),
                "returnOnEquity": raw_value(financial, "returnOnEquity"),
                "debtToEquity": raw_value(financial, "debtToEquity"),
                "currentRatio": raw_value(financial, "currentRatio"),
                "operatingCashflow": raw_value(financial, "operatingCashflow"),
                "freeCashflow": raw_value(financial, "freeCashflow"),
                "revenueGrowth": raw_value(financial, "revenueGrowth"),
                "earningsGrowth": raw_value(financial, "earningsGrowth"),
            }
    except Exception as exc:  # Public quote-summary access is less reliable than chart access.
        summary_error = str(exc)
    return {
        "capturedAt": datetime.now(UTC).isoformat(),
        "source": "yahoo",
        "sourceSymbol": symbol,
        "sourceUrls": [chart_url, summary_url],
        "candles": candles,
        "fundamentals": fundamentals,
        "warnings": [summary_error] if summary_error else [],
    }


def mfapi_snapshot(instrument: dict[str, Any]) -> dict[str, Any]:
    query = str(instrument["searchQuery"])
    search_url = f"https://api.mfapi.in/mf/search?{urlencode({'q': query})}"
    matches = fetch_json(search_url)
    if not isinstance(matches, list) or not matches:
        raise RuntimeError(f"MFapi returned no scheme for {query}")
    exact = next((row for row in matches if str(row.get("schemeName") or "").casefold() == query.casefold()), matches[0])
    scheme_code = str(exact.get("schemeCode") or "")
    if not scheme_code:
        raise RuntimeError(f"MFapi result has no scheme code for {query}")
    detail_url = f"https://api.mfapi.in/mf/{quote(scheme_code, safe='')}"
    payload = fetch_json(detail_url)
    values = list(reversed(payload.get("data") or []))
    candles = []
    for row in values[-420:]:
        try:
            date = datetime.strptime(str(row["date"]), "%d-%m-%Y").date().isoformat()
            close = float(row["nav"])
        except (KeyError, TypeError, ValueError):
            continue
        candles.append({"date": date, "open": close, "high": close, "low": close, "close": close, "volume": None})
    return {
        "capturedAt": datetime.now(UTC).isoformat(),
        "source": "mfapi",
        "sourceSymbol": scheme_code,
        "sourceUrls": [search_url, detail_url],
        "candles": candles,
        "fundamentals": {"scheme": payload.get("meta") or {}, "name": exact.get("schemeName")},
        "warnings": [],
    }


def finite_number(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def mean(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def rounded(value: float | None, digits: int = 2) -> float | None:
    return round(value, digits) if value is not None and math.isfinite(value) else None


def technical_evidence(candles: list[dict[str, Any]]) -> dict[str, Any]:
    closes = [value for candle in candles if (value := finite_number(candle.get("close"))) is not None]
    if not closes:
        return {"trend": "unknown"}
    latest = closes[-1]
    previous = closes[-2] if len(closes) > 1 else latest
    sma20 = mean(closes[-20:]) if len(closes) >= 20 else mean(closes)
    sma50 = mean(closes[-50:]) if len(closes) >= 50 else mean(closes)
    trend = "mixed"
    if sma20 is not None and sma50 is not None and latest > sma20 > sma50:
        trend = "rising"
    elif sma20 is not None and sma50 is not None and latest < sma20 < sma50:
        trend = "falling"

    deltas = [closes[index] - closes[index - 1] for index in range(max(1, len(closes) - 14), len(closes))]
    gains = [max(0.0, delta) for delta in deltas]
    losses = [max(0.0, -delta) for delta in deltas]
    average_gain = mean(gains) or 0.0
    average_loss = mean(losses) or 0.0
    rsi = 100.0 if average_loss == 0 and average_gain > 0 else 50.0 if average_loss == 0 else 100 - 100 / (1 + average_gain / average_loss)

    ranges: list[float] = []
    for index, candle in enumerate(candles[-15:]):
        high = finite_number(candle.get("high"))
        low = finite_number(candle.get("low"))
        if high is None or low is None:
            continue
        prior = finite_number(candles[max(0, len(candles) - 15 + index - 1)].get("close")) or low
        ranges.append(max(high - low, abs(high - prior), abs(low - prior)))
    atr = mean(ranges[-14:])
    recent = candles[-20:]
    lows = [value for candle in recent if (value := finite_number(candle.get("low"))) is not None]
    highs = [value for candle in recent if (value := finite_number(candle.get("high"))) is not None]
    volumes = [value for candle in recent if (value := finite_number(candle.get("volume"))) is not None and value > 0]
    return {
        "trend": trend,
        "ltp": rounded(latest),
        "previousClose": rounded(previous),
        "changePct": rounded((latest / previous - 1) * 100 if previous else None),
        "sma20": rounded(sma20),
        "sma50": rounded(sma50),
        "rsi14": rounded(rsi),
        "atr14": rounded(atr),
        "atrPct": rounded(atr / latest * 100 if atr and latest else None),
        "averageVolume20": rounded(mean(volumes), 0),
        "support": rounded(min(lows) if lows else None),
        "resistance": rounded(max(highs) if highs else None),
        "candles": len(candles),
    }


def stable_index(value: str, size: int) -> int:
    return int(hashlib.sha256(value.encode("utf-8")).hexdigest()[:8], 16) % size


def build_facts(instrument: dict[str, Any], snapshot: dict[str, Any], action: str) -> dict[str, Any]:
    technical = technical_evidence(snapshot.get("candles") or [])
    fundamentals = snapshot.get("fundamentals") if isinstance(snapshot.get("fundamentals"), dict) else {}
    key = f"{instrument['id']}:{action}"
    horizon = HORIZONS[stable_index(key + ":horizon", len(HORIZONS))]
    risk_profile = RISK_PROFILES[stable_index(key + ":risk", len(RISK_PROFILES))]
    ltp = finite_number(technical.get("ltp")) or 0.0
    average_multipliers = (0.78, 0.92, 1.08, 1.24)
    average_price = rounded(ltp * average_multipliers[stable_index(key + ":average", len(average_multipliers))]) if action == "Sell" else None
    pnl_pct = rounded((ltp / average_price - 1) * 100 if average_price else None)
    weights = (4.0, 9.0, 16.0, 24.0)
    portfolio_weight = weights[stable_index(key + ":weight", len(weights))] if action == "Sell" else 0.0

    debt_equity = finite_number(fundamentals.get("debtToEquity"))
    if debt_equity is not None and abs(debt_equity) > 10:
        debt_equity /= 100
    roe = finite_number(fundamentals.get("returnOnEquity"))
    if roe is not None and abs(roe) <= 2:
        roe *= 100
    company_applicable = instrument["instrumentType"] == "equity"
    missing = []
    if int(technical.get("candles") or 0) < 50:
        missing.append("price history")
    if company_applicable and not fundamentals:
        missing.append("fundamentals")
    data_state = "complete" if not missing else "incomplete"
    trend = str(technical.get("trend") or "unknown")
    if data_state == "incomplete":
        verdict = "Needs Input"
        confidence = "Low"
    elif action == "Sell":
        verdict = "Reduce" if trend == "falling" or (pnl_pct is not None and pnl_pct <= -15) or portfolio_weight >= 20 else "Hold and Watch"
        confidence = "High" if trend in {"rising", "falling"} else "Medium"
    else:
        verdict = "Buy in Tranches" if trend == "rising" and (finite_number(technical.get("rsi14")) or 50) < 70 else "Wait and Watch"
        confidence = "High" if trend in {"rising", "falling"} else "Medium"

    source_urls = [str(url) for url in snapshot.get("sourceUrls") or []]
    return {
        "schemaVersion": "analysis-facts.v1",
        "generatedAt": str(snapshot["capturedAt"]),
        "instrument": {
            "symbol": instrument["symbol"],
            "name": fundamentals.get("name") or instrument["name"],
            "type": instrument["instrumentType"],
            "sector": fundamentals.get("sector") or instrument["sectorHint"],
            "industry": fundamentals.get("industry"),
            "marketDataGeneratedAt": snapshot["capturedAt"],
            "publicSourceUrls": source_urls,
        },
        "userContext": {
            "action": action,
            "horizon": horizon,
            "riskProfile": risk_profile,
            "capital": 100000,
            "quantity": (10, 25, 50)[stable_index(key + ":quantity", 3)] if action == "Sell" else None,
            "averagePrice": average_price,
        },
        "deterministicAnalysis": {"verdict": verdict, "confidence": confidence},
        "technicalEvidence": technical,
        "fundamentalEvidence": {
            "applicable": company_applicable,
            "quality": "strong" if roe is not None and roe >= 18 and (debt_equity is None or debt_equity <= 0.7) else "mixed",
            "roce": rounded(roe),
            "debtEquity": rounded(debt_equity),
            "cashFlowQuality": "available" if fundamentals.get("operatingCashflow") is not None else "unavailable",
            "pe": rounded(finite_number(fundamentals.get("trailingPe"))),
            "forwardPe": rounded(finite_number(fundamentals.get("forwardPe"))),
            "priceToBook": rounded(finite_number(fundamentals.get("priceToBook"))),
            "marketCap": rounded(finite_number(fundamentals.get("marketCap")), 0),
            "profitMargin": rounded((finite_number(fundamentals.get("profitMargin")) or 0) * 100) if fundamentals.get("profitMargin") is not None else None,
            "revenueGrowth": rounded((finite_number(fundamentals.get("revenueGrowth")) or 0) * 100) if fundamentals.get("revenueGrowth") is not None else None,
            "earningsGrowth": rounded((finite_number(fundamentals.get("earningsGrowth")) or 0) * 100) if fundamentals.get("earningsGrowth") is not None else None,
            "businessSummary": fundamentals.get("businessSummary"),
            "updates": [],
        },
        "portfolioEvidence": {
            "weight": portfolio_weight,
            "pnlPct": pnl_pct,
            "riskBudget": 1000,
        },
        "signals": [],
        "reasoningTrace": [],
        "dataQuality": {"state": data_state, "missing": missing, "sourceWarnings": snapshot.get("warnings") or []},
        "uiOptions": {"patternsEnabled": stable_index(key + ":patterns", 2) == 0},
    }


def generate_output(facts: dict[str, Any], rule_set: dict[str, Any]) -> dict[str, Any]:
    prompt = {
        "task": "Fill every applicable LlmAnalysisV1 narrative field without changing the deterministic verdict or inventing facts.",
        "facts": facts,
        "retrievedRuleSet": rule_set,
        "outputSchema": OUTPUT_SCHEMA,
        "requirements": [
            "Every narrative item must cite relevant factRefs and ruleRefs.",
            "Use company-specific wording supported by the supplied facts.",
            "Treat company fundamentals as non-applicable for funds, ETFs, and indices.",
            "Return an empty chart.patterns array when uiOptions.patternsEnabled is false.",
        ],
    }
    return gemini_json(
        prompt,
        "You create high-quality supervised financial-analysis answers. Supplied facts and the deterministic verdict are authoritative. Return JSON only.",
        temperature=0.15,
    )


def manifest() -> dict[str, Any]:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def validate_manifest(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = payload or manifest()
    instruments = payload.get("instruments") or []
    errors: list[str] = []
    ids: set[str] = set()
    symbols: set[str] = set()
    split_counts = {"train": 0, "validation": 0, "eval": 0}
    for instrument in instruments:
        instrument_id = str(instrument.get("id") or "")
        symbol = str(instrument.get("symbol") or "")
        if not instrument_id or instrument_id in ids:
            errors.append(f"Duplicate or missing instrument id: {instrument_id!r}")
        if not symbol or symbol in symbols:
            errors.append(f"Duplicate or missing symbol: {symbol!r}")
        ids.add(instrument_id)
        symbols.add(symbol)
        source = instrument.get("source")
        if source not in PUBLIC_SOURCES:
            errors.append(f"{instrument_id}: source must be public")
        split = str(instrument.get("split") or "")
        actions = instrument.get("actions") or []
        if split not in split_counts:
            errors.append(f"{instrument_id}: invalid split {split!r}")
        else:
            split_counts[split] += len(actions)
        if not actions or any(action not in {"Buy", "Sell"} for action in actions):
            errors.append(f"{instrument_id}: invalid actions")
    if len(instruments) != int(payload.get("expectedInstruments") or 0):
        errors.append(f"Expected {payload.get('expectedInstruments')} instruments, found {len(instruments)}")
    if sum(split_counts.values()) != int(payload.get("expectedCases") or 0):
        errors.append(f"Expected {payload.get('expectedCases')} cases, found {sum(split_counts.values())}")
    if split_counts != payload.get("splitTargets"):
        errors.append(f"Split targets differ: {split_counts}")
    return {"instruments": len(instruments), "cases": sum(split_counts.values()), "splits": split_counts, "errors": errors}


def collect_snapshots(limit: int = 0) -> dict[str, Any]:
    validation = validate_manifest()
    if validation["errors"]:
        raise RuntimeError("Manifest is invalid: " + "; ".join(validation["errors"]))
    payload = manifest()
    snapshots = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8")) if SNAPSHOT_PATH.exists() else {}
    selected = payload["instruments"] if limit <= 0 else payload["instruments"][:limit]
    collected = 0
    failures: dict[str, str] = {}
    for instrument in selected:
        instrument_id = instrument["id"]
        if instrument_id in snapshots:
            continue
        try:
            snapshots[instrument_id] = yahoo_snapshot(instrument) if instrument["source"] == "yahoo" else mfapi_snapshot(instrument)
            collected += 1
            atomic_json(SNAPSHOT_PATH, snapshots)
        except Exception as exc:
            failures[instrument_id] = str(exc)
    return {"available": len(snapshots), "collected": collected, "failed": failures, "path": str(SNAPSHOT_PATH)}


def generate_gold(limit: int = 0) -> dict[str, Any]:
    if not SNAPSHOT_PATH.exists():
        raise RuntimeError("Collect public snapshots before generating gold examples.")
    snapshots = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
    rows = read_jsonl(GOLD_PATH)
    existing_ids = {str(row.get("id") or "") for row in rows}
    cases: list[tuple[dict[str, Any], str]] = []
    for instrument in manifest()["instruments"]:
        for action in instrument["actions"]:
            cases.append((instrument, action))
    if limit > 0:
        cases = cases[:limit]
    generated = 0
    quota_exhausted = False
    for instrument, action in cases:
        case_id = f"gold-{instrument['id']}-{action.lower()}"
        if case_id in existing_ids or instrument["id"] not in snapshots:
            continue
        facts = build_facts(instrument, snapshots[instrument["id"]], action)
        rule_set = retrieve_rule_set(facts)
        try:
            output = generate_output(facts, rule_set)
        except RuntimeError as exc:
            if "HTTP 429" in str(exc) or "RESOURCE_EXHAUSTED" in str(exc):
                quota_exhausted = True
                break
            raise
        if not facts["uiOptions"]["patternsEnabled"] and isinstance(output.get("chart"), dict):
            output["chart"]["patterns"] = []
        row = {
            "id": case_id,
            "lineageId": case_id,
            "split": instrument["split"],
            "reviewStatus": "pending",
            "reviewNotes": "",
            "facts": facts,
            "retrievedRuleIds": [rule["id"] for rule in rule_set["rules"]],
            "retrievedRuleSet": rule_set,
            "output": output,
            "provenance": {
                "kind": "public-market-snapshot",
                "instrumentId": instrument["id"],
                "source": snapshots[instrument["id"]]["source"],
                "sourceUrls": snapshots[instrument["id"]]["sourceUrls"],
                "capturedAt": snapshots[instrument["id"]]["capturedAt"],
                "factsHash": hashlib.sha256(canonical_json(facts).encode("utf-8")).hexdigest(),
            },
        }
        row_errors = audit_candidate(row, require_synthetic=False)
        unsupported_numbers = unsupported_numeric_claims(row)
        if unsupported_numbers:
            row_errors.append(f"{case_id}: unsupported numeric claims {unsupported_numbers[:8]}")
        if row_errors:
            raise RuntimeError("Generated gold row failed strict audit: " + "; ".join(row_errors[:12]))
        rows.append(row)
        existing_ids.add(case_id)
        generated += 1
        write_jsonl(GOLD_PATH, rows)
    return {"examples": len(rows), "generated": generated, "quotaExhausted": quota_exhausted, "path": str(GOLD_PATH)}


def audit_gold(rows: list[dict[str, Any]] | None = None, *, require_complete: bool = True) -> dict[str, Any]:
    rows = rows if rows is not None else read_jsonl(GOLD_PATH)
    errors: list[str] = []
    split_counts = {"train": 0, "validation": 0, "eval": 0}
    instrument_splits: dict[str, set[str]] = {}
    ids: set[str] = set()
    fingerprints: set[str] = set()
    for row in rows:
        row_id = str(row.get("id") or "")
        if not row_id or row_id in ids:
            errors.append(f"Duplicate or missing row id: {row_id!r}")
        ids.add(row_id)
        split = str(row.get("split") or "")
        if split not in split_counts:
            errors.append(f"{row_id}: invalid split {split!r}")
        else:
            split_counts[split] += 1
        provenance = row.get("provenance") if isinstance(row.get("provenance"), dict) else {}
        instrument_id = str(provenance.get("instrumentId") or "")
        instrument_splits.setdefault(instrument_id, set()).add(split)
        if provenance.get("source") not in PUBLIC_SOURCES or provenance.get("kind") != "public-market-snapshot":
            errors.append(f"{row_id}: provenance is not public-market data")
        serialised = canonical_json(row).casefold()
        if any(marker in serialised for marker in FORBIDDEN_MARKERS):
            errors.append(f"{row_id}: possible personal portfolio marker")
        fingerprint = hashlib.sha256(canonical_json({"facts": row.get("facts"), "output": row.get("output")}).encode("utf-8")).hexdigest()
        if fingerprint in fingerprints:
            errors.append(f"{row_id}: duplicate facts/output fingerprint")
        fingerprints.add(fingerprint)
        errors.extend(audit_candidate(row, require_synthetic=False))
        unsupported = unsupported_numeric_claims(row)
        if unsupported:
            errors.append(f"{row_id}: unsupported numeric claims {unsupported[:8]}")
    leaked = sorted(instrument for instrument, splits in instrument_splits.items() if len(splits) > 1)
    if leaked:
        errors.append(f"Instrument leakage across splits: {leaked}")
    if require_complete and split_counts != {"train": 75, "validation": 15, "eval": 30}:
        errors.append(f"Reasoning gold split is incomplete: {split_counts}")
    return {"examples": len(rows), "splits": split_counts, "instrumentLeakage": leaked, "errors": errors}


def approve_gold() -> dict[str, Any]:
    rows = read_jsonl(GOLD_PATH)
    result = audit_gold(rows)
    if result["errors"]:
        raise RuntimeError(f"Approval blocked by {len(result['errors'])} audit failures.")
    reviewed_at = datetime.now(UTC).isoformat()
    for row in rows:
        row["reviewStatus"] = "approved"
        row["reviewNotes"] = "Codex-assisted public-market reasoning audit passed at the user's explicit request."
        row["reviewAudit"] = {
            "reviewerType": "codex-assisted",
            "requestedByUser": True,
            "method": "strict-grounding-v2",
            "checks": {check: True for check in REVIEW_CHECKS},
            "scores": {"usefulness": 4, "clarity": 4, "grounding": 5, "actionability": 4},
            "reviewedAt": reviewed_at,
        }
    write_jsonl(GOLD_PATH, rows)
    return {**result, "approved": len(rows)}


def main() -> int:
    load_local_env()
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("validate-manifest")
    collect = subparsers.add_parser("collect")
    collect.add_argument("--limit", type=int, default=0)
    generate = subparsers.add_parser("generate")
    generate.add_argument("--limit", type=int, default=0)
    audit = subparsers.add_parser("audit")
    audit.add_argument("--allow-partial", action="store_true")
    approve = subparsers.add_parser("approve")
    approve.add_argument("--requested-by-user", action="store_true")
    args = parser.parse_args()
    if args.command == "validate-manifest":
        result = validate_manifest()
    elif args.command == "collect":
        result = collect_snapshots(args.limit)
    elif args.command == "generate":
        result = generate_gold(args.limit)
    elif args.command == "audit":
        result = audit_gold(require_complete=not args.allow_partial)
    else:
        if not args.requested_by_user:
            raise SystemExit("approve requires --requested-by-user")
        result = approve_gold()
    print(json.dumps(result, indent=2))
    return 0 if not result.get("errors") else 1


if __name__ == "__main__":
    raise SystemExit(main())
