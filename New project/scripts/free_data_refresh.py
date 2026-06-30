#!/usr/bin/env python3
"""Free end-of-day data refresh for the NSE/BSE verdict workstation.

This uses Yahoo Finance's public chart endpoint for daily candles and
quoteSummary endpoint for company/fundamental data. It is unofficial,
best-effort, and intended for personal non-intraday analysis.
"""

from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
REFERENCE_DIR = ROOT / "data" / "reference"
CACHE_DIR = ROOT / "data" / "cache" / "free"
APP_SNAPSHOT = ROOT / "react-day1" / "public" / "stock-data" / "latest.json"
SYMBOL_MAP_PATH = REFERENCE_DIR / "free_data_symbols.json"
WATCHLIST_PATH = REFERENCE_DIR / "watchlist.json"
HOLDINGS_PATH = REFERENCE_DIR / "portfolio_holdings.json"


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).astimezone().isoformat(timespec="seconds")


def read_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def load_symbol_map() -> dict[str, dict[str, str]]:
    payload = read_json(SYMBOL_MAP_PATH, {"symbols": []})
    output: dict[str, dict[str, str]] = {}
    for row in payload.get("symbols", []):
        if not isinstance(row, dict):
            continue
        key = row.get("input", "").upper()
        if key:
            output[key] = row
        for alias in row.get("aliases", []):
            alias_key = str(alias).strip().upper()
            if alias_key:
                output[alias_key] = row
        symbol_key = f"{row.get('exchange', '').upper()}:{row.get('tradingsymbol', '').upper()}"
        if ":" in symbol_key and not symbol_key.endswith(":"):
            output[symbol_key] = row
    return output


def default_symbols() -> list[str]:
    watchlist = read_json(WATCHLIST_PATH, {"symbols": []})
    symbols = watchlist.get("symbols") or []
    if symbols:
        return symbols
    return ["NSE:ENGINERSIN", "BSE:SAMRATPH", "BSE:REGANTO"]


def split_symbol(symbol: str) -> tuple[str, str]:
    clean = symbol.strip().upper()
    if ":" in clean:
        exchange, tradingsymbol = clean.split(":", 1)
        return exchange or "AUTO", tradingsymbol
    return "AUTO", clean


def yahoo_guess(exchange: str, tradingsymbol: str) -> str:
    if exchange == "BSE" and tradingsymbol.isdigit():
        return f"{tradingsymbol}.BO"
    if exchange == "BSE":
        return f"{tradingsymbol}.BO"
    return f"{tradingsymbol}.NS"


def unique_candidates(candidates: list[str]) -> list[str]:
    output = []
    for candidate in candidates:
        clean = candidate.strip()
        if clean and clean not in output:
            output.append(clean)
    return output


def yahoo_candidates(item: dict[str, str]) -> list[str]:
    exchange = item.get("exchange", "NSE").upper()
    tradingsymbol = item.get("tradingsymbol", "").upper()
    configured = item.get("yahoo", "")
    if exchange == "AUTO":
        candidates = [configured, yahoo_guess("NSE", tradingsymbol), yahoo_guess("BSE", tradingsymbol)]
    else:
        candidates = [configured, yahoo_guess(exchange, tradingsymbol)]
    if "-" in tradingsymbol:
        if exchange == "AUTO":
            for inferred_exchange in ["NSE", "BSE"]:
                candidates.append(yahoo_guess(inferred_exchange, tradingsymbol.split("-", 1)[0]))
                candidates.append(yahoo_guess(inferred_exchange, tradingsymbol.replace("-", "")))
        else:
            candidates.append(yahoo_guess(exchange, tradingsymbol.split("-", 1)[0]))
            candidates.append(yahoo_guess(exchange, tradingsymbol.replace("-", "")))
    return unique_candidates(candidates)


def exchange_from_yahoo(yahoo_symbol: str) -> str:
    yahoo_symbol = yahoo_symbol.upper()
    if yahoo_symbol.endswith(".BO"):
        return "BSE"
    if yahoo_symbol.endswith(".NS"):
        return "NSE"
    return ""


def unsupported_reason(item: dict[str, str]) -> str:
    exchange = item.get("exchange", "").upper()
    tradingsymbol = item.get("tradingsymbol", "").upper()
    if exchange not in {"NSE", "BSE", "AUTO"}:
        return "unsupported exchange; only NSE/BSE listed symbols can be auto-fetched"
    if re.fullmatch(r"IN[A-Z0-9]{10}", tradingsymbol):
        return "looks like an ISIN/unlisted holding row, not a directly fetchable NSE/BSE ticker"
    return ""


def resolve_symbol(symbol: str, mapping: dict[str, dict[str, str]]) -> dict[str, str]:
    exchange, tradingsymbol = split_symbol(symbol)
    key = f"{exchange}:{tradingsymbol}"
    configured = mapping.get(key, {})
    return {
        "input": symbol,
        "exchange": configured.get("exchange", exchange),
        "tradingsymbol": configured.get("tradingsymbol", tradingsymbol),
        "name": configured.get("name", ""),
        "segment": "EOD",
        "instrument_type": "EQ",
        "instrument_token": configured.get("yahoo", yahoo_guess(exchange, tradingsymbol)),
        "kite_key": f"{configured.get('exchange', exchange)}:{configured.get('tradingsymbol', tradingsymbol)}",
        "mapped": bool(configured),
        "yahoo": configured.get("yahoo", yahoo_guess(exchange, tradingsymbol)),
        "screener": configured.get("screener", ""),
    }


