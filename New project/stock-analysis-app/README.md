# Fund Analyser

Fund Analyser is a browser-based NSE/BSE research workstation for personal stock and portfolio analysis. It turns a ticker, price context, portfolio holding details, chart structure, company fundamentals, risk preferences, and practical trading rules into a structured decision: what the app thinks, why it thinks that, what to do next, and what to avoid.

The app is built with React, TypeScript, Vite, and `lightweight-charts`. Most analysis runs in the browser. An optional Python bridge in the sibling `scripts/` folder fetches delayed/free market data, parses Zerodha-style holdings uploads, resolves symbol mappings, and proxies AI Coach calls without exposing provider secrets in the frontend.

This is an educational decision-support tool. It is not investment advice, a live data terminal, or an order execution system.

## What It Does

- Analyses NSE/BSE tickers for fresh-entry decisions and existing-holding reviews.
- Builds a verdict from price action, company quality, statement flow, portfolio exposure, risk controls, user preferences, and data confidence.
- Calculates position P&L, portfolio weight, capital-at-risk, suggested sizing, invalidation level, target/reward-risk, and add-more discipline.
- Shows interactive candlestick charts with indicators, pattern markers, volume, range lines, RSI, MACD, ATR, Bollinger Bands, VWAP, moving averages, and scenario forecasts.
- Presents dense evidence through swipeable flashcard decks so the page stays compact on small screens.
- Lets you upload a Zerodha holdings XLSX file, sync market data, analyse each holding, and resolve missing mappings.
- Stores workspace state in the browser so the current form, portfolio snapshot, and data window survive refreshes.
- Offers an optional AI Coach that explains the app's chart, company, or final verdict in plain English through the local bridge.
- Includes a reasoning audit trail and glossary so every verdict can be inspected.

## Main Workflow

1. Open the Start tab and fill the Research Brief.
2. Choose Buy for a fresh entry or Sell to review an already-held position.
3. Enter the ticker, exchange, horizon, capital or add-more capital, and optional holding details.
4. Add risk controls such as invalidation price, target price, max risk, risk profile, market access, and personal filters.
5. Click Analyse in the header to refresh/load evidence through the bridge when available.
6. Read the Decision tab first, then use Chart, Company, Portfolio, AI Coach, Reasoning, and Glossary for deeper context.

## Workspace Tabs

### Start

The Start tab is the input workspace. It is currently titled Research Brief.

It captures:

- Ticker and exchange.
- Investment horizon.
- Fresh-entry capital or add-more capital.
- Buy/Sell action selection, where Buy analyses a new position and Sell reviews an existing holding.
- Bought date, quantity, and average price for holding reviews.
- Risk profile and market-access mode.
- History window for market-data refresh.
- Manual LTP, invalidation price, and target price.
- Company overrides for market cap, debt/equity, ROCE, P/E, and profit trend.
- Personal filters such as avoid high debt, avoid small caps, avoid low liquidity, no intraday/swing, and no averaging losers.
- Thesis or report notes.

The Copy brief button copies the current research context so it can be reviewed or pasted elsewhere.

### Decision

The Decision tab is the answer page.

It shows:

- Verdict and score out of 100.
- Data confidence.
- Ticker, LTP, capital, quantity plan, risk budget, exit line, reward/risk, P&L, and portfolio weight depending on decision mode.
- Buy plan and exit discipline for fresh entries.
- Next actions, avoid-list, and why-this-answer guidance.
- Price drivers behind the answer.
- Metric clue flashcards grouped by technical, fundamental, statement, news, risk, and process signals.
- Missing-data warnings when the app cannot produce a high-confidence answer.

The app intentionally separates "Needs Input" from negative verdicts. Missing data means the evidence is incomplete, not automatically that the stock is bad.

### Chart

The Chart tab is an interactive technical analysis workspace.

It uses `src/PriceChart.tsx` and `lightweight-charts` for:

- Candlestick rendering.
- Hover/crosshair OHLC legend.
- Fit-to-view reset.
- 1D, 1M, 3M, 6M, 1Y, and All time windows.
- SMA 20/50/100/200.
- EMA 20/50.
- VWAP.
- Bollinger Bands.
- Volume histogram.
- Range high/low lines.
- RSI 14 pane.
- MACD pane.
- ATR 14 pane.
- Candlestick pattern markers.
- Bear/base/bull scenario forecast lines.

The tab also includes:

- Scenario Forecast controls with adaptive, technical, fundamental, and custom modes.
- Forecast horizon controls from 5 trading days to 10 years.
- Optional assumptions for volatility, trend influence, fundamental growth, valuation rerating, event risk, and custom annual returns.
- Detected pattern flashcards explaining how to spot, interpret, use, and invalidate candle patterns.
- A chart-reading guide for non-intraday trading.
- Position, risk, range, liquidity, and business-filter flashcards.

Chart output is designed for delayed end-of-day analysis, not live intraday execution.

### Company

The Company tab is the fundamental analysis workspace.

It includes:

- Company profile and business summary.
- Sector, industry, country, employee count, and source information when available.
- Ratio flashcards grouped by valuation, profitability, balance sheet, cash conversion, growth, and shareholder return.
- Recent filing/update cards with business meaning and possible price effect.
- Business quality score.
- Statement flow for P&L, balance sheet, cash flow, and valuation.
- Due-diligence checklist.
- Missing-fundamentals callout when the bridge could not fetch Screener/Yahoo-backed company data.

The app auto-fills blank company override fields from fetched fundamentals when available, while still letting the user edit those values.

### Portfolio

The Portfolio tab handles holdings, quotes, sync status, and diagnostics.

It supports:

- Zerodha-style XLSX holdings upload.
- Portfolio snapshot, current value, P&L, return, and loaded holdings count.
- Combined holdings and market-data table.
- Mobile-friendly portfolio cards.
- Row-level Analyze actions.
- Sync Market Data flow with progress.
- Remove uploaded feed.
- Quote, candle, volume, previous close, data status, and P&L columns.
- Missing Data Resolver for symbols that need mapping, retry, or unsupported marking.
- Symbol mapping upsert through the bridge.
- Connection diagnostics and copyable commands.

Uploaded holdings are personal financial data. Treat them as local/private and do not commit generated cache or holdings files.

### Grounded Analyst and AI Coach

After Analyse completes its market-data refresh, the app makes one grounded-analysis request and reuses the validated response across Decision, Chart, Company, Portfolio, Reasoning, and AI Coach. The deterministic engine remains authoritative for prices, calculations, scores, position sizing, and the verdict.

The AI Coach presents the shared response in three scopes:

- Chart: price action, indicators, candles, patterns, liquidity, and volatility.
- Company: business model, ratios, statements, filings, and missing evidence.
- Verdict: final action, risk controls, what to do next, and what not to do.

Full analysis calls go through `POST /api/llm/analysis`; `POST /api/llm/verdict` remains as a compatibility endpoint. The bridge retrieves up to 10 relevant paraphrased Varsity rules, combines them with exact structured facts, validates the model JSON, retries one malformed response, and leaves deterministic content in place when the provider is unavailable. LLM provider secrets stay on the bridge machine and must not be placed in `VITE_` variables.

Retrieval uses the internal versioned `RetrievedRuleSetV1` contract. It records the corpus and embedding versions, query fingerprint, filters, hybrid scores, paraphrased guidance, applicability, and source references. The identical payload is used by base Gemini today and exported with fine-tuning examples later, so switching generation models does not require rebuilding RAG.

#### Varsity RAG corpus

The tracked rulebook stores chapter titles, source metadata, and paraphrased analytical guidance, not raw chapter prose.

```bash
python3 tools/build_varsity_corpus.py --include-web
python3 -m server.llm_analysis build-index
```

Add `--embeddings` to the second command after setting `GEMINI_API_KEY` to build and query 768-dimensional `gemini-embedding-2` vectors. Semantic builds are resumable and use a staging database; the last complete index remains active until all 787 expected vectors are present. Unchanged content hashes reuse existing vectors. Without a complete vector index, retrieval automatically uses the local lexical index.

