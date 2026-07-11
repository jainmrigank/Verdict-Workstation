#!/usr/bin/env python3
"""Local HTTP bridge for the market-data refresh button."""

from __future__ import annotations

import argparse
import errno
import ipaddress
import importlib
import json
import os
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import free_data_refresh as data_refresh
from holdings_parser import holdings_to_symbols, parse_holdings_xlsx


APP_BACKEND_ROOT = Path(__file__).resolve().parent.parent / "stock-analysis-app"
if str(APP_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_BACKEND_ROOT))

from server.bridge_security import BridgeSecurity
from server.llm_analysis import generate_analysis


UPLOAD_DIR = data_refresh.CACHE_DIR / "uploads"
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_LLM_CONTEXT_BYTES = 512 * 1024
MAX_JSON_REQUEST_BYTES = 1024 * 1024
SERVER_STARTED_AT = datetime.now(timezone.utc).isoformat()

PDF_FOUNDATION_RULES: list[dict[str, Any]] = [
    {
        "area": "market basics",
        "rules": [
            "Start by identifying the instrument, exchange, liquidity, corporate-action risk, and whether the idea is investment, trade, or speculation.",
            "Treat price as one piece of evidence; capital safety depends on business quality, market depth, and the ability to exit.",
        ],
    },
    {
        "area": "chart analysis",
        "rules": [
            "Read trend, support/resistance, volume, and candlestick context together; no single pattern or indicator is enough to buy or sell.",
            "Use indicators such as RSI, MACD, moving averages, VWAP, Bollinger Bands, and ATR as confirmation and risk-placement tools, not as guarantees.",
        ],
    },
    {
        "area": "business analysis",
        "rules": [
            "Understand the business, industry drivers, accounting statements, profitability, leverage, cash conversion, growth, and valuation before concluding quality.",
            "Prefer businesses where PAT is backed by CFO, debt is manageable, reserves are healthy, and valuation is sensible versus history and peers.",
        ],
    },
    {
        "area": "futures and leverage",
        "rules": [
            "Recognise leverage, margin calls, mark-to-market movement, rollover, basis, and liquidity before considering futures exposure.",
            "Do not use futures to recover losses from a weak equity thesis; use derivatives only for a defined view or hedge.",
        ],
    },
    {
        "area": "options risk",
        "rules": [
            "Options require explicit awareness of intrinsic value, time value, volatility, expiry, and the Greeks.",
            "Long options need movement before time decay hurts; short options need strict risk controls because losses can expand quickly.",
        ],
    },
    {
        "area": "options strategy fit",
        "rules": [
            "Match the strategy to direction, volatility, time horizon, and max-loss comfort before entering.",
            "Every strategy must have a payoff map, break-even, maximum loss, maximum gain, and exit rule.",
        ],
    },
    {
        "area": "costs and taxation",
        "rules": [
            "Trading decisions should consider taxes, charges, turnover classification, record keeping, and post-tax return.",
            "A strategy that looks profitable before costs may be poor after brokerage, slippage, STT, taxes, and compliance burden.",
        ],
    },
    {
        "area": "macro-linked instruments",
        "rules": [
            "Currency and commodity contracts depend on macro drivers, contract specifications, expiry, leverage, and global risk events.",
            "Avoid applying equity-only logic to commodities or currencies without checking the underlying economic driver.",
        ],
    },
    {
        "area": "risk and behaviour",
        "rules": [
            "Predefine maximum loss, invalidation, position size, and review points before entering or adding.",
            "Avoid impulsive averaging, revenge trading, hot tips, and changing the plan only because price moved against you.",
        ],
    },
    {
        "area": "system discipline",
        "rules": [
            "Judge a system by expectancy, drawdown, sample size, costs, and robustness instead of one winning or losing trade.",
            "Be suspicious of overfitting; rules should be simple enough to execute consistently in live conditions.",
        ],
    },
    {
        "area": "capital separation",
        "rules": [
            "Separate emergency money, goal money, retirement money, and market-risk capital before buying stocks.",
            "Capital allocation should fit net worth, cash-flow stability, time horizon, and the emotional ability to tolerate drawdowns.",
        ],
    },
    {
        "area": "protection planning",
        "rules": [
            "Use insurance to transfer catastrophic risk; do not confuse protection products with stock-market return seeking.",
            "A stock decision should not endanger essential health, term, emergency, or family-protection planning.",
        ],
    },
    {
        "area": "supporting context",
        "rules": [
            "When the local PDF title is unavailable, treat it as supporting context only and rely on explicit stock evidence before acting.",
            "Do not let a generic rule override current data gaps, liquidity risk, leverage risk, or the user's stated constraints.",
        ],
    },
]