def upsert_symbol_mapping(payload: dict[str, Any]) -> dict[str, str]:
    raw_input = str(payload.get("input") or "").strip().upper()
    if not raw_input:
        raise ValueError("Mapping needs an input symbol such as NSE:TCS.")
    input_exchange, input_symbol = split_symbol(raw_input)
    yahoo = str(payload.get("yahoo") or "").strip().upper()
    inferred_exchange = exchange_from_yahoo(yahoo)
    exchange = str(payload.get("exchange") or inferred_exchange or input_exchange).strip().upper()
    tradingsymbol = str(payload.get("tradingsymbol") or input_symbol).strip().upper()
    if exchange not in {"NSE", "BSE"}:
        raise ValueError("Only NSE and BSE mappings are supported. Enter a Yahoo code ending in .NS or .BO.")
    if not tradingsymbol:
        raise ValueError("Mapping needs a tradingsymbol.")

    normalized = {
        "exchange": exchange,
        "input": f"{input_exchange}:{input_symbol}",
        "name": str(payload.get("name") or "").strip(),
        "screener": str(payload.get("screener") or tradingsymbol).strip().upper(),
        "tradingsymbol": tradingsymbol,
        "yahoo": yahoo or yahoo_guess(exchange, tradingsymbol),
    }
    symbol_key = f"{exchange}:{tradingsymbol}"
    existing = read_json(SYMBOL_MAP_PATH, {"symbols": []})
    rows = existing.get("symbols") if isinstance(existing, dict) else []
    if not isinstance(rows, list):
        rows = []
    next_rows = []
    replaced = False
    for row in rows:
        if not isinstance(row, dict):
            continue
        row_input = str(row.get("input") or "").upper()
        row_key = f"{str(row.get('exchange') or '').upper()}:{str(row.get('tradingsymbol') or '').upper()}"
        if row_input == normalized["input"] or row_key == symbol_key:
            next_rows.append(normalized)
            replaced = True
        else:
            next_rows.append(row)
    if not replaced:
        next_rows.append(normalized)
    write_json(SYMBOL_MAP_PATH, {"symbols": sorted(next_rows, key=lambda row: str(row.get("input") or ""))})
    return normalized


def yahoo_chart_url(yahoo_symbol: str, days: int) -> str:
    end = int(time.time())
    start = int((dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)).timestamp())
    params = urllib.parse.urlencode(
        {
            "period1": start,
            "period2": end,
            "interval": "1d",
            "events": "history",
            "includeAdjustedClose": "true",
        }
    )
    encoded_symbol = urllib.parse.quote(yahoo_symbol, safe="")
    return f"https://query1.finance.yahoo.com/v8/finance/chart/{encoded_symbol}?{params}"


def yahoo_quote_summary_url(yahoo_symbol: str) -> str:
    modules = ",".join(
        [
            "assetProfile",
            "price",
            "summaryDetail",
            "defaultKeyStatistics",
            "financialData",
        ]
    )
    params = urllib.parse.urlencode({"modules": modules})
    encoded_symbol = urllib.parse.quote(yahoo_symbol, safe="")
    return f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{encoded_symbol}?{params}"


def screener_company_url(screener_symbol: str) -> str:
    clean = screener_symbol.strip()
    if clean.startswith("http://") or clean.startswith("https://"):
        return clean
    if clean.startswith("/company/"):
        return f"https://www.screener.in{clean}"
    encoded_symbol = urllib.parse.quote(clean.strip("/").upper(), safe="/")
    return f"https://www.screener.in/company/{encoded_symbol}/"


def screener_search_url(query: str) -> str:
    return f"https://www.screener.in/api/company/search/?{urllib.parse.urlencode({'q': query})}"


def fetch_json(url: str) -> Any:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 local-verdict-workstation/1.0",
            "Accept": "application/json,text/plain,*/*",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_text(url: str) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 local-verdict-workstation/1.0",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", errors="replace")


def fetch_yahoo_candles(yahoo_symbol: str, days: int) -> list[dict[str, Any]]:
    payload = fetch_json(yahoo_chart_url(yahoo_symbol, days))
    chart = payload.get("chart", {})
    error = chart.get("error")
    if error:
        raise RuntimeError(error.get("description") or str(error))
    result = (chart.get("result") or [None])[0]
    if not result:
        raise RuntimeError("No chart result returned")

    timestamps = result.get("timestamp") or []
    quote = ((result.get("indicators") or {}).get("quote") or [{}])[0]
    opens = quote.get("open") or []
    highs = quote.get("high") or []
    lows = quote.get("low") or []
    closes = quote.get("close") or []
    volumes = quote.get("volume") or []
    candles: list[dict[str, Any]] = []

    for index, timestamp in enumerate(timestamps):
        close = closes[index] if index < len(closes) else None
        if close is None:
            continue
        candles.append(
            {
                "date": dt.datetime.fromtimestamp(timestamp, dt.timezone.utc).date().isoformat(),
                "open": opens[index] if index < len(opens) else None,
                "high": highs[index] if index < len(highs) else None,
                "low": lows[index] if index < len(lows) else None,
                "close": close,
                "volume": volumes[index] if index < len(volumes) else None,
            }
        )
    return candles


def raw_value(payload: dict[str, Any], key: str) -> Any:
    value = payload.get(key)
    if isinstance(value, dict):
        return value.get("raw", value.get("fmt"))
    return value


