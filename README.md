# Partsmith Markets

A stock-tracking dashboard built in the Partsmith CAD workbench style: app bar and ribbon on top, watchlist on the left, a drawing-sheet viewport in the middle, an inspector on the right, and a status bar laid out like a title block.

- **Live quotes.** Each viewer can paste their own free Finnhub key, and the page then streams prices every minute. Without a key, it shows the latest data committed by the GitHub Action, which refreshes prices every hour from 10 AM to 5 PM ET and does the full daily update at 3 PM ET.
- **Crowd sentiment.** Reddit mention counts (r/wallstreetbets, r/stocks, r/investing and more, via ApeWisdom) and Stocktwits trending symbols.
- **3 watchlist ideas every trading day.** Each one is scored on catalyst, price action, crowd attention and analyst support, with risks and links to its sources.
- **Daily investing stories.** Each morning (from 7 AM ET, weekends included) the updater pulls investing stories from established newsrooms only — MarketWatch, CNBC, Kiplinger, NPR and The New York Times (edit `story_feeds` in `config.json`). Off-topic and older-than-48-hour stories are dropped.
- **Tips & strategies every 2 hours.** `data/tips.json` holds educational tips and strategies, each linked to the SEC, IRS, FINRA, CFPB, S&P SPIVA or Morningstar. The page shows a new tip and strategy at every even hour, New York time. Add your own entries to that file.
- **Sources everywhere.** Every number links back to where it came from.
- **No build step.** It's plain HTML, CSS and JavaScript, with a standard-library Python script that updates the data.

> **Not investment advice.** The daily ideas come from a transparent scoring rule applied to public data. They don't account for your goals, timeline or risk tolerance.

---

## Quick start (about 5 minutes)

1. **Create the repo.** Push this folder to a new GitHub repository (public or private).

   ```bash
   cd Partsmiths-stock-tracker
   git init && git add . && git commit -m "Partsmith Markets"
   git branch -M main
   git remote add origin https://github.com/<you>/Partsmiths-stock-tracker.git
   git push -u origin main
   ```

2. **Get a free Finnhub key.** Sign up at <https://finnhub.io/register>.

3. **Add the key as a secret.** Go to **Settings → Secrets and variables → Actions → New repository secret**.
   - Name: `FINNHUB_API_KEY`
   - Value: your key

4. **Turn on GitHub Pages.** Go to **Settings → Pages → Build and deployment**.
   - Source: *Deploy from a branch*
   - Branch: `main`, folder `/ (root)`

5. **Run the first update.** Go to **Actions → Update market data → Run workflow**, choose mode `full`, and run it.
   This replaces the seed snapshot (Nov 17, 2026) with live data and today's 3 ideas.

Your site will be at `https://<you>.github.io/Partsmiths-stock-tracker/`.

### Turn on accounts (Log in / Sign up)

Accounts use Google Firebase (free tier). Until this is done, the site works normally and the Log in button says accounts aren't set up.

1. Go to <https://console.firebase.google.com> → **Create a project** (Google Analytics is optional).
2. **Build → Authentication → Get started.** Turn on **Email/Password** and **Google**.
3. **Authentication → Settings → Authorized domains → Add domain:** `<you>.github.io`
4. **Build → Firestore Database → Create database** (production mode). Then open the **Rules** tab, paste the rules below and click **Publish**:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```
5. **Project settings (gear) → Your apps → Web (`</>`)**: register an app, then copy `apiKey`, `authDomain`, `projectId` and `appId` into `assets/firebase-config.js`. These values are public identifiers, not secrets.

Each account stores only `hideWelcome` (the "Don't show this welcome screen again" choice) in `users/<uid>`.

### Run it locally

```bash
python3 -m http.server 8000          # then open http://localhost:8000
```

The page has to be served over HTTP. Opening `index.html` directly from disk blocks `fetch()`.

To refresh the data yourself:

```bash
export FINNHUB_API_KEY=your_key
python3 scripts/update_data.py --mode full     # prices, sentiment, news, picks (~3 min)
python3 scripts/update_data.py --mode quotes   # prices only (~30 s)
```

---

## How it works

```
GitHub Action (hourly + 3 PM ET) ──► scripts/update_data.py ──► data/market.json on the `data` branch ──► page reads it from raw.githubusercontent.com
                               │                                            │
                Finnhub · ApeWisdom · Stocktwits              index.html + assets/app.js
                                                              (re-fetches every 2 min;
                                                               optional live Finnhub polling)
