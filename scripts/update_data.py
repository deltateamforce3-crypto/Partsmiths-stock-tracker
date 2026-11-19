#!/usr/bin/env python3
"""Rebuild data/market.json for Partsmith Markets.

Sources
  * Finnhub (https://finnhub.io)   quotes, company profiles, analyst recommendations,
                                   company news, earnings calendar. Needs FINNHUB_API_KEY.
  * ApeWisdom (https://apewisdom.io) Reddit mention counts across r/wallstreetbets,
                                   r/stocks, r/investing and others. No key needed.
  * Stocktwits trending symbols    No key needed; often rate-limited, so it is optional.
  * CNN Business Fear & Greed      CNN's 0-100 market-mood gauge (the JSON behind
    (cnn.com/markets/fear-and-greed) its chart). No key needed; unofficial, so it fails soft.
  * Finnhub market news            General market headlines; established outlets
                                   (Reuters, CNBC, MarketWatch, AP …) are ranked first.
  * Daily investing stories        RSS feeds from established outlets only (the list in
                                   config.json "story_feeds"), filtered to investing topics.

Reddit posts themselves are not read: Reddit closed its public .json/RSS access in 2026.
Reddit data comes from ApeWisdom, which counts ticker mentions per subreddit.

Modes
  quotes  refresh prices, indices, macro proxies and index history (cheap, run often)
  full    everything in `quotes` plus Reddit/Stocktwits sentiment, news, analyst data,
          the earnings calendar and the 3 daily picks (≈3 min on Finnhub's free tier)
  stories only the daily investing stories (no API key needed; used on weekends and early
          mornings). `quotes` and `full` also refresh the stories once per day.

Only the Python standard library is used. Every source fails soft: if one is down the
others still update and the page says what is missing.
"""
from __future__ import annotations

import argparse
import html
import json
import re
import math
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from xml.etree import ElementTree
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
ET = ZoneInfo("America/New_York")
UA = "PartsmithMarkets/1.0 (+https://github.com)"

FINNHUB = "https://finnhub.io/api/v1"
APEWISDOM = "https://apewisdom.io/api/v1.0/filter/all-stocks/page/1"
STOCKTWITS = "https://api.stocktwits.com/api/2/trending/symbols.json"
APEWISDOM_SUB = "https://apewisdom.io/api/v1.0/filter/{}/page/1"
CNN_FG = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata"
BROWSER_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/131.0 Safari/537.36")
REDDIT_SUBS = ["wallstreetbets", "stocks", "investing"]
# How many tickers from each crowd list are added to the watchlist ("Trending")
CROWD_TAKE = {"reddit": 8, "community": 5, "stocktwits": 8}
ETF_WORDS = ("etf", "fund", "trust", "spdr", "ishares", "proshares", "direxion", "vanguard", "invesco",
             "select sector", "index", "shares", "graniteshares", "tradr", "leverage", "2x", "3x")

# Outlets with editorial standards and corrections policies; ranked ahead of blogs and
# aggregator-only pieces when choosing headlines. Matched case-insensitively on Finnhub's
# "source" field.
CREDIBLE = ["reuters", "associated press", "ap news", "bloomberg", "cnbc", "cnn", "marketwatch",
            "wall street journal", "wsj", "barron", "financial times", "new york times", "axios",
            "the economist", "fortune", "business insider", "forbes", "investopedia", "yahoo"]

NEXT_REFRESH = "GitHub Actions · hourly 10 AM–5 PM ET · full update 3 PM ET · stories daily"

SOURCES = {
    "finnhub": {"name": "Finnhub — quotes, profiles, analyst trends, news", "url": "https://finnhub.io"},
    "apewisdom": {"name": "ApeWisdom — Reddit mention tracker", "url": "https://apewisdom.io"},
    "stocktwits": {"name": "Stocktwits — trending symbols", "url": "https://stocktwits.com/sentiment"},
    "cnn-fg": {"name": "CNN Business — Fear & Greed Index", "url": "https://www.cnn.com/markets/fear-and-greed"},
}


# --------------------------------------------------------------------------- http
class Http:
    """Tiny JSON client with Finnhub rate limiting (free tier: 60 calls/min)."""

    def __init__(self, finnhub_key: str | None, min_interval: float = 1.05):
        self.key = finnhub_key
        self.min_interval = min_interval
        self._last = 0.0
        self.calls = 0
        self.errors: list[str] = []
        self.backoff_left = 300.0  # seconds this run may spend waiting out Finnhub rate limits
        self.rate_limited = 0

    def get(self, url: str, params: dict | None = None, retries: int = 2, headers: dict | None = None):
        if params:
            url = f"{url}?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json", **(headers or {})})
        attempt = 0
        while True:
            try:
                with urllib.request.urlopen(req, timeout=20) as r:
                    self.calls += 1
                    return json.loads(r.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                if e.code == 429 and self.backoff_left > 0:
                    # Rate limited (often because Live quotes in a browser shares the same Finnhub key).
                    # Wait for the per-minute window to reset instead of giving up; capped per run.
                    wait = min(20.0, self.backoff_left)
                    self.backoff_left -= wait
                    self.rate_limited += 1
                    time.sleep(wait)
                    continue
                self.errors.append(f"{urllib.parse.urlsplit(url).netloc} HTTP {e.code}")
                return None
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ConnectionError) as e:
                if attempt < retries:
                    attempt += 1
                    time.sleep(2)
                    continue
                self.errors.append(f"{urllib.parse.urlsplit(url).netloc} {type(e).__name__}")
                return None

    def get_text(self, url: str, retries: int = 1):
        """Fetch a page as text (used for RSS feeds). Returns None on failure."""
        req = urllib.request.Request(url, headers={"User-Agent": BROWSER_UA,
                                                   "Accept": "application/rss+xml, application/xml, text/xml, */*"})
        for attempt in range(retries + 1):
            try:
                with urllib.request.urlopen(req, timeout=20) as r:
                    self.calls += 1
                    return r.read().decode("utf-8", errors="replace")
            except Exception as e:  # any network problem (resets, dropped connections, bad URLs) fails soft
                if attempt < retries:
                    time.sleep(2)
                    continue
                code = getattr(e, "code", None)
                self.errors.append(f"{urllib.parse.urlsplit(url).netloc} {'HTTP ' + str(code) if code else type(e).__name__}")
                return None

    def finnhub(self, path: str, **params):
        if not self.key:
            return None
        wait = self.min_interval - (time.monotonic() - self._last)
        if wait > 0:
            time.sleep(wait)
        self._last = time.monotonic()
        params["token"] = self.key
        return self.get(f"{FINNHUB}{path}", params)


