"""Market maths over NAV series supplied by the caller: trailing fund returns and a Nifty 50 replay of the
investor's own cash flows. Pure functions: no network, no disk (the NAV store lives in the Worker, plan §10.4)."""

from __future__ import annotations

import bisect
from datetime import date, datetime, timedelta

BENCHMARK_CODE = "120716"  # UTI Nifty 50 Index Fund - Direct Plan - Growth
BENCHMARK_NAME = "Nifty 50 index fund"


class NavSeries:
    """Daily NAVs for one scheme, looked up as 'last NAV on or before a date'."""

    def __init__(self, rows: list[tuple[str, float]] | list[list]):
        rows = sorted((str(d), float(n)) for d, n in rows)
        self.dates = [d for d, _ in rows]
        self.navs = [n for _, n in rows]

    def on(self, iso_date: str, max_stale_days: int = 10) -> float | None:
        i = bisect.bisect_right(self.dates, iso_date) - 1
        if i < 0:
            return None
        gap = (datetime.fromisoformat(iso_date) - datetime.fromisoformat(self.dates[i])).days
        return self.navs[i] if gap <= max_stale_days else None


def series_map(navs: dict[str, list | NavSeries] | None) -> dict[str, NavSeries]:
    """{amfi_code: [[iso_date, nav], ...] or NavSeries (from the NAV store)} → {amfi_code: NavSeries}, skipping empty
    series."""
    out = {}
    for code, rows in (navs or {}).items():
        if isinstance(rows, NavSeries):
            if rows.dates:
                out[str(code)] = rows
        elif rows:
            out[str(code)] = NavSeries(rows)
    return out


def _years_before(iso: str, years: int) -> str:
    d = date.fromisoformat(iso)
    try:
        return d.replace(year=d.year - years).isoformat()
    except ValueError:  # 29 Feb
        return (d - timedelta(days=365 * years)).isoformat()


def trailing_returns(series: NavSeries | None) -> dict[str, float | None]:
    """1Y absolute, 3Y / 5Y annualised, point to point from the latest NAV. None when the fund is younger."""
    out: dict[str, float | None] = {"1y": None, "3y": None, "5y": None}
    if not series or not series.dates:
        return out
    end, last = series.dates[-1], series.navs[-1]
    for key, years in (("1y", 1), ("3y", 3), ("5y", 5)):
        start = _years_before(end, years)
        if series.dates[0] > start:
            continue
        first = series.on(start)
        if first:
            out[key] = round((last / first) ** (1 / years) - 1, 5)
    return out


def replay(cashflows: list[list] | None, bench: NavSeries | None, as_of: str) -> float | None:
    """Value today had the same rupees gone in (and come out) of the benchmark on the same days.
    Cash flows are from the investor's side: money in negative, money out positive."""
    if not cashflows or not bench:
        return None
    units = 0.0
    for d, amount in cashflows:
        price = bench.on(d)
        if price is None:
            return None
        units += -amount / price
    price = bench.on(as_of) or (bench.navs[-1] if bench.navs else None)
    return round(max(units, 0.0) * price, 2) if price else None