Run the reviewed retrieval benchmark with:

```bash
python3 tools/evaluate_retrieval.py
```

The tracked query set covers every Varsity module and app analysis area, with a target of at least 90% top-10 recall.

#### No-cost Gemma bake-off

The original 120 templated rows now live in `contract_fixtures.jsonl`; they test contracts and edge cases but are not treated as financial-reasoning gold. The real gold pipeline uses 63 timestamped public instruments and creates 75 train, 15 validation, and 30 sealed-evaluation cases without using uploaded holdings.

```bash
python3 tools/reasoning_dataset.py validate-manifest
python3 tools/reasoning_dataset.py collect
python3 tools/reasoning_dataset.py generate --rpm 15 --wait-on-short-quota --max-wait-seconds 600
python3 tools/review_candidates.py --dataset reasoning
python3 tools/reasoning_dataset.py approve --requested-by-user
python3 tools/reasoning_dataset.py seal
python3 tools/llm_dataset.py export --pilot
```

Gemini Flash generates and expands the reasoning examples within free-tier quota. Generation is paced at 15 RPM, every completed row is checkpointed, bounded short-window quota delays are retried, and daily or hard limits stop safely for a later resume. Twice-invalid answers are quarantined and block approval until regenerated. The complete `RetrievedRuleSetV1` payload is embedded in every provider-neutral training row.

The teacher generator is provider-neutral. `tools/teacher_bakeoff.py` can compare OpenAI GPT-5.4 mini or Cerebras GPT-OSS 120B against accepted Gemini cases using identical facts, RAG rules, and strict audit gates. OpenAI and Cerebras candidates use constrained `LlmAnalysisV1` JSON decoding and are written only to ignored comparison artifacts; the gold corpus is unchanged until a reviewed teacher is explicitly selected. OpenAI reports include prompt, cached, completion, and reasoning-token usage plus an estimated USD cost so a small bake-off can be reviewed before corpus-scale generation. `tools/model_bakeoff_eval.py` also supports a complete OpenAI validation baseline with response reuse, which lets evaluator and presentation fixes rescore verified raw responses without buying another generation.

For an isolated GPT-5.4 mini teacher comparison, keep the production `LLM_MODEL` on Gemini and set only `OPENAI_API_KEY` plus `OPENAI_DATASET_MODEL=gpt-5.4-mini` in `../.env`, then run:

```bash
python3 tools/teacher_bakeoff.py --provider openai --limit 3 --rpm 2
```

The included `notebooks/gemma_bakeoff_colab.ipynb` prefers `Gemma 4 E4B IT`, then tries the smaller `Gemma 4 E2B IT` or `Gemma 3 4B IT` candidates with the identical corpus, RAG payload, loss masking, seed, and promotion gates. Live full-sequence probes confirmed that these candidates require a BF16-capable accelerator; a free Tesla T4 falls back to float32 attention and runs out of memory even at rank 8 with attention-only LoRA. The training CLI now rejects non-BF16 hardware before downloading model weights. `Gemma 4 12B IT` remains an optional stronger-accelerator experiment. Training enforces no truncation and records resumable, checksummed run manifests. Model artifacts and generated split files remain untracked.

After the 75/15 pilot improves validation quality, `tools/llm_dataset.py expand` creates 1,080 audited descendants and preserves each gold case's split lineage. `tools/model_bakeoff_eval.py` compares Gemini, OpenAI baselines, untuned Gemma, and tuned Gemma with reports bound to exact source hashes, artifacts, responses, and human reviews. The 30-case evaluation set requires a passing validation comparison and allows each model role to run only once; promotion remains blocked unless every grounding, schema, completeness, human-quality, reliability, and 120-second latency gate passes. See `data/training/README.md` for the complete commands.

### Reasoning

The Reasoning tab is the audit trail.

It shows:

- Decision path steps.
- Plain-English explanation.
- Formula or interpretation for each step.
- Rationale and takeaway.
- Practical price checks from the trading-rule layer.
- Positive signals and data freshness.

