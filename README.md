# Verdict Workstation

AI-assisted stock research workstation for NSE/BSE analysis, portfolio review, and grounded decision support.

Live demo: https://verdict-workstation.vercel.app

Main app path: `New project/stock-analysis-app`

## Recruiter Quick Read

Verdict Workstation is a React, TypeScript, Vite, and Python project built to explore reliable AI-assisted analysis rather than a simple chatbot wrapper. It combines deterministic financial calculations with an optional grounded LLM layer, a local Python bridge, market-data ingestion, schema validation, fallbacks, and audit-focused reasoning views.

The project is most relevant to roles involving agentic AI, API integrations, workflow reliability, prompt engineering, and production-grade troubleshooting.

## What The App Does

- Analyses NSE/BSE tickers for fresh-entry and existing-holding decisions.
- Uploads and parses Zerodha-style holdings files for portfolio review.
- Syncs delayed/free market data through a Python bridge.
- Shows charts, indicators, fundamentals, portfolio exposure, risk controls, and reasoning trails.
- Uses an optional AI Coach to explain chart, company, and verdict context in plain English.
- Keeps deterministic calculations authoritative for prices, P&L, position sizing, risk, scores, and verdicts.
- Stores user workspace state in the browser and avoids committing personal holdings/cache data.

This is an educational decision-support tool. It is not investment advice, live trading software, or an order-execution system.

## Architecture

```text
React + TypeScript UI
  -> deterministic analysis engine
  -> browser-local workspace state
  -> optional Python bridge
       -> market data fetchers
       -> holdings parser and symbol resolver
       -> grounded LLM analysis endpoint
            -> retrieved Varsity-style rules
            -> structured facts
            -> schema validation
            -> retry/fallback handling
```

Core pieces:

- `New project/stock-analysis-app/src`: React UI, analysis flow, charts, cards, and local state.
- `New project/stock-analysis-app/server`: Python LLM/RAG and bridge-support modules.
- `New project/scripts`: market-data refresh, holdings parsing, and local bridge entrypoints.
- `New project/stock-analysis-app/tools`: retrieval, dataset, review, and model-comparison tooling.
- `New project/stock-analysis-app/schemas`: structured contracts for generated/validated analysis.

## Agent And Reliability Design

The AI layer is deliberately treated as optional and failure-prone. The app therefore includes:

- Deterministic fallback when the model provider is unavailable.
- Structured JSON validation before model output is used by the UI.
- One retry for malformed model responses.
- Secret isolation: model/provider keys stay on the bridge and are never exposed as `VITE_` browser variables.
- Retrieved rule payloads with versioned metadata, source references, scores, and applicability flags.
- Explicit data-confidence and missing-data warnings instead of pretending incomplete evidence is conclusive.
- Dataset generation safeguards such as checkpointing, bounded quota waits, invalid-answer quarantine, review gates, and sealed evaluation splits.

These choices map directly to agentic-workflow concerns: non-happy paths, data contracts, retries, timeouts, observability-friendly traces, and safe degradation.

## How To Run

```bash
cd "New project/stock-analysis-app"
npm install
npm run dev
```

Optional bridge, from the parent project folder:

```bash
cd "New project"
python3 scripts/market_data_server.py --host 127.0.0.1 --port 8787
```

Set bridge and LLM values from `.env.example` files. Keep provider secrets outside the frontend.

Useful checks:

```bash
npm run lint
npm run build
npm run test
python3 tools/evaluate_retrieval.py
```

Some Python commands require local environment setup and provider keys.

## Screenshots To Add

Add current screenshots before sharing widely:

- Decision workspace with verdict, confidence, and next actions.
- Chart tab with indicators and scenario controls.
- Portfolio tab after sample holdings import.
- AI Coach response with grounding/fallback notes.
- Reasoning tab showing the audit trail.

## AI Usage Transparency

This is an AI-assisted learning and portfolio project. Codex was used to accelerate implementation, documentation, and review cycles. The project is still presented as my work because I define the product requirements, inspect the code, validate behavior, run checks, and make the architecture/reliability decisions.

## Current Limitations

- Market data is delayed/free-source and best effort.
- The deployed frontend works best with a configured bridge for richer data and AI Coach flows.
- Some advanced dataset/model tooling is experimental and intended for learning, not production investing.
- The repository still contains a nested project path; a future cleanup should split the app into a cleaner top-level repository.

## Why This Project Matters For Netomi's Agentic Engineer Role

Netomi's role asks for prompt engineering, API integrations, JSON workflows, unit testing, debugging, retries, timeouts, idempotency, performance, cost, and fault-tolerance thinking. This project demonstrates those ideas in a concrete workflow: structured market facts enter the system, deterministic logic remains authoritative, the LLM layer explains and enriches only after validation, and the app degrades safely when evidence or providers are missing.
