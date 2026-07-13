# Grounded Analyst Training Data

The workflow separates schema fixtures, public-market reasoning gold, Gemini-generated descendants, and model artifacts.

## Tracked Inputs

- `contract_fixtures.jsonl`: 120 approved `TEST:*` rows for contract and edge-case tests. They are not reasoning gold.
- `reasoning_instruments.json`: 63 public instruments assigned to immutable train, validation, or sealed evaluation partitions.
- `reasoning_gold.jsonl`: generated only after public snapshots and Gemini answers pass review. It is safe to track because it contains no personal portfolio data.

Public snapshot caches, expanded rows, provider exports, model weights, adapters, GGUF files, and evaluation responses are generated and ignored by Git.

## Build The Gold Set

```bash
python3 tools/reasoning_dataset.py validate-manifest
python3 tools/reasoning_dataset.py collect
python3 tools/reasoning_dataset.py enrich-fundamentals
python3 tools/reasoning_dataset.py generate --provider openai --rpm 5 --wait-on-short-quota --max-wait-seconds 600
python3 tools/reasoning_dataset.py normalize-editorial
python3 tools/reasoning_dataset.py audit
python3 tools/review_candidates.py --dataset reasoning
python3 tools/reasoning_dataset.py approve --requested-by-user
python3 tools/reasoning_dataset.py seal
python3 tools/reasoning_dataset.py verify-seal
```

`collect` checkpoints 63 timestamped Yahoo/MFapi snapshots in `data/generated`, and `enrich-fundamentals` fills missing equity evidence from the existing Screener integration. `generate` supports Gemini, Cerebras, and OpenAI dataset providers, checkpoints every completed response, reports token usage and estimated provider cost, and stops cleanly on quota or provider/network outages. Use `--max-new` for a bounded run. Use repeatable `--case-id` with `--refresh-existing` to regenerate only reviewed problem cases. A malformed or audit-failing response receives one constrained repair; a second failure is quarantined without discarding successful rows.

`normalize-editorial` rewrites internal schema labels only in user-facing prose while preserving facts, `factRefs`, `ruleRefs`, verdicts, and the structured output contract. Run it before final human review and approval.

Approval requires 75 train, 15 validation, and 30 sealed-evaluation gold rows. All scenarios for one instrument remain in one partition. The review workspace can edit expected JSON and records every grounding, applicability, coverage, and writing-quality check.

### Teacher bake-off

To compare Cerebras GPT-OSS 120B against the accepted Gemini cases without changing the gold file, set `CEREBRAS_API_KEY` locally and run:

```bash
python3 tools/teacher_bakeoff.py --provider cerebras --limit 3 --rpm 2
```

Candidate outputs and the report are checkpointed under ignored `data/generated/teacher_bakeoff`. Cerebras receives the identical facts and `RetrievedRuleSetV1`, with strict `LlmAnalysisV1` constrained decoding. Promote it only after every candidate passes the automated audit and the reviewed usefulness, clarity, grounding, and actionability scores are no more than 0.2 below Gemini. Set `DATASET_LLM_PROVIDER=cerebras` only after that decision; production inference and Gemini embeddings remain independent.

The original fixtures remain independently auditable:

```bash
python3 tools/approve_candidates.py
python3 tools/evaluate_llm.py data/training/contract_fixtures.jsonl
```

## Pilot And Expansion

Once all reasoning gold is approved:

```bash
python3 tools/llm_dataset.py export --pilot
python3 tools/gemma_bakeoff.py --dry-run --model gemma4-e4b \
  --expected-dataset-hash 6a374ec58b9fd134de5cf1ccdeda33384ba24c02935c4af2b3e3d8a6bbd75c09
```

First capture the validation baseline with identical RAG input and a recorded generation profile:

```bash
python3 tools/model_bakeoff_eval.py run \
  --name base-gemini-runtime-pilot-v9 \
  --provider gemini \
  --reuse-responses-from base-gemini-runtime-pilot-v8 \
  --temperature 0.1 \
  --max-output-tokens 8192 \
  --reasoning-effort minimal \
  --rpm 15
```

