# Verdict Workstation — UI/UX Redesign Plan

**Goal:** Make the app non-bulky and easy to understand for a first-time, non-finance user — without losing any functionality.
**Scope of source:** `src/App.tsx` (7,343 lines), `src/App.css` (4,405 lines), single-page React/Vite app, 7 view states.
**Constraint carried through every decision:** nothing gets deleted. Anything hidden from the default path must remain fully reachable and fully functional.

---

## 0. Audit — what made the original app feel bulky

1. **7 flat top-level tabs** shown all at once: Setup, Decision, AI Coach, Charts, Company, Reasoning, Data Hub. Several labels (Coach, Reasoning, Data Hub) don't self-explain to a layman.
2. **Setup screen** exposed ~15 fields and controls before the user had done anything: Ticker, Exchange, History window, Capital, Horizon, Already-holding toggle + details grid, Risk profile (4-way segmented), Market access (3-way segmented), Max risk slider + unit, plus a collapsed "Evidence and Guardrails" panel with manual overrides, personal filters, and a thesis text box.
3. **Verdict screen** stacked ~8 panels vertically for a single answer: verdict banner → 6–8 metric grid → Buy Plan / Exit Discipline cards → "Adaptive Hybrid Score" panel (previously auto-expanded) → nested "All Signal Contributions" → 3-card do/don't/why grid (previously auto-collapsed, i.e. the actual advice was hidden by default while the score jargon was open) → two more side-by-side panels for raw signals and cautions.
4. **Terminology gap:** "reward/risk," "invalidation price," "adaptive hybrid score," "confidence label," "data confidence means evidence coverage, not certainty" — trader vocabulary with no lay explanation inline (only small `?` tooltips, which itself signals the primary copy isn't self-explanatory).
5. **Every dense screen had the same failure pattern:** advanced/audit content defaulted open, core actionable content defaulted closed.

Directional decision confirmed with you: **full guided-flow redesign** (ticker → verdict first, everything else on demand), for an audience of **you + non-finance friends/family** — approachable, not a public-newcomer product, so power-user depth stays one click away rather than being removed.

---

## 1. Information architecture change

**Before:** 7 equal-weight tabs in one row.
**After:** 4 primary tabs + 1 "More" menu.

- Primary (always visible): **Get Started** (was "Setup") · **Verdict** (was "Decision") · **Charts** (was "Technicals") · **Company** (was "Fundamentals")
- Secondary, under a **"More ▾"** dropdown: **AI Coach** · **Reasoning** · **Data Hub**

Rationale for the split:
- Get Started → Verdict → Charts → Company is the actual everyday path for "should I buy/hold/avoid this stock."
- Coach/Reasoning/Data Hub are audit, explainability, and sync tooling — valuable, but not needed on every visit. Moving them under "More" cuts visible tab count from 7 to 5 without removing a single feature.
- No `View` type or state logic changes — same `view` string union, same `setView` calls. Only the **rendering** of the nav bar changes (split into `primaryWorkspaceTabs` + `moreWorkspaceTabs` arrays, plus a `moreMenuOpen` boolean state and a dropdown panel). This kept the change low-risk since it doesn't touch any business/analysis logic.
- Default landing view stays `setup`; the app already auto-calls `setView('verdict')` once analysis loads, so the guided flow ("enter ticker → verdict first") was already half-implemented and just needed the front door decluttered.

**Status: implemented.**

---

## 2. "Get Started" (Setup) screen changes

**Before:** one always-open panel with 15 fields/controls.
**After:** progressive disclosure — 4 essential fields visible, everything else behind a collapsed "Advanced setup" panel with safe defaults.

Always visible now:
- Ticker
- Exchange
- Capital to deploy
- Horizon
- "Already holding" toggle (reveals holding-specific fields only when checked — unchanged behavior)
- Load & Analyse / Copy brief buttons

Moved into a new collapsed-by-default **"Advanced setup (optional)"** sub-section, with a one-line explanation that defaults are already sensible:
- Risk profile (segmented: Conservative / Balanced / Balanced+Aggressive / Aggressive) — default `balanced_aggressive`, unchanged
- Market access (segmented: Delivery only / F&O context / Hedging allowed) — default `hedging`, unchanged
- History window (days of candles to fetch) — default `730`, unchanged
- Max risk slider + risk unit (% of capital vs. rupee amount), and the "Add-more sizing is inactive" idle-state explainer for holding-review mode

Existing "Evidence and Guardrails" panel (manual data overrides, personal filters, investment thesis) was **already collapsed by default** in the original code — left structurally alone, just retitled/re-described in plainer language: **"Fine-tune the evidence"** with a one-line explanation that it's optional and only needed to override stale figures.

Copy changes:
- Section eyebrow/title: "Decision brief / Analyse One Fund" → "Step 1 / Get Your Verdict," with a plain-language one-liner replacing the trader-toned description.
- Panel title: "Instrument and Money Context" → "Tell us what you're looking at."
- "Evidence and Guardrails" → "Fine-tune the evidence."

**Status: implemented and visually verified** (screenshots taken via a headless build).

---

## 3. Verdict screen changes

**Before:** verdict banner → metrics → plan cards → auto-open score breakdown → auto-open nested signal contributions → do/don't/why cards (auto-collapsed) → two side-by-side raw-signal/caution panels (auto-collapsed).

**Changes made:**
1. **"Adaptive Hybrid Score" → renamed "See the full score breakdown," now collapsed by default** (was auto-open). Added a one-line explainer: "How the 0–100 score above was built, signal by signal. Most people won't need this." The nested "All Signal Contributions" panel inside it is unchanged (was already collapsed).
2. **"Buy, Quantity, and Exit Plan" and "What Not to Do" cards now open by default** (previously collapsed, which meant the actual recommendation was hidden while the score jargon was showing). "Why This Verdict" intentionally left collapsed — it's supporting rationale, not the primary instruction.
3. **Merged the two side-by-side "Entry/Exit Signals" and "Cautions" panels into a single collapsed section**, "Every signal & caution behind this verdict," with the two lists now nested inside as sub-cards rather than two separate top-level bordered boxes. Cuts one full panel's worth of visual weight.
4. **Simplified one jargon-heavy sentence** in the holding-review verdict summary (removed the "data confidence means evidence coverage, not certainty of recovery" trailing clause, which added technical nuance without helping a first-time reader).
5. Metric grid, buy/exit plan cards, and verdict banner itself were left structurally as-is — they were already reasonably compact and are the actual "answer," so they stay visible by default.

**Status: implemented and visually verified**, including the empty ("Needs Input") state and mobile width.

**Follow-up fixed:** the guidance-grid column ratio was squared to `1fr 1fr 1fr` (previously `1.1fr 1fr 1fr`) — confirmed via direct DOM measurement that the earlier "narrower" appearance was a height illusion from the collapsed "Why This Verdict" card, not an actual width bug, but the ratio was tidied up regardless for pixel-perfect symmetry.

**Added: AI Coach promotion.** A callout — "Confused by any of this? Ask the AI Coach to explain this verdict in plain English →" — now sits directly under the verdict summary. Clicking it switches to the AI Coach tab and, if no review has been generated yet, kicks off `generateAiCoachReview()` automatically. This surfaces the most approachable content in the app (plain-English explanation) at the exact moment someone is looking at a verdict they don't fully understand, without duplicating the Coach view's logic into the Verdict screen.

---

## 4. Charts (Technicals) view changes

**Before:** 14 chart-indicator toggle buttons always visible in one row (SMA20/50/100/200, EMA20/50, VWAP, Bollinger, Volume, Range, RSI, MACD, ATR, Patterns), plus — whenever "Scenario Forecast" was switched on — 8 always-visible assumption fields (Horizon, Forecast type, Volatility multiplier, Trend influence %, Fundamental growth %, Valuation rerating %, Event risk, plus 3 custom bear/base/bull return fields when in custom mode).

**Changes made:**
1. **Indicator toggles split into "common" (5, always visible) + "More indicators" (9, expandable):** Volume, Range, Patterns, SMA 20, EMA 20 stay in the main row; SMA 50/100/200, EMA 50, VWAP, Bollinger, RSI, MACD, ATR move behind a "More indicators" button that expands a second row. No indicator was disabled or changed — same state object, same toggle function, just fewer buttons competing for attention by default.
2. **Forecast assumptions split:** Horizon and Forecast type (the two choices a casual user actually wants to make) stay visible when Scenario Forecast is switched on. Volatility multiplier, Trend influence %, Fundamental growth %, Valuation rerating %, Event risk, and the custom bear/base/bull return fields moved into a collapsed "Advanced forecast assumptions (optional)" sub-section with the same "defaults are already applied" framing used in Get Started.
3. The existing "Position, Risk, Range, and Liquidity" card grid (Price Trend, Cost vs Current Value, Concentration, Size and Reward, Range and Liquidity, Quality Checklist) was audited and left untouched — it was already collapsed by default with plain-language captions on every card, which is the pattern the rest of the app is now moving toward.

**Status: implemented and visually verified**, including the expanded state of both the forecast assumptions and the second indicator row.

---

## 5. Company (Fundamentals) view — audited, no changes needed

Read through both sub-sections ("Company Snapshot, Evidence, and Updates" and "Financial Quality and Due Diligence"). Every card here already ends with a plain-language "Caption:" line explaining what the ratio or chart means and how to use it, and both sub-sections are sensible defaults (open by default, since visiting this tab is itself an opt-in action). No structural or copy changes made — this view was already built the way the rest of the app is now being brought up to.

---

## 6. Screens intentionally still untouched

- **Reasoning** — step-by-step audit trail. Correctly tucked under "More"; no changes made.
- **Data Hub** — sync and ticker-mapping plumbing. Correctly tucked under "More"; no changes made.

---

## 7. Global copy pass, Reasoning declutter, and onboarding tip — completed

**Global tooltip pass on the Verdict screen:** "Exit line," "Reward/risk," and "Data confidence" previously had zero inline explanation (not even the small `?` icons other fields get). Added `HelpTip` tooltips with plain-language text to all three, e.g. Exit line: "The price where the original idea is considered wrong. If the stock falls to or through this level, the plan is to sell rather than hope for a recovery." Chart legend/indicator jargon (VWAP, EMA, Bollinger, etc.) was already covered by tooltips from the Charts-view pass, so no gap there.

**Reasoning view decluttered:** previously every one of the 8 (or so) reasoning steps rendered fully expanded — title, plain-English summary, formula box, rationale, and takeaway, all always visible, making this the single longest-scrolling screen in the app. Restructured each step into its own collapsible card: the plain-English one-liner is now always visible as the card's subtitle, while the formula/rationale/takeaway detail is one click away. Cut the default-visible content on this screen by roughly 4x with zero loss of detail.

- **Bug caught and fixed during this change:** the first attempt reused an existing CSS class (`reasoning-step-header`, a `32px 1fr` grid built for the old icon+title layout) as the new collapsible heading's class, which squeezed every step title into a 32px-wide column and wrapped it one character per line. This was only caught by actually rendering the page in a headless browser and screenshotting it — `tsc` and `vite build` both passed cleanly since it was a CSS/visual issue, not a type or syntax error. Fixed by using the existing generic `subsection-heading` class instead. This is a good example of why visual verification matters even after a build has zero errors.

**One-time onboarding tip added:** a dismissible banner now appears under the nav on first visit to "Get Started": *"New here? Fill in the four fields below and hit Load & Analyse to get a Buy/Hold/Avoid verdict. Everything else — risk settings, charts, company data, and the AI Coach — is optional and one tap away under the tabs above."* Dismissal is remembered via `localStorage` (same persistence mechanism the app already uses for its workspace state) so it won't reappear on later visits, but will still greet a first-time friend/family member using the app on their own browser.

**Status: implemented and visually verified**, including hovering the new tooltips, expanding/collapsing individual reasoning steps, and confirming the onboarding tip persists its dismissed state across a page reload.

---

## 8. Remaining ideas (not yet started, lower priority)

1. **Data Hub** — audited; left untouched. It's already compact (3 sync-overview cards, sync options, upload panel) and directly matches its stated purpose. No jargon or bulk issues found.
2. Could extend the same "explain in plain English" pattern from the Verdict screen to the Charts or Company tabs if you find yourself wanting that there too.
3. Optional: a second onboarding tip on first visit to the Verdict tab itself, similar in spirit to the Get Started one — only worth doing if the Get Started tip proves not to be enough context on its own.

---

## 9. Process notes (how each change was validated)

- Every structural change was followed by `npx tsc --noEmit` (type-check) and `npx vite build` (production build) to catch breakage immediately — this caught one real JSX fragment error during the Charts pass (two sibling elements inside a single `{condition && (...)}` block), fixed before moving on.
- After each pass, the app was actually built and rendered in a headless Chromium instance (Playwright) at both desktop (1400px) and mobile (390px) widths, and screenshotted to visually confirm the change — including clicking through the AI Coach callout end-to-end and measuring actual rendered pixel widths of the guidance cards rather than assuming from a screenshot.
- No business logic, calculation code, API calls, or state shape was changed — only JSX structure/grouping, a handful of copy strings, and the corresponding CSS.

## 10. Final end-to-end validation with real computed data

All screenshots through section 7 were of the empty ("Needs Input") state. As a closing check, a full workflow was run through the actual built app — ticker RELIANCE, ₹1,00,000 capital, manual LTP/invalidation/target prices, and manual fundamentals entered via "Fine-tune the evidence" — producing a real **"Watchlist: Wait for Entry"** verdict at **54/100** with fully computed quantity plan, risk budget, exit line, and reward/risk. This confirmed:

- The new Exit line, Reward/risk, and Data confidence tooltips render correctly against real computed values, not just placeholders.
- The Buy Plan / What Not to Do guidance cards populate with real, specific bullet content (e.g., "cap the risk-sized buy near 25 shares, about ₹33,750").
- The Company tab correctly shows its "Action needed" banner distinguishing manually-overridden decision inputs from the separate live-sync fundamentals grid — expected, pre-existing behavior, not something introduced by this redesign.
- The Charts tab still renders correctly for a loaded ticker, with the same "Refresh EOD data to draw candles" placeholder shown when no live candle sync has run.

No regressions found.

## 11. Visual polish pass

1. **"Needs Input" no longer looks like a warning.** The verdict banner previously used the identical red/rose styling for both "Avoid" (a deliberate negative verdict on a fully-analyzed stock) and "Needs Input" (you simply haven't finished entering data yet). To a first-time user who hasn't done anything wrong, landing on a red alarming banner before even typing a ticker is a bad first impression and conflates two very different meanings. Gave "Needs Input" its own neutral, slate-toned styling, distinct from the red used for a genuine Avoid verdict.
2. **"Why This Verdict" now opens by default,** matching "Buy, Quantity, and Exit Plan" and "What Not to Do." On inspection with real computed data, its content (score weighting breakdown, confidence rationale, sizing logic, sector-mapping status, process-discipline score) turned out to be just as useful and appropriately sized as the other two cards — there was no good reason for it alone to be collapsed, and it removed the last bit of visual asymmetry in that three-card row.
3. **Mobile tab strip now fades at the edge instead of abruptly cutting off.** Added a right-edge mask-image gradient to the horizontally-scrolling tab row on mobile, so a partially visible tab (e.g. "Charts" cut off mid-word) visually reads as "swipe for more" rather than looking like a layout bug.

**Status: implemented and visually verified** at both desktop and mobile widths, including confirming the neutral needs-data banner renders correctly and the "Why This Verdict" card now matches its neighbors.

## 12. Full sweep: UX gaps, consistency, bigger-ticket items, and housekeeping

This round worked through all four categories from the "what's more we can do" list.

### UX gaps — audited, no bugs found
- **"Already holding" flow**: tested end-to-end (toggle reveals Bought on/Quantity/Average price/Add-more capital, hides Capital field). Produced a correct "Hold and Watch" verdict with holding-specific metrics (P&L, P&L%, Weight) and holding-specific guidance ("do not average down," invalidation-level framing). No issues.
- **Portfolio import (Data Hub)**: reviewed the Zerodha XLSX upload panel — clear, self-explanatory, correctly scoped as local-only power-user tooling.
- **Error/loading states**: triggered a real network failure (no local bridge running) — the app already shows a clear, actionable message ("Failed to fetch. Start the local server with: python3 scripts/market_data_server.py") rather than failing silently. No changes needed.
- **Light mode**: checked Get Started and Verdict (including the new neutral needs-data styling and AI Coach callout) — renders cleanly with no contrast or layout issues.

### Consistency/polish
- **Extended the AI Coach callout to Charts and Company**, each with context-specific copy ("Not sure what this chart is telling you?" / "Ratios feeling like alphabet soup?"), so the plain-English explainer is reachable from every analysis screen, not just Verdict.
- **Reconsidered two items from the original list and decided against them**, rather than changing things for their own sake:
  - The "Varsity Knowledge Applied" cards in Reasoning are compact grid cards (not long vertical stacks), so they don't have the bulk problem the numbered reasoning steps had. Left as-is.
  - Blanket-replacing the shared "-" placeholder formatter with "Enter ticker" was rejected: that formatter is reused across dozens of contexts (Company ratios, portfolio weight, dividend yield) where "-" correctly means "no data for this field," not "no ticker entered." Forcing "Enter ticker" everywhere would introduce wrong messages. The existing "Missing: ..." banner already explains gaps accurately per context.

### Bigger-ticket items
- **Added a Glossary tab** under "More" — every jargon term used across the app (verdict basics, risk/sizing, chart indicators, fundamentals), grouped by category, with a live search box that filters by term or definition text. This gives people a place to browse all the terminology at once, complementing (not replacing) the inline tooltips.
- **Accessibility audit with axe-core**: ran an automated scan across every view (Get Started, Verdict, Charts, Company, More menu, Reasoning, Glossary, Data Hub). Found and fixed 3 real issues:
  1. An invalid ARIA structure (`role="tablist"` with a non-tab child once the "More" button was added) — fixed by switching the main nav to `aria-current` semantics, since there was never a paired `tabpanel` structure to justify the tabs pattern in the first place.
  2. `role="menuitemradio"` items were using `aria-selected` instead of the ARIA-spec-correct `aria-checked`.
  3. Two horizontally-scrolling tables in Data Hub had no keyboard access (`scrollable-region-focusable`) and one had an empty table header with no accessible name — both fixed with `tabIndex`, `role="region"`, descriptive `aria-label`s, and a screen-reader-only label for the actions column.
  - Final state: **zero axe-core violations across every view.**
- **Wrote a real README** (the project previously only had the default Vite scaffold template) documenting what the app does, the new information architecture and the design principles behind it, key files, the accessibility posture, and local-only setup constraints.

### Housekeeping
- **Unit tests added.** Found that the core scoring engine, `buildAnalysis(form, snapshot, cacheState)`, is already a standalone pure function outside the React component tree — genuinely testable without any risky refactoring. Added a small set of named exports (purely additive, zero behavior change) and installed Vitest. Wrote 14 tests covering the formatters (`formatInr`, `formatPercent`), `toneFromScore` boundaries, `defaultRiskPercentForProfile` ordering, and — most importantly — `buildAnalysis` itself: the empty-form "Needs Input" baseline, a fully-specified fresh-buy scenario producing a real risk budget and quantity plan, and a holding-review scenario correctly computing position P&L. All 14 pass. `npm test` now runs the suite.
- **Bundle size check**: production build is ~458 KB JS / ~72 KB CSS (~139 KB / ~12.6 KB gzipped). Not alarming for a personal tool, but worth watching if this ever needs to load quickly on mobile data.

**Status: implemented and verified** — full `tsc --noEmit` + `vite build` + `vitest run` all green, plus the axe-core scan and manual screenshot verification of the holding-review flow, light mode, Glossary (including search), and both new AI Coach callouts.

## 13. Two correctness fixes + one confirmed-fine check

1. **"Clear Browser Data" now requires two clicks.** It's a destructive action — wipes the entire form, cached market/company data, and portfolio mapping — that previously fired on a single click with zero confirmation. It now arms on first click (turning solid red: "Confirm clear? This cannot be undone"), requires a second click within 4 seconds to actually run, and silently reverts if left alone. No native `window.confirm()` dialog was used, since those are jarring and inconsistent with the rest of the app's style.
2. **Focus now moves on every view change**, including the automatic jump to Verdict after an analysis loads. Previously there were zero `.focus()` calls anywhere in the app — a keyboard or screen-reader user got no signal that the page had changed; focus just sat on whatever button they'd clicked, which had often scrolled off-screen. Added a visually-hidden, `aria-live="polite"` focus target that receives focus and announces "{Section} section loaded" on every view transition, both from manual tab clicks and automatic navigation. Verified via Playwright that both paths correctly move focus, and re-ran the axe-core scan afterward (0 violations, no regressions).
3. **Checked mobile numeric input types** across every remaining form field (invalidation price, target price, manual company-data overrides, "Bought on" date) — all were already correctly set up (`inputMode="decimal"` on numeric fields, `type="date"` on the date field). No changes needed.

**Status: implemented and visually verified**, including screenshots of the Clear Browser Data button in its default, armed, and auto-reverted states, and a Playwright-driven check confirming focus lands on the new-section announcement after both manual and automatic view changes.