def fetch_yahoo_fundamentals(yahoo_symbol: str) -> dict[str, Any]:
    payload = fetch_json(yahoo_quote_summary_url(yahoo_symbol))
    quote_summary = payload.get("quoteSummary", {})
    error = quote_summary.get("error")
    if error:
        raise RuntimeError(error.get("description") or str(error))
    result = (quote_summary.get("result") or [None])[0]
    if not result:
        raise RuntimeError("No quoteSummary result returned")

    asset_profile = result.get("assetProfile") or {}
    price = result.get("price") or {}
    summary_detail = result.get("summaryDetail") or {}
    key_stats = result.get("defaultKeyStatistics") or {}
    financial_data = result.get("financialData") or {}

    return {
        "name": raw_value(price, "longName") or raw_value(price, "shortName"),
        "currency": raw_value(price, "currency"),
        "exchange_name": raw_value(price, "exchangeName"),
        "sector": asset_profile.get("sector"),
        "industry": asset_profile.get("industry"),
        "website": asset_profile.get("website"),
        "country": asset_profile.get("country"),
        "employees": asset_profile.get("fullTimeEmployees"),
        "business_summary": asset_profile.get("longBusinessSummary"),
        "market_cap": raw_value(price, "marketCap") or raw_value(summary_detail, "marketCap"),
        "enterprise_value": raw_value(key_stats, "enterpriseValue"),
        "trailing_pe": raw_value(summary_detail, "trailingPE") or raw_value(key_stats, "trailingPE"),
        "forward_pe": raw_value(summary_detail, "forwardPE") or raw_value(key_stats, "forwardPE"),
        "price_to_book": raw_value(key_stats, "priceToBook"),
        "book_value": raw_value(key_stats, "bookValue"),
        "profit_margins": raw_value(financial_data, "profitMargins"),
        "gross_margins": raw_value(financial_data, "grossMargins"),
        "ebitda_margins": raw_value(financial_data, "ebitdaMargins"),
        "operating_margins": raw_value(financial_data, "operatingMargins"),
        "return_on_equity": raw_value(financial_data, "returnOnEquity"),
        "return_on_assets": raw_value(financial_data, "returnOnAssets"),
        "debt_to_equity": raw_value(financial_data, "debtToEquity"),
        "current_ratio": raw_value(financial_data, "currentRatio"),
        "total_debt": raw_value(financial_data, "totalDebt"),
        "total_cash": raw_value(financial_data, "totalCash"),
        "operating_cashflow": raw_value(financial_data, "operatingCashflow"),
        "free_cashflow": raw_value(financial_data, "freeCashflow"),
        "revenue_growth": raw_value(financial_data, "revenueGrowth"),
        "earnings_growth": raw_value(financial_data, "earningsGrowth"),
        "source": "yahoo_quote_summary",
    }


