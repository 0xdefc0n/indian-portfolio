"""After the statement: units over time, estimated SIP instalments and today's value (plan §10.5.1, M12).

A statement shows one day. Until the next upload, the build carries it forward with public NAVs only:
  - units over time (`units_timeline`): exact from a CAMS/KFintech transaction history, else one point per CDSL
    statement date with units constant in between;
  - estimated SIP instalments (owner request, 2026-11-26): each active SIP's due dates after the statement, up to
    today. As brokers and RTAs do it (AMFI "Payment modes and their efficiency", Annexure A2; KFintech's SIP TAT
    table): a due date on a weekend or exchange holiday runs on the next business day T; the bank is debited on T;
    units are allotted at T's NAV (after 0.005% stamp duty) and show in the folio within 1–2 business days (NACH: T to
    T+2). So an instalment is "in_progress" from T until T+2 business days, then "done". Its units count in the value
    as soon as T's NAV is out; until then it's pending and not counted;
  - today's value: the statement's units plus the estimated ones, times the latest NAV.
Estimates only ever start after the newest statement date, so the next upload replaces them by itself.
Pure functions: no clock, no network, no disk.
"""

from __future__ import annotations

import bisect
import calendar
from collections import Counter
from datetime import date, timedelta

from . import holidays
from .market import NavSeries

STAMP_DUTY = 0.00005  # 0.005% of the amount invested, since 1 Jul 2020
EXECUTE_WITHIN_DAYS = 7  # a due date is allotted at the first NAV within a week (weekends, holidays)
SIP_DAY_SAMPLE = 12  # the usual day of the month, from the latest instalments
MONTHLY_STEPS = {"monthly": (1, 15), "quarterly": (3, 45)}  # (months per step, minimum days after the last one)


def _d(iso: str) -> date:
    return date.fromisoformat(iso[:10])


def _add_months(y: int, m: int, k: int) -> tuple[int, int]:
    n = y * 12 + (m - 1) + k
    return n // 12, n % 12 + 1


def sip_day(transactions: list[dict], folio: str | None, isin: str) -> int | None:
    """The SIP's usual day of the month: the most common day among its latest instalments (a holiday moves one
    instalment, not the mandate). Ties go to the latest instalment's day."""
    days = sorted(t["date"] for t in transactions
                  if t.get("type") == "PURCHASE_SIP" and t.get("isin") == isin and t.get("folio") == folio and t.get("amount"))
    if not days:
        return None
    recent = [int(d[8:10]) for d in days[-SIP_DAY_SAMPLE:]]
    counts = Counter(recent)
    top = max(counts.values())
    return next(d for d in reversed(recent) if counts[d] == top)


def due_dates(sip: dict, day: int | None, after: date, until: date) -> list[date]:
    """Scheduled instalment dates in (after, until], following the SIP's last instalment."""
    last = _d(sip["last_date"])
    out: list[date] = []
    freq = sip.get("frequency")
    if freq in MONTHLY_STEPS:
        step, min_gap = MONTHLY_STEPS[freq]
        day = day or last.day
        k = 0
        while True:
            y, m = _add_months(last.year, last.month, k * step)
            d = date(y, m, min(day, calendar.monthrange(y, m)[1]))
            if d > until:
                break
            if (d - last).days > min_gap and d > after:
                out.append(d)
            k += 1
    elif freq in ("weekly", "fortnightly"):
        step_days = int(sip.get("interval_days") or (7 if freq == "weekly" else 14))
        d = last + timedelta(days=step_days)
        while d <= until:
            if d > after:
                out.append(d)
            d += timedelta(days=step_days)
    return out  # irregular SIPs aren't predictable: no estimate


ALLOTMENT_DAYS = 2  # units show by T+2 business days at the latest (KFintech NACH: T+1/T+2; AMFI: T)


def is_business_day(d: date, series: NavSeries | None = None) -> bool:
    """A weekday that isn't an exchange holiday. A past weekday with no NAV for the fund (later NAVs exist) was one."""
    iso = d.isoformat()
    if d.weekday() >= 5 or iso in holidays.UPCOMING_HOLIDAYS:
        return False
    if series and series.dates and series.dates[-1] > iso:
        i = bisect.bisect_left(series.dates, iso)
        return i < len(series.dates) and series.dates[i] == iso
    return True


def run_date(due: date, series: NavSeries | None = None) -> tuple[date, str | None]:
    """The business day an instalment due on `due` runs (is debited and priced), and why it moved, if it did."""
    d, reason = due, None
    for _ in range(14):
        if is_business_day(d, series):
            return d, reason
        reason = reason or ("weekend" if d.weekday() >= 5 else "holiday")
        d += timedelta(days=1)
    return d, reason


def add_business_days(d: date, n: int, series: NavSeries | None = None) -> date:
    while n > 0:
        d += timedelta(days=1)
        if is_business_day(d, series):
            n -= 1
    return d


def next_run(sip: dict, day: int | None, today: date, series: NavSeries | None = None) -> dict | None:
    """The next instalment that hasn't run yet: {"due", "date" (the run date), "moved"}. None for irregular SIPs."""
    for due in due_dates(sip, day, today - timedelta(days=10), today + timedelta(days=130)):
        run, moved = run_date(due, series)
        if run > today:
            return {"due": due.isoformat(), "date": run.isoformat(), "moved": moved}
    return None


