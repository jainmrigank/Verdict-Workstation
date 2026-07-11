#!/usr/bin/env python3
"""Validate and optionally submit a Gemini Flash Vertex tuning job."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parents[1]


def line_count(path: Path) -> int:
    return sum(1 for line in path.read_text(encoding="utf-8").splitlines() if line.strip())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--region", default="us-central1")
    parser.add_argument("--training-uri", required=True, help="GCS URI for the 900-row training JSONL.")
    parser.add_argument("--validation-uri", required=True, help="GCS URI for the 150-row validation JSONL.")
    parser.add_argument("--display-name", default="stock-analysis-agent-v1")
    parser.add_argument(
        "--source-model",
        default=os.environ.get("VERTEX_SOURCE_MODEL", "gemini-2.5-flash"),
        help="Vertex model that supports supervised tuning. Defaults to the documented Gemini 2.5 Flash model.",
    )
    parser.add_argument("--submit", action="store_true")
    args = parser.parse_args()

    split_root = APP_ROOT / "data" / "training" / "vertex"
    expected = {"train.jsonl": 900, "validation.jsonl": 150, "eval.jsonl": 150}
    actual = {name: line_count(split_root / name) if (split_root / name).exists() else 0 for name in expected}
    if actual != expected:
        raise SystemExit(f"Training split gate failed. Expected {expected}, found {actual}.")

    command = [
        "gcloud", "ai", "tuning-jobs", "create",
        f"--region={args.region}",
        f"--source-model={args.source_model}",
        f"--training-dataset-uri={args.training_uri}",
        f"--validation-dataset-uri={args.validation_uri}",
        f"--tuned-model-display-name={args.display_name}",
    ]
    print(json.dumps({"validatedSplits": actual, "command": command, "submitted": args.submit}, indent=2))
    if args.submit:
        subprocess.run(command, check=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