### Glossary

The Glossary tab is a searchable term guide covering verdict terms, market data, chart structure, indicators, candlesticks, risk, sizing, portfolio concepts, fundamentals, statements, data quality, and AI Coach terms.

## How The Analysis Engine Works

The core engine is `buildAnalysis(form, snapshot, cacheState)` in `src/App.tsx`.

Inputs:

- `AnalysisForm`: user-entered ticker, exchange, horizon, capital, holding details, risk controls, manual overrides, thesis, and filters.
- `Snapshot`: provider name, generated time, symbols, quotes, candles, fundamentals, holdings, upload metadata, and provider errors.
- `CacheState`: loading, live, free, or sample.

The engine:

1. Normalizes ticker, exchange, quote key, holding row, candles, and fundamentals.
2. Chooses fresh-entry mode or holding-review mode.
3. Builds price and chart signals from LTP, previous close, trend, volatility, candle history, RSI, MACD, ATR, VWAP, Bollinger position, patterns, and liquidity.
4. Builds company signals from market cap, valuation, profitability, leverage, margins, growth, cash flow, company updates, and statement summaries.
5. Adds portfolio signals such as current value, invested value, P&L, P&L %, concentration, and portfolio weight.
6. Applies risk controls such as risk budget, invalidation price, target price, reward/risk, max risk, and starter/suggested quantity.
7. Applies practical trading and sector rules from `src/tradingKnowledge.ts`.
8. Produces verdict, score, confidence, actions, positives, cautions, do/don't items, why items, signal cards, score components, trading lessons, and reasoning steps.

Score tone currently follows these bands:

- 62 and above: positive.
- 43 to 61: neutral.
- 42 and below: negative.

The score is not the whole answer. The app pairs it with confidence, missing-data warnings, and action guidance.

## Data Sources

The app can run from manual inputs alone, but richer analysis uses the local bridge.

Data can come from:

- User-entered form values.
- Manual LTP and company overrides.
- Browser-local workspace cache.
- Zerodha-style holdings XLSX uploads.
- Yahoo Finance public endpoints for delayed/end-of-day candles and best-effort quote/company data.
- Screener.in pages/search for company profile, ratios, statements, pros/cons, and updates.
- Local symbol mapping data.
- Generated trading and sector rules in `src/tradingKnowledge.ts`.

Free public data is best effort. Availability varies by exchange, symbol, provider, and rate limits.

## Privacy And Local State

- The frontend is a static browser app.
- Workspace state is saved in `localStorage` under `verdict-workstation:browser-workspace:v1`.
- Uploaded holdings are parsed in bridge memory and returned directly to the requesting browser. The workbook, holdings rows, and upload metadata are not persisted by the bridge.
- Holdings and portfolio workspace state remain in browser `localStorage`; bearer sessions use tab-scoped `sessionStorage`.
- Only non-personal market-data cache entries are persisted server-side.
- AI provider credentials are read only by the Python bridge.
- `VITE_` variables are public at build time and must not contain secrets.
- Private-group deployments need a protected HTTPS bridge if refresh, upload, mapping, or AI Coach should work outside localhost.

## Local Setup

Use Node.js `>=22.13.0`.

Install dependencies:

```bash
npm install
```

Start the Vite dev server:

```bash
npm run dev
```

Start a LAN-accessible dev server:

```bash
npm run dev:lan
```

Build the production bundle:

```bash
npm run build
```

Preview the production bundle:

```bash
npm run preview
```

Run lint and tests:

```bash
npm run lint
npm run test
```

## Optional Data Bridge

The bridge lives one directory above this app, in `../scripts`.

From the parent `New project` directory:

```bash
python3 scripts/market_data_server.py --host 127.0.0.1 --port 8787
```

By default, the app auto-detects the bridge at:

```text
http://<current-browser-host>:8787
```

For hosted or non-local bridge URLs, set this before building:

```bash
VITE_MARKET_DATA_BASE_URL=https://your-bridge-url
```

Bridge endpoints used by the app:

