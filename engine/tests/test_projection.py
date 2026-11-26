"""After the statement (plan §10.5.1, M12): units timelines, estimated SIP instalments, today's value.

The owner's case (2026-11-26): a CAMS/KFintech statement to 12 Oct, a monthly SIP on the 24th, today 26 Nov. The
Oct and Nov instalments aren't in the statement, so they're estimated at that day's NAV (the next NAV day for a
weekend or holiday) and the dashboard values everything at the latest NAV. A newer statement replaces the estimates.
All data synthetic.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from engine import projection
from engine.market import NavSeries
from engine.parsers.rta import detect_sips
from engine.portfolio import build_portfolio
from tests.fixtures import synthetic
from tests.fixtures.synthetic import F1, F2

TODAY = date(2026, 11, 26)
HOLIDAY = "2026-11-24"  # Guru Nanak Jayanti: no NAV


def series_for(fund: dict, end: date = date(2026, 11, 25), skip: tuple[str, ...] = (HOLIDAY,)) -> list[list]:
    return [[d.isoformat(), synthetic.nav(fund, d)] for d in synthetic.business_days(date(2024, 1, 1), end)
            if d.isoformat() not in skip]


def nav_on(rows: list[list], iso: str) -> float:
    return next(n for d, n in rows if d == iso)


def next_nav_day(rows: list[list], iso: str) -> tuple[str, float]:
    return next((d, n) for d, n in rows if d >= iso)


def rta_statement(period_to: str, sip_until: str, sip_amount: float = 10000.0, with_lump: bool = True) -> dict:
    """A KFintech detailed statement from 1 Jan 2025: a monthly SIP due on the 24th (weekend instalments land on the
    Monday, as RTAs show them) and, optionally, a lump sum in a liquid fund."""
    f1 = series_for(F1)
    txns = []
    due = date(2025, 1, 24)
    while due.isoformat() <= sip_until:
        nav_date, price = next_nav_day(f1, due.isoformat())
        invest = round(sip_amount / (1 + projection.STAMP_DUTY), 2)
        txns.append({"isin": F1["isin"], "name": F1["name"], "folio": "F-1", "date": nav_date, "type": "PURCHASE_SIP",
                     "units": round(invest / price, 3), "amount": invest, "nav": price})
        txns.append({"isin": F1["isin"], "name": F1["name"], "folio": "F-1", "date": nav_date, "type": "STAMP_DUTY_TAX",
                     "units": 0.0, "amount": round(sip_amount - invest, 2), "nav": None})
        due = date(due.year + (due.month == 12), due.month % 12 + 1, 24)
    schemes, holdings = [], []
    f1_units = round(sum(t["units"] for t in txns), 3)
    funds = [(F1, "F-1", f1_units, f1)]
    if with_lump:
        f2 = series_for(F2)
        lq_units = round(50000 / nav_on(f2, "2025-03-03"), 3)
        txns.append({"isin": F2["isin"], "name": F2["name"], "folio": "F-2", "date": "2025-03-03", "type": "PURCHASE",
                     "units": lq_units, "amount": 50000.0, "nav": nav_on(f2, "2025-03-03")})
        funds.append((F2, "F-2", lq_units, f2))
    for fund, folio, units, rows in funds:
        price = [n for d, n in rows if d <= period_to][-1]
        holdings.append({"isin": fund["isin"], "amfi": fund["amfi"], "amc": fund["amc"], "name": fund["name"], "folio": folio,
                         "rta": "KFINTECH", "asset_type": "mutual_fund", "units": units, "price": price,
                         "value": round(units * price, 2), "valuation_date": period_to,
                         "invested": round(sum(t["amount"] for t in txns if t["isin"] == fund["isin"]), 2)})
        schemes.append({"folio": folio, "isin": fund["isin"], "amfi": fund["amfi"], "name": fund["name"], "amc": fund["amc"],
                        "open": 0.0, "close": units, "type": fund["type"], "plan": "Direct", "kyc_ok": True,
                        "pan_kyc_ok": True, "nominee": True})
    txns.sort(key=lambda t: (t["date"], t["type"]))
    held = {(h["folio"], h["isin"]): h["units"] for h in holdings}
    return {"statement_type": "RTA_CAS", "file_type": "KFINTECH", "cas_type": "DETAILED", "pan": synthetic.PAN_A,
            "holder_name": "ALPHA SAMPLE PERSON", "period_from": "2025-01-01", "period_to": period_to,
            "valuation_date": period_to, "total_value": round(sum(h["value"] for h in holdings), 2),
            "holdings": holdings, "transactions": txns, "schemes": schemes,
            "sips": detect_sips(txns, period_to, held), "warnings": []}


def market(end: date = date(2026, 11, 25)) -> dict:
    return {"navs": {F1["amfi"]: series_for(F1, end), F2["amfi"]: series_for(F2, end),
                     synthetic.BENCH["amfi"]: series_for(synthetic.BENCH, end)}, "isin_to_code": {}, "stocks": None}


def build(statements: list[dict], mkt: dict | None = None, today: date = TODAY) -> dict:
    return build_portfolio([{"member_id": "m-1", "pan": synthetic.PAN_A, "data": st} for st in statements],
                           market() if mkt is None else mkt, today)


# ---------------------------------------------------------------- schedule

def test_sip_day_is_the_usual_day_not_a_holiday_shift():
    st = rta_statement("2026-10-12", "2026-09-30")
    assert projection.sip_day(st["transactions"], "F-1", F1["isin"]) == 24  # weekend instalments moved to Monday


def test_due_dates_follow_the_mandate_day():
    sip = {"frequency": "monthly", "interval_days": 30, "last_date": "2026-09-24"}
    got = projection.due_dates(sip, 24, date(2026, 10, 12), TODAY)
    assert got == [date(2026, 10, 24), date(2026, 11, 24)]
    # the last instalment moved to the 26th (weekend): the next one is still due on the 24th
    shifted = {**sip, "last_date": "2026-10-26"}
    assert projection.due_dates(shifted, 24, date(2026, 10, 26), TODAY) == [date(2026, 11, 24)]
    # the 31st in a short month
    eom = {**sip, "last_date": "2026-01-31"}
    assert projection.due_dates(eom, 31, date(2026, 1, 31), date(2026, 4, 1))[:2] == [date(2026, 2, 28), date(2026, 3, 31)]
    weekly = {"frequency": "weekly", "interval_days": 7, "last_date": "2026-11-02"}
    assert projection.due_dates(weekly, None, date(2026, 11, 5), TODAY) == [date(2026, 11, 9), date(2026, 11, 16), date(2026, 11, 23)]
    assert projection.due_dates({"frequency": "irregular", "interval_days": 50, "last_date": "2026-09-01"}, 1, date(2026, 9, 2), TODAY) == []
    assert projection.next_due(sip, 24, TODAY) == date(2026, 12, 24)
    assert projection.next_due(sip, 24, date(2026, 12, 24)) == date(2026, 12, 24)  # due today counts as upcoming


def test_execution_uses_the_next_nav_day():
    s = NavSeries(series_for(F1))
    assert projection.execution(s, date(2026, 10, 24))[0] == "2026-10-26"  # Saturday → Monday
    assert projection.execution(s, date(2026, 11, 24))[0] == "2026-11-25"  # holiday → next day
    assert projection.execution(s, date(2026, 11, 26)) is None  # today's NAV isn't out yet
    assert projection.execution(None, date(2026, 11, 2)) is None


# ---------------------------------------------------------------- the owner's case

def test_october_statement_with_a_sip_on_the_24th():
    st = rta_statement("2026-10-12", "2026-09-30")
    snap = build([st])
    f1_rows = series_for(F1)
    h = next(x for x in snap["holdings"] if x["isin"] == F1["isin"])
    stmt_units = next(x["units"] for x in st["holdings"] if x["isin"] == F1["isin"])

    # two instalments since the statement, each at its own NAV, after stamp duty
    expected = []
    for due in ("2026-10-24", "2026-11-24"):
        d, price = next_nav_day(f1_rows, due)
        expected.append((d, round(10000 / 1.00005 / price, 3)))
    assert [(d, u) for d, u in expected] == [("2026-10-26", expected[0][1]), ("2026-11-25", expected[1][1])]
    est_units = sum(u for _, u in expected)
    assert h["estimated"] == {"since": "2026-10-12", "instalments": 2, "amount": 20000.0, "units": round(est_units, 4),
                              "pending": 0, "in_progress": 1, "in_progress_amount": 10000.0}

    # valued today: statement units + estimated units, at the latest NAV
    latest = f1_rows[-1]
    assert h["as_of"] == latest[0] == "2026-11-25"
    assert h["units"] == pytest.approx(stmt_units + est_units, abs=1e-4)
    assert h["value"] == pytest.approx((stmt_units + est_units) * latest[1], abs=0.01)
    assert h["statement"]["as_of"] == "2026-10-12" and h["statement"]["units"] == stmt_units  # the truth, kept
    # the money went in too: invested and the XIRR cash flows include it
    stmt_invested = next(x["invested"] for x in st["holdings"] if x["isin"] == F1["isin"])
    assert h["invested"] == pytest.approx(stmt_invested + 20000, abs=0.01)
    assert [-10000.0, -10000.0] == [a for d, a in h["cashflows"] if d > "2026-10-12"]
    assert h["benchmark_value"] is not None

    # units timeline: exact up to the statement, then the estimated instalments
    tl = h["units_timeline"]
    assert h["units_exact"] is True
    assert tl[-2][0] == "2026-10-26" and tl[-1][0] == "2026-11-25"
    assert tl[-1][1] == pytest.approx(stmt_units + est_units, abs=1e-4)
    assert projection.units_on(tl, "2026-10-25") == pytest.approx(stmt_units, abs=1e-4)

    # the liquid fund (no SIP) is valued at its latest NAV too, units unchanged
    lq = next(x for x in snap["holdings"] if x["isin"] == F2["isin"])
    assert lq["estimated"] is None and lq["units"] == lq["statement"]["units"] and lq["as_of"] == "2026-11-25"

    # the SIP's next date rolls forward from today instead of asking for a new statement
    sip = next(s for s in snap["sips"] if s["isin"] == F1["isin"])
    assert sip["status"] == "active" and sip["sip_day"] == 24
    assert (sip["next_due"], sip["next_date"], sip["next_moved"]) == ("2026-12-24", "2026-12-24", None)
    assert sip["estimated"] == {"instalments": 2, "amount": 20000.0}
    # 24 Nov was a holiday: debited and priced on the 25th, units show by 27 Nov, so it's in progress on the 26th
    assert sip["latest"] == {"due": "2026-11-24", "date": "2026-11-25", "moved": "holiday", "amount": 10000.0,
                             "status": "in_progress", "units_by": "2026-11-27"}

    # the estimated instalments are listed as such, with the broker-style status
    est = [a for a in snap["activity"] if a.get("estimated")]
    assert [(a["due"], a["date"], a["moved"], a["status"], a["source"]) for a in est] == [
        ("2026-11-24", "2026-11-25", "holiday", "in_progress", "Estimate"),
        ("2026-10-24", "2026-10-26", "weekend", "done", "Estimate"),
    ]

    m = snap["members"][0]
    assert m["as_of"] == "2026-10-12" and m["value_date"] == "2026-11-25"
    assert m["estimated"] == {"instalments": 2, "amount": 20000.0, "pending": 0, "pending_amount": 0, "in_progress": 1,
                              "in_progress_amount": 10000.0}
    assert m["total"] == pytest.approx(sum(x["value"] for x in snap["holdings"]), abs=0.01)
    assert m["statement_total"] == pytest.approx(st["total_value"], abs=0.01)
    # the month-by-month chart carries on to the latest NAV, with the estimated money as flows
    hist = {p["month"]: p for p in m["history"]}
    assert m["history_source"] == "transactions"
    assert hist["2026-11"]["value"] == pytest.approx(m["total"], abs=0.5)
    assert hist["2026-11"]["flow"] == 10000.0
    oct_flow_in_statement = sum(t["amount"] for t in st["transactions"] if t["date"].startswith("2026-10"))
    assert hist["2026-10"]["flow"] == pytest.approx(oct_flow_in_statement + 10000.0, abs=0.01)


def test_run_day_before_its_nav_is_pending_and_in_progress():
    st = rta_statement("2026-10-12", "2026-09-30")
    # 25 Nov: the instalment (moved from the 24th) is debited today; its NAV comes tonight
    snap = build([st], market(end=date(2026, 11, 23)), today=date(2026, 11, 25))
    h = next(x for x in snap["holdings"] if x["isin"] == F1["isin"])
    assert h["estimated"]["instalments"] == 1 and h["estimated"]["pending"] == 1  # not in the value yet
    assert h["estimated"]["in_progress"] == 1
    assert snap["members"][0]["estimated"]["pending"] == 1 and snap["members"][0]["estimated"]["pending_amount"] == 10000.0
    sip = next(s for s in snap["sips"] if s["isin"] == F1["isin"])
    assert sip["latest"]["status"] == "in_progress" and sip["latest"]["date"] == "2026-11-25"
    pending = next(a for a in snap["activity"] if a.get("estimated") and a["due"] == "2026-11-24")
    assert pending["units"] == 0.0 and pending["status"] == "in_progress"


def test_on_the_holiday_itself_the_instalment_is_still_upcoming():
    st = rta_statement("2026-10-12", "2026-09-30")
    snap = build([st], market(end=date(2026, 11, 23)), today=date(2026, 11, 24))
    sip = next(s for s in snap["sips"] if s["isin"] == F1["isin"])
    assert (sip["next_due"], sip["next_date"], sip["next_moved"]) == ("2026-11-24", "2026-11-25", "holiday")
    assert sip["latest"]["due"] == "2026-10-24" and sip["latest"]["status"] == "done"


def test_status_turns_done_after_two_business_days():
    st = rta_statement("2026-10-12", "2026-09-30")
    snap = build([st], market(end=date(2026, 11, 26)), today=date(2026, 11, 27))
    sip = next(s for s in snap["sips"] if s["isin"] == F1["isin"])
    assert sip["latest"]["status"] == "done" and sip["latest"]["units_by"] == "2026-11-27"


def test_business_days_and_run_dates():
    assert projection.run_date(date(2026, 11, 24)) == (date(2026, 11, 25), "holiday")
    assert projection.run_date(date(2026, 10, 24)) == (date(2026, 10, 26), "weekend")
    assert projection.run_date(date(2026, 12, 25)) == (date(2026, 12, 28), "holiday")  # Christmas, then the weekend
    assert projection.run_date(date(2026, 12, 24)) == (date(2026, 12, 24), None)
    assert projection.add_business_days(date(2026, 11, 25), 2) == date(2026, 11, 27)
    assert projection.add_business_days(date(2026, 12, 24), 2) == date(2026, 12, 29)
    # a past weekday with no NAV for the fund (later NAVs exist) was a holiday for it
    s = NavSeries([["2026-03-02", 10.0], ["2026-03-04", 10.1]])
    assert projection.is_business_day(date(2026, 3, 3), s) is False
    assert projection.run_date(date(2026, 3, 3), s) == (date(2026, 3, 4), "holiday")


def test_a_newer_statement_replaces_the_estimates():
    old = rta_statement("2026-10-12", "2026-09-30")
    new = rta_statement("2026-11-25", "2026-11-24")  # the real Oct and Nov instalments
    snap = build([old, new])
    h = next(x for x in snap["holdings"] if x["isin"] == F1["isin"])
    assert h["estimated"] is None and not [a for a in snap["activity"] if a.get("estimated")]
    assert h["units"] == next(x["units"] for x in new["holdings"] if x["isin"] == F1["isin"])
    assert snap["members"][0]["estimated"]["instalments"] == 0


def test_stopped_sip_is_not_estimated():
    st = rta_statement("2026-10-12", "2026-06-30")  # last instalment in June: stopped by October
    snap = build([st])
    assert next(s for s in snap["sips"] if s["isin"] == F1["isin"])["status"] == "stopped"
    h = next(x for x in snap["holdings"] if x["isin"] == F1["isin"])
    assert h["estimated"] is None and h["units"] == h["statement"]["units"]


def test_no_navs_keeps_the_statement_figures():
    st = rta_statement("2026-10-12", "2026-09-30")
    snap = build([st], {"navs": {}, "isin_to_code": {}, "stocks": None})
    h = next(x for x in snap["holdings"] if x["isin"] == F1["isin"])
    assert h["value"] == h["statement"]["value"] and h["as_of"] == "2026-10-12"
    assert h["estimated"]["instalments"] == 0 and h["estimated"]["pending"] == 2  # ran, but nothing to value them with
    assert snap["members"][0]["history"] == []  # nothing to rebuild or extend without NAVs


# ---------------------------------------------------------------- units timelines on the shared fixture

def test_units_timeline_sources():
    snap = build_portfolio(synthetic.statements(), synthetic.market(), synthetic.TODAY)
    by = {(h["member_id"], h["isin"]): h for h in snap["holdings"]}
    f1 = by[("m-alpha", F1["isin"])]  # KFintech (newer) has the full history: exact
    assert f1["units_exact"] is True and f1["units_timeline"][0] == ["2022-12-31", 0.0]
    assert f1["units_timeline"][-1][1] == pytest.approx(f1["statement"]["units"], abs=1e-3)
    f3 = by[("m-alpha", synthetic.F3["isin"])]  # demat only: the CDSL statement date
    assert f3["units_exact"] is False and f3["units_timeline"] == [["2026-10-31", 200.0]]
    beta = by[("m-beta", synthetic.F3["isin"])]  # two CDSL statements: two points
    assert [p[0] for p in beta["units_timeline"]] == ["2026-09-30", "2026-10-31"]
    eq = by[("m-alpha", synthetic.EQ["isin"])]  # a listed share: no NAV, not in daily returns
    assert eq["amfi_code"] is None and eq["units_timeline"] is None and eq["value"] == eq["statement"]["value"]
    assert all(h["amfi_code"] for h in snap["holdings"] if h["isin"].startswith("INF"))


def test_units_on_before_and_between_points():
    tl = [["2026-09-30", 100.0], ["2026-10-31", 120.0]]
    assert projection.units_on(tl, "2026-09-01") == 100.0  # before the first point: assumed the same
    assert projection.units_on(tl, "2026-10-15") == 100.0
    assert projection.units_on(tl, "2026-10-31") == 120.0
    assert projection.units_on([], "2026-10-31") == 0.0


def test_dividend_payouts_are_listed():
    st = rta_statement("2026-10-12", "2026-09-30")
    st["transactions"].append({"isin": F2["isin"], "name": F2["name"], "folio": "F-2", "date": "2026-06-15",
                               "type": "DIVIDEND_PAYOUT", "units": 0.0, "amount": 250.0, "nav": None})
    snap = build([st])
    lq = next(x for x in snap["holdings"] if x["isin"] == F2["isin"])
    assert lq["payouts"] == [["2026-06-15", 250.0]]


def test_estimates_are_deterministic():
    st = rta_statement("2026-10-12", "2026-09-30")
    a, b = build([st]), build([st])
    assert a == b
    assert (date.fromisoformat(a["holdings"][0]["as_of"]) - date(2026, 11, 25)) == timedelta(0)


# ---------------------------------------------------------------- the user's skip and cancel (M12, owner request)

def build_with(statements: list[dict], overrides: list[dict], today: date = TODAY, mkt: dict | None = None) -> dict:
    return build_portfolio([{"member_id": "m-1", "pan": synthetic.PAN_A, "data": st} for st in statements],
                           market() if mkt is None else mkt, today, overrides)


def f1_sip(snap: dict) -> dict:
    return next(s for s in snap["sips"] if s["isin"] == F1["isin"])


def test_skip_the_next_instalment_only():
    st = rta_statement("2026-10-12", "2026-09-30")
    skip = [{"member_id": "m-1", "isin": F1["isin"], "folio": "F-1", "kind": "skip", "due": "2026-12-24"}]
    snap = build_with([st], skip)
    sip = f1_sip(snap)
    assert sip["status"] == "active" and sip["skipped"] == ["2026-12-24"]
    assert (sip["next_due"], sip["next_date"]) == ("2027-01-24", "2027-01-25")  # 24 Jan 2027 is a Sunday
    # only that one: on 24 Jan the SIP runs again
    later = build_with([st], skip, today=date(2027, 1, 26), mkt=market(end=date(2027, 1, 25)))
    h = next(x for x in later["holdings"] if x["isin"] == F1["isin"])
    est = [a for a in later["activity"] if a.get("estimated") and a["isin"] == F1["isin"]]
    assert [a["due"] for a in est] == ["2027-01-24", "2026-11-24", "2026-10-24"]  # 24 Dec skipped
    assert h["estimated"]["instalments"] == 3


def test_skipping_a_past_instalment_takes_it_out_of_the_value():
    st = rta_statement("2026-10-12", "2026-09-30")
    base = build_with([st], [])
    skipped = build_with([st], [{"member_id": "m-1", "isin": F1["isin"], "folio": "F-1", "kind": "skip", "due": "2026-11-24"}])
    a = next(x for x in base["holdings"] if x["isin"] == F1["isin"])
    b = next(x for x in skipped["holdings"] if x["isin"] == F1["isin"])
    assert a["estimated"]["instalments"] == 2 and b["estimated"]["instalments"] == 1
    assert b["invested"] == pytest.approx(a["invested"] - 10000, abs=0.01)
    assert f1_sip(skipped)["latest"]["due"] == "2026-10-24"


def test_cancel_stops_every_estimate_from_that_day():
    st = rta_statement("2026-10-12", "2026-09-30")
    snap = build_with([st], [{"member_id": "m-1", "isin": F1["isin"], "folio": "F-1", "kind": "cancel", "due": "2026-11-01"}])
    sip = f1_sip(snap)
    assert sip["status"] == "cancelled" and sip["cancelled_on"] == "2026-11-01" and sip["next_date"] is None
    h = next(x for x in snap["holdings"] if x["isin"] == F1["isin"])
    assert h["estimated"]["instalments"] == 1  # October's ran before the cancel; November's isn't counted
    assert h["sip"] is None  # no "Active SIP" label any more
    # other members' SIPs in the same fund aren't touched
    other = build_with([st], [{"member_id": "m-2", "isin": F1["isin"], "folio": "F-1", "kind": "cancel", "due": "2026-11-01"}])
    assert f1_sip(other)["status"] == "active"


def test_a_newer_statement_beats_a_cancel():
    old, new = rta_statement("2026-10-12", "2026-09-30"), rta_statement("2026-11-25", "2026-11-24")
    cancel = [{"member_id": "m-1", "isin": F1["isin"], "folio": "F-1", "kind": "cancel", "due": "2026-11-01"}]
    sip = f1_sip(build_with([old, new], cancel))
    assert sip["status"] == "active" and sip["cancelled_on"] is None  # the statement shows instalments after it


def test_holidays_from_the_worker_replace_the_fallback():
    st = rta_statement("2026-10-12", "2026-09-30")
    mkt = {**market(), "holidays": ["2026-12-24"]}  # say the exchange shuts on 24 Dec
    sip = f1_sip(build([st], mkt))
    assert (sip["next_due"], sip["next_date"], sip["next_moved"]) == ("2026-12-24", "2026-12-25", "holiday")
    # with the fallback (no list sent), 24 Dec is a normal day and 25 Dec a holiday
    assert f1_sip(build([st]))["next_date"] == "2026-12-24"


def test_bad_overrides_are_ignored():
    st = rta_statement("2026-10-12", "2026-09-30")
    snap = build_with([st], [{"kind": "skip"}, {"member_id": "m-1", "isin": F1["isin"], "folio": "F-1", "kind": "other", "due": "2026-12-24"}])
    assert f1_sip(snap)["status"] == "active" and f1_sip(snap)["skipped"] == []
