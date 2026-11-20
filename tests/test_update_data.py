"""Offline tests for scripts/update_data.py — no network, no API key.

Run:  python -m unittest discover -s tests -v
"""
import json
import sys
import unittest
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import update_data as ud  # noqa: E402

INDUSTRY = {"NVDA": "Semiconductors", "AVGO": "Semiconductors", "AMD": "Semiconductors", "INTC": "Semiconductors",
            "MSFT": "Technology", "AAPL": "Technology", "AMZN": "Retail", "GOOG": "Media", "META": "Media",
            "TSLA": "Automobiles", "DIS": "Media", "PLTR": "Technology", "JPM": "Banking", "WMT": "Retail",
            "GME": "Retail", "HOOD": "Financial Services", "TINY": "Biotechnology"}


RSS_FIXTURE = """<?xml version="1.0"?><rss version="2.0"><channel><title>MarketWatch</title>
<item><title>Is it too late to add energy stocks to your 401(k)?</title><link>https://www.marketwatch.com/a</link>
<description>&lt;p&gt;Energy shares have rallied this year.&lt;/p&gt;</description><pubDate>Wed, 18 Nov 2026 14:00:00 GMT</pubDate></item>
<item><title>I tried a viral lunch hack</title><link>https://www.marketwatch.com/b</link>
<description>Desk salad no more.</description><pubDate>Wed, 18 Nov 2026 13:00:00 GMT</pubDate></item>
<item><title>Old story about bonds</title><link>https://www.marketwatch.com/c</link>
<description>From last week.</description><pubDate>Mon, 09 Nov 2026 13:00:00 GMT</pubDate></item>
<item><title>Roth IRA conversions explained</title><link>https://www.marketwatch.com/d</link>
<pubDate>Wed, 18 Nov 2026 12:00:00 GMT</pubDate></item>
</channel></rss>"""


