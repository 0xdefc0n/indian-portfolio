"""Stocks inside funds (plan §10.3.1, M11): what the engine asks the Worker for, and the snapshot built from the
data the Worker's BharatStock job stored. Synthetic funds and stocks only."""

from __future__ import annotations

import base64
import gzip
import json

from fastapi.testclient import TestClient

from engine import server, stocks
from engine.portfolio import build_portfolio
from tests.fixtures import synthetic

KEY = "test-engine-key"
FOF = "INF000S09FF9"  # a made-up fund held inside F1, as if F1 were a fund-of-funds


def _row(isin, pct, kind="EQUITY", name=None, sector="Synthetic"):
    return {"isin": isin, "symbol": isin[-4:], "name": name or f"Stock {isin[-4:]}", "sector": sector, "type": kind, "pct": pct}


def _data(**extra):
    """F1 matched with stocks and a fund-of-funds unit; F3 matched, fetched, and empty."""
    return {
        "enabled": True,
        "matches": {
            synthetic.F1["isin"]: {"scheme_name": "Synth Flexi Cap Fund", "checked_at": 1},
            synthetic.F3["isin"]: {"scheme_name": "Synth Nifty 50 Index Fund", "checked_at": 1},
        },
        "holdings": {
            "Synth Flexi Cap Fund": {"month": "2026-10", "data_month": "2026-10", "rows": [
                _row("INE000S01AA1", 40), _row("INE000S02BB2", 30),
                _row(FOF, 20, kind=stocks.FUND_UNIT, name="Synth Overseas Fund - Direct Growth"),
                _row("CASH", 10, kind="CASH"),
            ]},
            "Synth Nifty 50 Index Fund": {"month": "2026-10", "data_month": None, "rows": []},
        },
        **extra,
    }


def _build(data):
    market = {**synthetic.market(), "stocks": data}
    return build_portfolio(synthetic.statements(), market, synthetic.TODAY)


def test_wanted_lists_equity_funds_with_display_names():
    snap = _build(None)
    want = stocks.wanted(snap["holdings"], None)
    assert [w[0] for w in want] == sorted([synthetic.F1["isin"], synthetic.F3["isin"]])  # not the liquid fund or the share
    assert dict(want)[synthetic.F1["isin"]] == "Synth Flexi Cap Fund"  # the display name, not the statement's raw name
    assert snap["stocks"]["pending"] == 2 and snap["stocks"]["refreshing"] is False  # not enabled: nothing to wait for


def test_wanted_adds_funds_inside_a_fund_of_funds():
    snap = _build(_data())
    want = dict(stocks.wanted(snap["holdings"], _data()))
    assert want[FOF] == "Synth Overseas Fund - Direct Growth"  # the row's own name: the household doesn't hold it
    assert len(want) == 3


def test_snapshot_from_stored_data():
    s = _build(_data())["stocks"]
    f1, f3 = synthetic.F1["isin"], synthetic.F3["isin"]
    assert s["enabled"] is True and s["month"] == "2026-10"
    assert dict(map(tuple, s["funds"][f1]))["INE000S01AA1"] == 40
    assert s["no_stocks"] == [f3]  # fetched, no rows
    assert s["look_through"] == {f1: {"funds": 1, "looked_through": 0}}
    assert s["pending"] == 1 and s["refreshing"] is True  # the fund inside F1 still waits for its data

    # The job then fetched the inner fund: looked through, nothing pending.
    data = _data()
    data["matches"][FOF] = {"scheme_name": "Synth Overseas Fund", "checked_at": 1}
    data["holdings"]["Synth Overseas Fund"] = {"month": "2026-10", "data_month": "2026-10", "rows": [_row("US000S01XX1", 100, kind="FOREIGN_EQUITY")]}
    s = _build(data)["stocks"]
    assert s["pending"] == 0 and s["refreshing"] is False
    assert dict(map(tuple, s["funds"][f1]))["US000S01XX1"] == 20  # 20% of F1 × 100% of the inner fund
    assert s["look_through"][f1] == {"funds": 1, "looked_through": 1}


def test_unmatched_fund_is_not_pending():
    data = _data()
    data["matches"][synthetic.F3["isin"]] = {"scheme_name": None, "checked_at": 1}
    s = _build(data)["stocks"]
    assert synthetic.F3["isin"] in s["unmatched"] and synthetic.F3["isin"] not in s["no_stocks"]


def test_build_returns_wanted_funds_in_a_header(monkeypatch):
    monkeypatch.setenv("ENGINE_SHARED_SECRET", KEY)
    client = TestClient(server.app)
    body = {"statements": synthetic.statements(), "market": {**synthetic.market(), "stocks": _data()},
            "today": synthetic.TODAY.isoformat(), "format": "gzip"}
    r = client.post("/build", content=json.dumps(body), headers={"X-Engine-Key": KEY})
    assert r.status_code == 200 and r.headers["content-type"] == "application/x-snapshot+gzip"
    raw = r.headers["x-engine-stocks-want"]
    want = json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
    assert sorted(w[0] for w in want) == sorted([synthetic.F1["isin"], synthetic.F3["isin"], FOF])
    assert json.loads(gzip.decompress(r.content))["stocks"]["enabled"] is True

    body["format"] = None
    r = client.post("/build", content=json.dumps(body), headers={"X-Engine-Key": KEY}).json()
    assert len(r["metrics"]["stocks_want"]) == 3
