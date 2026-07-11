#!/usr/bin/env python3
"""Run the reproducible Unsloth QLoRA bake-off on Colab or Kaggle."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


APP_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_ROOT = APP_ROOT / "data" / "training" / "provider"
DEFAULT_OUTPUT_ROOT = APP_ROOT / "data" / "generated" / "gemma_bakeoff"
MODEL_CONFIGS = {
    "gemma4-e4b": {
        "model": "unsloth/gemma-4-E4B-it",
        "chatTemplate": "gemma-4",
        "ggufQuantization": "Q8_0",
    },
    "gemma4-12b": {
        "model": "unsloth/gemma-4-12B-it",
        "chatTemplate": "gemma-4",
        "ggufQuantization": "Q8_0",
    },
}


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        raise RuntimeError(f"Dataset file does not exist: {path}")
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def dataset_hash(paths: list[Path]) -> str:
    digest = hashlib.sha256()
    for path in paths:
        digest.update(path.name.encode("utf-8"))
        digest.update(path.read_bytes())
    return digest.hexdigest()


def validate_rows(rows: list[dict[str, Any]], expected: int, split: str) -> dict[str, Any]:
    errors: list[str] = []
    for index, row in enumerate(rows):
        messages = row.get("messages")
        if not isinstance(messages, list) or [message.get("role") for message in messages] != ["system", "user", "assistant"]:
            errors.append(f"row {index}: messages must be system/user/assistant")
        if row.get("split") != split:
            errors.append(f"row {index}: expected split {split!r}, found {row.get('split')!r}")
        if not row.get("lineageId"):
            errors.append(f"row {index}: lineageId is missing")
    if len(rows) != expected:
        errors.append(f"expected {expected} rows, found {len(rows)}")
    return {"rows": len(rows), "errors": errors}


def dry_run(data_root: Path, final: bool) -> dict[str, Any]:
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
    lineage_overlap = sorted({row["lineageId"] for row in train_rows} & {row["lineageId"] for row in validation_rows})
    errors = [*train_result["errors"], *validation_result["errors"]]
    if lineage_overlap:
        errors.append(f"lineage leakage between train and validation: {lineage_overlap[:12]}")
    return {
        "train": train_result["rows"],
        "validation": validation_result["rows"],
        "lineageOverlap": lineage_overlap,
        "datasetHash": dataset_hash([train_path, validation_path]),
        "errors": errors,
    }


def message_text(tokenizer: Any, messages: list[dict[str, Any]]) -> str:
    return tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=False).removeprefix("<bos>")


def run_training(args: argparse.Namespace) -> dict[str, Any]:
    validation = dry_run(args.data_root, args.final)
    if validation["errors"]:
        raise RuntimeError("Dataset gate failed: " + "; ".join(validation["errors"]))
    try:
        import torch
        from datasets import Dataset
        from trl import SFTConfig, SFTTrainer
        from unsloth import FastModel
        from unsloth.chat_templates import get_chat_template, train_on_responses_only
    except ImportError as exc:
        raise RuntimeError("Training requires a CUDA Colab/Kaggle runtime with unsloth, datasets, transformers, and trl installed.") from exc

    config = MODEL_CONFIGS[args.model]
    train_name = "train.jsonl" if args.final else "pilot_train.jsonl"
    validation_name = "validation.jsonl" if args.final else "pilot_validation.jsonl"
    train_rows = read_jsonl(args.data_root / train_name)
    validation_rows = read_jsonl(args.data_root / validation_name)
    model, tokenizer = FastModel.from_pretrained(
        model_name=config["model"],
        max_seq_length=args.max_seq_length,
        dtype=None,
        load_in_4bit=True,
        full_finetuning=False,
    )
    tokenizer = get_chat_template(tokenizer, chat_template=config["chatTemplate"])
    token_lengths = [
        len(tokenizer(message_text(tokenizer, row["messages"]), add_special_tokens=True)["input_ids"])
        for row in [*train_rows, *validation_rows]
    ]
    maximum_tokens = max(token_lengths)
    if maximum_tokens > args.max_seq_length:
        raise RuntimeError(
            f"No-truncation gate failed: dataset needs {maximum_tokens} tokens but max_seq_length is {args.max_seq_length}."
        )

    model = FastModel.get_peft_model(
        model,
        finetune_vision_layers=False,
        finetune_language_layers=True,
        finetune_attention_modules=True,
        finetune_mlp_modules=True,
        r=args.lora_rank,
        lora_alpha=args.lora_rank,
        lora_dropout=0,
        bias="none",
        random_state=args.seed,
    )

    def dataset(rows: list[dict[str, Any]]) -> Any:
        return Dataset.from_list([{"text": message_text(tokenizer, row["messages"])} for row in rows])

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=dataset(train_rows),
        eval_dataset=dataset(validation_rows),
        args=SFTConfig(
            dataset_text_field="text",
            per_device_train_batch_size=1,
            per_device_eval_batch_size=1,
            gradient_accumulation_steps=args.gradient_accumulation,
            num_train_epochs=args.epochs,
            learning_rate=args.learning_rate,
            warmup_ratio=0.05,
            logging_steps=1,
            eval_strategy="epoch",
            save_strategy="epoch",
            save_total_limit=2,
            optim="adamw_8bit",
            weight_decay=0.001,
            lr_scheduler_type="linear",
            seed=args.seed,
            report_to="none",
            output_dir=str(args.output_root / args.model / "checkpoints"),
        ),
    )
    response_marker = "<|turn>model\n"
    instruction_marker = "<|turn>user\n"
    trainer = train_on_responses_only(trainer, instruction_part=instruction_marker, response_part=response_marker)
    result = trainer.train()

    output = args.output_root / args.model
    adapter = output / "adapter"
    adapter.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(str(adapter))
    tokenizer.save_pretrained(str(adapter))
    gguf_path = ""
    if args.export_gguf:
        gguf = output / "gguf"
        model.save_pretrained_gguf(str(gguf), tokenizer, quantization_method=args.quantization or config["ggufQuantization"])
        gguf_path = str(gguf)
    manifest = {
        "schemaVersion": "gemma-bakeoff-run.v1",
        "candidate": args.model,
        "baseModel": config["model"],
        "datasetHash": validation["datasetHash"],
        "finalDataset": args.final,
        "trainRows": validation["train"],
        "validationRows": validation["validation"],
        "maximumSequenceTokens": maximum_tokens,
        "maxSequenceLength": args.max_seq_length,
        "loraRank": args.lora_rank,
        "epochs": args.epochs,
        "learningRate": args.learning_rate,
        "gradientAccumulation": args.gradient_accumulation,
        "seed": args.seed,
        "trainLoss": finite_metric(getattr(result, "training_loss", None)),
        "adapterPath": str(adapter),
        "ggufPath": gguf_path,
        "createdAt": datetime.now(UTC).isoformat(),
        "cudaDevice": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "unavailable",
    }
    output.mkdir(parents=True, exist_ok=True)
    (output / "run_manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def finite_metric(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--model", choices=sorted(MODEL_CONFIGS), default="gemma4-e4b")
    result.add_argument("--data-root", type=Path, default=DEFAULT_DATA_ROOT)
    result.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    result.add_argument("--final", action="store_true", help="Use the final 900/150 files instead of the 75/15 pilot.")
    result.add_argument("--dry-run", action="store_true")
    result.add_argument("--max-seq-length", type=int, default=6144)
    result.add_argument("--lora-rank", type=int, choices=(8, 16), default=16)
    result.add_argument("--epochs", type=int, choices=(1, 2), default=2)
    result.add_argument("--learning-rate", type=float, default=2e-4)
    result.add_argument("--gradient-accumulation", type=int, default=8)
    result.add_argument("--seed", type=int, default=560)
    result.add_argument("--export-gguf", action="store_true")
    result.add_argument("--quantization", default="")
    return result


def main() -> int:
    args = parser().parse_args()
    payload = dry_run(args.data_root, args.final) if args.dry_run else run_training(args)
    print(json.dumps(payload, indent=2))
    return 0 if not payload.get("errors") else 1


if __name__ == "__main__":
    raise SystemExit(main())
