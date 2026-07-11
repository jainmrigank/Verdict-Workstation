from __future__ import annotations

import unittest

from server.bridge_security import BridgeSecurity


class MutableClock:
    def __init__(self, now: float = 1_000.0) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now


class BridgeSecurityTests(unittest.TestCase):
    def test_disabled_auth_accepts_local_request_without_token(self) -> None:
        security = BridgeSecurity(access_code="")
        result = security.validate_authorization(None)
        self.assertTrue(result.ok)
        self.assertEqual(result.code, "auth_disabled")

    def test_correct_code_issues_a_valid_expiring_token(self) -> None:
        clock = MutableClock()
        security = BridgeSecurity(access_code="shared", token_secret="test-secret", clock=clock)
        session = security.issue_token("shared")
        result = security.validate_authorization(f"Bearer {session['token']}")
        self.assertTrue(result.ok)
        self.assertTrue(result.session_id)
        self.assertEqual(result.expires_at, session["expiresAt"])

    def test_wrong_code_and_tampered_token_are_rejected(self) -> None:
        security = BridgeSecurity(access_code="shared", token_secret="test-secret")
        with self.assertRaisesRegex(ValueError, "invalid_access_code"):
            security.issue_token("wrong")
        token = str(security.issue_token("shared")["token"])
        tampered = f"{token[:-1]}{'A' if token[-1] != 'A' else 'B'}"
        self.assertFalse(security.validate_authorization(f"Bearer {tampered}").ok)

    def test_expired_token_is_rejected(self) -> None:
        clock = MutableClock()
        security = BridgeSecurity(access_code="shared", token_secret="test-secret", token_ttl_seconds=300, clock=clock)
        token = str(security.issue_token("shared")["token"])
        clock.now += 301
        result = security.validate_authorization(f"Bearer {token}")
        self.assertFalse(result.ok)
        self.assertEqual(result.code, "expired_token")

    def test_request_and_session_limits_are_scoped(self) -> None:
        clock = MutableClock()
        security = BridgeSecurity(
            access_code="shared",
            requests_per_minute=2,
            session_attempts_per_minute=1,
            clock=clock,
        )
        self.assertTrue(security.allow_session_attempt("127.0.0.1"))
        self.assertFalse(security.allow_session_attempt("127.0.0.1"))
        self.assertTrue(security.allow_request("session-a", "127.0.0.1"))
        self.assertTrue(security.allow_request("session-a", "127.0.0.1"))
        self.assertFalse(security.allow_request("session-a", "127.0.0.1"))
        self.assertTrue(security.allow_request("session-b", "127.0.0.1"))


if __name__ == "__main__":
    unittest.main()
