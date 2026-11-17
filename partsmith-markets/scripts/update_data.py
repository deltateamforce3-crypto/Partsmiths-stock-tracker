#!/usr/bin/env python3
"""Rebuild data/market.json for Partsmith Markets.

Sources
  * Finnhub (https://finnhub.io)   quotes, company profiles, analyst recommendations,
                                   company news, earnings calendar. Needs FINNHUB_API_KEY.
  * ApeWisdom (https://apewisdom.io) Reddit mention counts across r/wallstreetbets,
                                   r/stocks, r/investing and others. No key needed.
  * Stocktwits trending symbols    No key needed; often rate-limited, so it is optional.

Modes
  quotes  refresh prices, indices, macro proxies and index history (cheap, run often)
  full    everything in `quotes` plus Reddit/Stocktwits sentiment, news, analyst data,
          the earnings calendar and the 3 daily picks (≈3 min on Finnhub's free tier)

Only the Python standard library is used. Every source fails soft: if one is down the
others still update and the page says what is missing.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
ET = ZoneInfo("America/New_York")
UA = "PartsmithMarkets/1.0 (+https://github.com)"

FINNHUB = "https://finnhub.io/api/v1"
APEWISDOM = "https://apewisdom.io/api/v1.0/filter/all-stocks/page/1"
STOCKTWITS = "https://api.stocktwits.com/api/2/trending/symbols.json"

SOURCES = {
    "finnhub": {"name": "Finnhub — quotes, profiles, analyst trends, news", "url": "https://finnhub.io"},
    "apewisdom": {"name": "ApeWisdom — Reddit mention tracker", "url": "https://apewisdom.io"},
    "stocktwits": {"name": "Stocktwits — trending symbols", "url": "https://stocktwits.com/sentiment"},
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

    def get(self, url: str, params: dict | None = None, retries: int = 2):
        if params:
            url = f"{url}?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        for attempt in range(retries + 1):
            try:
                with urllib.request.urlopen(req, timeout=20) as r:
                    self.calls += 1
                    return json.loads(r.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                if e.code == 429 and attempt < retries:
                    time.sleep(5 * (attempt + 1))
                    continue
                self.errors.append(f"{urllib.parse.urlsplit(url).netloc} HTTP {e.code}")
                return None
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
                if attempt < retries:
                    time.sleep(2)
                    continue
                self.errors.append(f"{urllib.parse.urlsplit(url).netloc} {type(e).__name__}")
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
            rows.append({"k": m["k"], "v": fmt_money(q["c"]), "d": fmt_pct(dp), "dir": 1 if dp >= 0 else -1,
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
def reddit_mentions(http: Http):
    data = http.get(APEWISDOM)
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
    fresh.sort(key=lambda n: n["datetime"], reverse=True)
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
    data["nextRefresh"] = "GitHub Actions · every 15 min in market hours"
    sources = {k: v for k, v in (old.get("sources") or {}).items()
               if k in SOURCES or k.startswith("news-") or k.startswith("research-")}
    sources.update(SOURCES)
    for i, link in enumerate(cfg.get("research_links", [])):
        sources[f"research-{i}"] = link

    wl_syms = list(cfg["watchlist"])
    old_picks = [p["sym"] for p in old.get("picks", [])] if old.get("mode") == "auto" else []
    quote_syms = [i["sym"] for i in cfg["indices"]] + [m["sym"] for m in cfg["macro"]] + wl_syms + old_picks
    quotes = get_quotes(http, quote_syms)
    if not quotes:
        raise SystemExit("No quotes returned — check FINNHUB_API_KEY. Nothing written.")

    data["indices"] = build_indices(cfg, quotes) or old.get("indices", [])
    data["macro"] = build_macro(cfg, quotes, asof)
    data["history"] = update_history(old.get("history") if old.get("mode") == "auto" else None, cfg, quotes, today)

    profiles = {s: w for s, w in ((w["sym"], w) for w in old.get("watchlist", []))}
    spy_dp = (quotes.get("SPY") or {}).get("dp")

    # ---- full mode: sentiment + picks
    reddit, twits = [], []
    if mode == "full":
        reddit = reddit_mentions(http)
        twits = stocktwits_trending(http)
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
            data["picksFor"] = session_label(next_trading_day(today)) if now.hour >= 16 else session_label(today)
        data["_cand"] = {c["sym"]: c for c in cands}  # used below, removed before write

        # sentiment table
        rows = []
        if reddit:
            top = reddit[:8]
            risers = sorted([r for r in reddit[:50] if r["prev"] >= 20], key=lambda r: r["mentions"] / r["prev"],
                            reverse=True)[:3]
            rows.append({"platform": "Reddit", "detail": "Most-mentioned tickers, last 24h (ApeWisdom)",
                         "tickers": " · ".join(r["sym"] for r in top), "lean": "info",
                         "read": f"{top[0]['sym']} leads with {top[0]['mentions']:,} mentions. Fastest risers: "
                                 + ", ".join(f"{r['sym']} ({fmt_pct((r['mentions'] / r['prev'] - 1) * 100)})" for r in risers) + ".",
                         "src": "apewisdom"})
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
        data["macroNotes"] = []

    # ---- watchlist
    cand = data.pop("_cand", {})
    pick_syms = [p["sym"] for p in data.get("picks", [])]
    tags_cfg = cfg.get("tags", {})
    rd_by = {r["sym"]: r for r in reddit}
    old_wl = {w["sym"]: w for w in old.get("watchlist", [])}
    wl = []
    for s in list(dict.fromkeys(wl_syms + pick_syms)):
        q = quotes.get(s)
        prev = old_wl.get(s, {})
        name = (profiles.get(s) or {}).get("name") or prev.get("name") or s
        tags = [t for t, syms in tags_cfg.items() if s in syms]
        if s in rd_by and rd_by[s]["rank"] <= 25 or (s in cand and cand[s].get("stocktwits")):
            tags.append("social")
        row = {"sym": s, "name": name, "px": r2(q["c"]) if q else prev.get("px"),
               "pct": r2(q.get("dp")) if q else None, "tags": tags, "src": "finnhub"}
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
        data["summary"] = summary
        data["summarySrc"] = ["finnhub"] + (["apewisdom"] if reddit else [])

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
    return data


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mode", choices=["quotes", "full"], default="quotes")
    ap.add_argument("--config", default=str(ROOT / "config.json"))
    ap.add_argument("--out", default=str(ROOT / "data" / "market.json"))
    args = ap.parse_args(argv)

    key = os.environ.get("FINNHUB_API_KEY", "").strip()
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