def load_local_env() -> None:
    env_path = Path(__file__).resolve().parent.parent / ".env"
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


def refresh_module():
    return importlib.reload(data_refresh)


def quote_command(command: list[str]) -> str:
    return " ".join(f'"{part}"' if " " in part else part for part in command)


def configured_allowed_origins() -> list[str]:
    return [origin.strip().rstrip("/") for origin in os.environ.get("MARKET_DATA_ALLOW_ORIGIN", "").split(",") if origin.strip()]


def is_loopback_origin(origin: str) -> bool:
    try:
        parsed = urlparse(origin)
        hostname = parsed.hostname
        if not hostname:
            return False
        if hostname in {"localhost", "127.0.0.1", "::1"}:
            return True
        ip = ipaddress.ip_address(hostname)
        return ip.is_loopback
    except ValueError:
        return False


def allowed_origin(origin: str | None, allowed_origins: list[str]) -> str | None:
    if not origin:
        return None
    clean_origin = origin.rstrip("/")
    if clean_origin in allowed_origins or is_loopback_origin(clean_origin):
        return clean_origin
    return None


def has_external_origins(origins: list[str]) -> bool:
    return any(origin != "*" and not is_loopback_origin(origin) for origin in origins)


def sanitise_public_snapshot(snapshot: dict[str, Any]) -> dict[str, Any]:
    public_snapshot = {**snapshot, "holdings": []}
    public_snapshot.pop("upload", None)
    return public_snapshot


def purge_legacy_portfolio_state() -> None:
    module = refresh_module()
    module.write_json(module.HOLDINGS_PATH, [])
    upload_path = UPLOAD_DIR / "latest_holdings_upload.xlsx"
    if upload_path.exists():
        upload_path.unlink()
    for path in (module.CACHE_DIR / "latest.json", module.APP_SNAPSHOT):
        if not path.exists():
            continue
        try:
            snapshot = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(snapshot, dict) and (snapshot.get("holdings") or snapshot.get("upload")):
                module.write_json(path, sanitise_public_snapshot(snapshot))
        except (OSError, json.JSONDecodeError):
            continue


