"""build_portfolio: golden snapshot on synthetic data, plus parity with the original local app (app/)."""

from __future__ import annotations

import json
import os
import shutil
import time
from datetime import date

import pytest

from engine.portfolio import build_portfolio, market_requirements
from tests.conftest import FIXTURES, ROOT, assert_same, roundtrip
from tests.fixtures import synthetic

GOLDEN = FIXTURES / "golden_snapshot.json"


def test_golden_snapshot():
    snap = roundtrip(build_portfolio(synthetic.statements(), synthetic.market(), synthetic.TODAY))
    if os.getenv("UPDATE_GOLDEN") == "1":
        GOLDEN.write_text(json.dumps(snap, indent=1, sort_keys=True) + "\n")
    assert_same(snap, json.loads(GOLDEN.read_text()), "snapshot vs golden")


def test_snapshot_shape_and_rules():
    snap = build_portfolio(synthetic.statements(), synthetic.market(), synthetic.TODAY)
    assert set(snap) == {"members", "holdings", "activity", "sips", "benchmark", "stocks"}
    members = {m["id"]: m for m in snap["members"]}
    assert set(members) == {"m-alpha", "m-beta"}
    assert [m["id"] for m in snap["members"]] == ["m-alpha", "m-beta"]  # sorted by value
    alpha, beta = members["m-alpha"], members["m-beta"]
    assert alpha["pan"] == "AB••••••4F" and alpha["name"] == "Alpha Sample Person"
    assert alpha["sources"] == ["CDSL", "KFINTECH"]

    by = {(h["member_id"], h["isin"]): h for h in snap["holdings"]}
    f1 = by[("m-alpha", synthetic.F1["isin"])]
    assert f1["sources"] == ["CDSL", "KFINTECH"]  # held in both: one row, never double counted
    assert f1["as_of"] == "2026-11-20"  # the newer (KFintech) statement's numbers
    assert f1["invested"] is not None and f1["cashflows"]  # same units in both → cost applies
    assert f1["returns"]["1y"] is not None and f1["benchmark_value"] is not None
    assert by[("m-alpha", synthetic.F3["isin"])]["returns"]["1y"] is not None  # code from isin_to_code
    assert by[("m-alpha", synthetic.EQ["isin"])]["category"] == "Stocks & bonds"
    assert by[("m-alpha", synthetic.EQ["isin"])]["pledged"] == 5.0

    # the October SIP appears in both statements but is listed once
    oct_rows = [a for a in snap["activity"] if a["member_id"] == "m-alpha" and a["isin"] == synthetic.F1["isin"]
                and "2026-10-01" <= a["date"] <= "2026-10-10"]
    assert len(oct_rows) == 1 and oct_rows[0]["amount"] == 5000.0  # purchase + stamp duty

    assert any(s["status"] == "active" and s["isin"] == synthetic.F1["isin"] for s in snap["sips"])
    assert f1["sip"] == {"amount": 5000.0, "frequency": "monthly"}

    months = [h["month"] for h in beta["history"]]
    assert months == sorted(months) and len(months) == 4  # Jul..Oct, newer statement wins on overlap
    assert beta["history"][-2]["value"] == 15300.0
    assert any(i["level"] == "warn" and "nominee" in i["title"].lower() for i in beta["analysis"]["health"])
    assert snap["stocks"]["enabled"] is False


def test_history_source():
    # alpha holds demat-only funds, so KFintech transactions can't rebuild everything → CDSL month-ends,
    # which in turn miss the KFintech-only fund
    snap = build_portfolio(synthetic.statements(), synthetic.market(), synthetic.TODAY)
    alpha = next(m for m in snap["members"] if m["id"] == "m-alpha")
    assert alpha["history_source"] == "cdsl" and alpha["history_covers_all"] is False

    # a member with only the KFintech statement gets the month-by-month rebuild from transactions
    kf_only = [s for s in synthetic.statements() if s["data"]["statement_type"] == "RTA_CAS"]
    m = build_portfolio(kf_only, synthetic.market(), synthetic.TODAY)["members"][0]
    assert m["history_source"] == "transactions" and m["history_covers_all"] is True
    assert m["history"][0]["month"] == "2023-01" and m["history"][-1]["month"] == "2026-11"


