"""NAV store reads (M10): /build fetches the series it needs from NAV_STORE_URL, caches them per market date, and
gives the same snapshot as NAVs sent inline. Synthetic data only."""

from __future__ import annotations

import gzip
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from fastapi.testclient import TestClient

from engine import navstore, server
from tests.conftest import FIXTURES, assert_same
from tests.fixtures import synthetic

KEY = "test-engine-key"


class Store:
    """A local stand-in for the Worker's market gateway: GET /nav/{code}.json and /px/{isin}.json (M20) → the R2
    series formats."""

    def __init__(self, series: dict[str, list], prices: dict[str, list] | None = None):
        self.series = series
        self.prices = prices or {}
        self.requests: list[str] = []
        self.fail = False
        store = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802
                store.requests.append(self.path)
                px = self.path.startswith("/px/")
                code = self.path.removeprefix("/px/" if px else "/nav/").removesuffix(".json")
                if store.fail:
                    self.send_response(500)
                    self.end_headers()
                    return
                rows = (store.prices if px else store.series).get(code)
                if rows is None:
                    self.send_response(404)
                    self.end_headers()
                    return
                head = {"isin": code} if px else {"amfi_code": int(code)}
                body = json.dumps({**head, "dates": [d for d, _ in rows], ("closes" if px else "navs"): [n for _, n in rows]}).encode()
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *a):
                pass

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}/nav/"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def close(self):
        self.httpd.shutdown()


@pytest.fixture
def store(monkeypatch):
    s = Store(synthetic.market()["navs"], synthetic.market()["prices"])
    monkeypatch.setenv("NAV_STORE_URL", s.url)
    monkeypatch.setattr(navstore, "CACHE", navstore.NavCache())
    yield s
    s.close()


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("ENGINE_SHARED_SECRET", KEY)
    return TestClient(server.app)


def _body(**extra):
    market = {k: v for k, v in synthetic.market().items() if k not in ("navs", "prices")}
    return {"statements": synthetic.statements(), "market": {**market, "market_date": "2026-11-24"},
            "today": synthetic.TODAY.isoformat(), **extra}


def _post(client, body):
    return client.post("/build", content=json.dumps(body), headers={"X-Engine-Key": KEY, "Content-Type": "application/json"})


def test_build_reads_navs_from_the_store_and_matches_golden(client, store):
    r = _post(client, _body())
    assert r.status_code == 200 and r.json()["ok"] is True
    assert_same(r.json()["snapshot"], json.loads((FIXTURES / "golden_snapshot.json").read_text()), "NAV-store build vs golden")
    # only the needed codes (the benchmark included) and the held share's prices, each once
    assert sorted(store.requests) == sorted([*(f"/nav/{c}.json" for c in ("900001", "900002", "900003", "120716")),
                                             f"/px/{synthetic.EQ['isin']}.json"])


def test_cache_per_nav_key(client, store):
    assert _post(client, _body()).status_code == 200
    assert _post(client, _body()).status_code == 200
    assert len(store.requests) == 5  # second build: all five from the cache (nav_key defaults to the market date)
    nxt = _body()
    nxt["market"]["nav_key"] = "2026-11-24|1|99.5"  # the night's rows landed: same date, new key
    assert _post(client, nxt).status_code == 200
    assert len(store.requests) == 10
    metrics = _post(client, nxt).json()["metrics"]["nav_cache"]
    assert metrics["hits"] >= 10 and metrics["misses"] == 10


def test_refresh_codes_and_missing_series_are_not_cached(client, store):
    store.series.pop("900002")
    body = _body()
    body["market"]["refresh"] = ["900001"]  # its backfill is still running
    for _ in range(2):
        assert _post(client, body).status_code == 200
    reads = [r for r in store.requests]
    assert reads.count("/nav/900001.json") == 2 and reads.count("/nav/900002.json") == 2  # read fresh each time
    assert reads.count("/nav/900003.json") == 1


def test_missing_series_degrades_and_store_errors_fail(client, store):
    store.series.pop("900002")
    snap = _post(client, _body()).json()["snapshot"]
    liquid = next(h for h in snap["holdings"] if h["isin"] == synthetic.F2["isin"])
    assert liquid["returns"] == {"1y": None, "3y": None, "5y": None}  # no series: no fund returns, build still ok
    store.fail = True
    nxt = _body()
    nxt["market"]["market_date"] = "2026-11-26"
    r = _post(client, nxt)
    assert r.status_code == 502 and r.json()["code"] == "nav_store_error"


def test_inline_navs_skip_the_store(client, store):
    body = _body()
    body["market"]["navs"] = synthetic.market()["navs"]
    assert _post(client, body).status_code == 200 and store.requests == []


def test_gzip_format_is_the_snapshot_bytes(client, store):
    r = _post(client, _body(format="gzip"))
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/x-snapshot+gzip"
    assert "content-encoding" not in r.headers  # the Worker must get the bytes as they are
    assert float(r.headers["x-engine-peak-rss-mb"]) > 0
    snap = json.loads(gzip.decompress(r.content))
    assert_same(snap, json.loads((FIXTURES / "golden_snapshot.json").read_text()), "gzip build vs golden")


def test_bad_market_date(client, store):
    body = _body()
    body["market"]["market_date"] = "24-11-2026"
    assert _post(client, body).status_code == 400


def test_cache_is_bounded_by_points():
    cache = navstore.NavCache(max_points=10)
    from engine.market import NavSeries

    for i in range(5):
        cache.put((str(i), "d"), NavSeries([[f"2026-01-0{j + 1}", 1.0] for j in range(4)]))  # 4 points each
    assert cache.points <= 10 and len(cache) == 2
    assert cache.get(("0", "d")) == (False, None) and cache.get(("4", "d"))[0] is True


def test_codes_are_validated(store):
    out = navstore.load(["900001", "../secret", "12a"], "2026-11-24|1|100")
    assert list(out) == ["900001"] and store.requests == ["/nav/900001.json"]


def test_share_prices_come_from_the_store_cached_by_price_key(client, store):
    """M20: the held share is read from /px/, cached by price_key; a pending one (price_refresh) is read fresh."""
    body = _body()
    body["market"]["price_key"] = "2026-11-24|1|99|px3"
    snap = _post(client, body).json()["snapshot"]
    eq = next(h for h in snap["holdings"] if h["isin"] == synthetic.EQ["isin"])
    assert eq["price_source"] == "exchange" and eq["as_of"] == "2026-11-24"
    assert _post(client, body).status_code == 200
    px = f"/px/{synthetic.EQ['isin']}.json"
    assert store.requests.count(px) == 1  # the second build used the cache
    body["market"]["price_key"] = "2026-11-24|1|99|px4"  # new closes stored: a new key
    assert _post(client, body).status_code == 200 and store.requests.count(px) == 2
    body["market"]["price_refresh"] = [synthetic.EQ["isin"]]
    for _ in range(2):
        assert _post(client, body).status_code == 200
    assert store.requests.count(px) == 4


def test_a_share_with_no_prices_keeps_the_statement_value(client, store):
    store.prices.clear()
    snap = _post(client, _body()).json()["snapshot"]
    eq = next(h for h in snap["holdings"] if h["isin"] == synthetic.EQ["isin"])
    assert eq["price_source"] == "statement" and eq["value"] == eq["statement"]["value"] and eq["units_timeline"] is None