def spawn_relauncher(host: str, port: int, command: list[str], cwd: str) -> None:
    payload = json.dumps({"command": command, "cwd": cwd, "host": host, "port": port})
    relauncher_code = """
import json
import socket
import subprocess
import sys
import time

payload = json.loads(sys.argv[1])
deadline = time.time() + 8
while time.time() < deadline:
    try:
        with socket.create_connection((payload["host"], int(payload["port"])), timeout=0.25):
            time.sleep(0.25)
            continue
    except OSError:
        break
time.sleep(0.25)
subprocess.Popen(
    payload["command"],
    cwd=payload["cwd"],
    stdin=subprocess.DEVNULL,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
    start_new_session=True,
)
"""
    subprocess.Popen(
        [sys.executable, "-c", relauncher_code, payload],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


def llm_setup_payload() -> dict[str, Any]:
    return {
        "configured": False,
        "message": "AI Coach is not configured on the data bridge yet.",
        "setup": [
            "Set GEMINI_API_KEY or LLM_API_KEY on the machine running scripts/market_data_server.py.",
            "Set LLM_MODEL to the Gemini Flash model name you want to use.",
            "LLM_BASE_URL defaults to the Gemini API OpenAI-compatible endpoint.",
            "Restart scripts/market_data_server.py after setting the variables.",
        ],
    }


def llm_config() -> dict[str, str] | None:
    provider = os.environ.get("LLM_PROVIDER", "gemini").strip().lower()
    if provider == "vertex":
        vertex_url = os.environ.get("VERTEX_TUNED_MODEL_URL", "").strip()
        if not vertex_url:
            return None
        return {
            "provider": "vertex",
            "model": os.environ.get("LLM_MODEL", "gemini-3.5-flash-tuned"),
            "vertex_url": vertex_url,
        }
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("LLM_API_KEY") or os.environ.get("OPENAI_API_KEY")
    model = os.environ.get("LLM_MODEL") or os.environ.get("OPENAI_MODEL") or "gemini-3.5-flash"
    if not api_key or not model:
        return None
    return {
        "provider": "openai_compatible",
        "api_key": api_key,
        "model": model,
        "base_url": os.environ.get("LLM_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai").rstrip("/"),
    }


def load_server_trading_knowledge() -> dict[str, Any]:
    """Attach the paraphrased practical rule index without sending raw source text."""
    index_path = Path(__file__).resolve().parent.parent / "data/reference/trading_rule_index.json"
    if not index_path.exists():
        return {
            "loadError": "The local paraphrased rule index was not found.",
        }
    data = json.loads(index_path.read_text(encoding="utf-8"))
    category_map = {
        "process": "process",
        "sector": "sector",
        "instrument": "instrument",
        "capital": "capital",
    }
    compact_rules = [
        {
            "id": rule.get("id"),
            "category": category_map.get(str(rule.get("module") or ""), rule.get("module")),
            "appliesTo": rule.get("appliesTo"),
            "tone": rule.get("tone"),
            "evidenceTilt": rule.get("scoreImpact"),
            "principle": rule.get("principle"),
            "checklist": rule.get("checklist"),
            "action": rule.get("action"),
            "caution": rule.get("caution"),
        }
        for rule in data.get("derivedRules", [])
    ]
    return {
        "generatedAt": data.get("generatedAt"),
        "practicalChecks": compact_rules,
        "pdfFoundationRules": PDF_FOUNDATION_RULES,
    }


def attach_server_trading_knowledge(context: dict[str, Any]) -> dict[str, Any]:
    enriched = dict(context)
    existing = enriched.get("tradingGuardrails")
    knowledge = dict(existing) if isinstance(existing, dict) else {}
    server_knowledge = load_server_trading_knowledge()
    knowledge.update(server_knowledge)
    enriched["tradingGuardrails"] = knowledge
    return enriched


def yahoo_search_url(query: str, limit: int) -> str:
    from urllib.parse import urlencode

    params = urlencode(
        {
            "q": query,
            "quotesCount": max(1, min(limit, 20)),
            "newsCount": 0,
            "enableFuzzyQuery": "true",
            "quotesQueryId": "tss_match_phrase_query",
        }
    )
    return f"https://query2.finance.yahoo.com/v1/finance/search?{params}"


def search_symbol_from_yahoo(raw_symbol: str) -> tuple[str, str] | None:
    symbol = raw_symbol.strip().upper()
    if symbol.endswith(".NS"):
        return "NSE", symbol.removesuffix(".NS")
    if symbol.endswith(".BO"):
        return "BSE", symbol.removesuffix(".BO")
    return None


def merge_symbol_search_result(results: dict[str, dict[str, Any]], row: dict[str, Any]) -> None:
    exchange = str(row.get("exchange") or "").strip().upper()
    tradingsymbol = str(row.get("tradingsymbol") or "").strip().upper()
    if exchange not in {"NSE", "BSE"} or not tradingsymbol:
        return
    key = f"{exchange}:{tradingsymbol}"
    existing = results.get(key)
    if existing and int(existing.get("priority") or 0) >= int(row.get("priority") or 0):
        return
    results[key] = {
        "exchange": exchange,
        "tradingsymbol": tradingsymbol,
        "symbol": key,
        "name": str(row.get("name") or "").strip(),
        "meta": str(row.get("meta") or "").strip(),
        "source": str(row.get("source") or "").strip(),
        "priority": int(row.get("priority") or 0),
    }


def market_symbol_search(query: str, limit: int = 12) -> dict[str, Any]:
    clean_query = " ".join(query.strip().split())
    capped_limit = max(1, min(limit, 20))
    results: dict[str, dict[str, Any]] = {}
    errors: list[str] = []

    if not clean_query:
        return {"query": clean_query, "results": [], "errors": []}

    try:
        for result in data_refresh.fetch_screener_search(clean_query):
            url = str(result.get("url") or "")
            code = data_refresh.screener_code_from_url(url)
            if not code:
                continue
            exchange = "BSE" if code.isdigit() else "NSE"
            merge_symbol_search_result(
                results,
                {
                    "exchange": exchange,
                    "tradingsymbol": code,
                    "name": result.get("name") or "",
                    "meta": "Screener company search",
                    "source": "screener",
                    "priority": 80,
                },
            )
    except Exception as exc:
        errors.append(f"Screener search unavailable: {exc}")

    try:
        payload = data_refresh.fetch_json(yahoo_search_url(clean_query, capped_limit))
        for quote in payload.get("quotes", []) if isinstance(payload, dict) else []:
            if not isinstance(quote, dict):
                continue
            raw_symbol = str(quote.get("symbol") or "")
            parsed = search_symbol_from_yahoo(raw_symbol)
            if not parsed:
                continue
            exchange, tradingsymbol = parsed
            quote_type = str(quote.get("quoteType") or quote.get("typeDisp") or "").strip()
            exchange_display = str(quote.get("exchDisp") or quote.get("exchange") or "").strip()
            merge_symbol_search_result(
                results,
                {
                    "exchange": exchange,
                    "tradingsymbol": tradingsymbol,
                    "name": quote.get("longname") or quote.get("shortname") or quote.get("name") or "",
                    "meta": " | ".join(part for part in [quote_type, exchange_display] if part),
                    "source": "yahoo",
                    "priority": 70,
                },
            )
    except Exception as exc:
        errors.append(f"Yahoo search unavailable: {exc}")

    rows = sorted(
        results.values(),
        key=lambda row: (
            -int(row.get("priority") or 0),
            not str(row.get("tradingsymbol") or "").startswith(clean_query.upper()),
            str(row.get("symbol") or ""),
        ),
    )
    return {"query": clean_query, "results": rows[:capped_limit], "errors": errors}


def build_llm_prompt(context: dict[str, Any]) -> list[dict[str, str]]:
    coach_request = context.get("coachRequest") if isinstance(context.get("coachRequest"), dict) else {}
    scope = str(coach_request.get("scope") or "verdict").lower()
    if scope not in {"verdict", "technical", "fundamental"}:
        scope = "verdict"
    if scope == "technical":
        task = "Write a technical/chart-only AI Coach explanation for this stock."
        scope_rules = [
            "Focus on technicalEvidence, importantSignals from the Technical group, positionAndRisk, app verdict cautions, and relevant technical/risk checks.",
            "Explain what trend, candles, moving averages, RSI, MACD, ATR, VWAP, Bollinger/range, volume/liquidity, candlestick patterns, and support/resistance imply for the stock's possible future price path.",
            "For every important point, say whether it can attract demand, create selling pressure, cap upside, widen downside risk, or require waiting for confirmation.",
            "Do not produce a full company/fundamental review. Mention fundamentals only as a brief cross-check or data gap if it directly affects technical confidence.",
            "Do not rewrite the app verdict; explain how the chart either supports, weakens, or fails to confirm it.",
        ]
    elif scope == "fundamental":
        task = "Write a business/fundamental-only AI Coach explanation for this stock."
        scope_rules = [
            "Focus on fundamentalEvidence, company profile, ratios, statement flow, business quality pillars, updates, sectorOperatingRules, and relevant fundamental/sector checks.",
            "Explain what the business does, what important ratios/statements imply for future price support, what can improve valuation, what can cap upside, and what evidence is missing.",
            "For every important point, connect the business evidence to demand, selling pressure, valuation re-rating/de-rating, or confidence in holding future price gains.",
            "Do not produce a full chart/technical review. Mention price action only as a brief cross-check or data gap if it directly affects fundamental confidence.",
            "Do not rewrite the app verdict; explain how the business evidence either supports, weakens, or fails to confirm it.",
        ]
    else:
        task = "Write the separate AI Coach explanation for this already-computed verdict."
        scope_rules = [
            "Anchor to the app verdict and the evidence available for this stock.",
            "Do not change buy/hold/reduce/exit labels; explain them.",
            "If you would be more cautious than the app label, frame it as a caution, not a replacement verdict.",
            "Cover the action plan, risk plan, technical evidence, fundamental evidence, company updates, and data gaps in proportion to how they affect future price and capital risk.",
        ]
    system_prompt = """
You are the AI Coach inside Verdict Workstation, an educational NSE/BSE analysis assistant.
You do not replace the app's verdict. You explain it in plain English, using only the supplied facts, rules, and fetched data.
Never invent missing metrics, live prices, news, filings, or company facts. If data is missing, say it is missing and explain how that lowers confidence.
You receive compact practical trading checks, sector checklists, and matched lessons. Use that knowledge silently. Do not mention backend mechanics, internal datasets, prompt rules, implementation details, or internal field names in the answer.
Use cautious, practical language for a novice non-intraday investor. Keep the answer focused on future price consequences: what may push price up, what may cap or push it down, and what confirmation is needed before acting. Mention that this is decision support, not guaranteed future performance. Avoid the word "score" in user-facing prose; call 0-100 numbers evidence reads if you must reference them.
Return only valid JSON with these keys:
headline, plainEnglishVerdict, whatToDoNext, whatNotToDo, keyEvidence, practicalPrinciples, riskPlan, dataGaps, questionsBeforeAction, confidenceNote.
Array fields must be short arrays of strings. Keep every item specific to the current stock and user context.
"""
    user_prompt = {
        "task": task,
        "coachScope": scope,
        "rules": [
            *scope_rules,
            "Consult the practical trading checks supplied in the context before writing the answer.",
            "Use the supplied checks silently, but do not reveal backend mechanics, internal datasets, prompt rules, implementation details, or internal field names.",
            "Prioritise concrete action, future-price implications, risk, and data-gap clarity over generic education.",
            "Avoid explaining internal weights unless the user specifically asks. Do not say a signal lifts, drags, or keeps a layer mixed; describe what it can do to price instead.",
        ],
        "context": context,
    }
    return [
        {"role": "system", "content": system_prompt.strip()},
        {"role": "user", "content": json.dumps(user_prompt, ensure_ascii=False, separators=(",", ":"))},
    ]


def call_llm(context: dict[str, Any]) -> dict[str, Any]:
    config = llm_config()
    if not config:
        return llm_setup_payload()

    payload = {
        "model": config["model"],
        "temperature": float(os.environ.get("LLM_TEMPERATURE", "0.2")),
        "response_format": {"type": "json_object"},
        "messages": build_llm_prompt(context),
    }
    url = f"{config['base_url']}/chat/completions"
    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {config['api_key']}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    timeout = float(os.environ.get("LLM_TIMEOUT_SECONDS", "45"))
    try:
        with urlopen(request, timeout=timeout) as response:
            completion = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"LLM provider returned HTTP {exc.code}: {detail[:1000]}") from exc
    except URLError as exc:
        raise RuntimeError(f"Could not reach the configured LLM provider: {exc.reason}") from exc

    content = (
        completion.get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
    )
    try:
        review = json.loads(content)
    except json.JSONDecodeError:
        review = {"plainEnglishVerdict": content, "whatToDoNext": [], "whatNotToDo": []}
    return {
        "ok": True,
        "configured": True,
        "model": config["model"],
        "scope": (context.get("coachRequest") or {}).get("scope", "verdict") if isinstance(context.get("coachRequest"), dict) else "verdict",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "review": review,
    }


