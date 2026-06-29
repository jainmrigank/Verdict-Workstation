# Free Data Mode

This mode avoids paid Kite Connect data. It is designed for non-intraday NSE/BSE analysis.

## What the button does

The app's `Refresh Free Data` button calls a local server:

```bash
python3 scripts/free_data_server.py
```

That server fetches end-of-day candles from Yahoo Finance's public chart endpoint, updates:

- `data/cache/free/latest.json`
- `react-day1/public/stock-data/latest.json`

The React app then uses the refreshed cache for verdicts.

## Start the app

Terminal 1:

```bash
python3 scripts/free_data_server.py
```

Terminal 2:

```bash
cd react-day1
npm run dev -- --host 127.0.0.1
```

Then open:

```text
http://127.0.0.1:5173/
```

## Symbols

Edit `data/reference/free_data_symbols.json` if a Yahoo symbol needs a custom mapping.

Examples:

- NSE symbols usually map to `.NS`
- BSE symbols often map to a BSE code plus `.BO`, such as `517393.BO`

## Limits

Yahoo Finance data is unofficial and best-effort. Use exchange filings, company reports, and broker statements for final decisions.
