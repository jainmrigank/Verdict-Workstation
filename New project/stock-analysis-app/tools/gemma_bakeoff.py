#!/usr/bin/env python3
"""Run a reproducible, resumable Unsloth QLoRA bake-off on Colab."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import inspect
import json
import math
import platform
import re
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


APP_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_ROOT = APP_ROOT / "data" / "training" / "provider"
DEFAULT_OUTPUT_ROOT = APP_ROOT / "data" / "generated" / "gemma_bakeoff"
DEFAULT_EVALUATION_SEAL = APP_ROOT / "data" / "training" / "evaluation_seal.json"
REQUIREMENTS_PATH = APP_ROOT / "notebooks" / "gemma_bakeoff_requirements.txt"
PILOT_DATASET_HASH = "6a374ec58b9fd134de5cf1ccdeda33384ba24c02935c4af2b3e3d8a6bbd75c09"
SEQUENCE_HEADROOM = 128
SEQUENCE_MULTIPLE = 256
PACKAGE_NAMES = ("accelerate", "bitsandbytes", "datasets", "peft", "torch", "transformers", "trl", "unsloth")
MODEL_CONFIGS = {
    "gemma4-e4b": {
        # Pin the repository that FastModel actually loads. Passing the 16-bit
        # repository revision while Unsloth redirects to this 4-bit repository
        # makes the redirected config lookup use an unrelated commit hash.
        "model": "unsloth/gemma-4-E4B-it-unsloth-bnb-4bit",
        "chatTemplate": "gemma-4",
        "ggufQuantization": "Q8_0",
    },
    "gemma4-12b": {
        "model": "unsloth/gemma-4-12B-it",
        "chatTemplate": "gemma-4",
        "ggufQuantization": "Q8_0",
    },
}
RESPONSE_MARKER_CANDIDATES = (
    ("<start_of_turn>user\n", "<start_of_turn>model\n"),
    ("<|turn|>user\n", "<|turn|>model\n"),
    ("<|turn>user\n", "<|turn>model\n"),
)


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        raise RuntimeError(f"Dataset file does not exist: {path}")
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def dataset_hash(paths: list[Path]) -> str:
    digest = hashlib.sha256()
    for path in paths:
        digest.update(path.name.encode("utf-8"))
        digest.update(path.read_bytes())
    return digest.hexdigest()


def write_json_atomic(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def validate_rows(rows: list[dict[str, Any]], expected: int, split: str) -> dict[str, Any]:
    errors: list[str] = []
    ids: list[str] = []
    for index, row in enumerate(rows):
        messages = row.get("messages")
        if not isinstance(messages, list) or [message.get("role") for message in messages] != ["system", "user", "assistant"]:
            errors.append(f"row {index}: messages must be system/user/assistant")
        elif any(not isinstance(message.get("content"), str) or not message["content"].strip() for message in messages):
            errors.append(f"row {index}: every message must contain non-empty text")
        if row.get("split") != split:
            errors.append(f"row {index}: expected split {split!r}, found {row.get('split')!r}")
        if not row.get("lineageId"):
            errors.append(f"row {index}: lineageId is missing")
        if not row.get("id"):
            errors.append(f"row {index}: id is missing")
        else:
            ids.append(str(row["id"]))
    duplicate_ids = sorted({row_id for row_id in ids if ids.count(row_id) > 1})
    if duplicate_ids:
        errors.append(f"duplicate row IDs: {duplicate_ids[:12]}")
    if len(rows) != expected:
        errors.append(f"expected {expected} rows, found {len(rows)}")
    return {"rows": len(rows), "errors": errors}


def evaluation_ids(seal_path: Path) -> set[str]:
    if not seal_path.exists():
        raise RuntimeError(f"Evaluation seal does not exist: {seal_path}")
    payload = json.loads(seal_path.read_text(encoding="utf-8"))
    ids = payload.get("evaluationIds") or payload.get("ids") or []
    if not isinstance(ids, list) or not ids:
        raise RuntimeError(f"Evaluation seal contains no evaluation IDs: {seal_path}")
    return {str(row_id) for row_id in ids}


def dry_run(
    data_root: Path,
    final: bool,
    expected_dataset_hash: str = "",
    seal_path: Path = DEFAULT_EVALUATION_SEAL,
) -> dict[str, Any]:
    train_name = "train.jsonl" if final else "pilot_train.jsonl"
    validation_name = "validation.jsonl" if final else "pilot_validation.jsonl"
    expected_train = 900 if final else 75
    expected_validation = 150 if final else 15
    train_path = data_root / train_name
    validation_path = data_root / validation_name
    train_rows = read_jsonl(train_path)
    validation_rows = read_jsonl(validation_path)
    train_result = validate_rows(train_rows, expected_train, "train")
    validation_result = validate_rows(validation_rows, expected_validation, "validation")
    lineage_overlap = sorted({str(row.get("lineageId")) for row in train_rows} & {str(row.get("lineageId")) for row in validation_rows})
    sealed_ids = evaluation_ids(seal_path)
    supplied_ids = {
        str(value)
        for row in [*train_rows, *validation_rows]
        for value in (row.get("id"), row.get("lineageId"))
        if value
    }
    evaluation_overlap = sorted(supplied_ids & sealed_ids)
    observed_hash = dataset_hash([train_path, validation_path])
    errors = [*train_result["errors"], *validation_result["errors"]]
    if lineage_overlap:
        errors.append(f"lineage leakage between train and validation: {lineage_overlap[:12]}")
    if evaluation_overlap:
        errors.append(f"sealed evaluation rows are present in training inputs: {evaluation_overlap[:12]}")
    if expected_dataset_hash and observed_hash != expected_dataset_hash:
        errors.append(f"dataset hash mismatch: expected {expected_dataset_hash}, found {observed_hash}")
    return {
        "train": train_result["rows"],
        "validation": validation_result["rows"],
        "lineageOverlap": lineage_overlap,
        "evaluationOverlap": evaluation_overlap,
        "datasetHash": observed_hash,
        "expectedDatasetHash": expected_dataset_hash,
        "files": {
            train_name: sha256_file(train_path),
            validation_name: sha256_file(validation_path),
            seal_path.name: sha256_file(seal_path),
        },
        "errors": errors,
    }


def message_text(tokenizer: Any, messages: list[dict[str, Any]]) -> str:
    return tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=False).removeprefix("<bos>")


def rounded_sequence_length(maximum_tokens: int, headroom: int = SEQUENCE_HEADROOM, multiple: int = SEQUENCE_MULTIPLE) -> int:
    if maximum_tokens <= 0:
        raise ValueError("maximum_tokens must be positive")
    if headroom < 0 or multiple <= 0:
        raise ValueError("headroom must be non-negative and multiple must be positive")
    return math.ceil((maximum_tokens + headroom) / multiple) * multiple


def resolve_sequence_length(maximum_tokens: int, requested: int) -> int:
    required = rounded_sequence_length(maximum_tokens)
    if requested and requested < required:
        raise RuntimeError(
            f"No-truncation gate failed: rendered data needs {maximum_tokens} tokens plus {SEQUENCE_HEADROOM} headroom "
            f"({required} rounded), but max_seq_length is {requested}."
        )
    return requested or required


def detect_response_markers(texts: list[str]) -> tuple[str, str]:
    for instruction, response in RESPONSE_MARKER_CANDIDATES:
        if all(instruction in text and response in text for text in texts):
            return instruction, response
    raise RuntimeError("Response-only loss gate failed: the Gemma user/model turn markers were not found in every rendered row.")


def sft_sequence_kwargs(config_class: Any, sequence_length: int) -> dict[str, int]:
    parameters = inspect.signature(config_class).parameters
    if "max_length" in parameters:
        return {"max_length": sequence_length}
    if "max_seq_length" in parameters:
        return {"max_seq_length": sequence_length}
    raise RuntimeError("Installed TRL does not expose a supported SFT sequence-length setting; refusing possible truncation.")


def latest_checkpoint(checkpoint_root: Path) -> Path | None:
    checkpoints: list[tuple[int, Path]] = []
    if checkpoint_root.exists():
        for path in checkpoint_root.iterdir():
            match = re.fullmatch(r"checkpoint-(\d+)", path.name)
            if path.is_dir() and match:
                checkpoints.append((int(match.group(1)), path))
    return max(checkpoints, default=(0, None), key=lambda item: item[0])[1]


def resolve_resume_checkpoint(checkpoint_root: Path, resume: str) -> str | None:
    if resume == "none":
        return None
    if resume == "auto":
        checkpoint = latest_checkpoint(checkpoint_root)
        return str(checkpoint) if checkpoint else None
    checkpoint = Path(resume).expanduser().resolve()
    if not checkpoint.is_dir():
        raise RuntimeError(f"Requested checkpoint does not exist: {checkpoint}")
    resolved_root = checkpoint_root.expanduser().resolve()
    if checkpoint.parent != resolved_root or not re.fullmatch(r"checkpoint-\d+", checkpoint.name):
        raise RuntimeError("Explicit resume checkpoints must be a checkpoint-N directory inside this run's checkpoint root.")
    return str(checkpoint)


def default_run_name(args: argparse.Namespace) -> str:
    return f"{args.model}-r{args.lora_rank}-e{args.epochs}-seed{args.seed}"


def clean_run_name(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-.")
    if not cleaned:
        raise RuntimeError("Run name must contain at least one letter or number.")
    return cleaned


def current_git_commit() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=APP_ROOT, text=True, stderr=subprocess.DEVNULL
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return "unavailable"


def installed_versions() -> dict[str, str]:
    versions: dict[str, str] = {}
    for name in PACKAGE_NAMES:
        try:
            versions[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            versions[name] = "not-installed"
    return versions


def artifact_checksums(run_root: Path, roots: list[Path]) -> dict[str, str]:
    files: list[Path] = []
    for root in roots:
        if root.is_file():
            files.append(root)
        elif root.is_dir():
            files.extend(path for path in root.rglob("*") if path.is_file())
    return {str(path.relative_to(run_root)): sha256_file(path) for path in sorted(set(files))}


def directory_tree_hash(root: Path) -> str:
    if not root.is_dir():
        raise RuntimeError(f"Artifact directory does not exist: {root}")
    files = sorted(path for path in root.rglob("*") if path.is_file())
    if not files:
        raise RuntimeError(f"Artifact directory contains no files: {root}")
    digest = hashlib.sha256()
    for path in files:
        digest.update(str(path.relative_to(root)).encode("utf-8"))
        digest.update(sha256_file(path).encode("ascii"))
    return digest.hexdigest()


def verify_or_write_run_identity(path: Path, identity: dict[str, Any], checkpoint_root: Path) -> None:
    if path.exists():
        existing = json.loads(path.read_text(encoding="utf-8"))
        if existing != identity:
            differing = sorted(key for key in set(existing) | set(identity) if existing.get(key) != identity.get(key))
            raise RuntimeError(f"Checkpoint run identity mismatch: {differing}")
        return
    if latest_checkpoint(checkpoint_root):
        raise RuntimeError("Checkpoints exist without a run_identity.json; refusing an unverifiable resume.")
    write_json_atomic(path, identity)


def validate_completed_run(
    manifest: dict[str, Any], args: argparse.Namespace, validation: dict[str, Any], run_root: Path
) -> list[str]:
    errors: list[str] = []
    expected = {
        "status": "complete",
        "candidate": args.model,
        "datasetHash": validation["datasetHash"],
        "loraRank": args.lora_rank,
        "epochs": args.epochs,
        "learningRate": args.learning_rate,
        "gradientAccumulation": args.gradient_accumulation,
        "seed": args.seed,
        "quantization": args.quantization or MODEL_CONFIGS[args.model]["ggufQuantization"],
    }
    errors.extend(f"manifest mismatch: {key}" for key, value in expected.items() if manifest.get(key) != value)
    identity_path = run_root / "run_identity.json"
    if not identity_path.is_file():
        errors.append("run_identity.json is missing")
        identity: dict[str, Any] = {}
    else:
        identity = json.loads(identity_path.read_text(encoding="utf-8"))
        identity_expected = {
            "candidate": args.model,
            "datasetHash": validation["datasetHash"],
            "loraRank": args.lora_rank,
            "epochs": args.epochs,
            "learningRate": args.learning_rate,
            "gradientAccumulation": args.gradient_accumulation,
            "seed": args.seed,
            "gitCommit": current_git_commit(),
            "packages": installed_versions(),
            "trainingSourceHash": sha256_file(Path(__file__)),
            "requirementsHash": sha256_file(REQUIREMENTS_PATH),
        }
        errors.extend(
            f"run identity mismatch: {key}"
            for key, value in identity_expected.items()
            if identity.get(key) != value
        )
        for key in ("baseModel", "baseModelRevision", "datasetFiles", "maxSequenceLength", "responseMarkers"):
            if manifest.get(key) != identity.get(key):
                errors.append(f"manifest/run identity mismatch: {key}")
    path_fields = {"adapter": "adapterPath", "mergedHf": "mergedHfPath", "gguf": "ggufPath"}
    expected_trees = manifest.get("artifactTreeHashes") or {}
    checksum_roots: list[Path] = []
    for tree_name, field in path_fields.items():
        raw_path = str(manifest.get(field) or "")
        required = tree_name == "adapter" or (tree_name == "mergedHf" and args.export_merged_hf) or (tree_name == "gguf" and args.export_gguf)
        if not raw_path:
            if required:
                errors.append(f"completed run has no {field}")
            continue
        artifact = Path(raw_path).expanduser().resolve()
        try:
            artifact.relative_to(run_root.resolve())
        except ValueError:
            errors.append(f"{field} is outside the run directory")
            continue
        if not artifact.is_dir():
            errors.append(f"{field} does not exist")
            continue
        checksum_roots.append(artifact)
        try:
            if directory_tree_hash(artifact) != expected_trees.get(tree_name):
                errors.append(f"artifact tree hash mismatch: {tree_name}")
        except RuntimeError as exc:
            errors.append(str(exc))
    checksums_path = run_root / "checksums.json"
    metrics_path = run_root / "training_metrics.json"
    if metrics_path.is_file():
        checksum_roots.append(metrics_path.resolve())
    else:
        errors.append("training_metrics.json is missing")
    recomputed_hashes = artifact_checksums(run_root.resolve(), checksum_roots)
    if recomputed_hashes != (manifest.get("artifactHashes") or {}):
        errors.append("artifact file checksums no longer match run_manifest.json")
    if not checksums_path.is_file():
        errors.append("checksums.json is missing")
    elif json.loads(checksums_path.read_text(encoding="utf-8")) != (manifest.get("artifactHashes") or {}):
        errors.append("checksums.json does not match run_manifest.json")
    return errors


def _last_subsequence_end(values: list[int], needle: list[int]) -> int | None:
    if not needle:
        return None
    result: int | None = None
    for index in range(len(values) - len(needle) + 1):
        if values[index:index + len(needle)] == needle:
            result = index + len(needle)
    return result


def audit_response_masks(trainer: Any, tokenizer: Any | None = None, response_marker: str = "") -> dict[str, Any]:
    result: dict[str, Any] = {}
    marker_tokens = (
        list(tokenizer(response_marker, add_special_tokens=False)["input_ids"])
        if tokenizer is not None and response_marker
        else []
    )
    for name, dataset in (("train", trainer.train_dataset), ("validation", trainer.eval_dataset)):
        rows = len(dataset)
        active_tokens = 0
        masked_tokens = 0
        for index in range(rows):
            sample = dataset[index]
            labels = sample.get("labels")
            if labels is None:
                raise RuntimeError(f"Response-only loss audit failed: {name} row {index} has no labels.")
            values = labels.tolist() if hasattr(labels, "tolist") else list(labels)
            if values and isinstance(values[0], list):
                values = values[0]
            input_ids = sample.get("input_ids")
            token_values = input_ids.tolist() if hasattr(input_ids, "tolist") else list(input_ids or [])
            if token_values and isinstance(token_values[0], list):
                token_values = token_values[0]
            active_indices = [position for position, value in enumerate(values) if value != -100]
            active = len(active_indices)
            masked = sum(value == -100 for value in values)
            if active <= 0 or masked <= 0:
                raise RuntimeError(
                    f"Response-only loss audit failed: {name} row {index} has active={active}, masked={masked}."
                )
            first_active = active_indices[0]
            if any(value != -100 for value in values[:first_active]) or any(value == -100 for value in values[first_active:]):
                raise RuntimeError(f"Response-only loss audit failed: {name} row {index} is not one masked prompt plus active response suffix.")
            if token_values and any(values[position] != token_values[position] for position in active_indices):
                raise RuntimeError(f"Response-only loss audit failed: {name} row {index} active labels do not match assistant tokens.")
            if marker_tokens:
                marker_end = _last_subsequence_end(token_values, marker_tokens)
                if marker_end is None or marker_end != first_active:
                    raise RuntimeError(
                        f"Response-only loss audit failed: {name} row {index} starts at {first_active}, expected marker boundary {marker_end}."
                    )
            active_tokens += active
            masked_tokens += masked
        result[name] = {"rows": rows, "activeAssistantTokens": active_tokens, "maskedPromptTokens": masked_tokens}
    return result


def run_training_memory_probe(
    model: Any,
    tokenizer: Any,
    text: str,
    response_marker: str,
    torch: Any,
    bitsandbytes: Any,
    learning_rate: float,
) -> dict[str, Any]:
    encoded = tokenizer(text, return_tensors="pt", add_special_tokens=True)
    encoded = {key: value.to("cuda") for key, value in encoded.items()}
    labels = encoded["input_ids"].clone()
    sequence_tokens = int(encoded["input_ids"].shape[-1])
    response_end = text.index(response_marker) + len(response_marker)
    prefix_tokens = len(tokenizer(text[:response_end], add_special_tokens=True)["input_ids"])
    labels[:, :prefix_tokens] = -100
    assistant_tokens = int((labels != -100).sum().item())
    if assistant_tokens <= 0:
        raise RuntimeError("Training-step preflight found no assistant response labels in the longest row.")
    trainable = [parameter for parameter in model.parameters() if parameter.requires_grad]
    optimizer = bitsandbytes.optim.AdamW8bit(trainable, lr=learning_rate)
    model.train()
    torch.cuda.empty_cache()
    torch.cuda.reset_peak_memory_stats()
    output = model(**encoded, labels=labels)
    loss = output.loss
    loss.backward()
    optimizer.step()
    optimizer.zero_grad(set_to_none=True)
    peak_allocated = int(torch.cuda.max_memory_allocated())
    peak_reserved = int(torch.cuda.max_memory_reserved())
    model.zero_grad(set_to_none=True)
    del optimizer, output, loss, labels, encoded
    torch.cuda.empty_cache()
    return {
        "longestSequenceTokens": sequence_tokens,
        "assistantTokens": assistant_tokens,
        "maskedPromptTokens": prefix_tokens,
        "peakAllocatedBytes": peak_allocated,
        "peakReservedBytes": peak_reserved,
        "optimizer": "bitsandbytes.AdamW8bit",
        "forwardBackwardOptimizerStep": True,
    }


def finite_metric(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def attach_lora(FastModel: Any, model: Any, args: argparse.Namespace) -> Any:
    return FastModel.get_peft_model(
        model,
        finetune_vision_layers=False,
        finetune_language_layers=True,
        finetune_attention_modules=True,
        finetune_mlp_modules=True,
        r=args.lora_rank,
        lora_alpha=args.lora_rank,
        lora_dropout=0,
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=args.seed,
    )


def run_training(args: argparse.Namespace) -> dict[str, Any]:
    expected_hash = args.expected_dataset_hash
    validation = dry_run(args.data_root, args.final, expected_hash, args.evaluation_seal)
    if validation["errors"]:
        raise RuntimeError("Dataset gate failed: " + "; ".join(validation["errors"]))

    run_name = clean_run_name(args.run_name or default_run_name(args))
    run_root = args.output_root / run_name
    manifest_path = run_root / "run_manifest.json"
    if manifest_path.exists() and not args.preflight:
        existing = json.loads(manifest_path.read_text(encoding="utf-8"))
        completed_errors = validate_completed_run(existing, args, validation, run_root)
        if completed_errors:
            raise RuntimeError(f"Completed run {run_name!r} failed integrity checks: {'; '.join(completed_errors)}")
        return {**existing, "status": "already-complete"}

    try:
        from unsloth import FastModel
        from unsloth.chat_templates import get_chat_template, train_on_responses_only
        import bitsandbytes
        import torch
        from datasets import Dataset
        from huggingface_hub import HfApi
        from transformers import AutoTokenizer
        from trl import SFTConfig, SFTTrainer
    except ImportError as exc:
        raise RuntimeError(
            "Training requires a CUDA Colab/Kaggle runtime with unsloth, datasets, transformers, and trl installed."
        ) from exc
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA preflight failed: a CUDA accelerator is required for the Unsloth pilot.")

    config = MODEL_CONFIGS[args.model]
    preflight_path = run_root / "preflight_manifest.json"
    train_name = "train.jsonl" if args.final else "pilot_train.jsonl"
    validation_name = "validation.jsonl" if args.final else "pilot_validation.jsonl"
    train_rows = read_jsonl(args.data_root / train_name)
    validation_rows = read_jsonl(args.data_root / validation_name)
    existing_preflight = json.loads(preflight_path.read_text(encoding="utf-8")) if preflight_path.exists() else {}
    base_revision = str(
        args.base_revision
        or ((existing_preflight.get("environment") or {}).get("baseModelRevision") if not args.preflight else "")
        or HfApi().model_info(config["model"]).sha
        or ""
    )
    if not re.fullmatch(r"[0-9a-fA-F]{40,64}", base_revision):
        raise RuntimeError("Base-model revision must resolve to an immutable Hugging Face commit hash.")
    probe_tokenizer = AutoTokenizer.from_pretrained(config["model"], revision=base_revision)
    probe_tokenizer = get_chat_template(probe_tokenizer, chat_template=config["chatTemplate"])
    probe_texts = [message_text(probe_tokenizer, row["messages"]) for row in [*train_rows, *validation_rows]]
    token_lengths = [len(probe_tokenizer(text, add_special_tokens=True)["input_ids"]) for text in probe_texts]
    maximum_tokens = max(token_lengths)
    sequence_length = resolve_sequence_length(maximum_tokens, args.max_seq_length)

    model, tokenizer = FastModel.from_pretrained(
        model_name=config["model"],
        max_seq_length=sequence_length,
        dtype=None,
        load_in_4bit=True,
        full_finetuning=False,
        revision=base_revision,
    )
    tokenizer = get_chat_template(tokenizer, chat_template=config["chatTemplate"])
    texts = [message_text(tokenizer, row["messages"]) for row in [*train_rows, *validation_rows]]
    loaded_lengths = [len(tokenizer(text, add_special_tokens=True)["input_ids"]) for text in texts]
    if max(loaded_lengths) > sequence_length:
        raise RuntimeError(
            f"No-truncation gate failed after model load: {max(loaded_lengths)} tokens exceed {sequence_length}."
        )
    instruction_marker, response_marker = detect_response_markers(texts)
    observed_revision = str(
        getattr(getattr(model, "config", None), "_commit_hash", "")
        or getattr(tokenizer, "init_kwargs", {}).get("_commit_hash")
        or ""
    )
    if observed_revision and observed_revision != base_revision:
        raise RuntimeError(f"Loaded base-model revision {observed_revision} does not match requested {base_revision}.")
    environment = {
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "packages": installed_versions(),
        "gitCommit": current_git_commit(),
        "cudaVersion": str(torch.version.cuda or "unavailable"),
        "cudaDevice": torch.cuda.get_device_name(0),
        "cudaTotalMemoryBytes": int(torch.cuda.get_device_properties(0).total_memory),
        "baseModelRevision": base_revision,
    }
    preflight = {
        "schemaVersion": "gemma-bakeoff-preflight.v1",
        "status": "passed",
        "candidate": args.model,
        "baseModel": config["model"],
        "dataset": validation,
        "maximumSequenceTokens": maximum_tokens,
        "requiredSequenceLength": rounded_sequence_length(maximum_tokens),
        "resolvedSequenceLength": sequence_length,
        "responseMarkers": {"instruction": instruction_marker, "response": response_marker},
        "trainingConfiguration": {
            "loraRank": args.lora_rank,
            "epochs": args.epochs,
            "learningRate": args.learning_rate,
            "gradientAccumulation": args.gradient_accumulation,
            "seed": args.seed,
        },
        "trainingSourceHash": sha256_file(Path(__file__)),
        "requirementsHash": sha256_file(REQUIREMENTS_PATH),
        "environment": environment,
        "createdAt": datetime.now(UTC).isoformat(),
    }
    if args.preflight:
        model = attach_lora(FastModel, model, args)
        longest_text = texts[max(range(len(loaded_lengths)), key=loaded_lengths.__getitem__)]
        preflight["trainingStep"] = run_training_memory_probe(
            model,
            tokenizer,
            longest_text,
            response_marker,
            torch,
            bitsandbytes,
            args.learning_rate,
        )
        preflight["status"] = "training-step-passed"
        write_json_atomic(preflight_path, preflight)
        return preflight
    required_preflight = {
        "status": "training-step-passed",
        "candidate": args.model,
        "baseModel": config["model"],
        "maximumSequenceTokens": maximum_tokens,
        "resolvedSequenceLength": sequence_length,
        "responseMarkers": preflight["responseMarkers"],
        "trainingConfiguration": preflight["trainingConfiguration"],
        "trainingSourceHash": preflight["trainingSourceHash"],
        "requirementsHash": preflight["requirementsHash"],
        "environment": environment,
    }
    preflight_errors = [
        key for key, value in required_preflight.items() if existing_preflight.get(key) != value
    ]
    if (existing_preflight.get("dataset") or {}).get("datasetHash") != validation["datasetHash"]:
        preflight_errors.append("datasetHash")
    if (existing_preflight.get("environment") or {}).get("baseModelRevision") != base_revision:
        preflight_errors.append("baseModelRevision")
    if not (existing_preflight.get("trainingStep") or {}).get("forwardBackwardOptimizerStep"):
        preflight_errors.append("trainingStep")
    if preflight_errors:
        raise RuntimeError(
            "Training requires a matching training-step preflight for this exact run: " + ", ".join(sorted(set(preflight_errors)))
        )

    model = attach_lora(FastModel, model, args)

    def dataset(rows: list[dict[str, Any]]) -> Any:
        return Dataset.from_list([{"text": message_text(tokenizer, row["messages"])} for row in rows])

    checkpoint_root = run_root / "checkpoints"
    run_identity = {
        "schemaVersion": "gemma-bakeoff-identity.v1",
        "candidate": args.model,
        "baseModel": config["model"],
        "baseModelRevision": base_revision,
        "datasetHash": validation["datasetHash"],
        "datasetFiles": validation["files"],
        "maxSequenceLength": sequence_length,
        "loraRank": args.lora_rank,
        "epochs": args.epochs,
        "learningRate": args.learning_rate,
        "gradientAccumulation": args.gradient_accumulation,
        "seed": args.seed,
        "responseMarkers": {"instruction": instruction_marker, "response": response_marker},
        "gitCommit": environment["gitCommit"],
        "packages": environment["packages"],
        "trainingSourceHash": sha256_file(Path(__file__)),
        "requirementsHash": sha256_file(REQUIREMENTS_PATH),
    }
    run_identity_path = run_root / "run_identity.json"
    verify_or_write_run_identity(run_identity_path, run_identity, checkpoint_root)
    sft_args = {
        "dataset_text_field": "text",
        "per_device_train_batch_size": 1,
        "per_device_eval_batch_size": 1,
        "gradient_accumulation_steps": args.gradient_accumulation,
        "num_train_epochs": args.epochs,
        "learning_rate": args.learning_rate,
        "warmup_ratio": 0.05,
        "logging_steps": 1,
        "eval_strategy": "epoch",
        "save_strategy": "epoch",
        "save_total_limit": 2,
        "optim": "adamw_8bit",
        "weight_decay": 0.001,
        "lr_scheduler_type": "linear",
        "seed": args.seed,
        "report_to": "none",
        "packing": False,
        "output_dir": str(checkpoint_root),
        **sft_sequence_kwargs(SFTConfig, sequence_length),
    }
    trainer_parameters = inspect.signature(SFTTrainer).parameters
    trainer_kwargs: dict[str, Any] = {
        "model": model,
        "train_dataset": dataset(train_rows),
        "eval_dataset": dataset(validation_rows),
        "args": SFTConfig(**sft_args),
    }
    trainer_kwargs["processing_class" if "processing_class" in trainer_parameters else "tokenizer"] = tokenizer
    trainer = SFTTrainer(**trainer_kwargs)
    trainer = train_on_responses_only(trainer, instruction_part=instruction_marker, response_part=response_marker)
    response_mask_audit = audit_response_masks(trainer, tokenizer, response_marker)
    resume_checkpoint = resolve_resume_checkpoint(checkpoint_root, args.resume)
    result = trainer.train(resume_from_checkpoint=resume_checkpoint)

    metrics_path = run_root / "training_metrics.json"
    metrics = {
        "trainLoss": finite_metric(getattr(result, "training_loss", None)),
        "logHistory": getattr(trainer.state, "log_history", []),
        "responseMaskAudit": response_mask_audit,
    }
    write_json_atomic(metrics_path, metrics)
    adapter = run_root / "adapter"
    adapter.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(str(adapter))
    tokenizer.save_pretrained(str(adapter))
    artifact_roots = [adapter, metrics_path]
    merged_path = ""
    if args.export_merged_hf:
        if not hasattr(model, "save_pretrained_merged"):
            raise RuntimeError("Installed Unsloth cannot export a merged Hugging Face model.")
        merged = run_root / "merged_hf"
        model.save_pretrained_merged(str(merged), tokenizer, save_method="merged_16bit")
        merged_path = str(merged)
        artifact_roots.append(merged)
    gguf_path = ""
    if args.export_gguf:
        gguf = run_root / "gguf"
        model.save_pretrained_gguf(
            str(gguf), tokenizer, quantization_method=args.quantization or config["ggufQuantization"]
        )
        gguf_path = str(gguf)
        artifact_roots.append(gguf)
    hashes = artifact_checksums(run_root, artifact_roots)
    tree_hashes = {"adapter": directory_tree_hash(adapter)}
    if merged_path:
        tree_hashes["mergedHf"] = directory_tree_hash(Path(merged_path))
    if gguf_path:
        tree_hashes["gguf"] = directory_tree_hash(Path(gguf_path))
    checksums_path = run_root / "checksums.json"
    write_json_atomic(checksums_path, hashes)
    manifest = {
        "schemaVersion": "gemma-bakeoff-run.v2",
        "status": "complete",
        "runName": run_name,
        "candidate": args.model,
        "baseModel": config["model"],
        "baseModelRevision": base_revision,
        "datasetHash": validation["datasetHash"],
        "datasetFiles": validation["files"],
        "finalDataset": args.final,
        "trainRows": validation["train"],
        "validationRows": validation["validation"],
        "maximumSequenceTokens": maximum_tokens,
        "maxSequenceLength": sequence_length,
        "loraRank": args.lora_rank,
        "epochs": args.epochs,
        "learningRate": args.learning_rate,
        "gradientAccumulation": args.gradient_accumulation,
        "seed": args.seed,
        "quantization": args.quantization or config["ggufQuantization"],
        "responseOnlyLoss": True,
        "responseMaskAudit": response_mask_audit,
        "trainLoss": metrics["trainLoss"],
        "resumedFromCheckpoint": resume_checkpoint or "",
        "latestCheckpoint": str(latest_checkpoint(checkpoint_root) or ""),
        "adapterPath": str(adapter),
        "mergedHfPath": merged_path,
        "ggufPath": gguf_path,
        "checksumsPath": str(checksums_path),
        "artifactHashes": hashes,
        "artifactTreeHashes": tree_hashes,
        "runIdentityPath": str(run_identity_path),
        "environment": environment,
        "completedAt": datetime.now(UTC).isoformat(),
    }
    write_json_atomic(manifest_path, manifest)
    return manifest


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--model", choices=sorted(MODEL_CONFIGS), default="gemma4-e4b")
    result.add_argument("--data-root", type=Path, default=DEFAULT_DATA_ROOT)
    result.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    result.add_argument("--evaluation-seal", type=Path, default=DEFAULT_EVALUATION_SEAL)
    result.add_argument("--expected-dataset-hash", default="")
    result.add_argument("--final", action="store_true", help="Use the final 900/150 files instead of the 75/15 pilot.")
    mode = result.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="Validate files without loading a model.")
    mode.add_argument("--preflight", action="store_true", help="Load the candidate and prove full-sequence GPU fit without training.")
    result.add_argument("--run-name", default="")
    result.add_argument("--max-seq-length", type=int, default=0, help="Zero derives a no-truncation length from the rendered dataset.")
    result.add_argument("--lora-rank", type=int, choices=(8, 16), default=16)
    result.add_argument("--epochs", type=int, choices=(1, 2), default=2)
    result.add_argument("--learning-rate", type=float, default=2e-4)
    result.add_argument("--gradient-accumulation", type=int, default=8)
    result.add_argument("--seed", type=int, default=560)
    result.add_argument("--base-revision", default="", help="Optional immutable Hugging Face model commit; preflight resolves and records it.")
    result.add_argument("--resume", default="auto", help="Use auto, none, or an explicit checkpoint directory.")
    result.add_argument("--export-merged-hf", action="store_true")
    result.add_argument("--export-gguf", action="store_true")
    result.add_argument("--quantization", default="")
    return result


def main() -> int:
    args = parser().parse_args()
    if not args.expected_dataset_hash and not args.final:
        args.expected_dataset_hash = PILOT_DATASET_HASH
    payload = (
        dry_run(args.data_root, args.final, args.expected_dataset_hash, args.evaluation_seal)
        if args.dry_run
        else run_training(args)
    )
    print(json.dumps(payload, indent=2))
    return 0 if not payload.get("errors") else 1


if __name__ == "__main__":
    raise SystemExit(main())
