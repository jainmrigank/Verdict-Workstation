# Stock Analysis Agent

Stock Analysis Agent is a browser-based NSE/BSE decision workstation for personal stock analysis. It combines manual inputs, delayed/free market data, uploaded portfolio holdings, company fundamentals, chart evidence, risk sizing, and practical trading rules into a structured verdict such as Needs Input, Watch, Buy, Hold and Watch, Reduce, or Avoid.

The app is built with React, TypeScript, and Vite. Most of the decision engine runs directly in the browser; an optional local Python bridge in the sibling `scripts/` folder supplies delayed market data, holdings upload parsing, and AI Coach requests.

This is an educational decision-support tool, not financial advice and not a trading or order-execution platform.

## What The App Does

- Builds a stock-specific verdict from ticker, exchange, investment horizon, holding status, prices, quantity, average price, target, invalidation level, risk profile, company evidence, and portfolio context.
- Separates two workflows: fresh entry analysis and already-held position review.
- Scores chart, company, portfolio, risk, statement-flow, update/event, and process evidence.
- Shows what to do next, what to avoid, what evidence matters most, and which missing data weakens confidence.
- Explains the verdict through visible reasoning steps rather than hiding the answer inside a black box.
- Lets you upload a Zerodha-style holdings XLSX file and analyze each row with current quote and portfolio-weight context.
- Stores the active workspace in the browser so the app can recover after refresh without needing a backend account.
- Supports manual overrides so missing or weak public data can be corrected by the user.
- Includes an optional AI Coach that explains the generated verdict, chart evidence, or company evidence in plain English through the local bridge.

## Main Tabs

### Start

The Start tab is where the analysis context is created.

It includes:

- Ticker and exchange selection.
- Investment horizon.
- Already holding mode for existing positions.
- Quantity, average price, bought date, and add-more capital fields when relevant.
- Optional risk preferences such as avoiding high debt, small caps, low liquidity, intraday/swing behavior, and averaging down.
- Company override fields for profile and fundamentals when public data is missing or needs correction.
- A research brief section that summarizes the current form values for quick review or copying.

The Start tab is designed to be usable with minimal input, while still allowing detailed overrides when a stock needs manual correction.

### Decision

The Decision tab is the main answer page.

It shows:

- Final verdict label and score.
- Confidence level and missing-data warnings.
- Price used for the decision.
- P&L and portfolio-weight context for existing holdings.
- Practical next actions.
- Moves to avoid.
- Key reasons behind the answer.
- Risk controls such as invalidation level, position sizing, and add-more discipline.
- Evidence cards grouped by technicals, fundamentals, portfolio, and process.

For existing positions, the decision logic focuses on whether to hold, reduce, watch, or avoid adding more. For fresh entries, it focuses on whether the setup justifies new capital.

### Chart

The Chart tab turns price history into a practical price map.

It includes:

- Candlestick chart with multiple time windows.
- Moving averages such as SMA and EMA.
- VWAP, Bollinger Bands, volume, range, RSI, MACD, ATR, and pattern overlays.
- Support/resistance style chart context.
- Volatility and liquidity checks.
- Scenario forecast modes such as adaptive hybrid, technical range, fundamental valuation, and custom scenario.
- Bear, base, and bull case projections.

The chart is not meant to predict with certainty. It helps frame the price path, risk zone, and conditions that would improve or weaken the setup.

### Company

The Company tab focuses on the business behind the stock.

It includes:

- Company name, sector, industry, country, and employee count when available.
- Valuation metrics such as market cap, trailing P/E, forward P/E, price/book, and dividend yield.
- Profitability metrics such as ROE, ROCE, ROA, profit margin, gross margin, and operating margin.
- Balance-sheet metrics such as debt/equity and current ratio.
- Cash-flow and growth metrics such as FCF, revenue, net profit, operating cash flow, revenue growth, and earnings growth.
- Statement-flow summaries for P&L, balance sheet, cash flow, and valuation.
- Business-quality scoring.
- Sector-aware operating rules from the local trading knowledge catalogue.
- Notes for missing or weak company evidence.

Manual company overrides from the Start tab can fill or correct this evidence before it is used by the verdict engine.

### Portfolio

The Portfolio tab handles holdings and market-data coverage.

It includes:

- Zerodha-style holdings XLSX upload.
- Browser-local portfolio table.
- Portfolio snapshot, current value, P&L, return, and row-level quote information.
- Row-level Analyze actions that load a holding into the analysis flow.
- Latest price, previous close, change, value, volume, candles, and data-quality status.
- Missing-data resolver and symbol-map update flow.
- Market data refresh controls.
- Clear/upload reset controls.

Uploaded holdings are treated as private local data. They are parsed through the local bridge and cached for browser-local use; they are not meant to be committed to the repository.

### AI Coach

The AI Coach explains the app output in a more conversational way.

It has three focus modes:

- Chart: explains price action, indicators, candles, volatility, liquidity, support/resistance, and possible next moves.
- Company: explains business model, ratios, statements, updates, and data gaps.
- Verdict: explains the final action, risk controls, and evidence that matters most now.

The AI Coach only works when the local bridge is configured with an LLM key. The key stays on the machine running the bridge and is never exposed in the browser bundle.

### Reasoning

The Reasoning tab is the audit trail.

It shows the main decision steps used by the engine, including input checks, price context, capital at risk, technical evidence, company evidence, portfolio context, and final verdict construction.

### Glossary

The Glossary tab defines the finance, trading, portfolio, and app-specific terms used across the interface. It includes terms for chart indicators, valuation, risk, portfolio exposure, and AI Coach modes.

## How The Decision Engine Works