class FakeHttp(ud.Http):
    """Deterministic stand-in for the network."""

    def __init__(self):
        super().__init__("test-key", min_interval=0)
        self.now = datetime(2026, 11, 18, 10, 0, tzinfo=ud.ET).timestamp()

    def get_text(self, url, retries=1):
        self.calls += 1
        if "mw_topstories" in url:
            return RSS_FIXTURE
        return None  # every other feed "fails"; stories must still work

    def get(self, url, params=None, retries=2, headers=None):
        self.calls += 1
        if url == ud.APEWISDOM:
            return {"results": [
                {"rank": 1, "ticker": "NVDA", "name": "Nvidia", "mentions": 900, "mentions_24h_ago": 400, "upvotes": 5000},
                {"rank": 2, "ticker": "GME", "name": "GameStop", "mentions": 500, "mentions_24h_ago": 450, "upvotes": 2000},
                {"rank": 3, "ticker": "HOOD", "name": "Robinhood", "mentions": 300, "mentions_24h_ago": 100, "upvotes": 900},
                {"rank": 4, "ticker": "TINY", "name": "Tiny Bio", "mentions": 250, "mentions_24h_ago": 20, "upvotes": 100},
            ]}
        if url == ud.APEWISDOM_SUB.format("wallstreetbets"):
            return {"results": [
                {"rank": 1, "ticker": "NVDA", "name": "Nvidia", "mentions": 600, "mentions_24h_ago": 300, "upvotes": 3000},
                {"rank": 2, "ticker": "GME", "name": "GameStop", "mentions": 200, "mentions_24h_ago": 20, "upvotes": 800},
            ]}
        if url == ud.CNN_FG:
            return {"fear_and_greed": {"score": 25.17, "rating": "fear", "timestamp": "2026-11-18T01:00:00+00:00",
                                       "previous_close": 25.2, "previous_1_week": 35.9, "previous_1_month": 18.2,
                                       "previous_1_year": 8.9}}
        if url == ud.STOCKTWITS:
            return {"symbols": [{"symbol": "HOOD"}, {"symbol": "NVDA"}, {"symbol": "SPY"}]}
        return None

    def finnhub(self, path, **p):
        self.calls += 1
        s = p.get("symbol")
        if path == "/quote":
            if s == "TINY":
                return {"c": 3.2, "d": 0.4, "dp": 14.3, "h": 3.3, "l": 2.8, "o": 2.9, "pc": 2.8}
            base = 100 + sum(map(ord, s))
            dp = ((sum(map(ord, s)) % 13) - 6) / 2  # -3.0 .. +3.0
            return {"c": base, "d": base * dp / 100, "dp": dp, "h": base * 1.01, "l": base * 0.99,
                    "o": base, "pc": base / (1 + dp / 100)}
        if path == "/stock/profile2":
            if s in ("SPY", "QQQ"):
                return {}
            return {"name": f"{s} Corp", "finnhubIndustry": INDUSTRY.get(s, "Other"),
                    "marketCapitalization": 1500 if s == "TINY" else 250_000}
        if path == "/stock/recommendation":
            return [{"strongBuy": 10, "buy": sum(map(ord, s)) % 20, "hold": 5, "sell": 1, "strongSell": 0,
                     "period": "2026-11-01"}]
        if path == "/company-news":
            n = sum(map(ord, s)) % 4
            return [{"id": i + hash(s) % 1000, "headline": f"{s} headline {i}", "url": f"https://example.com/{s}/{i}",
                     "source": "Reuters", "datetime": int(self.now) - 3600 * (i + 1)} for i in range(n)]
        if path == "/news":
            t = int(self.now)
            return [{"id": 1, "headline": "Blog take on stocks", "url": "https://example.com/b", "source": "SomeBlog", "datetime": t - 60},
                    {"id": 2, "headline": "Stocks slide as yields rise", "url": "https://example.com/r", "source": "Reuters", "datetime": t - 7200},
                    {"id": 3, "headline": "Fed minutes due", "url": "https://example.com/c", "source": "CNBC", "datetime": t - 3600},
                    {"id": 4, "headline": "Second Reuters story", "url": "https://example.com/r2", "source": "Reuters", "datetime": t - 600},
                    {"id": 5, "headline": "Old news", "url": "https://example.com/o", "source": "Reuters", "datetime": t - 3 * 86400}]
        if path == "/calendar/earnings":
            return {"earningsCalendar": [{"symbol": "WMT", "date": "2026-11-19", "hour": "bmo"},
                                         {"symbol": "XYZ", "date": "2026-11-19", "hour": "amc"}]}
        return None


class BuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cfg = json.loads((ROOT / "config.json").read_text())
        cls.seed = json.loads((ROOT / "data" / "market.json").read_text())
        ud.time.time = lambda: FakeHttp().now  # freeze clock for the news window

    def run_build(self, mode, old=None, when=datetime(2026, 11, 18, 10, 0, tzinfo=ud.ET)):
        return ud.build(mode, FakeHttp(), self.cfg, old if old is not None else self.seed, when)

    def test_full_mode_schema_and_picks(self):
        d = self.run_build("full")
        self.assertEqual(d["mode"], "auto")
        self.assertEqual(len(d["picks"]), 3)
        inds = {INDUSTRY.get(p["sym"]) for p in d["picks"]}
        self.assertEqual(len(inds), 3, "picks must come from three different industries")
        self.assertNotIn("TINY", [p["sym"] for p in d["picks"]], "micro-caps / sub-$5 names are filtered out")
        wl = {w["sym"] for w in d["watchlist"]}
        for p in d["picks"]:
            self.assertIn(p["sym"], wl)
            self.assertEqual(set(p["scores"]), {"Catalyst", "Price action", "Crowd", "Institutional"})
            self.assertTrue(all(0 <= v <= 10 for v in p["scores"].values()))
            self.assertTrue(1 <= len(p["thesis"]) <= 3)
            for s in p["src"]:
                self.assertIn(s, d["sources"], f"source {s} must resolve")
        plats = [r["platform"] for r in d["sentiment"]]
        self.assertIn("Reddit (all)", plats)
        self.assertIn("r/wallstreetbets", plats)
        self.assertNotIn("r/stocks", plats, "communities with no data are skipped, not shown empty")
        self.assertEqual(plats[0], "CNN Business")
        self.assertEqual(d["calendar"][0]["items"], ["WMT AM"])
        json.dumps(d)  # serialisable

    def test_cnn_fear_greed_and_headlines(self):
        d = self.run_build("full")
        self.assertEqual(d["fearGreed"]["score"], 25)
        self.assertEqual(d["fearGreed"]["rating"], "Fear")
        self.assertIn("Fear & Greed Index reads 25 (Fear)", d["summary"])
        cnn = d["sentiment"][0]
        self.assertEqual(cnn["lean"], "bear")
        self.assertIn("a week ago 36", cnn["read"])
        # credible outlets only, one per outlet, newest first within an outlet, nothing older than 24h
        heads = [n["t"] for n in d["macroNotes"]]
        self.assertEqual(heads, ["Second Reuters story (Reuters)", "Fed minutes due (CNBC)"])
        for n in d["macroNotes"]:
            self.assertIn(n["src"], d["sources"])

    def test_crowd_tickers_join_watchlist(self):
        d = self.run_build("full")
        wl = {w["sym"]: w for w in d["watchlist"]}
        for sym in ("GME", "HOOD", "TINY", "SPY"):  # Reddit, a community and Stocktwits names, incl. an ETF
            self.assertIn(sym, wl)
            self.assertIn("social", wl[sym]["tags"])
        self.assertIn("etf", wl["SPY"]["tags"])
        self.assertEqual(wl["SPY"]["name"], "S&P 500 (SPY)")
        self.assertNotIn("etf", wl["GME"]["tags"])
        self.assertNotIn("social", wl["MSFT"]["tags"], "core watchlist names are only tagged if the crowd lists them")
        # hourly runs keep the crowd rows and refresh their prices
        later = self.run_build("quotes", old=d, when=datetime(2026, 11, 19, 11, 0, tzinfo=ud.ET))
        wl2 = {w["sym"]: w for w in later["watchlist"]}
        self.assertEqual(set(wl), set(wl2))
        self.assertIn("etf", wl2["SPY"]["tags"])
        self.assertIn("social", wl2["TINY"]["tags"])
        self.assertEqual(wl2["SPY"]["name"], "S&P 500 (SPY)")

    def test_market_movers_rank_by_dollar_value(self):
        rows = [
            {"sym": "BIG", "name": "Big", "pct": -2.0, "chg": -4.0, "mcap": 3_000_000, "tags": []},    # -$61B
            {"sym": "SMALL", "name": "Small", "pct": -20.0, "chg": -2.0, "mcap": 60_000, "tags": []},  # -$15B
            {"sym": "UP", "name": "Up", "pct": 5.0, "chg": 3.0, "mcap": 1_000_000, "tags": []},        # +$48B
            {"sym": "TINY", "name": "Tiny", "pct": 30.0, "chg": 1.0, "mcap": 2_000, "tags": []},        # under the floor
            {"sym": "SPY", "name": "S&P ETF", "pct": 1.0, "chg": 7.0, "mcap": 9_000_000, "tags": ["etf"]},
        ]
        m = ud.market_movers(rows, {"count": 5, "min_market_cap_millions": 50_000})
        self.assertEqual([x["sym"] for x in m["down"]], ["BIG", "SMALL"], "a 2% drop in a giant outranks a 20% drop in a small cap")
        self.assertEqual([x["sym"] for x in m["up"]], ["UP"])
        self.assertAlmostEqual(m["down"][0]["valueB"], -61.2, places=1)
        self.assertEqual(m["tracked"], 3)

    def test_full_build_has_movers(self):
        d = self.run_build("full")
        self.assertIn("movers", d)
        self.assertTrue(d["movers"]["up"] or d["movers"]["down"])
        for w in d["watchlist"]:
            if "etf" in w["tags"]:
                self.assertNotIn("mcap", w)

    def test_cnn_failure_is_soft(self):
        http = FakeHttp()
        http.get = lambda *a, **k: None
        self.assertIsNone(ud.cnn_fear_greed(http))
        self.assertEqual(ud.reddit_by_community(http), {})

    def test_every_src_reference_resolves(self):
        d = self.run_build("full")
        refs = set(d["summarySrc"]) | set(d["history"]["src"]) | {d["calendarSrc"]}
        for coll in ("indices", "macro", "watchlist", "sentiment", "macroNotes"):
            for row in d[coll]:
                refs.add(row["src"])
                refs.update(row.get("noteSrc", []))
                refs.update(row.get("factsSrc", []))
        for r in refs:
            self.assertIn(r, d["sources"])

    def test_quotes_mode_keeps_picks_and_builds_history(self):
        first = self.run_build("full")
        second = self.run_build("quotes", old=first, when=datetime(2026, 11, 19, 15, 0, tzinfo=ud.ET))
        self.assertEqual([p["sym"] for p in first["picks"]], [p["sym"] for p in second["picks"]])
        self.assertEqual(second["history"]["dates"], ["Nov 18", "Nov 19"])
        self.assertEqual([s["sym"] for s in second["history"]["series"]], ["SPY", "DIA", "QQQ"])
        same_day = self.run_build("quotes", old=second, when=datetime(2026, 11, 19, 15, 30, tzinfo=ud.ET))
        self.assertEqual(len(same_day["history"]["dates"]), 2, "same-day runs overwrite, not append")

    def test_seed_history_is_replaced_not_mixed(self):
        d = self.run_build("quotes")
        self.assertEqual(d["history"]["dates"], ["Nov 18"])
        self.assertIn("still building", d["history"]["note"])