The included Colab notebook requires typed confirmation before mounting private Drive or uploading files. It checks out an explicit reviewed commit, installs the tracked dependency lock including Torch, accepts exactly `pilot_train.jsonl` and `pilot_validation.jsonl`, writes checkpoints and artifacts to private Drive, derives sequence length from all 90 fully rendered examples, and refuses truncation. Preflight runs one full forward, backward, and 8-bit optimizer step on the longest example and records peak GPU memory. Training refuses to start unless that exact run name, dataset, model revision, package environment, GPU, and hyperparameter set has a matching preflight proof. Train `gemma4-e4b` rank 16 for two epochs first. Use the separately preflighted rank 8, one-epoch fallback only after a validation regression; preflight `gemma4-12b` only after the E4B review.

Every completed run records the Git commit, base revision, GPU/CUDA and package environment, dataset and artifact hashes, training metrics, checkpoints, adapter, merged Hugging Face model, and Q8_0 GGUF. Generated files remain ignored and must not be uploaded to a public model repository.

Expand only after the pilot improves on validation:

```bash
python3 tools/llm_dataset.py expand --target 1200 --batch-size 4
python3 tools/llm_dataset.py export
```

The final split is lineage-safe:

- 75 gold plus 825 descendants in train.
- 15 gold plus 135 descendants in validation.
- 30 gold plus 120 descendants in evaluation.

Generated rows keep `reviewStatus=gemini-generated`. They pass strict automated audits but are never labelled human-approved gold.

## Evaluation

Run base Gemini and local Gemma against validation first:

```bash
python3 tools/model_bakeoff_eval.py run --name base-gemini-runtime-pilot-v9 --provider gemini --reasoning-effort minimal --max-output-tokens 8192
python3 tools/model_bakeoff_eval.py run \
  --name untuned-gemma-mlx-pilot --provider local --runtime mlx --quantization MLX-8bit \
  --model-artifact-hash sha256-from-untuned-runtime-manifest
python3 tools/model_bakeoff_eval.py run \
  --name tuned-gemma-mlx-pilot --provider local --runtime mlx --quantization MLX-8bit \
  --model-artifact-hash sha256-from-runtime-manifest
```

For the llama.cpp compatibility smoke test, use a separate local server and run only these representative validation cases:

```bash
python3 tools/model_bakeoff_eval.py run \
  --name tuned-gemma-llamacpp-smoke --provider local --runtime llama.cpp --quantization Q8_0 \
  --case-ids gold-nse-icicibank-buy,gold-nse-icicibank-sell,gold-fund-icici-nifty50-buy
```

Only run all 15 llama.cpp validation cases if the smoke responses match the MLX reference structurally and semantically.

The final 30-case set remains untouched during the pilot. After validation passes, each Gemini, untuned, and tuned role can consume it only once, using `--split eval --allow-sealed-eval --validation-comparison <passing-comparison.json> --evaluation-role <role>`. Compare validation reports only after completing the generated case-level human-review worksheet. Each worksheet is cryptographically bound to the exact raw responses it scores:

```bash
python3 tools/model_bakeoff_eval.py compare \
  --gemini data/generated/model_eval/base-gemini-runtime-pilot-v9-validation-report.json \
  --untuned data/generated/model_eval/untuned-gemma-mlx-pilot-validation-report.json \
  --tuned data/generated/model_eval/tuned-gemma-mlx-pilot-validation-report.json \
  --gemini-human data/generated/model_eval/base-gemini-runtime-pilot-v9-validation-human-review.json \
  --untuned-human data/generated/model_eval/untuned-gemma-mlx-pilot-validation-human-review.json \
  --tuned-human data/generated/model_eval/tuned-gemma-mlx-pilot-validation-human-review.json \
  --output data/generated/model_eval/validation-comparison.json
```

Promotion requires three compatible complete reports, perfect schema, semantic grounding, verdict, pattern, and applicability checks, at least 95% completeness in every case, zero runtime errors, p95 latency no greater than 120 seconds, all four human dimensions at least 4/5, Gemini parity, and measurable improvement over untuned Gemma. Smoke reports and incomplete human worksheets are never promotable.

After a passing comparison, a final sealed-role command has this form:

```bash
python3 tools/model_bakeoff_eval.py run \
  --name final-gemini-eval --provider gemini --split eval --allow-sealed-eval \
  --validation-comparison data/generated/model_eval/validation-comparison.json \
  --evaluation-role gemini
```

Use distinct names and the corresponding local artifact hashes for the `untuned` and `tuned` roles. The ignored consumption registry prevents rerunning a completed role.

Do not add real holdings, uploaded workbooks, access tokens, or personal portfolio facts to any training file.
