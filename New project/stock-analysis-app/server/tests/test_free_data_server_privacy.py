from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


SERVER_PATH = Path(__file__).resolve().parents[3] / "scripts" / "free_data_server.py"
sys.path.insert(0, str(SERVER_PATH.parent))
SPEC = importlib.util.spec_from_file_location("free_data_server_privacy_test", SERVER_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Could not load {SERVER_PATH}")
FREE_DATA_SERVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FREE_DATA_SERVER)


class FreeDataServerPrivacyTests(unittest.TestCase):
    def test_public_snapshot_strips_personal_portfolio_fields(self) -> None:
        snapshot = {
            "provider": "free_public_sources",
            "quotes": {"NSE:TEST": {"ltp": 100}},
            "holdings": [{"tradingsymbol": "TEST", "quantity": 10}],
            "upload": {"filename": "private.xlsx", "holdings_count": 1},
        }
        public = FREE_DATA_SERVER.sanitise_public_snapshot(snapshot)
        self.assertEqual(public["holdings"], [])
        self.assertNotIn("upload", public)
        self.assertEqual(public["quotes"], snapshot["quotes"])

    def test_arbitrary_private_lan_origin_is_not_implicitly_allowed(self) -> None:
        allowed = ["https://verdict.example"]
        self.assertIsNone(FREE_DATA_SERVER.allowed_origin("http://192.168.1.20:5173", allowed))
        self.assertEqual(
            FREE_DATA_SERVER.allowed_origin("http://127.0.0.1:5173", allowed),
            "http://127.0.0.1:5173",
        )
        self.assertEqual(
            FREE_DATA_SERVER.allowed_origin("https://verdict.example", allowed),
            "https://verdict.example",
        )


if __name__ == "__main__":
    unittest.main()