def next_due(sip: dict, day: int | None, today: date) -> date | None:
    """The first scheduled date on or after today (None for an irregular SIP)."""
    dates = due_dates(sip, day, today - timedelta(days=1), today + timedelta(days=100))
    return dates[0] if dates else None


def execution(series: NavSeries | None, due: date) -> tuple[str, float] | None:
    """(NAV date, NAV) an instalment due on `due` is allotted at, or None while that NAV isn't out."""
    if not series:
        return None
    run, _ = run_date(due, series)
    i = bisect.bisect_left(series.dates, run.isoformat())
    if i >= len(series.dates) or (_d(series.dates[i]) - run).days > EXECUTE_WITHIN_DAYS:
        return None
    return series.dates[i], series.navs[i]


def estimate_sips(sips: list[dict], transactions: list[dict], after: str, series: NavSeries | None, today: date) -> dict:
    """Estimated instalments of one fund's active SIPs that have run after the statement date `after`.

    {"instalments": [...]} with each {"due", "date" (run date T), "moved" (None | "weekend" | "holiday"), "amount",
    "units", "nav", "folio", "status" ("in_progress" | "done"), "units_by"}; `units`/`nav` are None while T's NAV
    isn't out (pending: not counted in the value). "pending" lists those.
    """
    out = []
    start = _d(after)
    for s in sips:
        if s.get("status") != "active" or not s.get("amount"):
            continue
        day = sip_day(transactions, s.get("folio"), s["isin"])
        for due in due_dates(s, day, start, today):
            run, moved = run_date(due, series)
            if run > today:
                continue  # moved past today: still upcoming
            units_by = add_business_days(run, ALLOTMENT_DAYS, series)
            got = execution(series, due)
            inst = {"due": due.isoformat(), "date": run.isoformat(), "moved": moved, "amount": float(s["amount"]),
                    "units": None, "nav": None, "folio": s.get("folio"),
                    "status": "done" if got and today >= units_by else "in_progress", "units_by": units_by.isoformat()}
            if got:
                nav_date, price = got
                inst.update(date=nav_date, nav=price, units=round(s["amount"] / (1 + STAMP_DUTY) / price, 3))
            out.append(inst)
    out.sort(key=lambda x: (x["date"], x["folio"] or ""))
    return {"instalments": [i for i in out if i["units"] is not None], "pending": [i for i in out if i["units"] is None]}


def units_timeline(isin: str, rta: dict | None, cdsl_statements: list[dict], as_of: str, units: float) -> tuple[list[list], bool]:
    """[[date, units at the end of that day]], oldest first, and whether it's exact.

    Exact: a CAMS/KFintech statement whose transactions add up (opening balance + every transaction = closing) and
    which is the holding's newest source. Otherwise points at each CDSL statement date (after the CAMS/KFintech
    part, if any), units assumed constant in between. Before the first point, units are the first point's.
    """
    points: dict[str, float] = {}
    rta_end = ""
    folios = [s for s in (rta or {}).get("schemes", []) if s.get("isin") == isin]
    if folios and rta.get("period_from"):
        txns = []
        ok = True
        for s in folios:
            mine = [t for t in rta.get("transactions", []) if t.get("isin") == isin and t.get("folio") == s.get("folio") and t.get("units")]
            if abs((s.get("open") or 0) + sum(t["units"] for t in mine) - (s.get("close") or 0)) > 0.01:
                ok = False
                break
            txns += mine
        if ok:
            bal = sum(s.get("open") or 0 for s in folios)
            points[(_d(rta["period_from"]) - timedelta(days=1)).isoformat()] = bal
            for t in sorted(txns, key=lambda t: t["date"]):
                bal += t["units"]
                points[t["date"][:10]] = bal
            rta_end = (rta.get("valuation_date") or rta.get("period_to") or "")[:10]
    for st in sorted(cdsl_statements, key=lambda st: st.get("period_to") or ""):
        d = (st.get("period_to") or "")[:10]
        if not d or (rta_end and d <= rta_end):
            continue
        points[d] = sum(h.get("units") or 0 for h in st.get("holdings", []) if h.get("isin") == isin)
    exact = bool(rta_end) and all(d <= rta_end for d in points)
    last = max(points) if points else None
    mismatch = last is None or abs(points[last] - (units or 0)) > 0.01
    if mismatch or last < as_of[:10]:
        points[as_of[:10]] = units or 0  # the holding's own figure is the truth on its date
    if mismatch:
        exact = False
    out = [[d, round(max(u, 0.0), 4)] for d, u in sorted(points.items())]
    return out, exact


def extend_timeline(timeline: list[list], instalments: list[dict]) -> list[list]:
    """Add the estimated instalments' units (from their NAV date on)."""
    if not instalments:
        return timeline
    out = [list(p) for p in timeline]
    units = out[-1][1] if out else 0.0
    for inst in instalments:
        units = round(units + inst["units"], 4)
        if out and out[-1][0] == inst["date"]:
            out[-1][1] = units
        else:
            out.append([inst["date"], units])
    return out


def units_on(timeline: list[list], day: str) -> float:
    """Units at the end of `day`."""
    if not timeline:
        return 0.0
    i = bisect.bisect_right([p[0] for p in timeline], day) - 1
    return timeline[i][1] if i >= 0 else timeline[0][1]


def month_end(y: int, m: int) -> str:
    return date(y, m, calendar.monthrange(y, m)[1]).isoformat()