class StoryTests(unittest.TestCase):
    NOW = datetime(2026, 11, 18, 10, 0, tzinfo=ud.ET)

    def test_parse_and_filter(self):
        items = ud.parse_feed(RSS_FIXTURE, "MarketWatch")
        self.assertEqual(len(items), 4)
        self.assertEqual(items[0]["summary"], "Energy shares have rallied this year.")
        picked = ud.pick_stories(items, self.NOW.timestamp())
        titles = [i["title"] for i in picked]
        self.assertIn("Is it too late to add energy stocks to your 401(k)?", titles)
        self.assertNotIn("I tried a viral lunch hack", titles)      # not about investing
        self.assertNotIn("Old story about bonds", titles)           # older than 48h
        self.assertLessEqual(len(picked), 2)                        # max 2 per outlet

    def test_bad_xml_is_soft(self):
        self.assertEqual(ud.parse_feed("<not xml", "X"), [])

    def test_once_per_day_and_kept_on_failure(self):
        data = {}
        http = FakeHttp()
        ud.update_stories(data, http, {}, self.NOW)
        self.assertEqual(data["lastStories"], "2026-11-18")
        self.assertTrue(data["stories"])
        calls = http.calls
        ud.update_stories(data, http, {}, self.NOW)                 # same day: no refetch
        self.assertEqual(http.calls, calls)

        class Down(FakeHttp):
            def get_text(self, url, retries=1):
                return None
        tomorrow = datetime(2026, 11, 19, 8, 0, tzinfo=ud.ET)
        before = list(data["stories"])
        ud.update_stories(data, Down(), {}, tomorrow)               # all feeds down: keep old set
        self.assertEqual(data["stories"], before)

    def test_build_includes_stories(self):
        cfg = json.loads((ROOT / "config.json").read_text())
        data = ud.build("quotes", FakeHttp(), cfg, {}, self.NOW)
        self.assertTrue(data.get("stories"))


