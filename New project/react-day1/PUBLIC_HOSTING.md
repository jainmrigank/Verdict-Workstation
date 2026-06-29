# Public HTTPS Hosting

This app can be hosted as a static HTTPS frontend. The one-click market-data refresh and holdings upload features call the Python data bridge, so those actions need a separate HTTPS bridge URL if you want them to work publicly.

## Prerequisites

- Use Node `22.13.0` or newer. The project includes `.nvmrc`, `.node-version`, and `package.json` engines for this.
- Keep the frontend root as `react-day1`.
- Use `npm run build`.
- Deploy the generated `dist` directory.

## Recommended Path: Vercel With GitHub

1. Create a GitHub repository.

2. Keep the repository private at first. Before pushing, confirm that private portfolio data is not staged:

   ```bash
   git status --short
   ```

   The root `.gitignore` excludes local cache files, uploaded holdings, and `react-day1/public/stock-data/latest.json`.

3. From the project root, push this project to GitHub:

   ```bash
   git add .
   git commit -m "Prepare Verdict Workstation for public hosting"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git push -u origin main
   ```

4. Open `https://vercel.com/new`.

5. Choose `Import Git Repository`, then select your repo.

6. Set project settings:

   - Framework preset: `Vite`
   - Root directory: `react-day1`
   - Build command: `npm run build`
   - Output directory: `dist`
   - Node version: `22.x` or `>=22.13.0`

7. If you want read-only hosting, leave environment variables empty.

8. If you want public refresh/upload too, add this environment variable before deploying:

   ```text
   VITE_MARKET_DATA_BASE_URL=https://your-https-data-bridge-url
   ```

9. Click `Deploy`. Vercel will give you a HTTPS URL like:

   ```text
   https://your-project.vercel.app
   ```

10. Open that URL on your phone or send it to peers.

## Option 1: Public Read-Only App

Use this when you want peers to open the app on HTTPS without seeing or changing your live local portfolio data.

1. Build the frontend:

   ```bash
   cd react-day1
   npm run build
   ```

2. Deploy `react-day1/dist` to Vercel, Netlify, or Cloudflare Pages.

3. The hosted app will read the bundled `stock-data/latest.json` snapshot. Refresh/upload buttons need a bridge and will show a setup warning if no bridge is configured.

## Option 2: Public App With Refresh

Use this only if you are comfortable exposing the data bridge. It can refresh tickers and upload holdings, so treat it as personal financial infrastructure.

1. Put the Python bridge behind HTTPS using a trusted tunnel or a small hosted service.

2. Restrict CORS to your hosted app:

   ```bash
   python3 scripts/market_data_server.py --host 0.0.0.0 --allow-origin https://your-app-url
   ```

3. Build the frontend with the bridge URL:

   ```bash
   cd react-day1
   VITE_MARKET_DATA_BASE_URL=https://your-bridge-url npm run build
   ```

4. Deploy `react-day1/dist`.

## Platform Settings

Vercel:

- Framework preset: Vite
- Build command: `npm run build`
- Output directory: `dist`
- Root directory: `react-day1`

Netlify:

- Build command: `npm run build`
- Publish directory: `react-day1/dist`
- The SPA redirect is already in `public/_redirects`.

Cloudflare Pages:

- Framework preset: Vite
- Build command: `npm run build`
- Build output directory: `dist`

## What Is Needed To Actually Publish

I need one of these from you to complete the live HTTPS deployment:

- A hosting provider choice plus a login/token, such as Vercel, Netlify, or Cloudflare Pages.
- Or a GitHub repository connected to your hosting account, so the provider can deploy from the repo.
- If public refresh should work too, an HTTPS URL for the Python data bridge or permission to set up a tunnel/service for it.
