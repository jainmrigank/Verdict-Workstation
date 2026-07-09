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
2. Choose whether this is a fresh entry or an already-held position.
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
- Already holding mode.
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

### AI Coach

The AI Coach tab can explain the current analysis in three scopes:

- Chart: price action, indicators, candles, patterns, liquidity, and volatility.
- Company: business model, ratios, statements, filings, and missing evidence.
- Verdict: final action, risk controls, what to do next, and what not to do.

AI Coach calls go through `POST /api/llm/verdict` on the Python bridge. LLM provider secrets stay on the bridge machine and must not be placed in `VITE_` variables.

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
- Uploaded holdings are parsed by the bridge and copied into the local snapshot flow.
- AI provider credentials are read only by the Python bridge.
- `VITE_` variables are public at build time and must not contain secrets.
- Public deployments need a separate HTTPS bridge if refresh, upload, mapping, or AI Coach should work outside localhost.

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

- `GET /api/free-data/latest`
- `POST /api/free-data/refresh`
- `POST /api/portfolio/upload?days=...`
- `POST /api/portfolio/clear`
- `POST /api/symbol-map/upsert`
- `POST /api/llm/verdict`
- `POST /api/server/restart`

Related bridge scripts:

- `../scripts/market_data_server.py`: local HTTP bridge entrypoint.
- `../scripts/free_data_server.py`: bridge server implementation.
- `../scripts/free_data_refresh.py`: delayed/free market-data refresh.
- `../scripts/market_data_refresh.py`: wrapper for refresh CLI usage.
- `../scripts/holdings_parser.py`: Zerodha-style XLSX holdings parser.
- `../scripts/kite_refresh.py`: optional Kite-related refresh script.
- `../scripts/varsity_knowledge_refresh.py`: knowledge refresh utility.

## Optional AI Coach Setup

Set these on the machine running the bridge:

```bash
LLM_API_KEY=...
LLM_MODEL=...
LLM_BASE_URL=https://api.openai.com/v1
LLM_TEMPERATURE=0.2
LLM_TIMEOUT_SECONDS=45
```

Fallback names are also supported:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`

`LLM_BASE_URL` can point to an OpenAI-compatible provider.

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
