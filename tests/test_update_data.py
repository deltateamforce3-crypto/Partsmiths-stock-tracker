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


class FakeHttp(ud.Http):
    """Deterministic stand-in for the network."""

    def __init__(self):
        super().__init__("test-key", min_interval=0)
        self.now = datetime(2026, 11, 18, 10, 0, tzinfo=ud.ET).timestamp()

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


if __name__ == "__main__":
    unittest.main()