# --------------------------------------------------------------------------- helpers
def r2(x):
    return None if x is None else round(float(x), 2)


def clamp(x, lo=0.0, hi=10.0):
    return max(lo, min(hi, x))


def fmt_money(x):
    return f"${x:,.2f}"


def fmt_pct(x):
    if x is None:
        return "n/a"
    return f"{'+' if x > 0 else '−' if x < 0 else ''}{abs(x):.2f}%"


def valid_quote(q):
    return isinstance(q, dict) and q.get("c") not in (None, 0)


def session_label(d: date) -> str:
    return d.strftime("%a %-d %b %Y")


def next_trading_day(d: date) -> date:
    n = d + timedelta(days=1)
    while n.weekday() >= 5:  # skip weekends (holidays are not modelled)
        n += timedelta(days=1)
    return n


# --------------------------------------------------------------------------- quotes
def get_quotes(http: Http, syms):
    out = {}
    for s in dict.fromkeys(syms):
        q = http.finnhub("/quote", symbol=s)
        if valid_quote(q):
            out[s] = q
    return out


def build_indices(cfg, quotes):
    rows = []
    for i in cfg["indices"]:
        q = quotes.get(i["sym"])
        if q:
            rows.append({"sym": i["sym"], "name": i["name"], "last": r2(q["c"]), "chg": r2(q.get("d")),
                         "pct": r2(q.get("dp")), "src": "finnhub"})
    return rows


def build_macro(cfg, quotes, asof):
    rows = []
    for m in cfg["macro"]:
        q = quotes.get(m["sym"])
        if q:
            dp = q.get("dp") or 0
            d = q.get("d") or 0
            dollars = ("+" if d > 0 else "−" if d < 0 else "") + fmt_money(abs(d))
            rows.append({"k": m["k"], "v": fmt_money(q["c"]), "d": f"{dollars} · {fmt_pct(dp)}", "dir": 1 if dp >= 0 else -1,
                         "src": "finnhub", "asof": asof})
    return rows


def update_history(old_hist, cfg, quotes, day: date):
    """Keep a rolling window of daily closes for the first three index proxies."""
    syms = [i["sym"] for i in cfg["indices"][:3]]
    names = {i["sym"]: i["name"] for i in cfg["indices"]}
    same = old_hist and [s.get("sym") for s in old_hist.get("series", [])] == syms
    dates = list(old_hist["dates"]) if same else []
    series = {s["sym"]: list(s["values"]) for s in old_hist["series"]} if same else {s: [] for s in syms}
    label = day.strftime("%b %-d")
    if not dates or dates[-1] != label:
        dates.append(label)
        for s in syms:
            series[s].append(None)
    for s in syms:
        q = quotes.get(s)
        if q:
            series[s][-1] = r2(q["c"])
    keep = cfg.get("history_days", 30)
    dates = dates[-keep:]
    note = ("Daily closes of the ETF proxies, recorded by the GitHub Action. "
            "Today's point is the latest price until the close.")
    if len(dates) < 2:
        note += " History is still building — the chart appears after the second trading day."
    return {
        "note": note,
        "dates": dates,
        "series": [{"sym": s, "name": names[s], "values": series[s][-keep:]} for s in syms],
        "src": ["finnhub"],
    }


# --------------------------------------------------------------------------- sentiment
def reddit_mentions(http: Http, url: str = APEWISDOM):
    data = http.get(url)
    if not data or "results" not in data:
        return []
    rows = []
    for r in data["results"]:
        try:
            rows.append({
                "sym": r["ticker"].upper(), "name": r.get("name", ""), "rank": int(r["rank"]),
                "mentions": int(r.get("mentions") or 0),
                "prev": int(r.get("mentions_24h_ago") or 0),
                "upvotes": int(r.get("upvotes") or 0),
            })
        except (KeyError, TypeError, ValueError):
            continue
    return rows


def reddit_by_community(http: Http, subs=REDDIT_SUBS):
    """Top tickers per subreddit, from ApeWisdom's per-community counts."""
    out = {}
    for sub in subs:
        rows = reddit_mentions(http, APEWISDOM_SUB.format(sub))
        if rows:
            out[sub] = rows
    return out