def test_no_market_data_degrades_gracefully():
    snap = build_portfolio(synthetic.statements(), {}, synthetic.TODAY)
    assert snap["benchmark"] is None
    assert all(h["returns"] == {"1y": None, "3y": None, "5y": None} for h in snap["holdings"])
    assert len(snap["holdings"]) == 6


def test_market_requirements():
    req = market_requirements(synthetic.statements(), {synthetic.F3["isin"]: synthetic.F3["amfi"]})
    assert req["codes"] == ["120716", "900001", "900002", "900003"]
    assert req["isins_without_code"] == [synthetic.EQ["isin"]]
    assert synthetic.F1["isin"] in req["held_isins"]


def test_build_is_deterministic():
    a = roundtrip(build_portfolio(synthetic.statements(), synthetic.market(), synthetic.TODAY))
    b = roundtrip(build_portfolio(list(reversed(synthetic.statements())), synthetic.market(), synthetic.TODAY))
    assert_same(a, b, "builds from reordered input")


# ---------------------------------------------------------------- parity with the original app

def _legacy_available() -> bool:
    return (ROOT / "app" / "portfolio.py").exists()


def _remap_ids(snap: dict, ids: list[str]) -> dict:
    """Legacy member IDs are m0, m1… by value; map them to the engine's IDs in the same order."""
    mapping = {m["id"]: ids[i] for i, m in enumerate(snap["members"])}
    for m in snap["members"]:
        m["id"] = mapping[m["id"]]
    for key in ("holdings", "activity", "sips"):
        for row in snap[key]:
            row["member_id"] = mapping[row["member_id"]]
    return snap


def write_legacy_dir(tmp_path, statements):
    parsed = tmp_path / "parsed"
    parsed.mkdir()
    for i, s in enumerate(statements):
        (parsed / f"{s['pan']}_{i:02d}.json").write_text(json.dumps(s["data"]))
    return parsed


def write_legacy_nav_cache(tmp_path, market: dict):
    """The legacy app reads NAVs from data/.nav-cache in mfapi's format; write the same series there (fresh)."""
    cache = tmp_path / ".nav-cache"
    cache.mkdir()
    for code, rows in market["navs"].items():
        data = [{"date": f"{d[8:10]}-{d[5:7]}-{d[:4]}", "nav": str(n)} for d, n in rows]
        (cache / f"{code}.json").write_text(json.dumps({"data": data}))
    (cache / "scheme-list.json").write_text(json.dumps({i: [c, ""] for i, c in market["isin_to_code"].items()}))
    now = time.time()
    for f in cache.iterdir():
        os.utime(f, (now, now))


@pytest.fixture
def legacy(monkeypatch):
    if not _legacy_available():
        pytest.skip("app/ removed (after M10 parity)")
    monkeypatch.syspath_prepend(str(ROOT))
    import httpx

    def offline(*a, **k):
        raise httpx.ConnectError("offline in tests")

    monkeypatch.setattr(httpx.Client, "get", offline)
    monkeypatch.setattr(httpx, "get", offline)
    from app import portfolio as legacy_portfolio

    return legacy_portfolio


@pytest.mark.parametrize("with_navs", [False, True])
def test_parity_with_legacy_app(tmp_path, monkeypatch, legacy, with_navs):
    stmts, mkt = synthetic.statements(), synthetic.market()
    monkeypatch.setenv("NAV_HISTORY", "1" if with_navs else "0")
    parsed = write_legacy_dir(tmp_path, stmts)
    if with_navs:
        write_legacy_nav_cache(tmp_path, mkt)
    old = legacy.build_portfolio(parsed)
    new = build_portfolio(stmts, mkt if with_navs else {}, date.today())
    assert_same(_remap_ids(roundtrip(old), [m["id"] for m in new["members"]]), new, "legacy vs engine snapshot")