class StoryRobustnessTests(unittest.TestCase):
    def test_crashing_feed_does_not_stop_build(self):
        class Boom(FakeHttp):
            def get_text(self, url, retries=1):
                raise ConnectionResetError("peer reset")
        cfg = json.loads((ROOT / "config.json").read_text())
        data = ud.build("quotes", Boom(), cfg, {}, datetime(2026, 11, 18, 17, 23, tzinfo=ud.ET))
        self.assertTrue(data["watchlist"])           # prices still built
        self.assertNotIn("stories", data)            # no stories, but no crash


class RateLimitTests(unittest.TestCase):
    def test_waits_out_429_then_succeeds(self):
        import io, urllib.error, urllib.request
        calls = {"n": 0}
        def fake_urlopen(req, timeout=20):
            calls["n"] += 1
            if calls["n"] <= 2:
                raise urllib.error.HTTPError(req.full_url, 429, "Too Many Requests", {}, None)
            return io.BytesIO(b'{"c": 101.5}')
        orig_open, orig_sleep = urllib.request.urlopen, ud.time.sleep
        urllib.request.urlopen, ud.time.sleep = fake_urlopen, lambda s: None
        try:
            http = ud.Http("k", min_interval=0)
            self.assertEqual(http.get("https://finnhub.io/api/v1/quote"), {"c": 101.5})
            self.assertEqual(http.rate_limited, 2)
            self.assertEqual(http.errors, [])
        finally:
            urllib.request.urlopen, ud.time.sleep = orig_open, orig_sleep

    def test_gives_up_when_backoff_budget_spent(self):
        import urllib.error, urllib.request
        def always_429(req, timeout=20):
            raise urllib.error.HTTPError(req.full_url, 429, "Too Many Requests", {}, None)
        orig_open, orig_sleep = urllib.request.urlopen, ud.time.sleep
        urllib.request.urlopen, ud.time.sleep = always_429, lambda s: None
        try:
            http = ud.Http("k", min_interval=0)
            self.assertIsNone(http.get("https://finnhub.io/api/v1/quote"))
            self.assertEqual(http.backoff_left, 0)
            self.assertIn("HTTP 429", http.errors[0])
        finally:
            urllib.request.urlopen, ud.time.sleep = orig_open, orig_sleep


class TipsFileTests(unittest.TestCase):
    def test_tips_have_credible_sources(self):
        t = json.loads((ROOT / "data" / "tips.json").read_text())
        allowed = ("investor.gov", "irs.gov", "finra.org", "consumerfinance.gov", "spglobal.com", "morningstar.com", "sec.gov")
        for item in t["tips"] + t["strategies"]:
            for k in ("title", "body", "tryit", "src", "url"):
                self.assertTrue(item.get(k), (item.get("title"), k))
            self.assertTrue(any(d in item["url"] for d in allowed), item["url"])


