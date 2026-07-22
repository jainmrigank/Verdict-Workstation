from __future__ import annotations

import argparse
import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from tools.gemma_bakeoff import (
    COMPACT_ANALYSIS_PROMPT_VERSION,
    MAX_COMPACT_OUTPUT_TOKENS,
    MODEL_CONFIGS,
    PILOT_OUTPUT_CONTRACT,
    align_gemma4_projection_dtype,
    artifact_checksums,
    audit_response_masks,
    configure_pytorch_allocator,
    detect_response_markers,
    directory_tree_hash,
    dry_run,
    finalize_existing_run,
    gemma4_activation_dtype,
    gemma4_projection_dtype_state,
    latest_checkpoint,
    prepare_lora_model,
    qualification_output_errors,
    qualification_report_errors,
    qualification_rows,
    require_candidate_hardware,
    resolve_resume_checkpoint,
    resolve_sequence_length,
    resolved_gguf_artifact,
    rounded_sequence_length,
    sha256_file,
    token_ids,
    tokenize_text,
    validate_completed_run,
    verify_or_write_run_identity,
)
from tools.model_bakeoff_eval import (
    EVALUATOR_VERSION,
    SECTION_ARRAYS,
    TransientProviderError,
    call_chat,
    compare,
    compatibility_errors,
    completeness,
    evaluate_response,
    generation_binding,
    generation_profile,
    human_review_summary,
    non_company_applicability_errors,
    parse_training_facts,
    percentile95,
    provider_settings,
    response_content_hash,
    response_needs_retry,
    reusable_responses,
    run as run_bakeoff,
    sealed_eval_authorization,
    verify_sealed_provider_rows,
)
from tools.mlx_convert_compat import (
    SHARED_KV_LORA_B,
    SHARED_KV_WEIGHT,
    shared_kv_configuration,
    shared_kv_compatibility,
    shared_kv_key,
)
from tools.prepare_mlx_runtime import convert as convert_mlx, conversion_command, serve as serve_mlx, server_command, tree_hash, version_tuple
from tools.teacher_bakeoff import run as run_teacher_bakeoff


def training_row(index: int, split: str) -> dict:
    return {
        "id": f"row-{split}-{index}",
        "lineageId": f"lineage-{split}-{index}",
        "split": split,
        "messages": [
            {"role": "system", "content": "system"},
            {"role": "user", "content": "{}"},
            {"role": "assistant", "content": "{}"},
        ],
        "metadata": {},
    }


def compact_training_row(index: int, split: str) -> dict:
    item = ["Use the supplied evidence.", "u", ["deterministicAnalysis.verdict"], ["rule-one"]]
    step = ["Evidence", "Implication", "Action", "u", ["deterministicAnalysis.verdict"], ["rule-one"]]
    response = {
        "schemaVersion": PILOT_OUTPUT_CONTRACT,
        "decision": {
            "summary": "Wait and Watch",
            "nextActions": [item],
            "avoid": [item],
            "priceDrivers": [item],
            "risks": [item],
            "dataGaps": [],
        },
        "chart": {
            "summary": "Chart",
            "trend": [item],
            "momentum": [],
            "volume": [],
            "volatility": [],
            "levels": [],
            "patterns": [],
        },
        "company": {
            "summary": "Company",
            "businessModel": [item],
            "quality": [],
            "profitability": [],
            "balanceSheet": [],
            "cashFlow": [],
            "valuation": [],
            "sectorDrivers": [],
            "catalysts": [],
            "risks": [],
            "dataGaps": [],
        },
        "portfolio": {
            "summary": "Portfolio",
            "positionFit": [item],
            "concentration": [],
            "sizing": [],
            "holdingActions": [item],
            "risks": [],
        },
        "reasoning": {"steps": [step, step, step]},
        "coach": {
            "verdictSummary": "Wait and Watch",
            "chartSummary": "Chart",
            "companySummary": "Company",
            "questionsBeforeAction": [item, item, item],
        },
        "warnings": [],
    }
    row = training_row(index, split)
    row["messages"][2]["content"] = json.dumps(response)
    row["metadata"] = {
        "promptVersion": COMPACT_ANALYSIS_PROMPT_VERSION,
        "outputContract": PILOT_OUTPUT_CONTRACT,
    }
    return row


