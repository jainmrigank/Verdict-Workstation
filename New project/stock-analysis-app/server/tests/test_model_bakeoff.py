from __future__ import annotations

import argparse
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools.gemma_bakeoff import (
    MODEL_CONFIGS,
    artifact_checksums,
    audit_response_masks,
    detect_response_markers,
    directory_tree_hash,
    dry_run,
    latest_checkpoint,
    resolve_resume_checkpoint,
    resolve_sequence_length,
    rounded_sequence_length,
    sha256_file,
    tokenize_text,
    validate_completed_run,
    verify_or_write_run_identity,
)
from tools.model_bakeoff_eval import (
    EVALUATOR_VERSION,
    SECTION_ARRAYS,
    compare,
    compatibility_errors,
    completeness,
    evaluate_response,
    generation_binding,
    generation_profile,
    human_review_summary,
    non_company_applicability_errors,
    percentile95,
    provider_settings,
    response_content_hash,
    response_needs_retry,
    reusable_responses,
    run as run_bakeoff,
    sealed_eval_authorization,
    verify_sealed_provider_rows,
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


class ModelBakeoffTests(unittest.TestCase):
    def test_tokenize_text_uses_multimodal_processor_text_keyword(self) -> None:
        class Processor:
            def __call__(self, *, text: str, **_kwargs: object) -> dict[str, list[int]]:
                return {"input_ids": [len(text)]}

        self.assertEqual(tokenize_text(Processor(), "analysis"), {"input_ids": [8]})

    def test_small_gemma_candidates_pin_the_loaded_quantized_repository(self) -> None:
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
                ("pilot_train.jsonl", [training_row(index, "train") for index in range(75)]),
                ("pilot_validation.jsonl", [training_row(index, "validation") for index in range(15)]),
            ):
                (root / name).write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
            result = dry_run(root, final=False)
        self.assertEqual(result["errors"], [])
        self.assertEqual(result["train"], 75)
        self.assertEqual(result["validation"], 15)

    def test_pilot_dry_run_rejects_hash_changes_and_sealed_rows(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            train = [training_row(index, "train") for index in range(75)]
            validation = [training_row(index, "validation") for index in range(15)]
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
                "loraRank": 16,
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
                    "loraRank", "epochs", "learningRate", "gradientAccumulation", "seed", "responseMarkers",
                )},
                "status": "complete",
                "quantization": "Q8_0",
                "adapterPath": str(adapter),
                "mergedHfPath": "",
                "ggufPath": "",
                "artifactHashes": hashes,
                "artifactTreeHashes": {"adapter": directory_tree_hash(adapter)},
            }
            with (
                patch("tools.gemma_bakeoff.current_git_commit", return_value="commit"),
                patch("tools.gemma_bakeoff.installed_versions", return_value={"torch": "test"}),
            ):
                self.assertEqual(validate_completed_run(manifest, args, validation, run_root), [])
                weight.write_bytes(b"tampered")
                self.assertTrue(validate_completed_run(manifest, args, validation, run_root))

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
        self.assertLess(completeness(analysis, facts), 100)
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
        self.assertIn(
            "company.dataGaps must explain unavailable issuer or constituent evidence",
            non_company_applicability_errors(analysis, facts),
        )

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
                    "error": "",
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
        self.assertGreaterEqual(version_tuple("0.31.2"), (0, 31, 2))
        self.assertIn("--q-bits", conversion_command(source, output, 4))
        command = server_command(output, 8080)
        self.assertIn("127.0.0.1", command)
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
                output=output,
                bits=8,
                dry_run=False,
            )
            with (
                patch("tools.prepare_mlx_runtime.require_mlx_lm", return_value="0.31.2"),
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
            with patch("tools.prepare_mlx_runtime.require_mlx_lm", return_value="0.31.2"):
                with self.assertRaisesRegex(RuntimeError, "runtime_manifest"):
                    serve_mlx(args)

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