```

| Schedule (weekdays, US Eastern) | Mode | What it does |
|---|---|---|
| hourly, `10 AM – 5 PM` | `quotes` | Prices, ETF index proxies, macro proxies, index history (the 4 PM run picks up the close) |
| `3 PM` | `full` | Prices, Reddit and Stocktwits sentiment, news, analyst trends, earnings calendar, **3 new picks for the next trading day** |

The updater commits to a separate `data` branch that holds only `data/market.json`, so `main` only changes when you push. You never have to pull before pushing, and every copy of the site (Vercel, GitHub Pages, or the folder on your computer) shows the newest data without redeploying. The `data/market.json` on `main` is only a fallback for before the first run.

GitHub cron only understands UTC and can delay or drop runs when it's busy. So the workflow fires every hour at :23 on weekdays and checks the time in New York before doing anything. If the 3 PM run is dropped, the full update runs at the next hour that works, up to 8 PM. For extra reliability, an outside scheduler such as cron-job.org can start the workflow through GitHub's API (`workflow_dispatch` with `mode: auto`).

GitHub may start scheduled runs a few minutes late. Scheduled workflows are also paused after 60 days with no repo activity. Re-enable them from the Actions tab.

### Data sources

| Source | Used for | Key? |
|---|---|---|
| [Finnhub](https://finnhub.io) | Quotes, company profiles, analyst recommendations, company news, market headlines, earnings calendar | Free key (60 calls/min) |
| [CNN Business Fear & Greed Index](https://www.cnn.com/markets/fear-and-greed) | Market mood, 0 (extreme fear) to 100 (extreme greed), with week/month/year comparisons | None. Read from the JSON behind CNN's chart; unofficial, so it fails soft |
| [ApeWisdom](https://apewisdom.io) | Reddit mentions and 24-hour change, overall and per community (r/wallstreetbets, r/stocks, r/investing) | None |
| [Stocktwits](https://stocktwits.com) | Trending symbols | None; may block cloud IPs, so it's optional |
| [Charles Schwab](https://www.schwab.com/learn/story/schwab-market-update) | Linked as research context | Schwab has no public data API, so the site links to it instead of scraping it |

Indices and macro use ETF proxies (SPY, DIA, QQQ, IWM, TLT, UUP, USO, GLD, IBIT) because Finnhub's free tier quotes listed securities, not index levels.

Headlines are ranked by outlet: established newsrooms (Reuters, AP, Bloomberg, CNBC, CNN, MarketWatch, WSJ, Barron's, FT and similar) come first, and the market headlines list shows only those, one per outlet. Reddit posts are not read directly: Reddit closed its public `.json` and RSS access in 2026, so Reddit data is ApeWisdom's mention counts. Change the communities with `reddit_communities` in `config.json`.

Every ticker the crowd lists show (top 8 on Reddit overall, top 5 in each community, top 8 on Stocktwits), stocks and ETFs alike, also gets a watchlist row tagged **Trending** (and **ETFs** for funds). Hourly runs keep their prices fresh, and the list is rebuilt at each 3 PM update. Live quotes check up to 24 symbols a minute: the index ETFs, picks and core watchlist every time, with the trending names taking turns in the remaining slots.

**Market movers** ranks every company in the watchlist worth $50B or more by the stock-market value it gained or lost today (market cap × today's % move), so a 2% slide in a $3T company outranks a 20% drop in a small one. It shows the top 5 lifting the market and the top 5 dragging it down, refreshed every hour. Change the count or size floor under `movers` in `config.json`.

Every source fails soft. If one is down, the rest still update, and a **Data health** row in the sentiment table lists what failed.

### How the 3 ideas are picked

1. **Candidates:** your watchlist, the top 25 Reddit tickers and the top 15 Stocktwits trending symbols.
2. **Filters:** price at least $5, market cap at least $2B, and a real operating company (ETFs and OTC names are dropped).
3. **Four 0–10 scores per candidate:**
   - **Catalyst:** headlines in the last 36 hours, plus a bonus if earnings are due within 3 days.
   - **Price action:** today's move relative to SPY.
   - **Crowd:** Reddit rank, a bonus if mentions jumped 50% or more in 24 hours, and a bonus for Stocktwits trending.
   - **Institutional:** the share of analysts rating it Buy or Strong Buy.
4. **Weighted total:** 30% catalyst, 25% price action, 25% crowd, 20% institutional. You can change the weights in `config.json`.
5. **Diversity:** the top 3 must come from **three different industries**, so the picks don't all ride one theme.
6. **Risk rating:** each pick is rated **High** if it has heavy crowd attention, a move of 5% or more, a market cap under $10B, or upcoming earnings. Otherwise it's **Moderate**. It also gets a short list of counter-arguments.

---

## Customise

Everything lives in `config.json`:

- `watchlist`: the tickers you always track.
- `indices` and `macro`: the ETF proxies shown in the ribbon.
- `tags`: which chip filters (AI & chips, Mega-cap) each ticker appears under.
- `picks.weights`, `min_market_cap_millions`, `min_price`: tune the scoring.
- `research_links`: extra reading links shown in the sentiment table.

The colour theme is set by the CSS variables at the top of `assets/style.css`. Change `--accent` to re-brand the whole site.

## Project layout

```
index.html                 page shell
assets/style.css           Partsmith CAD theme (light + dark)
assets/app.js              renderer, chart, live-quote mode
data/market.json           the data file the Action rewrites
config.json                watchlist, proxies, scoring weights
scripts/update_data.py     data updater (stdlib only)
tests/test_update_data.py  offline tests, no network or key needed
.github/workflows/         update-data.yml (cron), tests.yml (CI)
```

## Tests

```bash
python3 -m unittest discover -s tests -v
```

## Security notes

- The Action's key lives in GitHub Secrets and never reaches the browser.
- A viewer's live-quote key is stored only in that viewer's `localStorage` and sent only to Finnhub.
- Don't commit API keys. `.env` is git-ignored.

## License

MIT. See [LICENSE](LICENSE).