def clean_html_text(fragment: str) -> str:
    text = re.sub(r"<(script|style|svg)[^>]*>.*?</\1>", " ", fragment, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<sup[^>]*>.*?</sup>", " ", text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<br\s*/?>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    text = text.replace("\xa0", " ").replace("&nbsp;", " ").replace("₹", "")
    text = re.sub(r"\s+", " ", text).strip()
    return text.replace(" +", "").replace("+", "").strip()


def first_match(pattern: str, text: str, default: str = "") -> str:
    match = re.search(pattern, text, flags=re.IGNORECASE | re.DOTALL)
    return match.group(1) if match else default


def number_from_text(value: str | None) -> float | None:
    if not value:
        return None
    match = re.search(r"-?\d[\d,]*(?:\.\d+)?", value)
    if not match:
        return None
    parsed = float(match.group(0).replace(",", ""))
    return parsed if parsed == parsed else None


def section_html(page: str, section_id: str) -> str:
    return first_match(rf'<section[^>]+id="{re.escape(section_id)}"[^>]*>(.*?)</section>', page)


def list_items(block: str) -> list[str]:
    return [clean_html_text(item) for item in re.findall(r"<li[^>]*>(.*?)</li>", block, flags=re.IGNORECASE | re.DOTALL) if clean_html_text(item)]


def extract_top_ratios(page: str) -> dict[str, str]:
    block = first_match(r'<ul[^>]+id="top-ratios"[^>]*>(.*?)</ul>', page)
    ratios: dict[str, str] = {}
    for item in re.findall(r"<li[^>]*>(.*?)</li>", block, flags=re.IGNORECASE | re.DOTALL):
        name = clean_html_text(first_match(r'<span[^>]+class="[^"]*\bname\b[^"]*"[^>]*>(.*?)</span>', item))
        value = clean_html_text(first_match(r'<span[^>]+class="[^"]*\bvalue\b[^"]*"[^>]*>(.*?)</span>', item))
        if name and value:
            ratios[name] = value
    return ratios


def extract_table(page: str, section_id: str) -> dict[str, Any]:
    block = section_html(page, section_id)
    table = first_match(r'<table[^>]+class="[^"]*\bdata-table\b[^"]*"[^>]*>(.*?)</table>', block)
    if not table:
        return {"periods": [], "rows": []}
    header_block = first_match(r"<thead[^>]*>(.*?)</thead>", table)
    headers = [clean_html_text(header) for header in re.findall(r"<th[^>]*>(.*?)</th>", header_block, flags=re.IGNORECASE | re.DOTALL)]
    periods = [header for header in headers[1:] if header]
    body = first_match(r"<tbody[^>]*>(.*?)</tbody>", table)
    rows = []
    for row_html in re.findall(r"<tr[^>]*>(.*?)</tr>", body, flags=re.IGNORECASE | re.DOTALL):
        cells = re.findall(r"<td[^>]*>(.*?)</td>", row_html, flags=re.IGNORECASE | re.DOTALL)
        if len(cells) < 2:
            continue
        metric = clean_html_text(cells[0])
        if not metric:
            continue
        values = []
        for period, cell in zip(periods, cells[1:]):
            raw = clean_html_text(cell)
            values.append({"period": period, "value": raw, "numeric": number_from_text(raw)})
        rows.append({"metric": metric, "values": values})
    return {"periods": periods, "rows": rows}


def row_by_metric(table: dict[str, Any], names: list[str]) -> dict[str, Any] | None:
    wanted = {name.lower() for name in names}
    for row in table.get("rows", []):
        metric = str(row.get("metric", "")).lower()
        if metric in wanted:
            return row
    for row in table.get("rows", []):
        metric = str(row.get("metric", "")).lower()
        if any(name in metric for name in wanted):
            return row
    return None


def latest_value(table: dict[str, Any], names: list[str]) -> dict[str, Any] | None:
    row = row_by_metric(table, names)
    if not row:
        return None
    for value in reversed(row.get("values", [])):
        if value.get("numeric") is not None:
            return {"metric": row.get("metric"), **value}
    return None


def previous_value(table: dict[str, Any], names: list[str]) -> dict[str, Any] | None:
    row = row_by_metric(table, names)
    if not row:
        return None
    seen_latest = False
    for value in reversed(row.get("values", [])):
        if value.get("numeric") is None:
            continue
        if seen_latest:
            return {"metric": row.get("metric"), **value}
        seen_latest = True
    return None


def annual_growth(table: dict[str, Any], names: list[str]) -> float | None:
    latest = latest_value(table, names)
    previous = previous_value(table, names)
    latest_number = latest.get("numeric") if latest else None
    previous_number = previous.get("numeric") if previous else None
    if latest_number is None or previous_number in (None, 0):
        return None
    return (latest_number - previous_number) / abs(previous_number)


def classify_update(title: str, summary: str) -> dict[str, Any]:
    text = f"{title} {summary}".lower()
    if any(term in text for term in ["result", "earning", "financial result", "transcript", "investor presentation"]):
        return {"category": "Earnings update", "tone": "neutral", "importance": 95}
    if any(term in text for term in ["agreement", "order", "contract", "project", "mou", "memorandum"]):
        return {"category": "Business/order update", "tone": "positive", "importance": 90}
    if any(term in text for term in ["director", "resignation", "appointment", "leadership", "management", "cmd", "cfo", "ceo"]):
        return {"category": "Leadership/governance", "tone": "neutral", "importance": 85}
    if any(term in text for term in ["dividend", "buyback", "bonus", "split", "corporate action"]):
        return {"category": "Corporate action", "tone": "positive", "importance": 82}
    if any(term in text for term in ["press release", "media release"]):
        return {"category": "Business update", "tone": "neutral", "importance": 78}
    if any(term in text for term in ["pledge", "default", "fraud", "penalty", "litigation", "show cause"]):
        return {"category": "Risk/compliance", "tone": "negative", "importance": 88}
    if "trading window" in text:
        return {"category": "Compliance", "tone": "neutral", "importance": 45}
    if "newspaper" in text:
        return {"category": "Disclosure", "tone": "neutral", "importance": 35}
    return {"category": "Exchange filing", "tone": "neutral", "importance": 55}


def parse_announcement_list(block: str) -> list[dict[str, Any]]:
    updates = []
    for index, item in enumerate(re.findall(r"<li[^>]*>(.*?)</li>", block, flags=re.IGNORECASE | re.DOTALL)):
        anchor_match = re.search(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', item, flags=re.IGNORECASE | re.DOTALL)
        if not anchor_match:
            continue
        url = html.unescape(anchor_match.group(1))
        anchor_html = anchor_match.group(2)
        summary_match = re.search(r'<(?:div|span)[^>]+class="[^"]*\bsmaller\b[^"]*"[^>]*>(.*?)</(?:div|span)>', anchor_html, flags=re.IGNORECASE | re.DOTALL)
        summary = clean_html_text(summary_match.group(1)) if summary_match else ""
        title_html = re.sub(r'<(?:div|span)[^>]+class="[^"]*\bsmaller\b[^"]*"[^>]*>.*?</(?:div|span)>', " ", anchor_html, flags=re.IGNORECASE | re.DOTALL)
        title = clean_html_text(title_html)
        if not title:
            continue
        date = ""
        detail = summary
        date_match = re.match(r"([^-\u2013\u2014]{1,18})\s*[-\u2013\u2014]\s*(.*)", summary)
        if date_match:
            date = date_match.group(1).strip()
            detail = date_match.group(2).strip()
        classification = classify_update(title, detail)
        updates.append(
            {
                "title": title,
                "summary": detail or summary or title,
                "date": date,
                "url": url,
                "rank": index,
                **classification,
            }
        )
    updates.sort(key=lambda update: (-int(update.get("importance", 0)), int(update.get("rank", 0))))
    return [{key: value for key, value in update.items() if key not in {"rank", "importance"}} for update in updates[:3]]


def extract_company_updates(page: str, company_id: str) -> list[dict[str, Any]]:
    announcements = first_match(r'<div[^>]+id="company-announcements-tab"[^>]*>(.*?</ul>)', page)
    updates = parse_announcement_list(announcements)
    if updates or not company_id:
        return updates
    try:
        recent = fetch_text(f"https://www.screener.in/announcements/recent/{company_id}/")
        return parse_announcement_list(recent)
    except (RuntimeError, urllib.error.URLError, urllib.error.HTTPError, TimeoutError):
        return []


def crores_to_rupees(value: float | None) -> float | None:
    return None if value is None else value * 10_000_000


def screener_candidates(item: dict[str, str]) -> list[str]:
    candidates = []
    configured = item.get("screener", "")
    yahoo = item.get("yahoo", "")
    tradingsymbol = item.get("tradingsymbol", "")
    if configured:
        candidates.append(configured)
    if yahoo.endswith(".BO") and yahoo[:-3].isdigit():
        candidates.append(yahoo[:-3])
    candidates.append(tradingsymbol)
    if "-" in tradingsymbol:
        candidates.append(tradingsymbol.split("-", 1)[0])
        candidates.append(tradingsymbol.replace("-", ""))
    output = []
    for candidate in candidates:
        clean = candidate.strip().upper()
        if clean and clean not in output:
            output.append(clean)
    return output


def compact_token(value: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", value.upper())


def symbol_roots(symbol: str) -> list[str]:
    symbol = symbol.strip().upper()
    roots = [symbol]
    if "-" in symbol:
        roots.append(symbol.split("-", 1)[0])
        roots.append(symbol.replace("-", ""))
    return [root for root in unique_candidates([compact_token(root) for root in roots]) if root]


def meaningful_words(value: str) -> list[str]:
    ignored = {"AND", "THE", "LTD", "LIMITED", "CO", "COMPANY", "PVT", "PRIVATE", "INC", "CORP", "CORPORATION"}
    return [word for word in re.findall(r"[A-Z0-9]+", value.upper()) if word and word not in ignored]


def company_acronyms(name: str) -> set[str]:
    words = meaningful_words(name)
    acronyms = set()
    if words:
        acronyms.add("".join(word[0] for word in words))
        with_legal_words = [word for word in re.findall(r"[A-Z0-9]+", name.upper()) if word]
        acronyms.add("".join(word[0] for word in with_legal_words))
    return acronyms


def screener_code_from_url(url: str) -> str:
    match = re.search(r"/company/([^/]+)/?", url)
    return match.group(1).strip().upper() if match else url.strip().upper()


def screener_search_terms(item: dict[str, str]) -> list[str]:
    terms = [
        item.get("screener", ""),
        item.get("isin", ""),
        item.get("source_symbol", ""),
        item.get("holding_name", ""),
        item.get("name", ""),
        item.get("tradingsymbol", ""),
    ]
    terms.extend(symbol_roots(item.get("tradingsymbol", "")))
    return unique_candidates([term for term in terms if term])


def fetch_screener_search(term: str) -> list[dict[str, Any]]:
    payload = fetch_json(screener_search_url(term))
    return payload if isinstance(payload, list) else []


def score_screener_search_result(item: dict[str, str], result: dict[str, Any], term: str) -> int:
    name = str(result.get("name") or "")
    url = str(result.get("url") or "")
    code = compact_token(screener_code_from_url(url))
    exchange = str(item.get("exchange") or "").upper()
    roots = symbol_roots(item.get("tradingsymbol", ""))
    source_roots = symbol_roots(item.get("source_symbol", ""))
    term_token = compact_token(term)
    name_words = {compact_token(word) for word in meaningful_words(name)}
    acronyms = company_acronyms(name)

    score = 0
    if exchange == "BSE" and code.isdigit():
        score += 30
    if exchange == "NSE" and code and not code.isdigit():
        score += 8

    for root in unique_candidates([*roots, *source_roots]):
        if not root:
            continue
        if code == root:
            score += 45
        elif code.startswith(root) and len(code) > len(root):
            score += 18
        if root in name_words:
            score += 32
        if root in acronyms:
            score += 45

    if term_token and term_token == code:
        score += 18
    if term_token and term_token in name_words:
        score += 10
    if "PARTLY" in name.upper() and "PP" not in item.get("tradingsymbol", "").upper():
        score -= 25
    return score


def discover_screener_candidates(item: dict[str, str]) -> list[dict[str, Any]]:
    ranked: dict[str, dict[str, Any]] = {}
    for term in screener_search_terms(item):
        try:
            results = fetch_screener_search(term)
        except (RuntimeError, urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError):
            continue
        for result in results:
            url = str(result.get("url") or "")
            if not url:
                continue
            code = screener_code_from_url(url)
            score = score_screener_search_result(item, result, term)
            previous = ranked.get(code)
            if previous and int(previous["score"]) >= score:
                continue
            ranked[code] = {
                "code": code,
                "name": str(result.get("name") or ""),
                "score": score,
                "term": term,
                "url": url,
            }
    candidates = sorted(ranked.values(), key=lambda row: int(row["score"]), reverse=True)
    if not candidates:
        return []
    best_score = int(candidates[0]["score"])
    second_score = int(candidates[1]["score"]) if len(candidates) > 1 else 0
    if best_score < 58 or (second_score and best_score - second_score < 8):
        return []
    return candidates[:3]


def parse_screener_fundamentals(page: str, source_url: str) -> dict[str, Any]:
    company_id = first_match(r'data-company-id="([^"]+)"', page)
    name = clean_html_text(first_match(r'<h1[^>]*>(.*?)</h1>', page)) or clean_html_text(first_match(r"<title[^>]*>(.*?)</title>", page)).split(" share price")[0]
    about = clean_html_text(first_match(r'<div[^>]+class="[^"]*\babout\b[^"]*"[^>]*>(.*?)</div>', page))
    key_points = clean_html_text(first_match(r'<div[^>]+class="[^"]*\bcommentary\b[^"]*"[^>]*>(.*?)</div>', page))
    meta_description = clean_html_text(first_match(r'<meta[^>]+name="description"[^>]+content="([^"]*)"', page))
    ratios = extract_top_ratios(page)
    analysis = section_html(page, "analysis")
    pros = list_items(first_match(r'<div[^>]+class="[^"]*\bpros\b[^"]*"[^>]*>(.*?)</div>', analysis))
    cons = list_items(first_match(r'<div[^>]+class="[^"]*\bcons\b[^"]*"[^>]*>(.*?)</div>', analysis))
    broad_sector = clean_html_text(first_match(r'title="Broad Sector"[^>]*>(.*?)</a>', page))
    sector = clean_html_text(first_match(r'title="Sector"[^>]*>(.*?)</a>', page))
    broad_industry = clean_html_text(first_match(r'title="Broad Industry"[^>]*>(.*?)</a>', page))
    industry = clean_html_text(first_match(r'title="Industry"[^>]*>(.*?)</a>', page))
    website = first_match(r'<a[^>]+href="(https?://[^"]+)"[^>]*>\s*<i[^>]+class="icon-link"', page)

    profit_loss = extract_table(page, "profit-loss")
    balance_sheet = extract_table(page, "balance-sheet")
    cash_flow = extract_table(page, "cash-flow")
    ratio_table = extract_table(page, "ratios")

    sales = latest_value(profit_loss, ["Sales"])
    operating_profit = latest_value(profit_loss, ["Operating Profit"])
    net_profit = latest_value(profit_loss, ["Net Profit", "Profit after tax"])
    eps = latest_value(profit_loss, ["EPS in Rs"])
    borrowings = latest_value(balance_sheet, ["Borrowings"])
    reserves = latest_value(balance_sheet, ["Reserves"])
    total_assets = latest_value(balance_sheet, ["Total Assets"])
    cfo = latest_value(cash_flow, ["Cash from Operating Activity"])
    cfi = latest_value(cash_flow, ["Cash from Investing Activity"])
    net_cash_flow = latest_value(cash_flow, ["Net Cash Flow"])

    sales_number = sales.get("numeric") if sales else None
    operating_profit_number = operating_profit.get("numeric") if operating_profit else None
    net_profit_number = net_profit.get("numeric") if net_profit else None
    cfo_number = cfo.get("numeric") if cfo else None
    cfi_number = cfi.get("numeric") if cfi else None

    market_cap_cr = number_from_text(ratios.get("Market Cap"))
    stock_pe = number_from_text(ratios.get("Stock P/E"))
    book_value = number_from_text(ratios.get("Book Value"))
    dividend_yield = number_from_text(ratios.get("Dividend Yield"))
    roce = number_from_text(ratios.get("ROCE"))
    roe = number_from_text(ratios.get("ROE"))

    payload: dict[str, Any] = {
        "name": name,
        "sector": broad_sector or sector,
        "industry": industry or broad_industry or sector,
        "website": website,
        "country": "India",
        "business_summary": " ".join(part for part in [about, key_points] if part) or meta_description,
        "key_points": key_points,
        "meta_description": meta_description,
        "top_ratios": ratios,
        "pros": pros,
        "cons": cons,
        "company_updates": extract_company_updates(page, company_id),
        "statement_tables": {
            "profit_loss": profit_loss,
            "balance_sheet": balance_sheet,
            "cash_flow": cash_flow,
            "ratios": ratio_table,
        },
        "statement_summary": {
            "sales": sales,
            "operating_profit": operating_profit,
            "net_profit": net_profit,
            "eps": eps,
            "borrowings": borrowings,
            "reserves": reserves,
            "total_assets": total_assets,
            "cash_from_operations": cfo,
            "cash_from_investing": cfi,
            "net_cash_flow": net_cash_flow,
        },
        "source": "screener",
        "source_url": source_url,
    }

    if market_cap_cr is not None:
        payload["market_cap"] = crores_to_rupees(market_cap_cr)
    if stock_pe is not None:
        payload["trailing_pe"] = stock_pe
    if book_value is not None:
        payload["book_value"] = book_value
    if dividend_yield is not None:
        payload["dividend_yield"] = dividend_yield / 100
    if roce is not None:
        payload["roce"] = roce
    if roe is not None:
        payload["return_on_equity"] = roe / 100
    if sales_number is not None:
        payload["revenue"] = crores_to_rupees(sales_number)
    if net_profit_number is not None:
        payload["net_profit"] = crores_to_rupees(net_profit_number)
    if sales_number not in (None, 0) and net_profit_number is not None:
        payload["profit_margins"] = net_profit_number / sales_number
    if sales_number not in (None, 0) and operating_profit_number is not None:
        payload["operating_margins"] = operating_profit_number / sales_number
    if borrowings and borrowings.get("numeric") is not None:
        payload["total_debt"] = crores_to_rupees(borrowings["numeric"])
    if cfo_number is not None:
        payload["operating_cashflow"] = crores_to_rupees(cfo_number)
    if cfo_number is not None and cfi_number is not None:
        payload["free_cashflow"] = crores_to_rupees(cfo_number + cfi_number)

    revenue_growth = annual_growth(profit_loss, ["Sales"])
    earnings_growth = annual_growth(profit_loss, ["Net Profit", "Profit after tax"])
    if revenue_growth is not None:
        payload["revenue_growth"] = revenue_growth
    if earnings_growth is not None:
        payload["earnings_growth"] = earnings_growth
    return {key: value for key, value in payload.items() if value not in (None, "", [], {})}


def fetch_screener_fundamentals(item: dict[str, str]) -> dict[str, Any]:
    errors = []
    attempted = set()

    def try_candidate_rows(candidate_rows: list[dict[str, Any]]) -> dict[str, Any] | None:
        for row in candidate_rows:
            candidate = str(row.get("code") or "").strip()
            if not candidate or candidate in attempted:
                continue
            attempted.add(candidate)
            url = screener_company_url(candidate)
            try:
                page = fetch_text(url)
                parsed = parse_screener_fundamentals(page, url)
                if parsed.get("name") or parsed.get("top_ratios"):
                    if row.get("term") != "configured":
                        parsed["screener_discovery"] = {
                            "candidate": candidate,
                            "name": row.get("name"),
                            "score": row.get("score"),
                            "term": row.get("term"),
                        }
                    return parsed
                errors.append(f"{candidate}: empty Screener parse")
            except (RuntimeError, urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
                errors.append(f"{candidate}: {exc}")
        return None

    configured_rows = [{"code": candidate, "name": "", "score": 100, "term": "configured"} for candidate in screener_candidates(item)]
    configured_result = try_candidate_rows(configured_rows)
    if configured_result:
        return configured_result

    discovered_rows = discover_screener_candidates(item)
    if discovered_rows:
        item["discovered_screener"] = discovered_rows[0]["code"]
        item["discovered_screener_name"] = discovered_rows[0]["name"]
        item["discovered_screener_score"] = str(discovered_rows[0]["score"])
    discovered_result = try_candidate_rows(discovered_rows)
    if discovered_result:
        return discovered_result

    search_note = "no confident Screener search match" if not discovered_rows else ""
    raise RuntimeError("; ".join([*errors, search_note]).strip("; ") or "no Screener candidates")


def merge_fundamentals(*payloads: dict[str, Any]) -> dict[str, Any]:
    merged: dict[str, Any] = {}
    sources = []
    for payload in payloads:
        if not payload:
            continue
        source = payload.get("source")
        if source and source not in sources:
            sources.append(source)
        for key, value in payload.items():
            if value in (None, "", [], {}):
                continue
            if key in {"top_ratios", "pros", "cons", "company_updates", "statement_tables", "statement_summary", "key_points", "meta_description", "source_url"}:
                merged[key] = value
            elif key not in merged or merged[key] in (None, "", [], {}):
                merged[key] = value
    if sources:
        merged["source"] = "+".join(sources)
    return merged


def quote_from_candles(candles: list[dict[str, Any]]) -> dict[str, Any]:
    if not candles:
        return {}
    last = candles[-1]
    previous = candles[-2] if len(candles) > 1 else last
    last_price = last.get("close")
    previous_close = previous.get("close")
    net_change = None
    if isinstance(last_price, (int, float)) and isinstance(previous_close, (int, float)):
        net_change = last_price - previous_close
    high = last.get("high")
    low = last.get("low")
    average_price = None
    if all(isinstance(value, (int, float)) for value in (high, low, last_price)):
        average_price = (high + low + last_price) / 3
    return {
        "last_price": last_price,
        "last_trade_time": last.get("date"),
        "volume": last.get("volume"),
        "average_price": average_price,
        "net_change": net_change,
        "ohlc": {
            "open": last.get("open"),
            "high": high,
            "low": low,
            "close": previous_close,
        },
    }


def merge_holdings_prices(holdings: list[dict[str, Any]], quotes: dict[str, Any], aliases: dict[str, str] | None = None) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    aliases = aliases or {}
    for holding in holdings:
        row = dict(holding)
        raw_key = f"{row.get('exchange', '').upper()}:{row.get('tradingsymbol', '').upper()}"
        key = aliases.get(raw_key, raw_key)
        if ":" in key and key != raw_key:
            resolved_exchange, resolved_symbol = key.split(":", 1)
            row["resolved_from_exchange"] = row.get("exchange")
            row["exchange"] = resolved_exchange
            row["tradingsymbol"] = resolved_symbol
        quote = quotes.get(key)
        if quote and quote.get("last_price") is not None:
            last_price = quote["last_price"]
            row["last_price"] = last_price
            quantity = row.get("quantity") or 0
            average_price = row.get("average_price") or 0
            row["pnl"] = (quantity * last_price) - (quantity * average_price)
        merged.append(row)
    return merged


def holding_lookup_keys(holding: dict[str, Any]) -> list[str]:
    exchange = str(holding.get("exchange") or "").upper()
    tradingsymbol = str(holding.get("tradingsymbol") or "").upper()
    if not tradingsymbol:
        return []
    keys = [f"{exchange}:{tradingsymbol}" if exchange else "", f"AUTO:{tradingsymbol}"]
    if exchange == "AUTO":
        keys.extend([f"NSE:{tradingsymbol}", f"BSE:{tradingsymbol}"])
    return unique_candidates([key for key in keys if key])


def holdings_metadata_by_symbol(holdings: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    metadata: dict[str, dict[str, Any]] = {}
    for holding in holdings:
        for key in holding_lookup_keys(holding):
            metadata[key] = holding
    return metadata


def apply_holding_metadata(item: dict[str, Any], metadata: dict[str, dict[str, Any]]) -> None:
    tradingsymbol = str(item.get("tradingsymbol") or "").upper()
    keys = [
        str(item.get("input") or "").upper(),
        str(item.get("kite_key") or "").upper(),
        f"AUTO:{tradingsymbol}",
        f"NSE:{tradingsymbol}",
        f"BSE:{tradingsymbol}",
    ]
    holding = next((metadata[key] for key in keys if key in metadata), None)
    if not holding:
        return
    field_map = {
        "isin": "isin",
        "name": "holding_name",
        "sector": "holding_sector",
        "source_symbol": "source_symbol",
    }
    for holding_key, item_key in field_map.items():
        value = holding.get(holding_key)
        if value not in (None, ""):
            item[item_key] = str(value)


def refresh_free_data(
    symbols: list[str] | None = None,
    days: int = 730,
    include_holdings: bool = True,
    return_holdings: bool = True,
    output: Path | None = None,
    app_output: Path | None = APP_SNAPSHOT,
) -> dict[str, Any]:
    mapping = load_symbol_map()
    requested_symbols = symbols or default_symbols()
    stored_holdings = read_json(HOLDINGS_PATH, [])
    holding_metadata = holdings_metadata_by_symbol(stored_holdings)
    holdings_for_request = stored_holdings if include_holdings else []
    if holdings_for_request:
        for holding in holdings_for_request:
            exchange = str(holding.get("exchange") or "").upper()
            tradingsymbol = str(holding.get("tradingsymbol") or "").upper()
            if exchange and tradingsymbol:
                holding_symbol = f"{exchange}:{tradingsymbol}"
                if holding_symbol not in requested_symbols:
                    requested_symbols.append(holding_symbol)
    resolved = []
    for symbol in requested_symbols:
        item = resolve_symbol(symbol, mapping)
        apply_holding_metadata(item, holding_metadata)
        resolved.append(item)
    quotes: dict[str, Any] = {}
    candles: dict[str, list[dict[str, Any]]] = {}
    fundamentals: dict[str, dict[str, Any]] = {}
    symbol_aliases: dict[str, str] = {}
    errors: list[str] = []

    for item in resolved:
        key = item["kite_key"]
        unsupported = unsupported_reason(item)
        if unsupported and not item.get("mapped"):
            errors.append(f"{key}: unsupported/unlisted security detected: {unsupported}")
            fundamentals[key] = {}
            continue

        used_yahoo_symbol = ""
        candle_errors = []
        for yahoo_symbol in yahoo_candidates(item):
            try:
                series = fetch_yahoo_candles(yahoo_symbol, days)
                inferred_exchange = exchange_from_yahoo(yahoo_symbol)
                if item.get("exchange") == "AUTO" and inferred_exchange:
                    item["exchange"] = inferred_exchange
                    item["kite_key"] = f"{inferred_exchange}:{item.get('tradingsymbol', '').upper()}"
                key = item["kite_key"]
                symbol_aliases[str(item.get("input") or "").upper()] = key
                symbol_aliases[f"AUTO:{item.get('tradingsymbol', '').upper()}"] = key
                candles[key] = series
                quotes[key] = quote_from_candles(series)
                used_yahoo_symbol = yahoo_symbol
                item["resolved_yahoo"] = yahoo_symbol
                break
            except (RuntimeError, urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
                candle_errors.append(f"{yahoo_symbol}: {exc}")
        if not used_yahoo_symbol:
            errors.append(f"{key}: could not fetch Yahoo EOD data for {', '.join(yahoo_candidates(item))}: {'; '.join(candle_errors)}")

        yahoo_fundamentals: dict[str, Any] = {}
        screener_fundamentals: dict[str, Any] = {}
        yahoo_fundamental_errors = []
        for yahoo_symbol in unique_candidates([used_yahoo_symbol, *yahoo_candidates(item)]):
            try:
                yahoo_fundamentals = fetch_yahoo_fundamentals(yahoo_symbol)
                break
            except (RuntimeError, urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
                yahoo_fundamental_errors.append(f"{yahoo_symbol}: {exc}")
        if not yahoo_fundamentals and yahoo_fundamental_errors:
            errors.append(f"{key}: could not fetch Yahoo company/fundamental data: {'; '.join(yahoo_fundamental_errors)}")
        try:
            screener_fundamentals = fetch_screener_fundamentals(item)
        except (RuntimeError, urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
            errors.append(f"{key}: could not fetch Screener company/fundamental data: {exc}")
        fundamentals[key] = merge_fundamentals(yahoo_fundamentals, screener_fundamentals)

    holdings = merge_holdings_prices(stored_holdings, quotes, symbol_aliases) if return_holdings and stored_holdings else []

    snapshot = {
        "provider": "free_yahoo_eod",
        "generated_at": now_iso(),
        "symbols": [
            {key: value for key, value in item.items()}
            for item in resolved
        ],
        "quotes": quotes,
        "candles": candles,
        "fundamentals": fundamentals,
        "holdings": holdings,
        "errors": errors,
        "source_urls": {
            "yahoo_chart": "https://query1.finance.yahoo.com/v8/finance/chart/",
            "yahoo_quote_summary": "https://query2.finance.yahoo.com/v10/finance/quoteSummary/",
            "screener_company": "https://www.screener.in/company/",
            "nse_reports": "https://www.nseindia.com/all-reports",
            "nse_financial_results": "https://www.nseindia.com/companies-listing/corporate-filings-financial-results",
            "nse_shareholding": "https://www.nseindia.com/companies-listing/corporate-filings-shareholding-pattern",
        },
        "notes": [
            "Yahoo Finance chart data is unofficial and delayed/end-of-day.",
            "Yahoo company/fundamental data is unofficial and best-effort; availability varies by symbol.",
            "Screener company pages are scraped as a free fallback for profile, ratios, statements, pros/cons, and due-diligence clues.",
            "Use exchange filings and company reports for final fundamental confirmation.",
        ],
    }

    output_path = output or (CACHE_DIR / "latest.json")
    write_json(output_path, snapshot)
    if app_output:
        write_json(app_output, snapshot)
    return snapshot


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Refresh free EOD data for the verdict workstation.")
    parser.add_argument("--symbols", nargs="*", help="Symbols such as NSE:ENGINERSIN BSE:SAMRATPH.")
    parser.add_argument("--days", type=int, default=730)
    parser.add_argument("--no-holdings", action="store_true")
    parser.add_argument("--output", help="Snapshot output path.")
    parser.add_argument("--app-output", default=str(APP_SNAPSHOT), help="Frontend snapshot output path.")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    output = Path(args.output).resolve() if args.output else None
    app_output = Path(args.app_output).resolve() if args.app_output else None
    snapshot = refresh_free_data(
        symbols=args.symbols,
        days=args.days,
        include_holdings=not args.no_holdings,
        return_holdings=not args.no_holdings,
        output=output,
        app_output=app_output,
    )
    print(f"Wrote {output or (CACHE_DIR / 'latest.json')}")
    if app_output:
        print(f"Wrote {app_output}")
    if snapshot["errors"]:
        print("Completed with warnings:")
        for error in snapshot["errors"]:
            print(f"- {error}")
    else:
        print(f"Fetched {len(snapshot['quotes'])} symbols.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