def cnn_fear_greed(http: Http):
    """CNN Business Fear & Greed Index: 0 = extreme fear, 100 = extreme greed."""
    data = http.get(CNN_FG, headers={"User-Agent": BROWSER_UA, "Referer": "https://www.cnn.com/",
                                     "Origin": "https://www.cnn.com"})
    fg = (data or {}).get("fear_and_greed") or {}
    try:
        score = float(fg["score"])
    except (KeyError, TypeError, ValueError):
        return None

    def num(k):
        try:
            return round(float(fg[k]))
        except (KeyError, TypeError, ValueError):
            return None
    return {"score": round(score), "rating": str(fg.get("rating", "")).strip().title(),
            "prevClose": num("previous_close"), "week": num("previous_1_week"),
            "month": num("previous_1_month"), "year": num("previous_1_year"),
            "asOf": fg.get("timestamp")}


def fg_lean(score):
    return "bear" if score < 45 else "bull" if score > 55 else "split"


def credibility(source: str) -> int:
    """Lower is more credible: index in CREDIBLE, or len(CREDIBLE) if unknown."""
    s = (source or "").lower()
    for i, name in enumerate(CREDIBLE):
        if name in s:
            return i
    return len(CREDIBLE)


def market_news(http: Http, limit=4):
    """General market headlines from the last 24h, established outlets first, one per outlet."""
    news = http.finnhub("/news", category="general")
    if not isinstance(news, list):
        return []
    cutoff = time.time() - 24 * 3600
    fresh = [n for n in news if n.get("datetime", 0) >= cutoff and n.get("headline") and n.get("url")]
    fresh.sort(key=lambda n: (credibility(n.get("source")), -n["datetime"]))
    out, seen = [], set()
    for n in fresh:
        src = (n.get("source") or "News").strip()
        if src.lower() in seen or credibility(src) == len(CREDIBLE):
            continue
        seen.add(src.lower())
        out.append(n)
        if len(out) == limit:
            break
    return out


# --------------------------------------------------------------------------- daily stories
# Established outlets with editorial standards. Only these feeds are read; edit the list in
# config.json ("story_feeds") — anything there should be a newsroom, not a blog or forum.
STORY_FEEDS = [
    {"outlet": "MarketWatch", "url": "https://feeds.content.dowjones.io/public/rss/mw_topstories"},
    {"outlet": "CNBC", "url": "https://www.cnbc.com/id/15839069/device/rss/rss.html"},
    {"outlet": "CNBC", "url": "https://www.cnbc.com/id/21324812/device/rss/rss.html"},
    {"outlet": "Kiplinger", "url": "https://www.kiplinger.com/feeds/all"},
    {"outlet": "NPR", "url": "https://feeds.npr.org/1017/rss.xml"},
    {"outlet": "The New York Times", "url": "https://rss.nytimes.com/services/xml/rss/nyt/YourMoney.xml"},
]
# A story must mention one of these to count as an investing story.
STORY_WORDS = re.compile(
    r"\b(invest\w*|stocks?|shares?|markets?|portfolio\w*|retire\w*|401\(?k\)?|ira|roth|index funds?|etfs?|"
    r"mutual funds?|bonds?|treasur\w+|dividends?|earnings|s&p|nasdaq|dow|wall street|fed\b|interest rates?|"
    r"inflation|savings?|wealth|brokerage|annuit\w+|capital gains?|tax\w*|crypto\w*|bitcoin|gold)\b", re.I)
STORY_MAX_AGE_H = 48


def _clean(text: str, limit: int) -> str:
    t = html.unescape(re.sub(r"<[^>]+>", " ", text or ""))
    t = re.sub(r"\s+", " ", t).strip()
    if len(t) > limit:
        t = t[: limit - 1].rsplit(" ", 1)[0].rstrip(",;:.-—") + "…"
    return t


def parse_feed(xml_text: str, outlet: str) -> list[dict]:
    """RSS 2.0 or Atom → [{title, url, summary, outlet, ts}]. Bad XML returns []."""
    try:
        root = ElementTree.fromstring(xml_text.encode("utf-8") if isinstance(xml_text, str) else xml_text)
    except ElementTree.ParseError:
        return []
    out = []
    atom = "{http://www.w3.org/2005/Atom}"
    for it in root.iter():
        tag = it.tag.split("}")[-1]
        if tag not in ("item", "entry"):
            continue
        def txt(name):
            el = it.find(name)
            if el is None:
                el = it.find(atom + name)
            return (el.text or "").strip() if el is not None and el.text else ""
        title = _clean(txt("title"), 200)
        link = txt("link")
        if not link:
            el = it.find(atom + "link")
            link = el.get("href", "") if el is not None else ""
        when = txt("pubDate") or txt("published") or txt("updated")
        ts = None
        try:
            ts = parsedate_to_datetime(when).timestamp()
        except (TypeError, ValueError, IndexError):
            try:
                ts = datetime.fromisoformat(when.replace("Z", "+00:00")).timestamp()
            except ValueError:
                ts = None
        if not title or not link.startswith("http") or ts is None:
            continue
        out.append({"title": title, "url": link.strip(), "summary": _clean(txt("description") or txt("summary"), 220),
                    "outlet": outlet, "ts": ts})
    return out


