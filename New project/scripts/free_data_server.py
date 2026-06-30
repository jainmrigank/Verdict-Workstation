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

import free_data_refresh as data_refresh
from holdings_parser import holdings_to_symbols, parse_holdings_xlsx


UPLOAD_DIR = data_refresh.CACHE_DIR / "uploads"
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
SERVER_STARTED_AT = datetime.now(timezone.utc).isoformat()


def refresh_module():
    return importlib.reload(data_refresh)


def quote_command(command: list[str]) -> str:
    return " ".join(f'"{part}"' if " " in part else part for part in command)


def configured_allowed_origins() -> list[str]:
    return [origin.strip().rstrip("/") for origin in os.environ.get("MARKET_DATA_ALLOW_ORIGIN", "").split(",") if origin.strip()]


def is_private_origin(origin: str) -> bool:
    try:
        parsed = urlparse(origin)
        hostname = parsed.hostname
        if not hostname:
            return False
        if hostname in {"localhost", "127.0.0.1", "::1"}:
            return True
        ip = ipaddress.ip_address(hostname)
        return ip.is_private or ip.is_loopback
    except ValueError:
        return False


def allowed_origin(origin: str | None, allowed_origins: list[str]) -> str | None:
    if not origin:
        return None
    clean_origin = origin.rstrip("/")
    if "*" in allowed_origins or clean_origin in allowed_origins or is_private_origin(clean_origin):
        return clean_origin
    return None


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


class FreeDataHandler(BaseHTTPRequestHandler):
    server_version = "MarketDataServer/1.0"

    def log_message(self, format: str, *args: Any) -> None:
        print(f"{self.address_string()} - {format % args}")

    def _set_headers(self, status: int = 200, content_type: str = "application/json") -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        origin = allowed_origin(self.headers.get("Origin"), getattr(self.server, "allowed_origins", []))
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Days, X-Filename")
        self.end_headers()

    def _write_json(self, payload: dict[str, Any], status: int = 200) -> None:
        self._set_headers(status)
        self.wfile.write(json.dumps(payload, indent=2, sort_keys=True).encode("utf-8"))

    def do_OPTIONS(self) -> None:
        self._set_headers(204)

    def do_GET(self) -> None:
        if self.path == "/health":
            self._write_json(
                {
                    "ok": True,
                    "service": "market-data",
                    "server_version": self.server_version,
                    "started_at": SERVER_STARTED_AT,
                    "supports_restart": True,
                },
            )
            return
        if self.path == "/api/free-data/latest":
            latest = data_refresh.CACHE_DIR / "latest.json"
            if not latest.exists():
                self._write_json({"error": "No market-data cache yet"}, status=404)
                return
            self._set_headers(200)
            self.wfile.write(latest.read_bytes())
            return
        self._write_json({"error": "Not found"}, status=404)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
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
        self._write_json({"error": "Not found"}, status=404)

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
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length).decode("utf-8") if length else "{}"
            payload = json.loads(body or "{}")
            symbols = payload.get("symbols") or None
            if isinstance(symbols, str):
                symbols = symbols.split()
            days = int(payload.get("days") or 730)
            include_holdings = bool(payload.get("includeHoldings", True))
            module = refresh_module()
            snapshot = module.refresh_free_data(
                symbols=symbols,
                days=days,
                include_holdings=include_holdings,
                return_holdings=include_holdings,
            )
            self._write_json(snapshot)
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

            UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
            (UPLOAD_DIR / "latest_holdings_upload.xlsx").write_bytes(data)
            module = refresh_module()
            module.write_json(module.HOLDINGS_PATH, holdings)
            snapshot = module.refresh_free_data(symbols=symbols, days=days, include_holdings=True)
            snapshot["upload"] = {
                "filename": filename,
                "holdings_count": len(holdings),
                "symbols": symbols,
            }
            module.write_json(module.CACHE_DIR / "latest.json", snapshot)
            module.write_json(module.APP_SNAPSHOT, snapshot)
            self._write_json(snapshot)
        except Exception as exc:
            self._write_json({"error": str(exc)}, status=500)

    def _handle_portfolio_clear(self) -> None:
        try:
            module = refresh_module()
            module.write_json(module.HOLDINGS_PATH, [])
            upload_path = UPLOAD_DIR / "latest_holdings_upload.xlsx"
            if upload_path.exists():
                upload_path.unlink()
            self._write_json({"ok": True, "message": "Uploaded holdings feed cleared."})
        except Exception as exc:
            self._write_json({"error": str(exc)}, status=500)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the local market-data refresh server.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument(
        "--allow-origin",
        action="append",
        default=configured_allowed_origins(),
        help="Extra browser origin allowed to call this bridge, e.g. https://your-public-app.example",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        server = ThreadingHTTPServer((args.host, args.port), FreeDataHandler)
        server.allowed_origins = args.allow_origin
    except OSError as exc:
        if getattr(exc, "errno", None) in {errno.EADDRINUSE, errno.EPERM}:
            print(
                f"Could not start the market-data server on port {args.port}. The port may already be in use, or this shell may not be allowed to bind it. "
                "Use the app's Restart Server button, stop the old terminal process with Ctrl+C, or choose another port with --port.",
            )
            return 1
        raise
    print(f"Market data server listening on http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Stopping market data server.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
