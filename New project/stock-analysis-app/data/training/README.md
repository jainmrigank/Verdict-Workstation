# Grounded Analyst Training Data

The training workflow deliberately separates human review from synthetic expansion.

1. Run `python3 tools/llm_dataset.py candidates` to create 120 synthetic, privacy-safe review candidates.
2. Set `GEMINI_API_KEY`, then run `python3 tools/llm_dataset.py preflight` for advisory Gemini Flash reviews. This does not approve candidates.
3. Run `python3 tools/review_candidates.py` and open `http://127.0.0.1:8791/`.
4. Review every candidate, edit its expected JSON when needed, complete all five checks, add notes, and press Approve. The workspace writes `reviewStatus: approved` for you.
5. Run `python3 tools/evaluate_llm.py data/training/gold_candidates.jsonl` and resolve every automated failure.
6. Run `python3 tools/llm_dataset.py expand` to use Gemini Flash to reach 1,200 examples.
7. Run `python3 tools/llm_dataset.py export` to create the 900/150/150 Vertex splits.
8. Upload the training and validation files to GCS, then run `python3 tools/train_vertex.py` without `--submit` to inspect the command. Add `--submit` only after costs and the target project are confirmed.

The Gemini dataset model comes from `GEMINI_DATASET_MODEL`, then `LLM_MODEL`, and defaults to `gemini-3.5-flash`. Vertex tuning defaults to the currently documented tunable `gemini-2.5-flash`; override it through `VERTEX_SOURCE_MODEL` or `--source-model` only when the target Vertex project supports that model for supervised tuning.

Run `python3 tools/approve_candidates.py` at any time for the strict grounding, verdict, rule-reference, coverage, privacy, and duplicate audit. When the user explicitly delegates review to Codex, `--approve --requested-by-user` records `codex-assisted` provenance on every passing candidate rather than mislabelling the set as human-reviewed.

Do not add real holdings or personal portfolio data to these files.
