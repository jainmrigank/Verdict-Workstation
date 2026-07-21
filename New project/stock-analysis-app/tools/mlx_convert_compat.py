#!/usr/bin/env python3
"""Convert Gemma checkpoints while rejecting unsafe shared-KV weight drops."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


SHARED_KV_WEIGHT = re.compile(
    r"(?:^|\.)language_model(?:\.model)?\.layers\.(?P<layer>\d+)\.self_attn\."
    r"(?P<projection>k_proj|v_proj|k_norm)\.weight$"
)
SHARED_KV_LORA_B = re.compile(
    r"(?:^|\.)language_model(?:\.model)?\.layers\.(?P<layer>\d+)\.self_attn\."
    r"(?P<projection>k_proj|v_proj)\.lora_B\.weight$"
)


def shared_kv_key(key: str, first_shared_layer: int, pattern: re.Pattern[str]) -> bool:
    match = pattern.search(key)
    return bool(match and int(match.group("layer")) >= first_shared_layer)


def shared_kv_configuration(source: Path) -> dict[str, int] | None:
    config_path = source / "config.json"
    if not config_path.is_file():
        return None
    config = json.loads(config_path.read_text(encoding="utf-8"))
    if config.get("model_type") != "gemma4":
        return None
    text_config = config.get("text_config") or {}
    layers = int(text_config.get("num_hidden_layers") or 0)
    shared = int(text_config.get("num_kv_shared_layers") or 0)
    if layers <= 0 or shared <= 0 or shared >= layers:
        return None
    return {"numHiddenLayers": layers, "numKvSharedLayers": shared, "firstSharedLayer": layers - shared}


def shared_kv_compatibility(source: Path, adapter: Path | None) -> dict[str, Any]:
    configuration = shared_kv_configuration(source)
    if configuration is None:
        return {"mode": "none"}
    if adapter is None:
        raise RuntimeError("Gemma 4 shared-KV conversion requires --adapter to prove dropped LoRA updates are zero.")
    adapter_weights = adapter / "adapter_model.safetensors"
    if not adapter_weights.is_file():
        raise RuntimeError(f"Gemma adapter weights do not exist: {adapter_weights}")

    try:
        from safetensors import safe_open
    except ImportError as exc:
        raise RuntimeError("Shared-KV verification requires safetensors in the MLX environment.") from exc

    first_shared_layer = configuration["firstSharedLayer"]
    dropped_weights: list[str] = []
    for weights_path in sorted(source.glob("*.safetensors")):
        with safe_open(weights_path, framework="np") as weights:
            dropped_weights.extend(
                key for key in weights.keys() if shared_kv_key(key, first_shared_layer, SHARED_KV_WEIGHT)
            )
    if not dropped_weights:
        return {**configuration, "mode": "native", "droppedWeightCount": 0}

    observed_lora_b: list[str] = []
    nonzero_lora_b: list[str] = []
    with safe_open(adapter_weights, framework="np") as weights:
        for key in weights.keys():
            if not shared_kv_key(key, first_shared_layer, SHARED_KV_LORA_B):
                continue
            observed_lora_b.append(key)
            tensor = weights.get_tensor(key)
            if bool((tensor != 0).any()):
                nonzero_lora_b.append(key)
    if nonzero_lora_b:
        raise RuntimeError(
            "Refusing to drop shared-KV projections with nonzero trained adapter updates: "
            + ", ".join(nonzero_lora_b[:8])
        )
    if not observed_lora_b:
        raise RuntimeError("Shared-KV projections are present, but no corresponding LoRA-B tensors were audited.")

    expected_layers = set(range(first_shared_layer, configuration["numHiddenLayers"]))
    observed_layers = {
        int(match.group("layer"))
        for key in observed_lora_b
        if (match := SHARED_KV_LORA_B.search(key)) is not None
    }
    if observed_layers != expected_layers:
        raise RuntimeError("Shared-KV LoRA audit does not cover every shared layer.")
    return {
        **configuration,
        "mode": "drop-canonical-unused-projections",
        "droppedWeightCount": len(dropped_weights),
        "auditedZeroLoraBCount": len(observed_lora_b),
        "adapterWeights": str(adapter_weights.resolve()),
    }


def install_gemma4_shared_kv_sanitizer() -> None:
    from mlx_lm.models import gemma4

    original = gemma4.Model.sanitize

    def sanitize(model: Any, weights: dict[str, Any]) -> dict[str, Any]:
        sanitized = original(model, weights)
        args = model.language_model.args
        first_shared_layer = int(args.num_hidden_layers) - int(args.num_kv_shared_layers)
        if first_shared_layer <= 0:
            return sanitized
        return {
            key: value
            for key, value in sanitized.items()
            if not shared_kv_key(key, first_shared_layer, SHARED_KV_WEIGHT)
        }

    gemma4.Model.sanitize = sanitize


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hf-path", type=Path, required=True)
    parser.add_argument("--mlx-path", type=Path, required=True)
    parser.add_argument("--q-bits", type=int, choices=(4, 6, 8), required=True)
    args = parser.parse_args()

    install_gemma4_shared_kv_sanitizer()
    from mlx_lm.convert import convert

    convert(
        hf_path=str(args.hf_path),
        mlx_path=str(args.mlx_path),
        quantize=True,
        q_bits=args.q_bits,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