- `POST /api/session`
- `GET /api/free-data/latest`
- `GET /api/symbols/search`
- `POST /api/free-data/refresh`
- `POST /api/portfolio/upload?days=...`
- `POST /api/portfolio/clear`
- `POST /api/symbol-map/upsert`
- `POST /api/llm/analysis`
- `POST /api/llm/verdict`
- `POST /api/server/restart`

All `/api/` routes except `/api/session` require a short-lived signed bearer token when group access is enabled. The frontend keeps that token in `sessionStorage` and sends it for search, market data, uploads, mappings, RAG-backed analysis, and compatibility calls.

### Private-group bridge protection

For access beyond the bridge machine, configure a shared code, an independent signing secret, and an exact frontend origin:

```bash
BRIDGE_GROUP_ACCESS_CODE=your-long-shared-code
BRIDGE_TOKEN_SECRET=your-long-random-signing-secret
MARKET_DATA_ALLOW_ORIGIN=https://your-frontend.example
```

Users enter the shared code under **Private bridge** in the app menu. `POST /api/session` exchanges it for a short-lived HMAC-signed token; the code itself is not saved in browser storage. Configure token lifetime and limits with `BRIDGE_TOKEN_TTL_SECONDS`, `BRIDGE_RATE_LIMIT_PER_MINUTE`, and `BRIDGE_SESSION_ATTEMPTS_PER_MINUTE`.

Remote access fails closed when an external origin is configured without `BRIDGE_GROUP_ACCESS_CODE`. Wildcard origins are rejected. Use an HTTPS tunnel or hosted HTTPS bridge, keep Gemini and bridge secrets server-side, and allow only the exact frontend origin. A later public release can replace code validation with OIDC/JWT while preserving the bearer-token and RAG contracts.

Related bridge scripts:

- `../scripts/market_data_server.py`: local HTTP bridge entrypoint.
- `../scripts/free_data_server.py`: bridge server implementation.
- `../scripts/free_data_refresh.py`: delayed/free market-data refresh.
- `../scripts/market_data_refresh.py`: wrapper for refresh CLI usage.
- `../scripts/holdings_parser.py`: Zerodha-style XLSX holdings parser.
- `../scripts/kite_refresh.py`: optional Kite-related refresh script.
- `../scripts/varsity_knowledge_refresh.py`: knowledge refresh utility.
- `tools/build_varsity_corpus.py`: canonical local-PDF and web-chapter corpus builder.
- `tools/reasoning_dataset.py`: public snapshot collection and real reasoning-gold approval pipeline.
- `tools/llm_dataset.py`: leak-proof Gemini expansion and provider-neutral dataset export.
- `tools/gemma_bakeoff.py`: Unsloth QLoRA training and GGUF export.
- `tools/model_bakeoff_eval.py`: resumable Gemini, OpenAI, and local Gemma evaluation with cost telemetry and promotion gates.
- `tools/prepare_mlx_runtime.py`: checksummed MLX conversion and loopback-only local serving.
- `tools/review_candidates.py`: local human-review and approval workspace.
- `tools/approve_candidates.py`: strict grounding audit and provenance-aware delegated approval.
- `tools/evaluate_llm.py`: deterministic schema and grounding checks.
- `tools/train_vertex.py`: gated Gemini Flash Vertex tuning submission.

## Optional Grounded Analyst Setup

Set these on the machine running the bridge:

```bash
GEMINI_API_KEY=...
LLM_MODEL=gemini-3.5-flash
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
LLM_TEMPERATURE=0.2
LLM_TIMEOUT_SECONDS=90
LLM_MAX_OUTPUT_TOKENS=8192
LLM_PROVIDER_RETRIES=2
```