class HistoryTests(unittest.TestCase):
    """Growth-chart price history: Yahoo backfill once, then our own daily closes."""

    def setUp(self):
        import tempfile
        self.dir = Path(tempfile.mkdtemp())
        ud.YAHOO_PAUSE = 0
        self.now = datetime(2026, 11, 19, 15, 30, tzinfo=ud.ET)

    def http(self, yahoo_ok=True):
        test = self

        class H(ud.Http):
            def __init__(self):
                super().__init__("k", min_interval=0)
                self.yahoo_calls = 0

            def get(self, url, params=None, retries=2, headers=None):
                if "finance.yahoo.com" not in url:
                    return None
                self.yahoo_calls += 1
                if not yahoo_ok:
                    return None
                if params["range"] == "3y":
                    start = datetime(2023, 11, 20, 16, 0, tzinfo=ud.ET)
                    ts = [int((start + ud.timedelta(days=i)).timestamp()) for i in range(0, 1095)]
                    return {"chart": {"result": [{"timestamp": ts, "indicators": {"quote": [{"close": [100 + i * 0.1 for i in range(len(ts))]}]}}]}}
                t0 = int(datetime(2026, 11, 19, 9, 30, tzinfo=ud.ET).timestamp())
                ts = [t0 + 300 * i for i in range(10)]
                return {"chart": {"result": [{"timestamp": ts, "indicators": {"quote": [{"close": [50 + i for i in range(10)]}]}}]}}
        return H()

    def quote(self, c, t=None):
        return {"c": c, "d": 1, "dp": 1, "h": c, "l": c, "o": c, "pc": c - 1,
                "t": t or int(self.now.timestamp())}

    def test_backfill_then_append_own_close(self):
        h = self.http()
        st = ud.update_price_history(h, self.dir, ["NVDA"], {"NVDA": self.quote(150.0)}, self.now, intraday=False)
        hist = json.loads((self.dir / "NVDA.json").read_text())
        self.assertEqual(st["backfilled"], 1)
        self.assertEqual(hist["src"], "yahoo")
        self.assertEqual(hist["d"][-1], "2026-11-19")
        self.assertEqual(hist["c"][-1], 150.0, "today's close comes from the quote")
        self.assertLessEqual(hist["d"][0], "2023-11-20")
        # a second run the same month does not ask Yahoo again
        h2 = self.http()
        ud.update_price_history(h2, self.dir, ["NVDA"], {"NVDA": self.quote(151.0)}, self.now, intraday=False)
        self.assertEqual(h2.yahoo_calls, 0)
        hist = json.loads((self.dir / "NVDA.json").read_text())
        self.assertEqual(hist["c"][-1], 151.0, "same-day runs overwrite today's close")

    def test_works_without_yahoo(self):
        h = self.http(yahoo_ok=False)
        syms = ["A", "B", "C", "D", "E", "F"]
        ud.update_price_history(h, self.dir, syms, {s: self.quote(10.0) for s in syms}, self.now, intraday=True)
        self.assertEqual(h.yahoo_calls, ud.YAHOO_GIVE_UP_AFTER, "stops asking Yahoo after repeated failures")
        hist = json.loads((self.dir / "F.json").read_text())
        self.assertEqual((hist["src"], hist["d"], hist["c"]), ("own", ["2026-11-19"], [10.0]))
        intra = json.loads((self.dir / "_intraday.json").read_text())
        self.assertEqual(intra["series"]["A"]["c"], [10.0])
        self.assertEqual(intra["series"]["A"]["pc"], 9.0)

    def test_intraday_resets_each_day_and_uses_yahoo_path(self):
        h = self.http()
        ud.update_price_history(h, self.dir, ["X"], {"X": self.quote(60.0)}, self.now, intraday=True)
        intra = json.loads((self.dir / "_intraday.json").read_text())
        self.assertEqual(intra["date"], "2026-11-19")
        self.assertEqual(intra["series"]["X"]["c"][:3], [50, 51, 52])
        self.assertEqual(intra["series"]["X"]["c"][-1], 60.0)
        nxt = datetime(2026, 11, 20, 10, 30, tzinfo=ud.ET)
        ud.update_price_history(self.http(yahoo_ok=False), self.dir, ["X"],
                                {"X": self.quote(61.0, int(nxt.timestamp()))}, nxt, intraday=True)
        intra = json.loads((self.dir / "_intraday.json").read_text())
        self.assertEqual((intra["date"], intra["series"]["X"]["c"]), ("2026-11-20", [61.0]))

    def test_merge_never_rewrites_the_past(self):
        hist = {"d": ["2026-11-18", "2026-11-19"], "c": [1.0, 2.0]}
        self.assertFalse(ud.merge_close(hist, "2026-11-17", 9.0))
        self.assertTrue(ud.merge_close(hist, "2026-11-20", 3.0))
        self.assertEqual(hist["c"], [1.0, 2.0, 3.0])


if __name__ == "__main__":
    unittest.main()
