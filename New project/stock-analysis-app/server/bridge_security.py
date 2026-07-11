from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Callable


def _b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


class SlidingWindowLimiter:
    def __init__(self, clock: Callable[[], float] = time.time) -> None:
        self.clock = clock
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str, limit: int, window_seconds: int = 60) -> bool:
        if limit <= 0:
            return False
        now = self.clock()
        cutoff = now - window_seconds
        with self._lock:
            events = self._events[key]
            while events and events[0] <= cutoff:
                events.popleft()
            if len(events) >= limit:
                return False
            events.append(now)
            if len(self._events) > 4096:
                stale_keys = [candidate for candidate, values in self._events.items() if not values or values[-1] <= cutoff]
                for candidate in stale_keys[:1024]:
                    self._events.pop(candidate, None)
            return True


@dataclass(frozen=True)
class AuthResult:
    ok: bool
    code: str
    session_id: str = ""
    expires_at: int = 0


class BridgeSecurity:
    def __init__(
        self,
        access_code: str = "",
        token_secret: str | bytes = b"",
        token_ttl_seconds: int = 12 * 60 * 60,
        requests_per_minute: int = 90,
        session_attempts_per_minute: int = 10,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.access_code = access_code
        self.token_secret = (
            token_secret.encode("utf-8")
            if isinstance(token_secret, str) and token_secret
            else token_secret
            if isinstance(token_secret, bytes) and token_secret
            else secrets.token_bytes(32)
        )
        self.token_ttl_seconds = max(300, token_ttl_seconds)
        self.requests_per_minute = max(1, requests_per_minute)
        self.session_attempts_per_minute = max(1, session_attempts_per_minute)
        self.clock = clock
        self.limiter = SlidingWindowLimiter(clock)

    @classmethod
    def from_env(cls) -> "BridgeSecurity":
        return cls(
            access_code=os.environ.get("BRIDGE_GROUP_ACCESS_CODE", "").strip(),
            token_secret=os.environ.get("BRIDGE_TOKEN_SECRET", "").strip(),
            token_ttl_seconds=int(os.environ.get("BRIDGE_TOKEN_TTL_SECONDS", str(12 * 60 * 60))),
            requests_per_minute=int(os.environ.get("BRIDGE_RATE_LIMIT_PER_MINUTE", "90")),
            session_attempts_per_minute=int(os.environ.get("BRIDGE_SESSION_ATTEMPTS_PER_MINUTE", "10")),
        )

    @property
    def enabled(self) -> bool:
        return bool(self.access_code)

    def allow_session_attempt(self, client_ip: str) -> bool:
        return self.limiter.allow(f"session:{client_ip}", self.session_attempts_per_minute)

    def allow_request(self, session_id: str, client_ip: str) -> bool:
        identity = session_id or client_ip
        return self.limiter.allow(f"request:{identity}", self.requests_per_minute)

    def issue_token(self, supplied_code: str) -> dict[str, int | str | bool]:
        if not self.enabled:
            return {"authRequired": False, "token": "", "expiresAt": 0}
        if not hmac.compare_digest(supplied_code.encode("utf-8"), self.access_code.encode("utf-8")):
            raise ValueError("invalid_access_code")
        now = int(self.clock())
        payload = {
            "v": 1,
            "sid": secrets.token_urlsafe(12),
            "iat": now,
            "exp": now + self.token_ttl_seconds,
        }
        encoded = _b64url_encode(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8"))
        signature = _b64url_encode(hmac.new(self.token_secret, encoded.encode("ascii"), hashlib.sha256).digest())
        return {
            "authRequired": True,
            "token": f"{encoded}.{signature}",
            "expiresAt": payload["exp"],
        }

    def validate_authorization(self, authorization: str | None) -> AuthResult:
        if not self.enabled:
            return AuthResult(True, "auth_disabled", "local")
        if not authorization or not authorization.startswith("Bearer "):
            return AuthResult(False, "missing_token")
        token = authorization.removeprefix("Bearer ").strip()
        try:
            encoded, supplied_signature = token.split(".", 1)
            expected_signature = _b64url_encode(
                hmac.new(self.token_secret, encoded.encode("ascii"), hashlib.sha256).digest()
            )
            if not hmac.compare_digest(supplied_signature, expected_signature):
                return AuthResult(False, "invalid_token")
            payload = json.loads(_b64url_decode(encoded).decode("utf-8"))
            expires_at = int(payload.get("exp") or 0)
            if int(payload.get("v") or 0) != 1 or expires_at <= int(self.clock()):
                return AuthResult(False, "expired_token")
            session_id = str(payload.get("sid") or "")
            if not session_id:
                return AuthResult(False, "invalid_token")
            return AuthResult(True, "ok", session_id, expires_at)
        except (ValueError, TypeError, json.JSONDecodeError, UnicodeDecodeError):
            return AuthResult(False, "invalid_token")