class FreeDataHandler(BaseHTTPRequestHandler):
    server_version = "MarketDataServer/1.0"

    def log_message(self, format: str, *args: Any) -> None:
        path = urlparse(self.path).path
        print(f"{self.client_address[0]} - {self.command} {path}")

    def _set_headers(self, status: int = 200, content_type: str = "application/json") -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        origin = allowed_origin(self.headers.get("Origin"), getattr(self.server, "allowed_origins", []))
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header(
            "Access-Control-Allow-Headers",
            "Authorization, Content-Type, Ngrok-Skip-Browser-Warning, X-Days, X-Filename",
        )
        self.end_headers()

    def _write_json(self, payload: dict[str, Any], status: int = 200) -> None:
        self._set_headers(status)
        self.wfile.write(json.dumps(payload, indent=2, sort_keys=True).encode("utf-8"))

    def _client_ip(self) -> str:
        return str(self.client_address[0])

    def _is_remote_request(self) -> bool:
        origin = self.headers.get("Origin")
        if origin:
            return not is_loopback_origin(origin)
        try:
            return not ipaddress.ip_address(self._client_ip()).is_loopback
        except ValueError:
            return True

    def _guard_request(self, path: str) -> bool:
        origin = self.headers.get("Origin")
        if origin and not allowed_origin(origin, getattr(self.server, "allowed_origins", [])):
            self._write_json({"error": "Origin is not allowed.", "code": "origin_not_allowed"}, status=403)
            return False
        if path in {"/health", "/api/session"} or not path.startswith("/api/"):
            return True
        security: BridgeSecurity = self.server.security
        if self.server.external_access and self._is_remote_request() and not security.enabled:
            self._write_json(
                {
                    "error": "Remote bridge access is disabled until a group access code is configured.",
                    "code": "bridge_auth_not_configured",
                },
                status=503,
            )
            return False
        auth = security.validate_authorization(self.headers.get("Authorization"))
        if not auth.ok:
            self._write_json(
                {"error": "Bridge session is missing or expired.", "code": auth.code, "authRequired": True},
                status=401,
            )
            return False
        if not security.allow_request(auth.session_id, self._client_ip()):
            self._write_json({"error": "Bridge request limit reached. Try again shortly.", "code": "rate_limited"}, status=429)
            return False
        return True

    def _read_json(self, max_bytes: int = MAX_JSON_REQUEST_BYTES) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length < 0 or length > max_bytes:
            raise ValueError("request_too_large")
        body = self.rfile.read(length).decode("utf-8") if length else "{}"
        payload = json.loads(body or "{}")
        if not isinstance(payload, dict):
            raise ValueError("request_must_be_object")
        return payload

    def do_OPTIONS(self) -> None:
        self._set_headers(204)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if not self._guard_request(parsed.path):
            return
        if parsed.path == "/health":
            security: BridgeSecurity = self.server.security
            self._write_json(
                {
                    "ok": True,
                    "service": "market-data",
                    "server_version": self.server_version,
                    "started_at": SERVER_STARTED_AT,
                    "supports_restart": True,
                    "auth_required": security.enabled or self.server.external_access,
                    "portfolio_storage": "browser-local",
                },
            )
            return
        if parsed.path == "/api/free-data/latest":
            latest = data_refresh.CACHE_DIR / "latest.json"
            if not latest.exists():
                self._write_json({"error": "No market-data cache yet"}, status=404)
                return
            try:
                payload = json.loads(latest.read_text(encoding="utf-8"))
                self._write_json(sanitise_public_snapshot(payload))
            except json.JSONDecodeError:
                self._write_json({"error": "Market-data cache is invalid."}, status=500)
            return
        if parsed.path == "/api/symbols/search":
            query_params = parse_qs(parsed.query)
            query = (query_params.get("q") or [""])[0]
            try:
                limit = int((query_params.get("limit") or ["12"])[0])
            except ValueError:
                limit = 12
            self._write_json(market_symbol_search(query, limit))
            return
        self._write_json({"error": "Not found"}, status=404)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if not self._guard_request(parsed.path):
            return
        if parsed.path == "/api/session":
            self._handle_session()
            return
        if parsed.path == "/api/free-data/refresh":
            self._handle_free_data_refresh()
            return
        if parsed.path == "/api/server/restart":
            self._handle_server_restart()
            return
        if parsed.path == "/api/portfolio/upload":
            self._handle_portfolio_upload(parsed.query)
            return
        if parsed.path == "/api/portfolio/clear":
            self._handle_portfolio_clear()
            return
        if parsed.path == "/api/symbol-map/upsert":
            self._handle_symbol_map_upsert()
            return
        if parsed.path == "/api/llm/verdict":
            self._handle_llm_verdict()
            return
        if parsed.path == "/api/llm/analysis":
            self._handle_llm_analysis()
            return
        self._write_json({"error": "Not found"}, status=404)

    def _handle_session(self) -> None:
        security: BridgeSecurity = self.server.security
        if not security.allow_session_attempt(self._client_ip()):
            self._write_json({"error": "Too many access attempts. Try again shortly.", "code": "rate_limited"}, status=429)
            return
        try:
            payload = self._read_json(16 * 1024)
            result = security.issue_token(str(payload.get("accessCode") or ""))
            self._write_json({"ok": True, **result})
        except ValueError as exc:
            if str(exc) == "invalid_access_code":
                self._write_json({"error": "Access code is not valid.", "code": "invalid_access_code"}, status=401)
                return
            status = 413 if str(exc) == "request_too_large" else 400
            self._write_json({"error": "Session request is invalid.", "code": str(exc)}, status=status)
        except json.JSONDecodeError:
            self._write_json({"error": "Session request must be valid JSON.", "code": "invalid_json"}, status=400)

    def _handle_server_restart(self) -> None:
        try:
            host, port = self.server.server_address[:2]
            script_path = Path(__file__).resolve()
            project_root = script_path.parent.parent
            command = [sys.executable, str(script_path), "--host", str(host), "--port", str(port)]
            for origin in getattr(self.server, "allowed_origins", []):
                command.extend(["--allow-origin", origin])
            spawn_relauncher(str(host), int(port), command, str(project_root))
            self._write_json(
                {
                    "ok": True,
                    "message": "Restart accepted. The local data server will come back on the same port.",
                    "command": quote_command(command),
                    "started_at": SERVER_STARTED_AT,
                },
            )

            def stop_server() -> None:
                time.sleep(0.25)
                self.server.shutdown()

            threading.Thread(target=stop_server, daemon=True).start()
        except Exception as exc:
            self._write_json({"error": str(exc)}, status=500)

    def _handle_free_data_refresh(self) -> None:
        try:
            payload = self._read_json()
            symbols = payload.get("symbols") or None
            if isinstance(symbols, str):
                symbols = symbols.split()
            days = int(payload.get("days") or 730)
            module = refresh_module()
            snapshot = module.refresh_free_data(
                symbols=symbols,
                days=days,
                include_holdings=False,
                return_holdings=False,
            )
            self._write_json(sanitise_public_snapshot(snapshot))
        except ValueError as exc:
            status = 413 if str(exc) == "request_too_large" else 400
            self._write_json({"error": "Market-data refresh request is invalid.", "code": str(exc)}, status=status)
        except Exception as exc:  # Keep local UI errors visible.
            self._write_json({"error": str(exc)}, status=500)

    def _handle_portfolio_upload(self, query: str) -> None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0:
                self._write_json({"error": "No XLSX file bytes received."}, status=400)
                return
            if length > MAX_UPLOAD_BYTES:
                self._write_json({"error": "Uploaded workbook is larger than 20 MB."}, status=413)
                return
            data = self.rfile.read(length)
            filename = self.headers.get("X-Filename", "holdings-upload.xlsx")
            query_params = parse_qs(query)
            days = int(self.headers.get("X-Days") or (query_params.get("days") or ["730"])[0])
            holdings = parse_holdings_xlsx(data)
            symbols = holdings_to_symbols(holdings)
            if not symbols:
                self._write_json({"error": "No symbols could be inferred from the uploaded holdings."}, status=400)
                return

            module = refresh_module()
            snapshot = module.refresh_free_data(
                symbols=symbols,
                days=days,
                include_holdings=False,
                return_holdings=False,
            )
            merged_holdings = module.merge_holdings_prices(
                holdings,
                snapshot.get("quotes") or {},
                snapshot.get("symbol_aliases") or {},
            )
            resolved_symbols = holdings_to_symbols(merged_holdings or holdings)
            snapshot["holdings"] = merged_holdings
            snapshot["upload"] = {
                "filename": filename,
                "holdings_count": len(holdings),
                "symbols": resolved_symbols or symbols,
            }
            self._write_json(snapshot)
        except Exception as exc:
            self._write_json({"error": str(exc)}, status=500)

    def _handle_portfolio_clear(self) -> None:
        try:
            purge_legacy_portfolio_state()
            self._write_json({"ok": True, "message": "No portfolio data is stored on the bridge."})
        except Exception as exc:
            self._write_json({"error": str(exc)}, status=500)

    def _handle_symbol_map_upsert(self) -> None:
        try:
            payload = self._read_json(64 * 1024)
            module = refresh_module()
            mapping = module.upsert_symbol_mapping(payload)
            self._write_json({"ok": True, "mapping": mapping})
        except ValueError as exc:
            status = 413 if str(exc) == "request_too_large" else 400
            self._write_json({"error": "Symbol mapping request is invalid.", "code": str(exc)}, status=status)
        except Exception as exc:
            self._write_json({"error": str(exc)}, status=500)

    def _handle_llm_verdict(self) -> None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0:
                self._write_json({"error": "No AI Coach context received."}, status=400)
                return
            if length > MAX_LLM_CONTEXT_BYTES:
                self._write_json({"error": "AI Coach context is too large. Refresh the page and try again with the selected stock only."}, status=413)
                return
            body = self.rfile.read(length).decode("utf-8")
            payload = json.loads(body or "{}")
            context = payload.get("context")
            if not isinstance(context, dict):
                self._write_json({"error": "AI Coach context must be a JSON object."}, status=400)
                return
            self._write_json(call_llm(attach_server_trading_knowledge(context)))
        except Exception as exc:
            self._write_json({"error": str(exc)}, status=500)

    def _handle_llm_analysis(self) -> None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0:
                self._write_json({"error": "No analysis facts received."}, status=400)
                return
            if length > MAX_LLM_CONTEXT_BYTES:
                self._write_json({"error": "Analysis facts are too large. Send only the selected instrument."}, status=413)
                return
            body = self.rfile.read(length).decode("utf-8")
            payload = json.loads(body or "{}")
            context = payload.get("context")
            if not isinstance(context, dict):
                self._write_json({"error": "Analysis facts must be a JSON object."}, status=400)
                return
            if context.get("schemaVersion") != "analysis-facts.v1":
                self._write_json({"error": "Unsupported analysis facts schema."}, status=400)
                return
            self._write_json(generate_analysis(context, llm_config()))
        except Exception as exc:
            self._write_json({"error": str(exc)}, status=500)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the local market-data refresh server.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument(
        "--allow-origin",
        action="append",
        default=[],
        help="Extra browser origin allowed to call this bridge, e.g. https://your-public-app.example",
    )
    return parser


