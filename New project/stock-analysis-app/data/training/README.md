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
python3 tools/reasoning_dataset.py generate
python3 tools/reasoning_dataset.py audit
python3 tools/review_candidates.py --dataset reasoning
python3 tools/reasoning_dataset.py approve --requested-by-user
```

`collect` checkpoints 63 timestamped Yahoo/MFapi snapshots in `data/generated`. `generate` checkpoints each completed Gemini response and stops cleanly on free-tier HTTP 429 responses. Re-run it after quota resets.

Approval requires 75 train, 15 validation, and 30 sealed-evaluation gold rows. All scenarios for one instrument remain in one partition. The review workspace can edit expected JSON and records every grounding, applicability, coverage, and writing-quality check.

The original fixtures remain independently auditable:

```bash
python3 tools/approve_candidates.py
python3 tools/evaluate_llm.py data/training/contract_fixtures.jsonl
```

## Pilot And Expansion

Once all reasoning gold is approved:

```bash
python3 tools/llm_dataset.py export --pilot
python3 tools/gemma_bakeoff.py --dry-run --model gemma4-e4b
```

Upload `pilot_train.jsonl` and `pilot_validation.jsonl` to the included Colab notebook. Train `gemma4-e4b`; try `gemma3-12b` only when the free accelerator can load it without truncation.

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
python3 tools/model_bakeoff_eval.py run --name base-gemini --provider gemini
python3 tools/model_bakeoff_eval.py run --name tuned-gemma --provider local
```

The final 30-case set requires the explicit `--split eval --allow-sealed-eval` gate. Compare reports only after adding the recorded human-score file:

```bash
python3 tools/model_bakeoff_eval.py compare \
  --baseline data/generated/model_eval/base-gemini-eval-report.json \
  --candidate data/generated/model_eval/tuned-gemma-eval-report.json \
  --human-scores data/generated/model_eval/human_scores.json
```

Promotion requires perfect schema and verdict preservation, zero unsupported facts/rules/numbers, at least 95% completeness, correct pattern behavior, zero runtime errors, p95 latency no greater than 120 seconds, and mean human quality at least 4/5.

Do not add real holdings, uploaded workbooks, access tokens, or personal portfolio facts to any training file.
