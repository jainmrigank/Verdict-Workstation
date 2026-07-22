# RAG Model Quality Report

Evaluation date: 2026-07-17

## Result

The application continues to use base Gemini Flash plus semantic RAG in production, with deterministic analysis authoritative for verdicts, calculations, and fallbacks. GPT-5.4-mini was used only as a paid offline quality baseline for the 15-case validation set. It is not a production dependency.

After prompt, retrieval, normalization, and semantic-validation hardening, the GPT-5.4-mini baseline passed every automated gate and received 4/5 in every human-review dimension. This gives the Gemma pilot a clean target to match without exposing the sealed 30-case evaluation set.

## GPT-5.4-mini Validation Baseline

Run: `base-openai54mini-runtime-pilot-v11`

The run used prompt v8, the same `AnalysisFactsV1` and `RetrievedRuleSetV1` inputs intended for local Gemma, low reasoning effort, JSON output, and a 12,000-token output limit. All 15 responses were rebound to the current evaluator without issuing another paid request.

| Metric | Result |
| --- | ---: |
| Completed cases | 15/15 |
| Schema validity | 100% |
| Semantic validity | 100% |
| Deterministic verdict preservation | 100% |
| Unsupported fact references | 0 |
| Unsupported rule references | 0 |
| Unsupported numeric claims | 0 |
| Average applicable-field completeness | 98.61% |
| Minimum case completeness | 95.83% |
| Pattern-toggle compliance | 100% |
| Non-company applicability compliance | 100% |
| Runtime errors | 0% |
| p95 latency | 48.024 seconds |

The complete response set is bound to content hash `46be76009f80f7a1cb59597c039cca705187748b80e7ee83e198de48ffe8c8d0` and validation dataset SHA-256 `4c176dc30b374b91c2482a1830c830abdcbf8921dca2c8b7d0289228a4f39a80`.

## Human Review

All 15 normalized responses were reviewed case by case after the automated checks passed.

| Dimension | Mean |
| --- | ---: |
| Usefulness | 4.0/5 |
| Clarity | 4.0/5 |
| Grounding | 4.0/5 |
| Actionability | 4.0/5 |

The review included equity Buy and Sell cases, thin-history BSE cases, an ETF, indices, and mutual funds. The final responses preserve deterministic decisions, defer when evidence is insufficient, require an investable proxy for index actions, use fund-specific evidence for funds, and avoid invented position sizes, timing, targets, RSI labels, valuation labels, and company causes.

## Runtime Hardening

Prompt v8 and the provider-output boundary now:

- Keep deterministic verdicts explicit, including Reduce decisions.
- Strip backend field names and inline citation markers from reader-facing text while preserving structured references.
- Rebind narrative citations to relevant rules from the current retrieved rule set.
- Prevent unsupported RSI, valuation, volatility, concentration, and profitability labels.
- Remove unsafe tranche instructions outside a `Buy in Tranches` verdict.
- Treat one-candle history, identity conflicts, and missing investable proxies as execution constraints.
- Separate equity-company analysis from ETF, index, and mutual-fund analysis.
- Materialize complete response checkpoints even when every response is safely reused.

The approved 120-row gold corpus also passes this same provider-preparation and semantic-validation boundary without modifying the sealed source rows.

## Cost

The clean 15-case GPT-5.4-mini response artifact represents an estimated `$0.409521` of API use. Including smoke runs, retries, and the complete baseline work, the total estimated OpenAI spend was `$1.181941`.

Starting from the reported `$2.60` credit balance, the estimated remaining balance is about `$1.42`. Provider billing can differ slightly from the evaluator estimate.

## Gemma Pilot Status

The private pilot inputs are ready:

- 75 training cases.
- 15 validation cases.
- No train/validation lineage overlap.
- No sealed-evaluation overlap.
- Resumable, no-truncation Gemma 4 E4B training configuration using QLoRA rank 16, two epochs, and seed 560.
- A reversible compact model contract, a 3,584-token output ceiling, and an A100-only eight-case qualification smoke that must pass before full E4B training.

No Gemma adapter, merged model, MLX bundle, or GGUF has been produced yet. The next external action is to mount the user's private Google Drive in the signed-in Colab session and upload only `pilot_train.jsonl` and `pilot_validation.jsonl`. The sealed 30-case evaluation set remains local and untouched.

## Promotion Rule

Production stays on Gemini plus RAG unless tuned Gemma passes the 15-case validation gates: full schema and verdict preservation, zero unsupported claims or references, at least 95% applicable-field completeness, correct non-company behavior, 4/5 human quality, measurable improvement over untuned Gemma, no more than 0.2 below the GPT baseline, and p95 local latency no greater than 120 seconds.
