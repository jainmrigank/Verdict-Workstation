#!/usr/bin/env python3
"""Commercially named entrypoint for the local market-data bridge."""

from __future__ import annotations

from free_data_server import main


if __name__ == "__main__":
    raise SystemExit(main())
