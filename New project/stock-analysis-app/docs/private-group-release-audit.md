# Private-Group Release Audit

Audit date: 2026-07-14

## Result

The private-group release path is operational and preserves browser-local portfolio privacy. The deployed frontend, protected bridge, semantic RAG index, ticker search, market refresh, deterministic analysis, and grounded Gemini narrative all passed direct acceptance checks.

## Verified

- The production Vercel JavaScript and CSS assets were byte-for-byte identical to a local production build from `main` at commit `3b2d064`.
- The frontend bridge URL and active ngrok tunnel both resolve to the same HTTPS endpoint.
- `/health` reports authentication required, the exact Vercel origin allowlist, and browser-local portfolio storage.
- Protected API calls reject missing bearer tokens.
- The semantic index is complete: 787 rules, 787 embeddings, 768 dimensions, `gemini-embedding-2`, and `build_status=complete`.
- Live ticker typeahead returned market-wide NSE/BSE matches for ETERNAL and populated the selected exchange.
- Live Analyse loaded NSE:ETERNAL market data and preserved the deterministic `Watchlist: Wait for Entry` verdict.
- After raising the remote generation timeout to the measured workload range, the live AI Coach returned a validated grounded response with Varsity RAG references.
- A two-session synthetic-workbook acceptance test issued distinct bearer tokens, returned the two uploaded holdings only to the uploading caller, and found zero holdings or upload metadata in either shared market snapshot.
- A subsequent market refresh returned quotes without holdings. The frontend merge regression test protects the uploaded holdings grid when that response is applied.
- No workbook was written to the bridge, and the legacy holdings persistence file was unchanged.
- ngrok request inspection is disabled so bearer tokens and access codes are not retained in its local request history.

## Failure Safety

- Invalid and expired tokens, origin allowlisting, request limits, lexical retrieval fallback, malformed LLM output repair, local-provider failure, Gemini fallback, and deterministic fallback are covered by server tests.
- The runtime now allows a 90-second remote generation window, an 8,192-token output budget, and two provider attempts by default.

## Manual Browser Coverage

The deployed workflow passed at desktop and 768px tablet widths without horizontal overflow, clipped controls, or overlapping header content. A second browser session independently showed no bridge session and no uploaded portfolio, supporting session isolation.

The 500px pass exposed one genuine regression: ticker identity, LTP, change, and Analyse were still compressed into a single row. The local fix now uses a two-row phone status header, keeps the full ticker visible, places LTP and Analyse on the second row, and preserves the right-aligned action. The closed and open drawer, 500px header, 768px persistent rail, and 1440px desktop layout were visually rechecked locally.

## Release Decision

The protected private-group backend passes. Keep the release private until the phone-header correction is deployed and the 500px production pass is repeated against that deployed commit.
