# Verdict Workstation

A personal NSE/BSE stock decision tool. Enter a ticker and how much you're investing; the app pulls live/delayed market and company data and returns a clear Buy / Watchlist / Hold / Reduce / Avoid verdict, with the reasoning, risk sizing, and technical/fundamental evidence behind it.

This is a single-page React + TypeScript + Vite app (`src/App.tsx`). All scoring, sizing, and verdict logic runs client-side; a small local Python bridge (in the sibling `scripts/` folder) supplies delayed market data, since there's no paid data subscription behind this.

## Getting started

```bash
npm install
npm run dev          # local dev server
npm run dev:lan      # dev server reachable from other devices on your network
npm run build         # type-check (tsc -b) + production build
npm run preview       # serve the production build locally
```

To get real (delayed) market data instead of the empty starter workspace, start the local data bridge from the parent `New project/` folder:

```bash
python3 scripts/market_data_server.py
```

Without it, the app still runs and lets you compute verdicts using manually entered prices and fundamentals (see "Fine-tune the evidence" on the Get Started screen) — useful for testing or for stocks the bridge can't map yet.

## Information architecture

The app is organized as a guided flow rather than a flat set of equal tabs:

| Tab | Purpose |
|---|---|
| **Get Started** | The only required step: ticker, exchange, capital, horizon. Everything else (risk profile, market access, history window, manual data overrides) is tucked behind collapsed "optional"/"advanced" sections with sensible defaults, so a first-time user only sees four fields. |
| **Verdict** | The answer: verdict banner, key metrics, buy/exit plan, and guidance (what to do, what not to do, why). The app auto-navigates here once a verdict is computed. Deeper score-breakdown and raw-signal detail stay collapsed by default. |
| **Charts** | Interactive candlestick chart, indicator toggles (5 common ones visible, 9 more behind "More indicators"), and an optional scenario forecast tool (2 visible fields, the rest behind "Advanced forecast assumptions"). |
| **Company** | Fundamentals, business-quality scoring, and due-diligence checklists, each with a plain-language caption explaining what it means and how to use it. |
| **More ▾** | Secondary/power-user tools, intentionally out of the default view: **AI Coach** (an LLM explains the verdict in plain English — also reachable via a one-click callout on the Verdict/Charts/Company screens), **Reasoning** (a step-by-step audit trail of how the verdict was calculated, each step collapsed to a one-line summary by default), **Data Hub** (local sync controls, portfolio import, symbol mapping — this is genuinely local-dev tooling, not meant for a casual user), and **Glossary** (every jargon term used in the app, defined in plain English, with a search box). |

### Design principles behind this structure

- **Progressive disclosure over flat density.** Every screen leads with only what's needed to act, with detail one click away rather than always-on. Sensible defaults mean the collapsed/advanced options never need to be touched to get a correct answer.
- **Tooltips are backup, not the only explanation.** Jargon terms (exit line, reward/risk, ROCE, VWAP, etc.) get inline plain-language framing where they appear, in addition to being defined in the Glossary.
- **Distinct meanings get distinct visual treatment.** "Needs Input" (you haven't finished entering data) is intentionally styled differently from "Avoid" (a deliberate negative verdict on a fully-analyzed stock) — these used to share the same red warning color, which read as alarming before a first-time user had even done anything.
- **Nothing is removed, only reorganized.** Every field, override, and power-user tool from the original flat-tab layout still exists and is fully functional; this redesign only changed how much is visible by default.

## Key files

- `src/App.tsx` — the entire app: types, scoring/verdict engine, and all view rendering.
- `src/App.css` — all styling, including CSS custom properties for both dark and light themes.
- `src/varsityKnowledge.ts` — the "Varsity Knowledge" rule catalogue referenced by the Reasoning view.

## Accessibility

Verified with an automated `axe-core` scan across every primary and secondary view — zero violations as of the last audit. Notable fixes already applied: the workspace nav uses `aria-current` rather than an incomplete ARIA tabs pattern (there's no paired `tabpanel` structure), the "More" dropdown uses a proper `menu`/`menuitemradio` pattern with `aria-checked`, and horizontally-scrolling tables are keyboard-focusable with descriptive labels.

## Known local-only constraints

- Live market/company data requires the local Python bridge; without it, `Sync Market Data` will show a clear "start the local server" error rather than failing silently.
- The AI Coach's LLM calls also go through that same local bridge — no API key is ever present in the browser.