def pick_stories(items: list[dict], now_ts: float, limit: int = 6, per_outlet: int = 2) -> list[dict]:
    """Newest investing stories from the last 48h, rotating across outlets, no duplicates."""
    fresh = [i for i in items if now_ts - STORY_MAX_AGE_H * 3600 <= i["ts"] <= now_ts + 3600
             and STORY_WORDS.search(i["title"] + " " + i["summary"])]
    fresh.sort(key=lambda i: -i["ts"])
    by_outlet: dict[str, list[dict]] = {}
    seen = set()
    for i in fresh:
        key = re.sub(r"\W+", "", i["title"].lower())[:60]
        if key in seen or i["url"] in seen:
            continue
        seen.update((key, i["url"]))
        by_outlet.setdefault(i["outlet"], []).append(i)
    out, rnd = [], 0
    while len(out) < limit and rnd < per_outlet:
        for lst in sorted(by_outlet.values(), key=lambda l: -l[0]["ts"]):
            if rnd < len(lst) and len(out) < limit:
                out.append(lst[rnd])
        rnd += 1
    return sorted(out, key=lambda i: -i["ts"])


def daily_stories(http: Http, feeds: list[dict], now: datetime) -> list[dict]:
    items = []
    for f in feeds:
        try:
            text = http.get_text(f["url"])
            if text:
                items += parse_feed(text, f["outlet"])
        except Exception as e:  # one broken feed must never stop the price update
            http.errors.append(f"{f.get('outlet', 'feed')} {type(e).__name__}")
    picked = pick_stories(items, now.timestamp())
    return [{"title": i["title"], "url": i["url"], "summary": i["summary"], "outlet": i["outlet"],
             "time": datetime.fromtimestamp(i["ts"], ET).strftime("%a %-I:%M %p ET")} for i in picked]


def update_stories(data: dict, http: Http, cfg: dict, now: datetime, force: bool = False) -> None:
    """Refresh data["stories"] once per New York calendar day (or when forced)."""
    today = now.date().isoformat()
    if not force and data.get("lastStories") == today and data.get("stories"):
        return
    items = daily_stories(http, cfg.get("story_feeds") or STORY_FEEDS, now)
    if items:  # keep yesterday's set rather than showing nothing if every feed failed
        data["stories"] = items
        data["storiesDate"] = now.strftime("%a %-d %b %Y")
        data["lastStories"] = today


def stocktwits_trending(http: Http):
    data = http.get(STOCKTWITS)
    if not data or "symbols" not in data:
        return []
    return [s["symbol"].upper() for s in data["symbols"] if s.get("symbol")]


def analyst_ratio(http: Http, sym):
    rec = http.finnhub("/stock/recommendation", symbol=sym)
    if not rec:
        return None
    latest = rec[0]
    buys = latest.get("strongBuy", 0) + latest.get("buy", 0)
    total = buys + latest.get("hold", 0) + latest.get("sell", 0) + latest.get("strongSell", 0)
    if not total:
        return None
    return {"ratio": buys / total, "total": total, "period": latest.get("period")}


def company_news(http: Http, sym, today: date):
    news = http.finnhub("/company-news", symbol=sym, **{"from": (today - timedelta(days=2)).isoformat(),
                                                         "to": today.isoformat()})
    if not isinstance(news, list):
        return []
    cutoff = time.time() - 36 * 3600
    fresh = [n for n in news if n.get("datetime", 0) >= cutoff and n.get("headline") and n.get("url")]
    # established outlets first, then newest
    fresh.sort(key=lambda n: (credibility(n.get("source")) == len(CREDIBLE), -n["datetime"]))
    return fresh


def earnings_calendar(http: Http, today: date, days=7):
    data = http.finnhub("/calendar/earnings", **{"from": today.isoformat(),
                                                  "to": (today + timedelta(days=days)).isoformat()})
    if not data:
        return []
    return data.get("earningsCalendar", []) or []


# --------------------------------------------------------------------------- picks
def score_candidate(c, spy_dp):
    """Turn raw signals into four 0-10 scores. Every input is shown on the page."""
    q, prof = c["quote"], c["profile"]
    rel = (q.get("dp") or 0) - (spy_dp or 0)
    price = clamp(5 + rel * 1.25)

    crowd = 0.0
    rd = c.get("reddit")
    if rd:
        crowd += clamp(10 - (rd["rank"] - 1) * 0.35, 0, 8)
        if rd["prev"] and rd["mentions"] >= 1.5 * rd["prev"]:
            crowd += 1.5
    if c.get("stocktwits"):
        crowd += 2
    crowd = clamp(crowd)

    an = c.get("analyst")
    inst = clamp(an["ratio"] * 10) if an else 5.0

    n_news = len(c.get("news", []))
    catalyst = 2.0 if n_news == 0 else clamp(3 + n_news * 0.8, 0, 8)
    if c.get("earnings"):
        catalyst = clamp(catalyst + 3)

    scores = {"Catalyst": round(catalyst), "Price action": round(price), "Crowd": round(crowd),
              "Institutional": round(inst)}
    return scores, rel


