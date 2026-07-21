#!/usr/bin/env python3
"""Convert and serve a qualified Gemma artifact through loopback-only MLX-LM."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import subprocess
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

APP_ROOT = Path(__file__).resolve().parents[1]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from tools.gemma_bakeoff import current_git_commit, sha256_file, write_json_atomic
from tools.mlx_convert_compat import shared_kv_compatibility


MINIMUM_MLX_LM_VERSION = (0, 31, 3)


def version_tuple(value: str) -> tuple[int, ...]:
    pieces: list[int] = []
    for piece in value.split("."):
        digits = "".join(character for character in piece if character.isdigit())
        if not digits:
            break
        pieces.append(int(digits))
    return tuple(pieces)


def require_mlx_lm() -> str:
    try:
        version = importlib.metadata.version("mlx-lm")
    except importlib.metadata.PackageNotFoundError as exc:
        raise RuntimeError("MLX-LM is not installed. Install current mlx-lm on Apple Silicon first.") from exc
    if version_tuple(version) < MINIMUM_MLX_LM_VERSION:
        required = ".".join(str(piece) for piece in MINIMUM_MLX_LM_VERSION)
        raise RuntimeError(f"MLX-LM {required} or newer is required for Gemma 4; found {version}.")
    return version


def tree_hash(root: Path) -> str:
    if not root.is_dir():
        raise RuntimeError(f"Model directory does not exist: {root}")
    files = sorted(path for path in root.rglob("*") if path.is_file())
    if not files:
        raise RuntimeError(f"Model directory contains no files: {root}")
    digest = hashlib.sha256()
    for path in files:
        digest.update(str(path.relative_to(root)).encode("utf-8"))
        digest.update(sha256_file(path).encode("ascii"))
    return digest.hexdigest()


def conversion_command(source: Path, output: Path, bits: int) -> list[str]:
    return [
        sys.executable,
        str(APP_ROOT / "tools" / "mlx_convert_compat.py"),
        "--hf-path",
        str(source),
        "--mlx-path",
        str(output),
        "--q-bits",
        str(bits),
    ]


def server_command(model: Path, port: int) -> list[str]:
    return [
        sys.executable,
        "-m",
        "mlx_lm",
        "server",
        "--model",
        str(model),
        "--host",
        "127.0.0.1",
        "--port",
        str(port),
        "--prompt-concurrency",
        "1",
        "--decode-concurrency",
        "1",
    ]


def convert(args: argparse.Namespace) -> dict[str, Any]:
    version = require_mlx_lm()
    source = args.merged_hf.expanduser().resolve()
    output = args.output.expanduser().resolve()
    run_manifest_path = args.run_manifest.expanduser().resolve()
    if not run_manifest_path.is_file():
        raise RuntimeError(f"Gemma run manifest does not exist: {run_manifest_path}")
    run_manifest = json.loads(run_manifest_path.read_text(encoding="utf-8"))
    if run_manifest.get("status") != "complete":
        raise RuntimeError("Gemma run manifest is not complete.")
    expected_source_hash = str((run_manifest.get("artifactTreeHashes") or {}).get("mergedHf") or "")
    if not expected_source_hash:
        raise RuntimeError("Gemma run manifest does not contain artifactTreeHashes.mergedHf.")
    source_hash = tree_hash(source)
    if source_hash != expected_source_hash:
        raise RuntimeError(f"Merged-model hash mismatch: expected {expected_source_hash}, found {source_hash}")
    if output.exists():
        raise RuntimeError(f"MLX output already exists; use a new versioned path: {output}")
    compatibility = shared_kv_compatibility(source, getattr(args, "adapter", None))
    command = conversion_command(source, output, args.bits)
    if args.dry_run:
        return {
            "status": "dry-run",
            "sourceHash": source_hash,
            "runManifest": str(run_manifest_path),
            "mlxLmVersion": version,
            "compatibility": compatibility,
            "command": command,
        }
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = output.parent / f".{output.name}.build-{uuid.uuid4().hex}"
    staging_command = conversion_command(source, staging, args.bits)
    subprocess.run(staging_command, check=True)
    artifact_hash = tree_hash(staging)
    manifest = {
        "schemaVersion": "mlx-runtime-artifact.v1",
        "status": "complete",
        "source": str(source),
        "sourceHash": source_hash,
        "sourceRunManifest": str(run_manifest_path),
        "sourceRunName": str(run_manifest.get("runName") or ""),
        "model": str(output),
        "modelArtifactHash": artifact_hash,
        "quantization": f"MLX-{args.bits}bit",
        "mlxLmVersion": version,
        "compatibility": compatibility,
        "conversionCommand": staging_command,
        "gitCommit": current_git_commit(),
        "createdAt": datetime.now(UTC).isoformat(),
    }
    write_json_atomic(staging / "runtime_manifest.json", manifest)
    staging.replace(output)
    return manifest


def serve(args: argparse.Namespace) -> dict[str, Any]:
    version = require_mlx_lm()
    model = args.model.expanduser().resolve()
    artifact_hash = tree_hash(model)
    manifest_path = model / "runtime_manifest.json"
    if not manifest_path.is_file():
        raise RuntimeError("MLX runtime_manifest.json is required before serving a model artifact.")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"MLX runtime_manifest.json is invalid: {exc}") from exc
    required = {
        "status": manifest.get("status"),
        "modelArtifactHash": manifest.get("modelArtifactHash"),
        "quantization": manifest.get("quantization"),
        "sourceRunName": manifest.get("sourceRunName"),
    }
    missing = [key for key, value in required.items() if not value]
    if manifest.get("status") != "complete" or missing:
        raise RuntimeError(f"MLX runtime manifest is not qualified; missing or invalid fields: {missing}")
    recorded = str(manifest["modelArtifactHash"])
    # The manifest itself is added after the recorded model hash is calculated.
    hash_without_manifest = tree_hash_without(model, {manifest_path})
    if recorded != hash_without_manifest:
        raise RuntimeError("MLX artifact files no longer match runtime_manifest.json.")
    artifact_hash = recorded
    command = server_command(model, args.port)
    if args.dry_run:
        return {
            "status": "dry-run",
            "modelArtifactHash": artifact_hash,
            "mlxLmVersion": version,
            "baseUrl": f"http://127.0.0.1:{args.port}/v1",
            "command": command,
        }
    subprocess.run(command, check=True)
    return {"status": "stopped", "modelArtifactHash": artifact_hash}


def tree_hash_without(root: Path, excluded: set[Path]) -> str:
    files = sorted(path for path in root.rglob("*") if path.is_file() and path not in excluded)
    if not files:
        raise RuntimeError(f"Model directory contains no model files: {root}")
    digest = hashlib.sha256()
    for path in files:
        digest.update(str(path.relative_to(root)).encode("utf-8"))
        digest.update(sha256_file(path).encode("ascii"))
    return digest.hexdigest()


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    commands = result.add_subparsers(dest="command", required=True)
    convert_parser = commands.add_parser("convert")
    convert_parser.add_argument("--merged-hf", type=Path, required=True)
    convert_parser.add_argument("--run-manifest", type=Path, required=True)
    convert_parser.add_argument("--adapter", type=Path)
    convert_parser.add_argument("--output", type=Path, required=True)
    convert_parser.add_argument("--bits", type=int, choices=(4, 6, 8), default=8)
    convert_parser.add_argument("--dry-run", action="store_true")
    serve_parser = commands.add_parser("serve")
    serve_parser.add_argument("--model", type=Path, required=True)
    serve_parser.add_argument("--port", type=int, default=8080)
    serve_parser.add_argument("--dry-run", action="store_true")
    return result


def main() -> int:
    args = parser().parse_args()
    payload = convert(args) if args.command == "convert" else serve(args)
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