class ModelBakeoffTests(unittest.TestCase):
    def test_evaluator_preserves_the_provider_rows_retrieved_rule_set(self) -> None:
        stored = {"schemaVersion": "retrieved-rule-set.v1", "mode": "hybrid", "rules": [{"id": "rule-one"}]}
        row = training_row(1, "validation")
        row["messages"][1]["content"] = json.dumps(
            {"facts": {"instrument": {"type": "equity"}}, "retrievedRuleSet": stored}
        )

        facts, rule_set = parse_training_facts(row)

        self.assertEqual(facts, {"instrument": {"type": "equity"}})
        self.assertEqual(rule_set, stored)

    def test_pytorch_allocator_defaults_to_expandable_segments(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(configure_pytorch_allocator(), "expandable_segments:True")
            self.assertEqual(os.environ["PYTORCH_ALLOC_CONF"], "expandable_segments:True")

    def test_pytorch_allocator_preserves_explicit_configuration(self) -> None:
        with patch.dict(os.environ, {"PYTORCH_ALLOC_CONF": "max_split_size_mb:128"}, clear=True):
            self.assertEqual(configure_pytorch_allocator(), "max_split_size_mb:128")

    def test_gemma_candidates_require_bfloat16_hardware(self) -> None:
        class UnsupportedCuda:
            class cuda:
                @staticmethod
                def is_bf16_supported() -> bool:
                    return False

                @staticmethod
                def get_device_name(_index: int) -> str:
                    return "Tesla T4"

        with self.assertRaisesRegex(RuntimeError, "Tesla T4 does not support BF16"):
            require_candidate_hardware("gemma3-4b", MODEL_CONFIGS["gemma3-4b"], UnsupportedCuda())

    def test_bfloat16_hardware_passes_candidate_gate(self) -> None:
        class SupportedCuda:
            class cuda:
                @staticmethod
                def is_bf16_supported() -> bool:
                    return True

        require_candidate_hardware("gemma4-e4b", MODEL_CONFIGS["gemma4-e4b"], SupportedCuda())

    def test_gemma4_activation_dtype_uses_bfloat16_on_l4_class_hardware(self) -> None:
        class Torch:
            bfloat16 = "bfloat16"
            float32 = "float32"

            class cuda:
                @staticmethod
                def is_bf16_supported() -> bool:
                    return True

        self.assertEqual(gemma4_activation_dtype(Torch()), "bfloat16")

    def test_gemma4_activation_dtype_retains_float32_fallback(self) -> None:
        class Torch:
            bfloat16 = "bfloat16"
            float32 = "float32"

            class cuda:
                @staticmethod
                def is_bf16_supported() -> bool:
                    return False

        self.assertEqual(gemma4_activation_dtype(Torch()), "float32")

    def test_gemma4_projection_follows_embedding_dtype(self) -> None:
        class Weight:
            def __init__(self, dtype: str) -> None:
                self.dtype = dtype

        class Projection:
            def __init__(self) -> None:
                self.weight = Weight("float16")

            def to(self, *, dtype: str) -> "Projection":
                self.weight.dtype = dtype
                return self

        class Module:
            embed_tokens = type("Embedding", (), {"weight": Weight("float32")})()
            per_layer_model_projection = Projection()

        class Model:
            def named_modules(self) -> list[tuple[str, object]]:
                return [("model.language_model", Module())]

        model = Model()
        self.assertEqual(
            align_gemma4_projection_dtype(model),
            ["model.language_model.per_layer_model_projection"],
        )
        self.assertEqual(Module.per_layer_model_projection.weight.dtype, "float32")
        self.assertEqual(
            gemma4_projection_dtype_state(model),
            [
                {
                    "module": "model.language_model",
                    "embedding": "float32",
                    "projection": "float32",
                    "projectionType": "Projection",
                }
            ],
        )

    def test_gemma4_projection_alignment_runs_after_lora_preparation(self) -> None:
        class Weight:
            def __init__(self, dtype: str) -> None:
                self.dtype = dtype

        class Projection:
            def __init__(self) -> None:
                self.weight = Weight("float16")

            def to(self, *, dtype: str) -> "Projection":
                self.weight.dtype = dtype
                return self

        class Module:
            embed_tokens = type("Embedding", (), {"weight": Weight("float16")})()
            per_layer_model_projection = Projection()

        class Model:
            def named_modules(self) -> list[tuple[str, object]]:
                return [("model.language_model", Module())]

        class FastModel:
            kwargs: dict[str, object] = {}

            @staticmethod
            def get_peft_model(model: Model, **kwargs: object) -> Model:
                FastModel.kwargs = kwargs
                Module.embed_tokens.weight.dtype = "float32"
                return model

        model, adjustments = prepare_lora_model(
            FastModel(),
            Model(),
            argparse.Namespace(lora_rank=16, lora_targets="all", seed=560),
        )
        self.assertIsInstance(model, Model)
        self.assertEqual(adjustments, ["model.language_model.per_layer_model_projection"])
        self.assertEqual(Module.per_layer_model_projection.weight.dtype, "float32")
        self.assertTrue(FastModel.kwargs["finetune_mlp_modules"])

        prepare_lora_model(
            FastModel(),
            Model(),
            argparse.Namespace(lora_rank=8, lora_targets="attention", seed=560),
        )
        self.assertTrue(FastModel.kwargs["finetune_attention_modules"])
        self.assertFalse(FastModel.kwargs["finetune_mlp_modules"])

    def test_gemma4_projection_can_follow_float32_activation_dtype(self) -> None:
        class Weight:
            def __init__(self, dtype: str) -> None:
                self.dtype = dtype

        class Projection:
            def __init__(self) -> None:
                self.weight = Weight("float16")

            def to(self, *, dtype: str) -> "Projection":
                self.weight.dtype = dtype
                return self

        class Module:
            embed_tokens = type("Embedding", (), {"weight": Weight("float16")})()
            per_layer_model_projection = Projection()

        class Model:
            def named_modules(self) -> list[tuple[str, object]]:
                return [("model.language_model", Module())]

        model = Model()
        self.assertEqual(
            align_gemma4_projection_dtype(model, "float32"),
            ["model.language_model.per_layer_model_projection"],
        )
        self.assertEqual(Module.per_layer_model_projection.weight.dtype, "float32")

    def test_gemma4_ple_gate_and_projection_follow_activation_dtype(self) -> None:
        class Weight:
            def __init__(self) -> None:
                self.dtype = "float16"

        class Projection:
            def __init__(self) -> None:
                self.weight = Weight()

            def to(self, *, dtype: str) -> "Projection":
                self.weight.dtype = dtype
                return self

        class Layer:
            per_layer_input_gate = Projection()
            per_layer_projection = Projection()

        class Model:
            def named_modules(self) -> list[tuple[str, object]]:
                return [("model.language_model.layers.0", Layer())]

        self.assertEqual(
            align_gemma4_projection_dtype(Model(), "float32"),
            [
                "model.language_model.layers.0.per_layer_input_gate",
                "model.language_model.layers.0.per_layer_projection",
            ],
        )
        self.assertEqual(Layer.per_layer_input_gate.weight.dtype, "float32")
        self.assertEqual(Layer.per_layer_projection.weight.dtype, "float32")

    def test_tokenize_text_uses_multimodal_processor_text_keyword(self) -> None:
        class Processor:
            def __call__(self, *, text: str, **_kwargs: object) -> dict[str, list[int]]:
                return {"input_ids": [len(text)]}

        self.assertEqual(tokenize_text(Processor(), "analysis"), {"input_ids": [8]})

    def test_token_ids_flattens_multimodal_processor_batch_dimension(self) -> None:
        class Processor:
            def __call__(self, *, text: str, **_kwargs: object) -> dict[str, list[list[int]]]:
                return {"input_ids": [[len(text), 2, 3]]}

        self.assertEqual(token_ids(Processor(), "analysis"), [8, 2, 3])

    def test_small_gemma_candidates_pin_the_loaded_quantized_repository(self) -> None:
        self.assertEqual(
            MODEL_CONFIGS["gemma3-4b"]["model"],
            "unsloth/gemma-3-4b-it-unsloth-bnb-4bit",
        )
        self.assertEqual(MODEL_CONFIGS["gemma3-4b"]["chatTemplate"], "gemma-3")
        self.assertEqual(
            MODEL_CONFIGS["gemma4-e2b"]["model"],
            "unsloth/gemma-4-E2B-it-unsloth-bnb-4bit",
        )
        self.assertEqual(
            MODEL_CONFIGS["gemma4-e4b"]["model"],
            "unsloth/gemma-4-E4B-it-unsloth-bnb-4bit",
        )

    def test_teacher_bakeoff_checkpoints_candidate_without_mutating_baseline(self) -> None:
        baseline = {
            "id": "gold-one",
            "split": "train",
            "facts": {
                "userContext": {"action": "Buy"},
                "deterministicAnalysis": {"verdict": "Wait and Watch"},
                "uiOptions": {"patternsEnabled": False},
            },
            "retrievedRuleIds": [],
            "retrievedRuleSet": {"rules": []},
            "output": {"decision": {"summary": "Baseline"}},
        }
        candidate_output = {"decision": {"summary": "Candidate"}}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            gold_path = root / "gold.jsonl"
            gold_path.write_text(json.dumps(baseline) + "\n", encoding="utf-8")
            with (
                patch("tools.teacher_bakeoff.GOLD_PATH", gold_path),
                patch("tools.teacher_bakeoff.OUTPUT_ROOT", root / "reports"),
                patch("tools.teacher_bakeoff.generate_output", return_value=candidate_output),
                patch("tools.teacher_bakeoff.normalise_output_contract", side_effect=lambda output, _facts, _rules: output),
                patch("tools.teacher_bakeoff.row_audit_errors", return_value=[]),
            ):
                result = run_teacher_bakeoff("cerebras", 1, 0)
            stored_baseline = json.loads(gold_path.read_text(encoding="utf-8"))
            candidate_path = Path(result["candidatePath"])
            stored_candidate = json.loads(candidate_path.read_text(encoding="utf-8"))
        self.assertEqual(result["automatedPasses"], 1)
        self.assertEqual(stored_baseline["output"]["decision"]["summary"], "Baseline")
        self.assertEqual(stored_candidate["output"]["decision"]["summary"], "Candidate")
        self.assertEqual(stored_candidate["candidateTeacher"]["provider"], "cerebras")

    def test_pilot_dry_run_enforces_75_15_and_no_lineage_overlap(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, rows in (
                ("pilot_train.jsonl", [compact_training_row(index, "train") for index in range(75)]),
                ("pilot_validation.jsonl", [compact_training_row(index, "validation") for index in range(15)]),
            ):
                (root / name).write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
            result = dry_run(root, final=False)
        self.assertEqual(result["errors"], [])
        self.assertEqual(result["train"], 75)
        self.assertEqual(result["validation"], 15)

    def test_pilot_dry_run_rejects_hash_changes_and_sealed_rows(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            train = [compact_training_row(index, "train") for index in range(75)]
            validation = [compact_training_row(index, "validation") for index in range(15)]
            train[0]["id"] = "gold-nse-sbin-buy"
            for name, rows in (("pilot_train.jsonl", train), ("pilot_validation.jsonl", validation)):
                (root / name).write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
            result = dry_run(root, final=False, expected_dataset_hash="not-the-real-hash")
        self.assertIn("gold-nse-sbin-buy", result["evaluationOverlap"])
        self.assertTrue(any("dataset hash mismatch" in error for error in result["errors"]))
        self.assertTrue(any("sealed evaluation rows" in error for error in result["errors"]))

    def test_sequence_length_is_derived_with_headroom_and_never_truncated(self) -> None:
        self.assertEqual(rounded_sequence_length(6000), 6144)
        self.assertEqual(resolve_sequence_length(6000, 0), 6144)
        self.assertEqual(resolve_sequence_length(6000, 8192), 8192)
        with self.assertRaisesRegex(RuntimeError, "No-truncation gate failed"):
            resolve_sequence_length(6000, 6000)

    def test_qualification_smoke_uses_stable_five_three_subset(self) -> None:
        train = [training_row(index, "train") for index in range(8)]
        validation = [training_row(index, "validation") for index in range(5)]

        selected_train, selected_validation = qualification_rows(train, validation)

        self.assertEqual([row["id"] for row in selected_train], [f"row-train-{index}" for index in range(5)])
        self.assertEqual(
            [row["id"] for row in selected_validation],
            [f"row-validation-{index}" for index in range(3)],
        )

    def test_qualification_output_rejects_token_ceiling_before_schema_pass(self) -> None:
        errors = qualification_output_errors(
            compact_training_row(1, "validation"),
            "not-json",
            MAX_COMPACT_OUTPUT_TOKENS,
        )
        self.assertTrue(any("token ceiling" in error for error in errors))
        self.assertTrue(any("invalid response JSON" in error for error in errors))

    def test_qualification_report_must_bind_contract_and_all_eight_cases(self) -> None:
        args = argparse.Namespace(model="gemma4-e4b", lora_rank=16, lora_targets="all")
        report = {
            "status": "passed",
            "candidate": "gemma4-e4b",
            "datasetHash": "dataset",
            "outputContract": PILOT_OUTPUT_CONTRACT,
            "promptVersion": COMPACT_ANALYSIS_PROMPT_VERSION,
            "maxOutputTokens": MAX_COMPACT_OUTPUT_TOKENS,
            "loraRank": 16,
            "loraTargets": "all",
            "maxSteps": 30,
            "passedCases": 8,
            "totalCases": 8,
            "cases": [
                {"id": f"case-{index}", "schemaAndGroundingValid": True, "errors": []}
                for index in range(8)
            ],
        }
        self.assertEqual(qualification_report_errors(report, args, {"datasetHash": "dataset"}), [])
        report["cases"][0]["errors"] = ["bad schema"]
        self.assertTrue(qualification_report_errors(report, args, {"datasetHash": "dataset"}))

    def test_response_only_markers_are_detected_from_rendered_rows(self) -> None:
        texts = ["<start_of_turn>user\nQuestion<start_of_turn>model\nAnswer"]
        self.assertEqual(
            detect_response_markers(texts),
            ("<start_of_turn>user\n", "<start_of_turn>model\n"),
        )
        with self.assertRaisesRegex(RuntimeError, "Response-only loss gate failed"):
            detect_response_markers(["Question Answer"])

    def test_latest_checkpoint_selects_highest_completed_step(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "checkpoint-8").mkdir()
            (root / "checkpoint-16").mkdir()
            (root / "notes").mkdir()
            self.assertEqual(latest_checkpoint(root), root / "checkpoint-16")

    def test_checkpoint_identity_rejects_incompatible_resume(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            checkpoints = root / "checkpoints"
            identity_path = root / "run_identity.json"
            identity = {"datasetHash": "one", "learningRate": 0.001}
            verify_or_write_run_identity(identity_path, identity, checkpoints)
            verify_or_write_run_identity(identity_path, identity, checkpoints)
            with self.assertRaisesRegex(RuntimeError, "identity mismatch"):
                verify_or_write_run_identity(identity_path, {**identity, "learningRate": 0.002}, checkpoints)

    def test_explicit_resume_checkpoint_must_belong_to_current_run(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            checkpoints = root / "run" / "checkpoints"
            valid = checkpoints / "checkpoint-10"
            external = root / "other" / "checkpoint-10"
            valid.mkdir(parents=True)
            external.mkdir(parents=True)
            self.assertEqual(resolve_resume_checkpoint(checkpoints, str(valid)), str(valid.resolve()))
            with self.assertRaisesRegex(RuntimeError, "inside this run"):
                resolve_resume_checkpoint(checkpoints, str(external))

    def test_response_mask_audit_requires_prompt_and_assistant_tokens(self) -> None:
        class FakeTrainer:
            train_dataset = [{"labels": [-100, -100, 4, 5]}]
            eval_dataset = [{"labels": [-100, 7]}]

        result = audit_response_masks(FakeTrainer())
        self.assertEqual(result["train"]["activeAssistantTokens"], 2)
        FakeTrainer.eval_dataset = [{"labels": [-100, -100]}]
        with self.assertRaisesRegex(RuntimeError, "active=0"):
            audit_response_masks(FakeTrainer())
        FakeTrainer.eval_dataset = [{"labels": [4, -100, 7], "input_ids": [4, 5, 7]}]
        with self.assertRaisesRegex(RuntimeError, "active response suffix"):
            audit_response_masks(FakeTrainer())

    def test_artifact_checksums_and_tree_hash_change_with_content(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifact = root / "adapter"
            artifact.mkdir()
            weight = artifact / "weights.bin"
            weight.write_bytes(b"first")
            checksums = artifact_checksums(root, [artifact])
            first_hash = tree_hash(artifact)
            self.assertIn("adapter/weights.bin", checksums)
            weight.write_bytes(b"second")
            self.assertNotEqual(first_hash, tree_hash(artifact))

    def test_completed_run_revalidates_artifact_content(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            run_root = Path(directory) / "run"
            adapter = run_root / "adapter"
            adapter.mkdir(parents=True)
            weight = adapter / "weights.bin"
            weight.write_bytes(b"first")
            metrics = run_root / "training_metrics.json"
            metrics.write_text("{}", encoding="utf-8")
            hashes = artifact_checksums(run_root, [adapter, metrics])
            (run_root / "checksums.json").write_text(json.dumps(hashes), encoding="utf-8")
            validation = {"datasetHash": "dataset", "files": {}}
            args = argparse.Namespace(
                model="gemma4-e4b",
                lora_rank=16,
                lora_targets="all",
                epochs=2,
                learning_rate=2e-4,
                gradient_accumulation=8,
                seed=560,
                quantization="Q8_0",
                export_merged_hf=False,
                export_gguf=False,
            )
            identity = {
                "candidate": args.model,
                "baseModel": "unsloth/gemma-4-E4B-it-unsloth-bnb-4bit",
                "baseModelRevision": "a" * 40,
                "datasetHash": "dataset",
                "datasetFiles": {},
                "maxSequenceLength": 1024,
                "maximumAssistantTokens": 512,
                "maxOutputTokens": MAX_COMPACT_OUTPUT_TOKENS,
                "outputContract": PILOT_OUTPUT_CONTRACT,
                "promptVersion": COMPACT_ANALYSIS_PROMPT_VERSION,
                "loraRank": 16,
                "loraTargets": "all",
                "epochs": 2,
                "learningRate": 2e-4,
                "gradientAccumulation": 8,
                "seed": 560,
                "responseMarkers": {"instruction": "user", "response": "model"},
                "gitCommit": "commit",
                "packages": {"torch": "test"},
                "trainingSourceHash": sha256_file(Path("tools/gemma_bakeoff.py")),
                "requirementsHash": sha256_file(Path("notebooks/gemma_bakeoff_requirements.txt")),
            }
            (run_root / "run_identity.json").write_text(json.dumps(identity), encoding="utf-8")
            manifest = {
                **{key: identity[key] for key in (
                    "candidate", "baseModel", "baseModelRevision", "datasetHash", "datasetFiles", "maxSequenceLength",
                    "maximumAssistantTokens", "maxOutputTokens", "outputContract", "promptVersion",
                    "loraRank", "loraTargets", "epochs", "learningRate", "gradientAccumulation", "seed", "responseMarkers",
                )},
                "status": "complete",
                "quantization": "Q8_0",
                "adapterPath": str(adapter),
                "mergedHfPath": "",
                "ggufPath": "",
                "artifactHashes": hashes,
                "artifactTreeHashes": {"adapter": directory_tree_hash(adapter)},
                "environment": {
                    "gitCommit": identity["gitCommit"],
                    "packages": identity["packages"],
                    "baseModelRevision": identity["baseModelRevision"],
                },
            }
            with (
                patch("tools.gemma_bakeoff.current_git_commit", return_value="commit"),
                patch("tools.gemma_bakeoff.installed_versions", return_value={"torch": "test"}),
            ):
                self.assertEqual(validate_completed_run(manifest, args, validation, run_root), [])
                weight.write_bytes(b"tampered")
                self.assertTrue(validate_completed_run(manifest, args, validation, run_root))

    def test_interrupted_run_finalizer_records_actual_gguf_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output_root = Path(directory)
            run_name = "gemma4-e2b-r8-e2-seed560-attention"
            run_root = output_root / run_name
            adapter = run_root / "adapter"
            merged = run_root / "merged_hf"
            requested_gguf = run_root / "gguf"
            actual_gguf = run_root / "gguf_gguf"
            for artifact in (adapter, merged, requested_gguf, actual_gguf):
                artifact.mkdir(parents=True)
            (adapter / "adapter_model.safetensors").write_bytes(b"adapter")
            (merged / "model.safetensors").write_bytes(b"merged")
            (requested_gguf / "model.safetensors").write_bytes(b"placeholder")
            (actual_gguf / "model.Q8_0.gguf").write_bytes(b"gguf")
            (actual_gguf / "model.BF16-mmproj.gguf").write_bytes(b"projector")

            environment = {
                "gitCommit": "training-commit",
                "packages": {"torch": "test"},
                "baseModelRevision": "a" * 40,
            }
            identity = {
                "candidate": "gemma4-e2b",
                "baseModel": MODEL_CONFIGS["gemma4-e2b"]["model"],
                "baseModelRevision": environment["baseModelRevision"],
                "datasetHash": "dataset-hash",
                "datasetFiles": {"train": "train-hash", "validation": "validation-hash"},
                "maxSequenceLength": 8192,
                "maximumAssistantTokens": 3000,
                "maxOutputTokens": MAX_COMPACT_OUTPUT_TOKENS,
                "outputContract": PILOT_OUTPUT_CONTRACT,
                "promptVersion": COMPACT_ANALYSIS_PROMPT_VERSION,
                "loraRank": 8,
                "loraTargets": "attention",
                "epochs": 2,
                "learningRate": 2e-4,
                "gradientAccumulation": 8,
                "seed": 560,
                "responseMarkers": {"instruction": "user", "response": "model"},
                "gitCommit": environment["gitCommit"],
                "packages": environment["packages"],
                "trainingSourceHash": "source-hash",
                "requirementsHash": "requirements-hash",
            }
            preflight = {
                "status": "training-step-passed",
                "dataset": {
                    "datasetHash": "dataset-hash",
                    "files": identity["datasetFiles"],
                    "train": 75,
                    "validation": 15,
                    "errors": [],
                },
                "maximumSequenceTokens": 7000,
                "maximumAssistantTokens": identity["maximumAssistantTokens"],
                "trainingSourceHash": identity["trainingSourceHash"],
                "requirementsHash": identity["requirementsHash"],
                "environment": environment,
            }
            metrics = {
                "trainLoss": 0.0639,
                "responseMaskAudit": {
                    "train": {"activeAssistantTokens": 100},
                    "validation": {"activeAssistantTokens": 20},
                },
            }
            for name, payload in (
                ("run_identity.json", identity),
                ("preflight_manifest.json", preflight),
                ("training_metrics.json", metrics),
            ):
                (run_root / name).write_text(json.dumps(payload), encoding="utf-8")
            (run_root / "run_manifest.json").write_text(
                json.dumps({"status": "complete", "ggufPath": str(requested_gguf)}),
                encoding="utf-8",
            )

            args = argparse.Namespace(
                output_root=output_root,
                run_name=run_name,
                expected_dataset_hash="dataset-hash",
                final=False,
                model="gemma4-e2b",
                lora_rank=8,
                lora_targets="attention",
                epochs=2,
                learning_rate=2e-4,
                gradient_accumulation=8,
                seed=560,
                export_merged_hf=True,
                export_gguf=True,
                quantization="Q8_0",
            )
            with patch("tools.gemma_bakeoff.current_git_commit", return_value="finalizer-commit"):
                manifest = finalize_existing_run(args)

            self.assertEqual(Path(manifest["ggufPath"]), actual_gguf.resolve())
            self.assertTrue(manifest["finalizedAfterInterruption"])
            self.assertEqual(manifest["finalizerGitCommit"], "finalizer-commit")
            self.assertIn("gguf_gguf/model.Q8_0.gguf", manifest["artifactHashes"])
            self.assertNotIn("gguf/model.safetensors", manifest["artifactHashes"])
            self.assertTrue((run_root / "checksums.json").is_file())
            self.assertTrue((run_root / "run_manifest.json").is_file())
            repeated = finalize_existing_run(args)
            self.assertEqual(repeated["status"], "already-complete")

    def test_gguf_resolution_requires_real_gguf_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            requested = Path(directory) / "gguf"
            requested.mkdir()
            (requested / "model.safetensors").write_bytes(b"placeholder")
            with self.assertRaisesRegex(RuntimeError, "contains no .gguf files"):
                resolved_gguf_artifact(requested)

    def test_generation_profile_records_unsupported_seed(self) -> None:
        args = argparse.Namespace(temperature=0.1, max_output_tokens=8192, reasoning_effort="minimal", seed=560, runtime="")
        gemini = generation_profile(args, "gemini")
        local = generation_profile(args, "local")
        self.assertEqual(gemini["unsupported"], ["seed"])
        self.assertEqual(gemini["applied"]["reasoningEffort"], "minimal")
        self.assertNotIn("seed", gemini["applied"])
        self.assertEqual(local["applied"]["seed"], 560)
        self.assertIn("reasoningEffort", local["unsupported"])
        args.runtime = "mlx"
        mlx = generation_profile(args, "local")
        self.assertIn("responseFormat", mlx["unsupported"])
        self.assertNotIn("responseFormat", mlx["applied"])

    def test_openai_profile_uses_reasoning_without_temperature(self) -> None:
        args = argparse.Namespace(temperature=0.1, max_output_tokens=12000, reasoning_effort="medium", seed=None, runtime="")
        profile = generation_profile(args, "openai")
        self.assertEqual(profile["applied"]["reasoningEffort"], "medium")
        self.assertEqual(profile["applied"]["maxOutputTokens"], 12000)
        self.assertNotIn("temperature", profile["applied"])
        self.assertIn("temperature", profile["unsupported"])

    def test_openai_provider_settings_and_request_usage(self) -> None:
        args = argparse.Namespace(provider="openai", base_url="", model="", runtime="")
        with patch.dict(
            os.environ,
            {"OPENAI_API_KEY": "test-key", "OPENAI_DATASET_MODEL": "gpt-5.4-mini"},
            clear=True,
        ):
            settings = provider_settings(args)
        self.assertEqual(settings["baseUrl"], "https://api.openai.com/v1")
        self.assertEqual(settings["model"], "gpt-5.4-mini")

        payload = {
            "choices": [{"message": {"content": '{"ok":true}'}}],
            "usage": {
                "prompt_tokens": 100,
                "completion_tokens": 50,
                "total_tokens": 150,
                "completion_tokens_details": {"reasoning_tokens": 20},
            },
        }

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *unused):
                return False

            def read(self):
                return json.dumps(payload).encode("utf-8")

        captured = {}

        def fake_urlopen(request, timeout):
            captured["body"] = json.loads(request.data.decode("utf-8"))
            captured["timeout"] = timeout
            return FakeResponse()

        profile = generation_profile(
            argparse.Namespace(temperature=0.1, max_output_tokens=12000, reasoning_effort="medium", seed=None, runtime=""),
            "openai",
        )
        with (
            patch("tools.model_bakeoff_eval.urlopen", side_effect=fake_urlopen),
            patch("tools.model_bakeoff_eval.record_provider_usage") as usage,
        ):
            self.assertEqual(call_chat([{"role": "user", "content": "test"}], settings, 180, profile), '{"ok":true}')
        self.assertEqual(captured["body"]["max_completion_tokens"], 12000)
        self.assertEqual(captured["body"]["reasoning_effort"], "medium")
        self.assertNotIn("max_tokens", captured["body"])
        self.assertNotIn("temperature", captured["body"])
        usage.assert_called_once_with(payload)

    def test_evaluator_does_not_normalise_an_invalid_shape_into_a_pass(self) -> None:
        row = training_row(1, "validation")
        row["messages"][1]["content"] = json.dumps(
            {
                "facts": {"deterministicAnalysis": {"verdict": "Wait and Watch"}, "uiOptions": {}},
                "retrievedRuleSet": {"rules": []},
            }
        )
        result = evaluate_response(
            row,
            json.dumps({"decision": {"verdict": "Wait and Watch", "explanation": "Incomplete"}}),
            latency=1.0,
            repairs=0,
        )
        self.assertFalse(result["schemaValid"])
        self.assertEqual(result["completenessPct"], 0)
        self.assertFalse(result["verdictPreserved"])

    def test_provider_error_is_never_counted_as_schema_valid(self) -> None:
        row = training_row(2, "validation")
        row["messages"][1]["content"] = json.dumps({"facts": {}, "retrievedRuleSet": {"rules": []}})
        result = evaluate_response(row, "", latency=2.0, repairs=0, error="Provider HTTP 503")
        self.assertFalse(result["schemaValid"])
        self.assertEqual(result["schemaErrors"], ["Provider HTTP 503"])

    def test_completeness_excludes_non_company_fundamentals_but_requires_explanation(self) -> None:
        analysis = {
            section: {
                "summary": "Available",
                **{name: [{"text": "Available"}] for name in arrays},
            }
            for section, arrays in SECTION_ARRAYS.items()
        }
        for name in SECTION_ARRAYS["company"]:
            analysis["company"][name] = []
        analysis["company"]["summary"] = "Company fundamentals are not applicable to this index."
        analysis["company"]["dataGaps"] = [{"text": "Not applicable for an index."}]
        analysis["chart"]["patterns"] = []
        analysis["reasoning"] = {"steps": [{"text": "Available"}]}
        analysis["coach"] = {
            "verdictSummary": "Available",
            "chartSummary": "Available",
            "companySummary": "Not applicable to an index.",
            "questionsBeforeAction": [{"text": "Available"}],
        }
        facts = {"instrument": {"type": "index"}, "uiOptions": {"patternsEnabled": False}}
        self.assertEqual(completeness(analysis, facts), 100)
        analysis["company"]["summary"] = ""
        self.assertLess(completeness(analysis, facts), 100)
        analysis["company"]["summary"] = "Not applicable to an index."
        analysis["company"]["dataGaps"] = []
        self.assertEqual(completeness(analysis, facts), 100)
        facts["instrument"]["type"] = "equity"
        self.assertLess(completeness(analysis, facts), 80)

    def test_response_retry_includes_invalid_final_outputs(self) -> None:
        self.assertTrue(response_needs_retry({"error": "quota", "schemaValid": False, "semanticValid": False}))
        self.assertTrue(response_needs_retry({"error": "", "schemaValid": False, "semanticValid": False}))
        self.assertTrue(response_needs_retry({"error": "", "schemaValid": True, "semanticValid": False}))
        self.assertFalse(response_needs_retry({"error": "", "schemaValid": True, "semanticValid": True}))
        self.assertFalse(response_needs_retry({"error": ""}))

    def test_non_company_applicability_requires_explicit_company_and_coach_reasons(self) -> None:
        facts = {"instrument": {"type": "etf"}}
        analysis = {
            "company": {
                "summary": "Company fundamentals are not applicable to this ETF.",
                "dataGaps": [{"text": "Issuer evidence is not applicable."}],
            },
            "coach": {"companySummary": "Operating-company analysis is non-applicable to an ETF."},
        }
        self.assertEqual(non_company_applicability_errors(analysis, facts), [])
        analysis["coach"]["companySummary"] = "Review the instrument."
        self.assertIn(
            "coach.companySummary must explain that operating-company fundamentals are non-applicable",
            non_company_applicability_errors(analysis, facts),
        )
        analysis["coach"]["companySummary"] = "Company analysis is not applicable."
        analysis["company"]["dataGaps"] = []
        self.assertEqual(non_company_applicability_errors(analysis, facts), [])

    def test_generation_binding_ignores_scoring_code_but_rejects_prompt_changes(self) -> None:
        base = {
            "provider": "gemini",
            "model": "gemini-3.5-flash",
            "datasetFileSha256": "dataset",
            "promptVersion": "analysis-prompt.v6",
            "evaluatorSourceHash": "old-evaluator",
            "fingerprint": "old-fingerprint",
        }
        rescored = {**base, "evaluatorSourceHash": "new-evaluator", "fingerprint": "new-fingerprint"}
        self.assertEqual(generation_binding(base), generation_binding(rescored))
        self.assertNotEqual(
            generation_binding(base),
            generation_binding({**rescored, "promptVersion": "analysis-prompt.v7"}),
        )

    def test_reusable_responses_rescores_valid_rows_and_skips_invalid_rows(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            rows = [training_row(1, "validation"), training_row(2, "validation")]
            binding = {
                "provider": "gemini",
                "model": "gemini-3.5-flash",
                "split": "validation",
                "caseIds": [row["id"] for row in rows],
                "datasetFileSha256": "dataset",
                "promptVersion": "analysis-prompt.v6",
                "expectedCases": 15,
            }
            source_config = {**binding, "fingerprint": "source-fingerprint"}
            (root / "source-validation-config.json").write_text(json.dumps(source_config), encoding="utf-8")
            source_responses = [
                {
                    "id": row["id"],
                    "raw": f"raw-{index}",
                    "error": "historical provider error" if index == 0 else "",
                    "latencySeconds": 1,
                    "repairs": 0,
                    "evaluationFingerprint": "source-fingerprint",
                }
                for index, row in enumerate(rows)
            ]
            (root / "source-validation-responses.jsonl").write_text(
                "".join(json.dumps(row) + "\n" for row in source_responses),
                encoding="utf-8",
            )
            (root / "source-validation-report.json").write_text(
                json.dumps(
                    {
                        "evaluationFingerprint": "source-fingerprint",
                        "responseContentHash": response_content_hash(source_responses),
                        "caseIds": [row["id"] for row in rows],
                    }
                ),
                encoding="utf-8",
            )

            def evaluated(row, raw, latency, repairs, error=""):
                valid = row["id"] == rows[0]["id"]
                return {
                    "id": row["id"],
                    "raw": raw,
                    "error": error,
                    "schemaValid": valid,
                    "semanticValid": valid,
                }

            with (
                patch("tools.model_bakeoff_eval.REPORT_ROOT", root),
                patch("tools.model_bakeoff_eval.evaluate_response", side_effect=evaluated),
            ):
                reused = reusable_responses(
                    "source",
                    "validation",
                    rows,
                    {**binding, "fingerprint": "current-fingerprint"},
                )
            self.assertEqual(list(reused), [rows[0]["id"]])
            self.assertEqual(reused[rows[0]["id"]]["evaluationFingerprint"], "current-fingerprint")
            self.assertEqual(reused[rows[0]["id"]]["reusedFrom"], "source")

    def test_reusable_responses_accepts_a_verified_source_subset(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target_rows = [training_row(1, "validation"), training_row(2, "validation")]
            source_row = target_rows[0]
            binding = {
                "provider": "openai",
                "model": "gpt-5.4-mini",
                "baseUrl": "https://api.openai.com/v1",
                "split": "validation",
                "datasetFileSha256": "dataset",
                "generationProfile": {"applied": {"reasoningEffort": "low"}},
                "runtime": "openai-chat-completions",
                "modelArtifactHash": "",
                "quantization": "",
                "promptVersion": "analysis-prompt.v8",
                "runtimeSourceHash": "runtime",
                "groundingSourceHash": "grounding",
            }
            source_config = {**binding, "caseIds": [source_row["id"]], "expectedCases": 15, "fingerprint": "source-fingerprint"}
            (root / "subset-validation-config.json").write_text(json.dumps(source_config), encoding="utf-8")
            source_response = {
                "id": source_row["id"],
                "raw": "valid",
                "error": "",
                "latencySeconds": 1,
                "repairs": 0,
                "evaluationFingerprint": "source-fingerprint",
            }
            (root / "subset-validation-responses.jsonl").write_text(json.dumps(source_response) + "\n", encoding="utf-8")
            (root / "subset-validation-report.json").write_text(
                json.dumps(
                    {
                        "evaluationFingerprint": "source-fingerprint",
                        "responseContentHash": response_content_hash([source_response]),
                        "caseIds": [source_row["id"]],
                    }
                ),
                encoding="utf-8",
            )

            with (
                patch("tools.model_bakeoff_eval.REPORT_ROOT", root),
                patch(
                    "tools.model_bakeoff_eval.evaluate_response",
                    return_value={"id": source_row["id"], "raw": "valid", "error": "", "schemaValid": True, "semanticValid": True},
                ),
            ):
                reused = reusable_responses(
                    "subset",
                    "validation",
                    target_rows,
                    {**binding, "caseIds": [row["id"] for row in target_rows], "expectedCases": 15, "fingerprint": "target"},
                )
            self.assertEqual(list(reused), [source_row["id"]])

    def test_evaluator_run_binds_checkpoints_reports_and_human_review_to_responses(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            provider_root = root / "provider"
            report_root = root / "reports"
            provider_root.mkdir()
            rows = [training_row(index, "validation") for index in range(15)]
            (provider_root / "pilot_validation.jsonl").write_text(
                "".join(json.dumps(row) + "\n" for row in rows),
                encoding="utf-8",
            )
            args = argparse.Namespace(
                name="integration",
                provider="local",
                model="",
                base_url="http://127.0.0.1:8080/v1",
                split="validation",
                allow_sealed_eval=False,
                validation_comparison=None,
                evaluation_role="",
                timeout=120,
                temperature=0.1,
                max_output_tokens=8192,
                seed=560,
                rpm=15,
                wait_on_short_quota=True,
                max_wait_seconds=600,
                provider_retries=3,
                retry_backoff_seconds=0,
                retry_errors=True,
                runtime="mlx",
                model_artifact_hash="artifact",
                quantization="MLX-8bit",
                case_ids="",
            )

            def evaluated(row, raw, latency, repairs, error=""):
                return {
                    "id": row["id"], "latencySeconds": latency, "repairs": repairs, "error": error,
                    "schemaValid": True, "schemaErrors": [], "semanticValid": True, "semanticErrors": [],
                    "verdictPreserved": True, "unsupportedFactRefs": [], "unsupportedRuleRefs": [],
                    "unsupportedNumericClaims": [], "completenessPct": 100, "patternsRespected": True,
                    "applicabilityRespected": True, "raw": raw,
                }

            with (
                patch("tools.model_bakeoff_eval.PROVIDER_ROOT", provider_root),
                patch("tools.model_bakeoff_eval.REPORT_ROOT", report_root),
                patch("tools.model_bakeoff_eval.call_chat", return_value='{"ok":true}'),
                patch("tools.model_bakeoff_eval.evaluate_response", side_effect=evaluated),
                patch("tools.model_bakeoff_eval.current_git_commit", return_value="commit"),
            ):
                report = run_bakeoff(args)
            self.assertEqual(report["cases"], 15)
            self.assertTrue(report["responseContentHash"])
            review = json.loads(Path(report["humanReviewPath"]).read_text(encoding="utf-8"))
            self.assertEqual(review["responseContentHash"], report["responseContentHash"])
            responses = [json.loads(line) for line in Path(report["responsesPath"]).read_text(encoding="utf-8").splitlines()]
            self.assertTrue(all(row["evaluationFingerprint"] == report["evaluationFingerprint"] for row in responses))

            reused_args = argparse.Namespace(**vars(args))
            reused_args.name = "integration-reused"
            reused_args.reuse_responses_from = "integration"
            with (
                patch("tools.model_bakeoff_eval.PROVIDER_ROOT", provider_root),
                patch("tools.model_bakeoff_eval.REPORT_ROOT", report_root),
                patch("tools.model_bakeoff_eval.call_chat", side_effect=AssertionError("provider should not be called")),
                patch("tools.model_bakeoff_eval.evaluate_response", side_effect=evaluated),
                patch("tools.model_bakeoff_eval.current_git_commit", return_value="commit"),
            ):
                reused_report = run_bakeoff(reused_args)
            self.assertEqual(reused_report["reusedCases"], 15)
            reused_responses_path = Path(reused_report["responsesPath"])
            self.assertTrue(reused_responses_path.is_file())
            self.assertEqual(len(reused_responses_path.read_text(encoding="utf-8").splitlines()), 15)

    def test_evaluator_stops_after_exhausted_transient_provider_retries(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            provider_root = root / "provider"
            report_root = root / "reports"
            provider_root.mkdir()
            rows = [training_row(index, "validation") for index in range(15)]
            (provider_root / "pilot_validation.jsonl").write_text(
                "".join(json.dumps(row) + "\n" for row in rows),
                encoding="utf-8",
            )
            args = argparse.Namespace(
                name="transient-stop",
                provider="local",
                model="",
                base_url="http://127.0.0.1:8080/v1",
                split="validation",
                allow_sealed_eval=False,
                validation_comparison=None,
                evaluation_role="",
                timeout=120,
                temperature=0.1,
                max_output_tokens=8192,
                reasoning_effort="minimal",
                seed=560,
                rpm=15,
                wait_on_short_quota=True,
                max_wait_seconds=600,
                provider_retries=1,
                retry_backoff_seconds=0,
                retry_errors=True,
                runtime="mlx",
                model_artifact_hash="artifact",
                quantization="MLX-8bit",
                case_ids="",
            )
            with (
                patch("tools.model_bakeoff_eval.PROVIDER_ROOT", provider_root),
                patch("tools.model_bakeoff_eval.REPORT_ROOT", report_root),
                patch("tools.model_bakeoff_eval.call_chat", side_effect=TransientProviderError("Provider HTTP 503")) as provider,
                patch("tools.model_bakeoff_eval.current_git_commit", return_value="commit"),
            ):
                report = run_bakeoff(args)
            self.assertEqual(provider.call_count, 1)
            self.assertEqual(report["cases"], 1)
            self.assertEqual(report["providerStop"]["caseId"], rows[0]["id"])

    def test_local_provider_is_loopback_only_and_mlx_uses_default_model(self) -> None:
        args = argparse.Namespace(provider="local", base_url="http://127.0.0.1:8080/v1", model="", runtime="mlx")
        with patch.dict(os.environ, {}, clear=True):
            settings = provider_settings(args)
        self.assertEqual(settings["model"], "default_model")
        args.base_url = "http://192.168.1.8:8080/v1"
        with self.assertRaisesRegex(RuntimeError, "loopback"):
            provider_settings(args)

    def test_sealed_provider_rows_reject_modified_content_with_unchanged_id(self) -> None:
        approved = {"id": "sealed-one", "split": "eval"}
        expected = training_row(1, "eval")
        expected["id"] = approved["id"]
        modified = json.loads(json.dumps(expected))
        modified["messages"][2]["content"] = '{"changed":true}'
        with (
            patch(
                "tools.model_bakeoff_eval.verify_evaluation_seal",
                return_value={"verified": True, "errors": [], "evaluationIds": [approved["id"]]},
            ),
            patch("tools.model_bakeoff_eval.approved_gold", return_value=[approved]),
            patch("tools.model_bakeoff_eval.provider_row", return_value=expected),
        ):
            with self.assertRaisesRegex(RuntimeError, "content differs"):
                verify_sealed_provider_rows([modified])

    def test_human_review_requires_bound_complete_scores(self) -> None:
        report = {
            "name": "pilot",
            "evaluationFingerprint": "fingerprint",
            "responseContentHash": "responses",
            "caseIds": ["case-one"],
        }
        with tempfile.TemporaryDirectory() as directory:
            review_path = Path(directory) / "review.json"
            review_path.write_text(
                json.dumps(
                    {
                        "evaluationFingerprint": "fingerprint",
                        "responseContentHash": "responses",
                        "cases": [{"id": "case-one", "scores": {"usefulness": 4, "clarity": 4, "grounding": 4}}],
                    }
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(RuntimeError, "actionability"):
                human_review_summary(review_path, report)

    def test_mlx_commands_are_versioned_and_loopback_only(self) -> None:
        source = Path("/tmp/merged")
        output = Path("/tmp/mlx")
        self.assertGreaterEqual(version_tuple("0.31.3"), (0, 31, 3))
        self.assertIn("--q-bits", conversion_command(source, output, 4))
        command = server_command(output, 8080)
        self.assertIn("127.0.0.1", command)
        self.assertEqual(command[command.index("--prompt-concurrency") + 1], "1")
        self.assertEqual(command[command.index("--decode-concurrency") + 1], "1")
        self.assertNotIn("0.0.0.0", command)

    def test_mlx_conversion_requires_manifest_hash_and_publishes_atomically(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "merged"
            source.mkdir()
            (source / "model.safetensors").write_bytes(b"weights")
            run_manifest = root / "run_manifest.json"
            run_manifest.write_text(
                json.dumps(
                    {
                        "status": "complete",
                        "runName": "pilot",
                        "artifactTreeHashes": {"mergedHf": tree_hash(source)},
                    }
                ),
                encoding="utf-8",
            )
            output = root / "mlx"

            def fake_conversion(command, check):
                self.assertTrue(check)
                staging = Path(command[command.index("--mlx-path") + 1])
                staging.mkdir()
                (staging / "weights.safetensors").write_bytes(b"mlx")

            args = argparse.Namespace(
                merged_hf=source,
                run_manifest=run_manifest,
                adapter=None,
                output=output,
                bits=8,
                dry_run=False,
            )
            with (
                patch("tools.prepare_mlx_runtime.require_mlx_lm", return_value="0.31.3"),
                patch("tools.prepare_mlx_runtime.subprocess.run", side_effect=fake_conversion),
                patch("tools.prepare_mlx_runtime.current_git_commit", return_value="commit"),
            ):
                manifest = convert_mlx(args)
            self.assertTrue(output.is_dir())
            self.assertTrue((output / "runtime_manifest.json").is_file())
            self.assertEqual(manifest["sourceRunName"], "pilot")

    def test_mlx_serve_requires_qualified_runtime_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            model = Path(directory) / "model"
            model.mkdir()
            (model / "weights.safetensors").write_bytes(b"mlx")
            args = argparse.Namespace(model=model, port=8080, dry_run=True)
            with patch("tools.prepare_mlx_runtime.require_mlx_lm", return_value="0.31.3"):
                with self.assertRaisesRegex(RuntimeError, "runtime_manifest"):
                    serve_mlx(args)

    def test_gemma4_shared_kv_keys_are_scoped_to_canonical_shared_layers(self) -> None:
        self.assertFalse(
            shared_kv_key("language_model.model.layers.14.self_attn.k_proj.weight", 15, SHARED_KV_WEIGHT)
        )
        self.assertTrue(
            shared_kv_key("language_model.model.layers.15.self_attn.k_proj.weight", 15, SHARED_KV_WEIGHT)
        )
        self.assertTrue(
            shared_kv_key(
                "base_model.model.model.language_model.layers.34.self_attn.v_proj.lora_B.weight",
                15,
                SHARED_KV_LORA_B,
            )
        )
        self.assertFalse(
            shared_kv_key("language_model.model.layers.20.self_attn.q_proj.weight", 15, SHARED_KV_WEIGHT)
        )

    def test_gemma4_shared_kv_configuration_uses_checkpoint_contract(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)
            (source / "config.json").write_text(
                json.dumps(
                    {
                        "model_type": "gemma4",
                        "text_config": {"num_hidden_layers": 35, "num_kv_shared_layers": 20},
                    }
                ),
                encoding="utf-8",
            )
            self.assertEqual(
                shared_kv_configuration(source),
                {"numHiddenLayers": 35, "numKvSharedLayers": 20, "firstSharedLayer": 15},
            )

    def test_gemma4_shared_kv_conversion_rejects_nonzero_adapter_updates(self) -> None:
        class BooleanResult:
            def __init__(self, value: bool) -> None:
                self.value = value

            def any(self) -> bool:
                return self.value

        class Tensor:
            def __init__(self, nonzero: bool) -> None:
                self.nonzero = nonzero

            def __ne__(self, _value: object) -> BooleanResult:
                return BooleanResult(self.nonzero)

        class Store:
            def __init__(self, values: dict[str, Tensor]) -> None:
                self.values = values

            def __enter__(self) -> "Store":
                return self

            def __exit__(self, *_args: object) -> None:
                return None

            def keys(self) -> list[str]:
                return list(self.values)

            def get_tensor(self, key: str) -> Tensor:
                return self.values[key]

        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "merged"
            adapter = Path(directory) / "adapter"
            source.mkdir()
            adapter.mkdir()
            (source / "config.json").write_text(
                json.dumps(
                    {
                        "model_type": "gemma4",
                        "text_config": {"num_hidden_layers": 3, "num_kv_shared_layers": 1},
                    }
                ),
                encoding="utf-8",
            )
            source_weights = source / "model.safetensors"
            adapter_weights = adapter / "adapter_model.safetensors"
            source_weights.touch()
            adapter_weights.touch()
            merged_values = {
                f"language_model.model.layers.2.self_attn.{projection}.weight": Tensor(False)
                for projection in ("k_proj", "v_proj", "k_norm")
            }
            adapter_values = {
                f"base_model.model.model.language_model.layers.2.self_attn.{projection}.lora_B.weight": Tensor(False)
                for projection in ("k_proj", "v_proj")
            }

            def safe_open(path: Path, **_kwargs: object) -> Store:
                return Store(adapter_values if Path(path) == adapter_weights else merged_values)

            with patch.dict("sys.modules", {"safetensors": SimpleNamespace(safe_open=safe_open)}):
                result = shared_kv_compatibility(source, adapter)
                self.assertEqual(result["droppedWeightCount"], 3)
                self.assertEqual(result["auditedZeroLoraBCount"], 2)
                next(iter(adapter_values.values())).nonzero = True
                with self.assertRaisesRegex(RuntimeError, "nonzero trained adapter updates"):
                    shared_kv_compatibility(source, adapter)

    def test_promotion_requires_every_hard_and_human_gate(self) -> None:
        ids = [f"case-{index}" for index in range(15)]

        def report(name: str, completeness: float, semantic: float = 100) -> dict:
            is_gemini = name == "gemini"
            return {
                "schemaVersion": "model-bakeoff-report.v2",
                "name": name,
                "promotable": True,
                "split": "validation",
                "cases": 15,
                "expectedCases": 15,
                "caseIds": ids,
                "datasetFileSha256": "dataset",
                "promptVersion": "analysis-prompt.v6",
                "evaluatorVersion": EVALUATOR_VERSION,
                "evaluatorSourceHash": "evaluator-source",
                "evaluationHelperSourceHash": "evaluation-helper-source",
                "runtimeSourceHash": "runtime-source",
                "groundingSourceHash": "grounding-source",
                "evaluationFingerprint": f"fingerprint-{name}",
                "responseContentHash": f"responses-{name}",
                "provider": "gemini" if is_gemini else "local",
                "runtime": "gemini-openai-compatible" if is_gemini else "mlx",
                "model": "gemini-3.5-flash" if is_gemini else f"gemma-{name}",
                "modelArtifactHash": "" if is_gemini else f"artifact-{name}",
                "quantization": "" if is_gemini else "MLX-8bit",
                "generationProfile": {"requested": {"temperature": 0.1, "maxOutputTokens": 8192}},
                "schemaValidityPct": 100,
                "semanticValidityPct": semantic,
                "semanticErrors": 0 if semantic == 100 else 1,
                "verdictPreservationPct": 100,
                "unsupportedFactRefs": 0,
                "unsupportedRuleRefs": 0,
                "unsupportedNumericClaims": 0,
                "averageCompletenessPct": completeness,
                "minimumCompletenessPct": completeness,
                "patternsRespectedPct": 100,
                "applicabilityRespectedPct": 100,
                "p95LatencySeconds": 119,
                "errorRatePct": 0,
            }

        def review(name: str, score: float) -> dict:
            return {
                "evaluationFingerprint": f"fingerprint-{name}",
                "responseContentHash": f"responses-{name}",
                "cases": [
                    {
                        "id": case_id,
                        "scores": {dimension: score for dimension in ("usefulness", "clarity", "grounding", "actionability")},
                    }
                    for case_id in ids
                ],
            }

        gemini = report("gemini", 98)
        untuned = report("untuned", 96)
        tuned = report("tuned", 98)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = {}
            for name, payload in (("gemini", gemini), ("untuned", untuned), ("tuned", tuned)):
                paths[name] = root / f"{name}.json"
                paths[name].write_text(json.dumps(payload), encoding="utf-8")
                paths[f"{name}_human"] = root / f"{name}-human.json"
                paths[f"{name}_human"].write_text(
                    json.dumps(review(name, {"gemini": 4.2, "untuned": 3.8, "tuned": 4.1}[name])), encoding="utf-8"
                )
            args = argparse.Namespace(
                gemini=paths["gemini"], untuned=paths["untuned"], tuned=paths["tuned"],
                gemini_human=paths["gemini_human"], untuned_human=paths["untuned_human"], tuned_human=paths["tuned_human"],
            )
            result = compare(args)
            self.assertTrue(result["promote"])
            tuned["verdictPreservationPct"] = 99
            paths["tuned"].write_text(json.dumps(tuned), encoding="utf-8")
            result = compare(args)
        self.assertFalse(result["promote"])

    def test_smoke_report_is_never_promotable(self) -> None:
        report = {
            "schemaVersion": "model-bakeoff-report.v2",
            "name": "smoke",
            "promotable": False,
            "cases": 1,
            "expectedCases": 15,
        }
        self.assertTrue(any("not a complete promotable run" in error for error in compatibility_errors([report, report, report])))

    def test_sealed_evaluation_requires_passing_validation_and_is_one_time_per_role(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            comparison = root / "comparison.json"
            comparison.write_text(
                json.dumps({"schemaVersion": "model-bakeoff-comparison.v2", "promote": True}),
                encoding="utf-8",
            )
            registry = root / "consumption.json"
            args = argparse.Namespace(
                allow_sealed_eval=True,
                validation_comparison=comparison,
                evaluation_role="gemini",
                provider="gemini",
            )
            with patch("tools.model_bakeoff_eval.EVALUATION_CONSUMPTION_PATH", registry):
                self.assertEqual(sealed_eval_authorization(args)["role"], "gemini")
                registry.write_text(
                    json.dumps({"schemaVersion": "sealed-evaluation-consumption.v1", "roles": {"gemini": {}}}),
                    encoding="utf-8",
                )
                with self.assertRaisesRegex(RuntimeError, "already been consumed"):
                    sealed_eval_authorization(args)

    def test_percentile_uses_observed_upper_tail(self) -> None:
        self.assertEqual(percentile95([1, 2, 3, 4, 5]), 5)


if __name__ == "__main__":
    unittest.main()