def describe_pick(c, scores, rel, spy_dp):
    q, prof = c["quote"], c["profile"]
    sym = c["sym"]
    facts = []
    dp = q.get("dp") or 0
    facts.append((scores["Price action"],
                  f"{'Up' if dp >= 0 else 'Down'} {abs(dp):.2f}% to {fmt_money(q['c'])} versus "
                  f"{fmt_pct(spy_dp)} for SPY — {abs(rel):.2f} pts {'better' if rel >= 0 else 'worse'} than the market."))
    rd = c.get("reddit")
    if rd:
        chg = ""
        if rd["prev"]:
            chg = f", {fmt_pct((rd['mentions'] / rd['prev'] - 1) * 100)} vs. 24h earlier"
        facts.append((scores["Crowd"], f"#{rd['rank']} on Reddit with {rd['mentions']:,} mentions in 24h{chg}"
                                         f"{' and trending on Stocktwits' if c.get('stocktwits') else ''}."))
    elif c.get("stocktwits"):
        facts.append((scores["Crowd"], "Trending on Stocktwits right now."))
    an = c.get("analyst")
    if an:
        facts.append((scores["Institutional"],
                      f"{an['ratio'] * 100:.0f}% of {an['total']} covering analysts rate it Buy or Strong Buy "
                      f"(Finnhub, {an['period']})."))
    if c.get("earnings"):
        e = c["earnings"]
        facts.append((scores["Catalyst"] + 1, f"Reports earnings on {e['date']} ({e.get('hour', '').upper() or 'time TBA'})."))
    if c.get("news"):
        h = c["news"][0]["headline"]
        h = h if len(h) <= 110 else h[:107].rstrip() + "…"
        facts.append((scores["Catalyst"], f"{len(c['news'])} headlines in the last 36h; latest: “{h}”"))
    facts.sort(key=lambda f: f[0], reverse=True)
    thesis = [f[1] for f in facts[:3]]

    risks = []
    mcap = prof.get("marketCapitalization") or 0
    if scores["Crowd"] >= 8:
        risks.append("Heavy social-media attention can reverse quickly.")
    if dp >= 4:
        risks.append(f"Already up {dp:.1f}% today — chasing a gap adds risk.")
    if dp <= -4:
        risks.append(f"Down {abs(dp):.1f}% today — the selling may not be finished.")
    if an and an["ratio"] < 0.5:
        risks.append(f"Analyst support is thin ({an['ratio'] * 100:.0f}% Buy).")
    if c.get("earnings"):
        risks.append("Earnings can move the stock sharply in either direction.")
    if mcap and mcap < 10_000:
        risks.append(f"Smaller company (≈${mcap / 1000:.1f}B market cap), so expect bigger swings.")
    if not risks:
        risks.append("Single-stock risk: size positions accordingly and diversify.")
    high = scores["Crowd"] >= 8 or abs(dp) >= 5 or (mcap and mcap < 10_000) or bool(c.get("earnings"))

    best = max(scores, key=lambda k: scores[k])
    role = {
        "Catalyst": "Earnings catalyst" if c.get("earnings") else "News catalyst",
        "Price action": "Relative strength",
        "Crowd": "Crowd favorite",
        "Institutional": "Analyst favorite",
    }[best]

    src = ["finnhub"]
    if rd:
        src.append("apewisdom")
    if c.get("stocktwits"):
        src.append("stocktwits")
    news_src = []
    for n in c.get("news", [])[:2]:
        sid = f"news-{sym}-{n['id'] if n.get('id') else abs(hash(n['url'])) % 10**8}"
        news_src.append((sid, {"name": f"{n.get('source', 'News')} — {n['headline'][:90]}", "url": n["url"]}))
        src.append(sid)
    return {"sym": sym, "role": role, "risk": "high" if high else "mod", "thesis": thesis,
            "risks": " ".join(risks), "scores": scores, "src": src}, news_src


def choose_picks(cands, weights, count, spy_dp):
    scored = []
    for c in cands:
        s, rel = score_candidate(c, spy_dp)
        total = sum(s[k] * w for k, w in weights.items())
        scored.append((total, c, s, rel))
    scored.sort(key=lambda t: t[0], reverse=True)
    chosen, industries = [], set()
    for total, c, s, rel in scored:
        ind = c["profile"].get("finnhubIndustry") or "Unknown"
        if ind in industries:
            continue
        chosen.append((total, c, s, rel))
        industries.add(ind)
        if len(chosen) == count:
            break
    return chosen


