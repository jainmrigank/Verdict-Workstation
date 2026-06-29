#!/usr/bin/env python3
"""Local Kite Connect data bridge for the NSE/BSE analysis app.

The script keeps API credentials in .env, fetches market data with stdlib HTTP,
and writes a sanitized JSON snapshot for the React app to display.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
CACHE_DIR = ROOT / "data" / "cache" / "kite"
APP_SNAPSHOT = ROOT / "react-day1" / "public" / "stock-data" / "latest.json"
KITE_BASE = "https://api.kite.trade"
KITE_LOGIN = "https://kite.zerodha.com/connect/login"


class KiteError(RuntimeError):
    pass


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).astimezone().isoformat(timespec="seconds")


def load_env(path: Path = ENV_PATH) -> dict[str, str]:
    env: dict[str, str] = {}
    if path.exists():
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            value = value.strip().strip('"').strip("'")
            env[key.strip()] = value
    for key in ("KITE_API_KEY", "KITE_API_SECRET", "KITE_ACCESS_TOKEN", "KITE_USER_ID"):
        if os.environ.get(key):
            env[key] = os.environ[key]
    return env


def write_env_value(key: str, value: str, path: Path = ENV_PATH) -> None:
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    found = False
    updated: list[str] = []
    for line in lines:
        if line.startswith(f"{key}="):
            updated.append(f"{key}={value}")
            found = True
        else:
            updated.append(line)
    if not found:
        updated.append(f"{key}={value}")
    path.write_text("\n".join(updated).rstrip() + "\n", encoding="utf-8")


def require_env(env: dict[str, str], keys: list[str]) -> None:
    missing = [key for key in keys if not env.get(key)]
    if missing:
        joined = ", ".join(missing)
        raise KiteError(f"Missing {joined}. Copy .env.example to .env and fill it locally.")


def kite_headers(env: dict[str, str], auth: bool = True) -> dict[str, str]:
    headers = {
        "X-Kite-Version": "3",
        "User-Agent": "local-nse-bse-analysis-agent/1.0",
    }
    if auth:
        require_env(env, ["KITE_API_KEY", "KITE_ACCESS_TOKEN"])
        headers["Authorization"] = f"token {env['KITE_API_KEY']}:{env['KITE_ACCESS_TOKEN']}"
    return headers


def request_json(
    method: str,
    path: str,
    env: dict[str, str],
    params: dict[str, Any] | list[tuple[str, str]] | None = None,
    data: dict[str, str] | None = None,
    auth: bool = True,
) -> dict[str, Any]:
    url = f"{KITE_BASE}{path}"
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    body = urllib.parse.urlencode(data).encode("utf-8") if data else None
    headers = kite_headers(env, auth=auth)
    if data:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise KiteError(f"Kite API HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise KiteError(f"Kite API network error: {exc.reason}") from exc


def request_text(path: str, env: dict[str, str], auth: bool = True) -> str:
    req = urllib.request.Request(f"{KITE_BASE}{path}", headers=kite_headers(env, auth=auth))
    try:
        with urllib.request.urlopen(req, timeout=45) as response:
            return response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise KiteError(f"Kite API HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise KiteError(f"Kite API network error: {exc.reason}") from exc


def cmd_login_url(args: argparse.Namespace) -> int:
    env = load_env()
    require_env(env, ["KITE_API_KEY"])
    query = urllib.parse.urlencode({"v": "3", "api_key": env["KITE_API_KEY"]})
    print(f"{KITE_LOGIN}?{query}")
    return 0


def cmd_session(args: argparse.Namespace) -> int:
    env = load_env()
    require_env(env, ["KITE_API_KEY", "KITE_API_SECRET"])
    checksum = hashlib.sha256(
        f"{env['KITE_API_KEY']}{args.request_token}{env['KITE_API_SECRET']}".encode("utf-8")
    ).hexdigest()
    payload = {
        "api_key": env["KITE_API_KEY"],
        "request_token": args.request_token,
        "checksum": checksum,
    }
    response = request_json("POST", "/session/token", env, data=payload, auth=False)
    data = response.get("data") or {}
    access_token = data.get("access_token")
    if not access_token:
        raise KiteError(f"No access_token in response: {json.dumps(response, indent=2)}")
    if args.save_env:
        write_env_value("KITE_ACCESS_TOKEN", access_token)
        print("Saved KITE_ACCESS_TOKEN to .env")
    else:
        print(access_token)
    return 0


def instrument_cache_path(exchange: str) -> Path:
    return CACHE_DIR / f"instruments_{exchange.upper()}.csv"


def download_instruments(exchange: str, env: dict[str, str], refresh: bool) -> list[dict[str, str]]:
    exchange = exchange.upper()
    path = instrument_cache_path(exchange)
    if refresh or not path.exists():
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        text = request_text(f"/instruments/{exchange}", env, auth=True)
        path.write_text(text, encoding="utf-8")
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def split_symbol(symbol: str) -> tuple[str | None, str]:
    item = symbol.strip().upper()
    if ":" in item:
        exchange, tradingsymbol = item.split(":", 1)
        return exchange, tradingsymbol
    return None, item


def resolve_symbols(symbols: list[str], env: dict[str, str], refresh_instruments: bool) -> tuple[list[dict[str, str]], list[str]]:
    instruments: dict[str, list[dict[str, str]]] = {}
    resolved: list[dict[str, str]] = []
    errors: list[str] = []

    def by_exchange(exchange: str) -> list[dict[str, str]]:
        if exchange not in instruments:
            instruments[exchange] = download_instruments(exchange, env, refresh_instruments)
        return instruments[exchange]

    for symbol in symbols:
        requested_exchange, tradingsymbol = split_symbol(symbol)
        exchanges = [requested_exchange] if requested_exchange else ["NSE", "BSE"]
        match: dict[str, str] | None = None
        for exchange in [item for item in exchanges if item]:
            rows = by_exchange(exchange)
            match = next((row for row in rows if row.get("tradingsymbol", "").upper() == tradingsymbol), None)
            if match:
                resolved.append(
                    {
                        "input": symbol,
                        "exchange": exchange,
                        "tradingsymbol": match.get("tradingsymbol", tradingsymbol),
                        "instrument_token": match.get("instrument_token", ""),
                        "name": match.get("name", ""),
                        "segment": match.get("segment", ""),
                        "instrument_type": match.get("instrument_type", ""),
                        "lot_size": match.get("lot_size", ""),
                        "tick_size": match.get("tick_size", ""),
                        "kite_key": f"{exchange}:{match.get('tradingsymbol', tradingsymbol)}",
                    }
                )
                break
        if not match:
            fallback_exchange = requested_exchange or "NSE"
            errors.append(f"Could not resolve {symbol}; using {fallback_exchange}:{tradingsymbol} for quote only.")
            resolved.append(
                {
                    "input": symbol,
                    "exchange": fallback_exchange,
                    "tradingsymbol": tradingsymbol,
                    "instrument_token": "",
                    "name": "",
                    "segment": "",
                    "instrument_type": "",
                    "lot_size": "",
                    "tick_size": "",
                    "kite_key": f"{fallback_exchange}:{tradingsymbol}",
                }
            )
    return resolved, errors


def compact_quote(raw: dict[str, Any]) -> dict[str, Any]:
    ohlc = raw.get("ohlc") or {}
    depth = raw.get("depth") or {}
    return {
        "last_price": raw.get("last_price"),
        "last_trade_time": raw.get("last_trade_time"),
        "volume": raw.get("volume"),
        "average_price": raw.get("average_price"),
        "buy_quantity": raw.get("buy_quantity"),
        "sell_quantity": raw.get("sell_quantity"),
        "net_change": raw.get("net_change"),
        "lower_circuit_limit": raw.get("lower_circuit_limit"),
        "upper_circuit_limit": raw.get("upper_circuit_limit"),
        "ohlc": {
            "open": ohlc.get("open"),
            "high": ohlc.get("high"),
            "low": ohlc.get("low"),
            "close": ohlc.get("close"),
        },
        "depth": {
            "buy": depth.get("buy", [])[:3],
            "sell": depth.get("sell", [])[:3],
        },
    }


def fetch_quotes(keys: list[str], env: dict[str, str]) -> dict[str, Any]:
    if not keys:
        return {}
    params = [("i", key) for key in keys]
    response = request_json("GET", "/quote", env, params=params, auth=True)
    data = response.get("data") or {}
    return {key: compact_quote(value) for key, value in data.items()}


def fetch_candles(instrument_token: str, days: int, env: dict[str, str]) -> list[dict[str, Any]]:
    today = dt.date.today()
    start = today - dt.timedelta(days=days)
    params = {
        "from": start.isoformat(),
        "to": today.isoformat(),
    }
    response = request_json(
        "GET",
        f"/instruments/historical/{instrument_token}/day",
        env,
        params=params,
        auth=True,
    )
    candles = response.get("data", {}).get("candles", [])
    return [
        {
            "date": row[0],
            "open": row[1],
            "high": row[2],
            "low": row[3],
            "close": row[4],
            "volume": row[5],
        }
        for row in candles
    ]


def compact_holding(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "tradingsymbol": row.get("tradingsymbol"),
        "exchange": row.get("exchange"),
        "isin": row.get("isin"),
        "quantity": row.get("quantity"),
        "average_price": row.get("average_price"),
        "last_price": row.get("last_price"),
        "pnl": row.get("pnl"),
        "product": row.get("product"),
        "collateral_quantity": row.get("collateral_quantity"),
        "t1_quantity": row.get("t1_quantity"),
    }


def fetch_holdings(env: dict[str, str]) -> list[dict[str, Any]]:
    response = request_json("GET", "/portfolio/holdings", env, auth=True)
    return [compact_holding(row) for row in response.get("data", [])]


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def cmd_refresh(args: argparse.Namespace) -> int:
    env = load_env()
    require_env(env, ["KITE_API_KEY", "KITE_ACCESS_TOKEN"])
    symbols = args.symbols or ["NSE:ENGINERSIN", "BSE:SAMRATPH", "BSE:REGANTO"]
    resolved, errors = resolve_symbols(symbols, env, args.refresh_instruments)
    quote_keys = [item["kite_key"] for item in resolved]
    quotes = fetch_quotes(quote_keys, env)

    candles: dict[str, list[dict[str, Any]]] = {}
    for item in resolved:
        token = item.get("instrument_token")
        if not token:
            continue
        try:
            candles[item["kite_key"]] = fetch_candles(token, args.days, env)
        except KiteError as exc:
            errors.append(f"Could not fetch candles for {item['kite_key']}: {exc}")

    holdings: list[dict[str, Any]] = []
    if args.include_holdings:
        try:
            holdings = fetch_holdings(env)
        except KiteError as exc:
            errors.append(f"Could not fetch holdings: {exc}")

    snapshot = {
        "provider": "kite_connect",
        "generated_at": now_iso(),
        "symbols": resolved,
        "quotes": quotes,
        "candles": candles,
        "holdings": holdings,
        "errors": errors,
        "source_urls": {
            "kite_connect_docs": "https://kite.trade/docs/connect/v3/",
            "market_quotes": "https://kite.trade/docs/connect/v3/market-quotes/",
            "historical": "https://kite.trade/docs/connect/v3/historical/",
            "portfolio": "https://kite.trade/docs/connect/v3/portfolio/",
        },
    }

    output = Path(args.output).resolve() if args.output else CACHE_DIR / "latest.json"
    write_json(output, snapshot)
    if args.app_output:
        write_json(Path(args.app_output).resolve(), snapshot)
    else:
        write_json(APP_SNAPSHOT, snapshot)
    print(f"Wrote {output}")
    print(f"Wrote {APP_SNAPSHOT}")
    if errors:
        print("Completed with warnings:")
        for error in errors:
            print(f"- {error}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Refresh local NSE/BSE market data from Kite Connect.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    login = subparsers.add_parser("login-url", help="Print the Kite login URL for the configured API key.")
    login.set_defaults(func=cmd_login_url)

    session = subparsers.add_parser("session", help="Exchange a request_token for an access_token.")
    session.add_argument("--request-token", required=True)
    session.add_argument("--save-env", action="store_true", help="Write KITE_ACCESS_TOKEN into .env.")
    session.set_defaults(func=cmd_session)

    refresh = subparsers.add_parser("refresh", help="Fetch quotes, daily candles, and optionally holdings.")
    refresh.add_argument("--symbols", nargs="*", help="Symbols such as NSE:ENGINERSIN BSE:SAMRATPH.")
    refresh.add_argument("--days", type=int, default=365, help="Daily candle lookback.")
    refresh.add_argument("--include-holdings", action="store_true")
    refresh.add_argument("--refresh-instruments", action="store_true")
    refresh.add_argument("--output", help="Snapshot output path. Defaults to data/cache/kite/latest.json.")
    refresh.add_argument(
        "--app-output",
        default=str(APP_SNAPSHOT),
        help="React app snapshot path. Defaults to react-day1/public/stock-data/latest.json.",
    )
    refresh.set_defaults(func=cmd_refresh)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return args.func(args)
    except KiteError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