def main() -> int:
    load_local_env()
    args = build_parser().parse_args()
    args.allow_origin = list(dict.fromkeys([*configured_allowed_origins(), *args.allow_origin]))
    if "*" in args.allow_origin:
        print("Wildcard bridge origins are not allowed. Configure each HTTPS app origin explicitly.")
        return 1
    security = BridgeSecurity.from_env()
    purge_legacy_portfolio_state()
    try:
        server = ThreadingHTTPServer((args.host, args.port), FreeDataHandler)
        server.allowed_origins = args.allow_origin
        server.external_access = has_external_origins(args.allow_origin)
        server.security = security
    except OSError as exc:
        if getattr(exc, "errno", None) in {errno.EADDRINUSE, errno.EPERM}:
            print(
                f"Could not start the market-data server on port {args.port}. The port may already be in use, or this shell may not be allowed to bind it. "
                "Use the app's Restart Server button, stop the old terminal process with Ctrl+C, or choose another port with --port.",
            )
            return 1
        raise
    auth_mode = "group-token" if security.enabled else "local-only"
    print(f"Market data server listening on http://{args.host}:{args.port} ({auth_mode}, browser-local portfolios)")
    if server.external_access and not security.enabled:
        print("Remote API requests are blocked until BRIDGE_GROUP_ACCESS_CODE is configured.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Stopping market data server.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