The core decision engine lives in `src/App.tsx` as `buildAnalysis(form, snapshot, cacheState)`.

At a high level:

1. It normalizes the selected ticker, exchange, quote, holdings row, fundamentals, and cached market snapshot.
2. It checks whether the request is a fresh-entry analysis or an already-held position review.
3. It calculates price context, returns, volatility, volume, trend, RSI, MACD, ATR, VWAP, Bollinger position, and candle-pattern evidence.
4. It reads company evidence such as valuation, profitability, leverage, margins, growth, cash flow, and statement-flow signals.
5. It adds portfolio context such as position value, P&L, return, concentration, and portfolio weight.
6. It applies user preferences, risk profile, invalidation level, target price, and add-more capital rules.
7. It applies practical trading rules from `src/tradingKnowledge.ts`.
8. It produces a score, tone, confidence, verdict, next actions, avoid-list, reasons, warnings, signal cards, and reasoning steps.

The score is not treated as a standalone answer. The app pairs it with confidence, missing-data warnings, and concrete next actions.

## Data Sources

The app can work from several sources:

- Manual inputs entered on the Start tab.
- Manual company and price overrides entered by the user.
- Browser-local workspace cache.
- Zerodha-style holdings XLSX uploads.
- Free/delayed market-data refresh through the local Python bridge.
- Yahoo Finance public chart and quote endpoints used by the bridge for end-of-day candles and best-effort company data.
- Screener.in company pages/search used by the bridge as a free fallback for profile, ratios, statements, pros/cons, and due-diligence clues.
- Local practical trading rules generated into `src/tradingKnowledge.ts`.

Free data availability varies by symbol and exchange. Some mappings require manual correction through the app.

## Privacy And Local State

- The React app runs client-side in the browser.
- The active workspace is saved in `localStorage` under `verdict-workstation:browser-workspace:v1`.
- Uploaded holdings are parsed by the local bridge and used to refresh market-data coverage.
- LLM credentials are read only by the bridge from environment variables.
- No LLM key is shipped to the browser.
- Public deployments can host the static app, but upload, refresh, and AI Coach features need a reachable HTTPS bridge.

## Local Development

Requirements:

- Node.js `>=22.13.0`
- npm
- Python 3 for the optional market-data bridge

Install and run the app:

```bash
npm install
npm run dev
```

Run the app on the local network:

```bash
npm run dev:lan
```

Build and preview:

```bash
npm run build
npm run preview
```

Run lint and tests:

```bash
npm run lint
npm run test
```

## Optional Market-Data Bridge

The bridge is in the sibling `scripts/` folder one level above this app directory.

From the parent `New project/` folder:

```bash
python3 scripts/market_data_server.py --host 127.0.0.1 --port 8787
```

When the app runs on `localhost`, `127.0.0.1`, LAN, or `.local`, it will automatically try `http://<host>:8787`.

For a hosted app or non-local bridge, set:

```bash
VITE_MARKET_DATA_BASE_URL=https://your-bridge-url
```

The bridge exposes the endpoints used by the app:

- `GET /api/free-data/latest`
- `POST /api/free-data/refresh`
- `POST /api/portfolio/upload?days=...`
- `POST /api/portfolio/clear`
- `POST /api/symbol-map/upsert`
- `POST /api/llm/verdict`
- `POST /api/server/restart`

## Optional AI Coach Configuration

Set these on the machine running `scripts/market_data_server.py`, either in the sibling `.env` file or in the shell:

```bash
LLM_API_KEY=...
LLM_MODEL=...
LLM_BASE_URL=https://api.openai.com/v1
LLM_TEMPERATURE=0.2
LLM_TIMEOUT_SECONDS=45
```

`OPENAI_API_KEY` and `OPENAI_MODEL` are also supported as fallback names. `LLM_BASE_URL` can point to any OpenAI-compatible provider.

## Public Hosting

The app can be deployed as a static Vite build.

Included hosting helpers:

- `vercel.json` builds with `npm run build` and serves `dist`.
- `public/_redirects` supports single-page-app routing on static hosts.
- `PUBLIC_HOSTING.md` contains more detailed public-hosting notes.

Important hosting note: the static app can be public, but market refresh, holdings upload, and AI Coach need a separately hosted HTTPS bridge and a `VITE_MARKET_DATA_BASE_URL` value at build time.

## Important Files

- `src/App.tsx` - application state, views, scoring engine, formatters, market-data calls, portfolio flow, AI Coach flow, and exported test helpers.
- `src/App.css` - visual system, responsive layout, navigation, cards, forms, tables, chart UI, and theme styling.
- `src/tradingKnowledge.ts` - generated practical trading-rule catalogue and sector operating rules used by the analysis.
- `src/__tests__/buildAnalysis.test.ts` - tests for formatting, score tones, default risk profile, fresh-entry analysis, and holding-review analysis.
- `.env.example` - browser-facing bridge URL example.
- `PUBLIC_HOSTING.md` - public deployment guide.
- `../scripts/market_data_server.py` - local bridge entrypoint.
- `../scripts/free_data_server.py` - bridge server implementation.
- `../scripts/free_data_refresh.py` - free end-of-day market-data refresh logic.
- `../scripts/holdings_parser.py` - Zerodha-style holdings XLSX parser.

## Limitations

- This app is not investment advice.
- It does not place trades.
- It does not provide guaranteed real-time data.
- Free public data sources can be delayed, incomplete, rate-limited, or unavailable for some symbols.
- Screener and Yahoo data are best-effort fallbacks, not official exchange feeds.
- AI Coach explanations should be treated as explanations of the app's evidence, not as independent recommendations.
- Manual review is still required before making any financial decision.