Fallback names are also supported:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`

The Gemini API's OpenAI-compatible transport is used by both the runtime analyst and offline dataset tools. `GEMINI_DATASET_MODEL` can override the model used for preflight and expansion without changing the deployed runtime model.

For a tuned Vertex endpoint, set `LLM_PROVIDER=vertex`, `VERTEX_TUNED_MODEL_URL`, and Application Default Credentials (or a short-lived `VERTEX_ACCESS_TOKEN`). The base OpenAI-compatible configuration remains the rollback path.

### Optional Local Gemma Setup

Use MLX-LM `0.31.2` or newer as the Gemma 4 quality-reference runtime on Apple Silicon. Convert the selected run's merged Hugging Face model into a versioned local directory, then serve it on loopback:

```bash
python3 tools/prepare_mlx_runtime.py convert \
  --merged-hf /path/to/gemma-run/merged_hf \
  --run-manifest /path/to/gemma-run/run_manifest.json \
  --output data/generated/gemma_bakeoff/runtime/gemma-e4b-mlx8 \
  --bits 8

python3 tools/prepare_mlx_runtime.py serve \
  --model data/generated/gemma_bakeoff/runtime/gemma-e4b-mlx8 \
  --port 8080
```

Copy `modelArtifactHash` and `quantization` from `runtime_manifest.json` into the protected bridge configuration:

```bash
LLM_PROVIDER=local
LLM_BASE_URL=http://127.0.0.1:8080/v1
LLM_API_KEY=local-only
LLM_MODEL=verdict-gemma
LOCAL_MODEL_ARTIFACT_HASH=sha256-from-runtime-manifest
LOCAL_MODEL_QUANTIZATION=MLX-8bit
LOCAL_LLM_TIMEOUT_SECONDS=120
LOCAL_LLM_MAX_TOKENS=8192
```

The bridge rejects a local-model URL that is not loopback, serializes local generations, coalesces duplicate requests, and versions its cache with the artifact hash and quantization. The MLX server is never tunnel-exposed directly. Set `LOCAL_LLM_FALLBACK=gemini` plus `GEMINI_API_KEY` only when Gemini fallback is desired. A failed local or fallback response never replaces deterministic analysis.

The Q8_0 GGUF is a compatibility artifact, not the default runtime. Test llama.cpp first on the documented three-case validation smoke set and compare it with MLX. Do not promote llama.cpp when it changes grounding, schema compliance, completeness, or reviewed answer quality.

## Deployment

The frontend can be deployed as a static Vite app.

If deploying this app from a larger repository, use this app directory as the frontend root:

```text
New project/stock-analysis-app
```

Build command:

```bash
npm run build
```

Output directory:

```text
dist
```

Included hosting files:

- `vercel.json`: Vercel build/output configuration and SPA rewrite.
- `public/_redirects`: static-host SPA fallback.

Read-only hosting works with no bridge. Refresh, upload, symbol mapping, and AI Coach need a reachable HTTPS bridge plus `VITE_MARKET_DATA_BASE_URL`.

## Project Structure

```text
stock-analysis-app/
  src/
    App.tsx                  Main app state, views, analysis engine, bridge calls
    App.css                  Full visual system and responsive layout
    FlashcardDeck.tsx        Reusable swipe/keyboard/tap flashcard carousel
    PriceChart.tsx           lightweight-charts candlestick/indicator component
    tradingKnowledge.ts      Generated sector and practical trading rules
    __tests__/
      buildAnalysis.test.ts  Unit tests for formatters and analysis behavior
  public/
    _redirects               Static-host SPA redirect
  .env.example               Public bridge URL example and AI secret note
  package.json               Scripts and dependencies
  vercel.json                Static deployment config
```

## Testing

The test suite currently covers:

- INR and percent formatting.
- Score tone bands.
- Default risk profile behavior.
- Empty form behavior.
- Fresh-entry quantity/risk calculation.
- Existing-holding review behavior.

Run it with:

```bash
npm run test
```

## Limitations

- Not investment advice.
- Not a trade execution tool.
- Not guaranteed real-time data.
- Free/delayed public data can be stale, incomplete, unavailable, or rate-limited.
- Some BSE/NSE symbols require manual Yahoo/Screener mapping.
- Forecasts are scenarios, not promises.
- AI Coach explains the app's evidence; it should not override independent due diligence.
- Always verify important decisions against exchange filings, annual reports, broker data, and your own risk rules.
