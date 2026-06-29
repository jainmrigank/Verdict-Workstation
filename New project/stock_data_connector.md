# NSE/BSE Stock Data Connector

This project now has a local Kite Connect bridge that refreshes stock data into JSON. Codex can read that JSON for future analysis, which avoids repeated web scraping for quotes, candles, holdings, and basic portfolio state.

## What I can do locally

- Read cached quotes, historical daily candles, and holdings from `data/cache/kite/latest.json`.
- Show the same cache in the React app through `react-day1/public/stock-data/latest.json`.
- Keep credentials in `.env`, which is ignored by git.
- Use the Zerodha/Kite API for current market and portfolio data.

## What I still need from you

- A Kite Connect app from Zerodha.
- `KITE_API_KEY` and `KITE_API_SECRET`.
- A fresh daily `request_token`, or an already generated `KITE_ACCESS_TOKEN`.
- Approval before any live network command is run from this sandbox.

## Setup

1. Copy `.env.example` to `.env`.
2. Fill `KITE_API_KEY` and `KITE_API_SECRET`.
3. Print the login URL:

```bash
python3 scripts/kite_refresh.py login-url
```

4. Open that URL, log in, and copy the `request_token` from the redirect URL.
5. Generate and save the access token:

```bash
python3 scripts/kite_refresh.py session --request-token YOUR_REQUEST_TOKEN --save-env
```

6. Refresh your current watchlist and holdings:

```bash
python3 scripts/kite_refresh.py refresh --symbols NSE:ENGINERSIN BSE:SAMRATPH BSE:REGANTO --days 730 --include-holdings --refresh-instruments
```

## Official Docs

- [Kite Connect v3](https://kite.trade/docs/connect/v3/)
- [Market quotes](https://kite.trade/docs/connect/v3/market-quotes/)
- [Historical candles](https://kite.trade/docs/connect/v3/historical/)
- [Portfolio holdings](https://kite.trade/docs/connect/v3/portfolio/)