# --------------------------------------------------------------------------- build
def build(mode: str, http: Http, cfg: dict, old: dict, now: datetime) -> dict:
    today = now.date()
    asof = now.strftime("%-I:%M %p")
    data = dict(old)
    data["mode"] = "auto"
    data["snapshot"] = now.isoformat(timespec="seconds")
    data["session"] = session_label(today)
    data["nextRefresh"] = NEXT_REFRESH
    sources = {k: v for k, v in (old.get("sources") or {}).items()
               if k in SOURCES or k.startswith("news-") or k.startswith("research-")}
    sources.update(SOURCES)
    for i, link in enumerate(cfg.get("research_links", [])):
        sources[f"research-{i}"] = link

    wl_syms = list(cfg["watchlist"])
    old_picks = [p["sym"] for p in old.get("picks", [])] if old.get("mode") == "auto" else []
    # tickers the crowd lists added at the last full run; hourly runs keep their prices fresh
    crowd = list(old.get("crowdSyms", [])) if old.get("mode") == "auto" else []
    crowd_names = dict(old.get("crowdNames", {})) if old.get("mode") == "auto" else {}
    fund_syms = {i["sym"] for i in cfg["indices"]} | {m["sym"] for m in cfg["macro"]}
    quote_syms = [i["sym"] for i in cfg["indices"]] + [m["sym"] for m in cfg["macro"]] + wl_syms + old_picks + crowd
    quotes = get_quotes(http, quote_syms)
    if not quotes:
        why = ("Finnhub kept rate-limiting this key (is Live quotes open in a browser with the same key?)"
               if http.rate_limited else "check FINNHUB_API_KEY")
        raise SystemExit(f"No quotes returned — {why}. Nothing written; the previous data is kept.")

    data["indices"] = build_indices(cfg, quotes) or old.get("indices", [])
    data["macro"] = build_macro(cfg, quotes, asof)
    data["history"] = update_history(old.get("history") if old.get("mode") == "auto" else None, cfg, quotes, today)

    fg = cnn_fear_greed(http)
    if fg:
        data["fearGreed"] = fg
    try:
        update_stories(data, http, cfg, now)
    except Exception as e:  # stories are a bonus; prices and picks still get saved
        http.errors.append(f"stories {type(e).__name__}")
    profiles = {s: w for s, w in ((w["sym"], w) for w in old.get("watchlist", []))}
    spy_dp = (quotes.get("SPY") or {}).get("dp")

    # ---- full mode: sentiment + picks
    reddit, twits = [], []
    if mode == "full":
        reddit = reddit_mentions(http)
        subs = reddit_by_community(http, cfg.get("reddit_communities", REDDIT_SUBS))
        twits = stocktwits_trending(http)
        headlines = market_news(http)
        pc = cfg["picks"]
        cand_syms = list(dict.fromkeys(
            wl_syms + [r["sym"] for r in reddit[: pc["reddit_candidates"]]] + twits[: pc["stocktwits_candidates"]]))
        earn = {e["symbol"]: e for e in earnings_calendar(http, today) if e.get("symbol")}
        rd_by = {r["sym"]: r for r in reddit}
        cands = []
        for s in cand_syms:
            q = quotes.get(s) or http.finnhub("/quote", symbol=s)
            if not valid_quote(q) or q["c"] < pc["min_price"]:
                continue
            quotes[s] = q
            prof = http.finnhub("/stock/profile2", symbol=s) or {}
            if not prof.get("name") or (prof.get("marketCapitalization") or 0) < pc["min_market_cap_millions"]:
                continue  # skips ETFs, OTC names and micro-caps
            e = earn.get(s)
            if e and not (today <= date.fromisoformat(e["date"]) <= today + timedelta(days=3)):
                e = None
            cands.append({"sym": s, "quote": q, "profile": prof, "reddit": rd_by.get(s), "stocktwits": s in twits,
                          "analyst": analyst_ratio(http, s), "news": company_news(http, s, today), "earnings": e})
            profiles[s] = {"name": prof["name"], "industry": prof.get("finnhubIndustry"),
                           "mcap": prof.get("marketCapitalization")}
        chosen = choose_picks(cands, pc["weights"], pc["count"], spy_dp)
        picks = []
        for total, c, s, rel in chosen:
            p, news_src = describe_pick(c, s, rel, spy_dp)
            picks.append(p)
            sources.update(dict(news_src))
        if picks:
            data["picks"] = picks
            data["picksFor"] = session_label(next_trading_day(today)) if now.hour >= 15 else session_label(today)
        data["_cand"] = {c["sym"]: c for c in cands}  # used below, removed before write

        # every ticker the crowd lists show (stocks and ETFs) also gets a watchlist row
        names = {i["sym"]: i["name"] for i in cfg["indices"]} | {m["sym"]: m["k"] for m in cfg["macro"]}
        names.update({r["sym"]: r["name"] for r in reddit if r["sym"] not in names})
        for rows_ in subs.values():
            names.update({r["sym"]: r["name"] for r in rows_ if r["sym"] not in names})
        listed = ([r["sym"] for r in reddit[:CROWD_TAKE["reddit"]]]
                  + [r["sym"] for rows_ in subs.values() for r in rows_[:CROWD_TAKE["community"]]]
                  + twits[:CROWD_TAKE["stocktwits"]])
        crowd, crowd_names = [], {}
        for sym in dict.fromkeys(listed):
            if sym in wl_syms or not sym.replace(".", "").isalpha() or len(sym) > 6:
                continue
            q = quotes.get(sym) or http.finnhub("/quote", symbol=sym)
            if not valid_quote(q):
                continue  # not a US-listed ticker (or a false match like "YOLO")
            quotes[sym] = q
            if sym not in profiles:
                prof = http.finnhub("/stock/profile2", symbol=sym) or {}
                nm = prof.get("name") or names.get(sym) or sym
                is_fund = sym in fund_syms or not prof.get("name") and any(w in nm.lower() for w in ETF_WORDS)
                profiles[sym] = {"name": nm, "industry": "ETF / fund" if is_fund else prof.get("finnhubIndustry"),
                                 "mcap": None if is_fund else prof.get("marketCapitalization")}
            crowd.append(sym)
            crowd_names[sym] = profiles[sym]["name"]

        # sentiment table
        rows = []
        if fg:
            moves = [f"{lbl} {v}" for lbl, v in (("previous close", fg["prevClose"]), ("a week ago", fg["week"]),
                                                    ("a month ago", fg["month"]), ("a year ago", fg["year"])) if v is not None]
            rows.append({"platform": "CNN Business", "detail": "Fear & Greed Index (0 = extreme fear, 100 = extreme greed)",
                         "tickers": "Broad market", "lean": fg_lean(fg["score"]),
                         "read": f"Reads {fg['score']} ({fg['rating']})." + (f" Compare: {', '.join(moves)}." if moves else ""),
                         "src": "cnn-fg"})
        if reddit:
            top = reddit[:8]
            risers = sorted([r for r in reddit[:50] if r["prev"] >= 20], key=lambda r: r["mentions"] / r["prev"],
                            reverse=True)[:3]
            rows.append({"platform": "Reddit (all)", "detail": "Most-mentioned tickers, last 24h (ApeWisdom)",
                         "tickers": " · ".join(r["sym"] for r in top), "lean": "info",
                         "read": f"{top[0]['sym']} leads with {top[0]['mentions']:,} mentions across all tracked subreddits. Fastest risers: "
                                 + ", ".join(f"{r['sym']} ({fmt_pct((r['mentions'] / r['prev'] - 1) * 100)})" for r in risers) + ".",
                         "src": "apewisdom"})
        for sub, srows in subs.items():
            sid = f"reddit-{sub}"
            sources[sid] = {"name": f"ApeWisdom — r/{sub} ticker mentions", "url": f"https://apewisdom.io/{sub}/"}
            top = srows[:5]
            jump = sorted([r for r in srows[:20] if r["prev"] >= 10], key=lambda r: r["mentions"] / r["prev"], reverse=True)[:1]
            read = f"{top[0]['sym']} leads with {top[0]['mentions']:,} mentions and {top[0]['upvotes']:,} upvotes."
            if jump:
                j = jump[0]
                read += f" Biggest jump: {j['sym']} ({fmt_pct((j['mentions'] / j['prev'] - 1) * 100)} vs. a day earlier)."
            rows.append({"platform": f"r/{sub}", "detail": "Most-mentioned tickers, last 24h", "lean": "info",
                         "tickers": " · ".join(r["sym"] for r in top), "read": read, "src": sid})
        if twits:
            rows.append({"platform": "Stocktwits", "detail": "Trending symbols right now", "tickers": " · ".join(twits[:8]),
                         "lean": "info", "read": "Symbols with unusually high message volume on Stocktwits.",
                         "src": "stocktwits"})
        for p in picks:
            an = data["_cand"][p["sym"]].get("analyst")
            if an:
                rows.append({"platform": "Analysts", "detail": f"Recommendation trend, {an['period']}", "tickers": p["sym"],
                             "lean": "bull" if an["ratio"] >= 0.6 else "bear" if an["ratio"] < 0.4 else "split",
                             "read": f"{an['ratio'] * 100:.0f}% Buy/Strong Buy across {an['total']} analysts.",
                             "src": "finnhub"})
        if "research-0" in sources:
            rows.append({"platform": "Charles Schwab", "detail": "Daily market update & strategist research", "tickers": "Broad market",
                         "lean": "info", "read": "Schwab has no public data feed. Read the morning update for context on the day's movers.",
                         "src": "research-0"})
        if http.errors:
            rows.append({"platform": "Data health", "detail": "Sources that failed this run", "tickers": "—", "lean": "bear",
                         "read": "; ".join(sorted(set(http.errors)))[:300], "src": "finnhub"})
        data["sentiment"] = rows

        # earnings calendar for watchlist + picks
        focus = set(wl_syms) | {p["sym"] for p in data.get("picks", [])} | {r["sym"] for r in reddit[:25]}
        by_day: dict[str, list[str]] = {}
        for e in earn.values():
            if e["symbol"] in focus:
                hour = {"bmo": "AM", "amc": "PM"}.get(e.get("hour"), "")
                by_day.setdefault(e["date"], []).append(f"{e['symbol']} {hour}".strip())
        data["calendar"] = [{"d": date.fromisoformat(d).strftime("%a %-d %b"), "items": sorted(v)}
                            for d, v in sorted(by_day.items())][:6]
        data["calendarSrc"] = "finnhub"
        notes = []
        for n in headlines:
            sid = f"news-mkt-{n['id'] if n.get('id') else abs(hash(n['url'])) % 10**8}"
            sources[sid] = {"name": f"{n.get('source', 'News')} — {n['headline'][:90]}", "url": n["url"]}
            notes.append({"t": f"{n['headline']} ({n.get('source', 'News')})", "src": sid})
        data["macroNotes"] = notes

    # ---- watchlist
    cand = data.pop("_cand", {})
    pick_syms = [p["sym"] for p in data.get("picks", [])]
    tags_cfg = cfg.get("tags", {})
    rd_by = {r["sym"]: r for r in reddit}
    old_wl = {w["sym"]: w for w in old.get("watchlist", [])}
    wl = []
    for s in list(dict.fromkeys(wl_syms + pick_syms + crowd)):
        q = quotes.get(s)
        prev = old_wl.get(s, {})
        name = (profiles.get(s) or {}).get("name") or crowd_names.get(s) or prev.get("name") or s
        tags = [t for t, syms in tags_cfg.items() if s in syms]
        if (s in crowd or s in rd_by and rd_by[s]["rank"] <= 25 or (s in cand and cand[s].get("stocktwits"))
                or s not in wl_syms and "social" in prev.get("tags", [])):
            tags.append("social")
        industry = (profiles.get(s) or {}).get("industry") or next((f[1] for f in prev.get("facts", []) if f[0] == "Industry"), None)
        if s in fund_syms or industry == "ETF / fund":
            tags.append("etf")
        row = {"sym": s, "name": name, "px": r2(q["c"]) if q else prev.get("px"),
               "pct": r2(q.get("dp")) if q else None, "chg": r2(q.get("d")) if q else None,
               "tags": tags, "src": "finnhub"}
        if not q:
            row["stale"] = "quote unavailable"
        c = cand.get(s)
        if c and c.get("news"):
            n = c["news"][0]
            row["note"] = n["headline"]
            sid = f"news-{s}-{n['id'] if n.get('id') else abs(hash(n['url'])) % 10**8}"
            sources[sid] = {"name": f"{n.get('source', 'News')} — {n['headline'][:90]}", "url": n["url"]}
            row["noteSrc"] = [sid]
        elif mode != "full" and prev.get("note") and prev.get("noteSrc"):
            row["note"], row["noteSrc"] = prev["note"], prev["noteSrc"]
        if q:
            row["facts"] = [["Open", fmt_money(q["o"])], ["Day range", f"{fmt_money(q['l'])} – {fmt_money(q['h'])}"],
                            ["Prev. close", fmt_money(q["pc"])]]
            prof = profiles.get(s) or {}
            if prof.get("industry"):
                row["facts"].append(["Industry", prof["industry"]])
            if prof.get("mcap"):
                row["facts"].append(["Mkt cap", f"${prof['mcap'] / 1e6:.2f}T" if prof["mcap"] >= 1e6 else f"${prof['mcap'] / 1e3:.1f}B"])
            if not prof.get("industry"):  # quotes-only run: keep profile facts from the last full run
                row["facts"] += [f for f in prev.get("facts", []) if f[0] in ("Industry", "Mkt cap")]
            if s in rd_by:
                row["facts"].append(["Reddit 24h", f"#{rd_by[s]['rank']} · {rd_by[s]['mentions']:,} mentions"])
            row["factsSrc"] = ["finnhub"] + (["apewisdom"] if s in rd_by else [])
        wl.append(row)
    data["watchlist"] = wl
    data["crowdSyms"] = [s for s in crowd if s not in pick_syms]
    data["crowdNames"] = {s: crowd_names.get(s, s) for s in data["crowdSyms"]}

    # ---- headline & summary written from the numbers, not from opinions
    idx = data["indices"]
    if idx:
        lead = idx[0]
        movers = sorted([w for w in wl if w["pct"] is not None], key=lambda w: w["pct"])
        up = sum(1 for w in movers if w["pct"] > 0)
        data["headline"] = (f"{lead['name']} {fmt_pct(lead['pct'])} · " +
                            " · ".join(f"{i['name'].split(' (')[0]} {fmt_pct(i['pct'])}" for i in idx[1:3]))
        summary = f"{up} of {len(movers)} watchlist stocks are higher."
        if movers:
            summary += (f" Best: {movers[-1]['sym']} {fmt_pct(movers[-1]['pct'])}. "
                        f"Worst: {movers[0]['sym']} {fmt_pct(movers[0]['pct'])}.")
        if reddit:
            summary += f" Most-discussed on Reddit: {reddit[0]['sym']} ({reddit[0]['mentions']:,} mentions)."
        fgd = data.get("fearGreed")
        if fgd:
            summary += f" CNN's Fear & Greed Index reads {fgd['score']} ({fgd['rating']})."
        data["summary"] = summary
        data["summarySrc"] = ["finnhub"] + (["apewisdom"] if reddit else []) + (["cnn-fg"] if fgd else [])

    # prune sources nothing references any more
    used = set(data.get("summarySrc", [])) | set(data["history"].get("src", [])) | {data.get("calendarSrc")}
    for coll in ("indices", "macro", "watchlist", "sentiment", "macroNotes"):
        for row in data.get(coll, []):
            used.add(row.get("src"))
            used.update(row.get("noteSrc", []) or [])
            used.update(row.get("factsSrc", []) or [])
    for p in data.get("picks", []):
        used.update(p.get("src", []))
    data["sources"] = {k: v for k, v in sources.items() if k in used or k in SOURCES or k.startswith("research-")}
    data["runInfo"] = {"mode": mode, "apiCalls": http.calls, "errors": sorted(set(http.errors))}
    if mode == "full":
        data["lastFull"] = today.isoformat()
        data["picksAt"] = now.isoformat(timespec="minutes")   # when the pick write-ups were made
    return data


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mode", choices=["quotes", "full", "stories"], default="quotes")
    ap.add_argument("--config", default=str(ROOT / "config.json"))
    ap.add_argument("--out", default=str(ROOT / "data" / "market.json"))
    args = ap.parse_args(argv)

    key = os.environ.get("FINNHUB_API_KEY", "").strip()
    if args.mode == "stories":
        cfg = json.loads(Path(args.config).read_text())
        out = Path(args.out)
        data = json.loads(out.read_text()) if out.exists() else {}
        http = Http(key or None)
        update_stories(data, http, cfg, datetime.now(ET), force=True)
        out.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
        print(f"Wrote {out} (stories): {len(data.get('stories', []))} stories, errors: {sorted(set(http.errors)) or 'none'}")
        return 0
    if not key:
        print("FINNHUB_API_KEY is not set. Get a free key at https://finnhub.io/register", file=sys.stderr)
        return 2
    cfg = json.loads(Path(args.config).read_text())
    out = Path(args.out)
    old = json.loads(out.read_text()) if out.exists() else {}
    http = Http(key)
    data = build(args.mode, http, cfg, old, datetime.now(ET))
    out.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    print(f"Wrote {out} ({args.mode}): {http.calls} API calls, {len(data.get('picks', []))} picks, "
          f"errors: {data['runInfo']['errors'] or 'none'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
