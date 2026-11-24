"""Market comparisons from public NAV data (api.mfapi.in): trailing fund returns and a
Nifty 50 benchmark replay of the investor's own cash flows. Only scheme codes are fetched."""

from __future__ import annotations

import json
import logging
import time
from datetime import date, timedelta
from pathlib import Path

import httpx

from .nav import NavSeries, enabled

log = logging.getLogger("market")

BENCHMARK_CODE = "120716"  # UTI Nifty 50 Index Fund - Direct Plan - Growth
BENCHMARK_NAME = "Nifty 50 index fund"
SCHEMES_URL = "https://api.mfapi.in/mf"
SCHEMES_MAX_AGE = 7 * 24 * 3600


def _scheme_list(cache_dir: Path) -> dict[str, list]:
    """{ISIN: [AMFI scheme code, scheme name]} from mfapi's public scheme list, cached for a week."""
    path = cache_dir / "scheme-list.json"
    if enabled() and (not path.exists() or time.time() - path.stat().st_mtime > SCHEMES_MAX_AGE):
        try:
            r = httpx.get(SCHEMES_URL, timeout=30, headers={"User-Agent": "portfolio-tracker"})
            r.raise_for_status()
            mapping = {}
            for s in r.json():
                for k in ("isinGrowth", "isinDivReinvestment"):
                    if s.get(k):
                        mapping[s[k]] = [str(s["schemeCode"]), s.get("schemeName") or ""]
            if mapping:
                cache_dir.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(mapping))
        except (httpx.HTTPError, ValueError, KeyError) as e:
            log.warning("Scheme list unavailable (%s); using cache if any", type(e).__name__)
    try:
        return json.loads(path.read_text()) if path.exists() else {}
    except (OSError, ValueError):
        return {}


def isin_to_code(cache_dir: Path) -> dict[str, str]:
    return {k: v[0] for k, v in _scheme_list(cache_dir).items()}


def isin_to_name(cache_dir: Path) -> dict[str, str]:
    return {k: v[1] for k, v in _scheme_list(cache_dir).items()}


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
