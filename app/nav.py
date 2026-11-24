"""Historical NAVs for rebuilding month-end portfolio values from statement transactions.

Source: api.mfapi.in (free, AMFI daily NAVs). Only AMFI scheme codes are sent; no PAN, units or
amounts ever leave the machine. Responses are cached on disk and refreshed at most once a day.
Set NAV_HISTORY=0 to turn this off (the chart then falls back to CDSL month-end values).
"""

from __future__ import annotations

import bisect
import json
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

import httpx

log = logging.getLogger("nav")

API = "https://api.mfapi.in/mf/{code}"
MAX_AGE = 24 * 3600


def enabled() -> bool:
    return os.getenv("NAV_HISTORY", "1").lower() not in {"0", "false", "off", "no"}


class NavSeries:
    """Daily NAVs for one scheme, looked up as 'last NAV on or before a date'."""

    def __init__(self, rows: list[tuple[str, float]]):
        rows.sort()
        self.dates = [d for d, _ in rows]
        self.navs = [n for _, n in rows]

    def on(self, iso_date: str, max_stale_days: int = 10) -> float | None:
        i = bisect.bisect_right(self.dates, iso_date) - 1
        if i < 0:
            return None
        gap = (datetime.fromisoformat(iso_date) - datetime.fromisoformat(self.dates[i])).days
        return self.navs[i] if gap <= max_stale_days else None


def _parse(payload: dict) -> list[tuple[str, float]]:
    rows = []
    for r in payload.get("data", []):
        try:
            rows.append((datetime.strptime(r["date"], "%d-%m-%Y").date().isoformat(), float(r["nav"])))
        except (KeyError, ValueError, TypeError):
            continue
    return rows


def _load(code: str, cache_dir: Path, client: httpx.Client) -> NavSeries | None:
    path = cache_dir / f"{code}.json"
    fresh = path.exists() and time.time() - path.stat().st_mtime < MAX_AGE
    if not fresh:
        try:
            r = client.get(API.format(code=code))
            r.raise_for_status()
            payload = r.json()
            if _parse(payload):
                path.write_text(json.dumps(payload))
        except (httpx.HTTPError, ValueError) as e:
            log.warning("NAV history unavailable for a scheme (%s); using cache if any", type(e).__name__)
    if not path.exists():
        return None
    try:
        rows = _parse(json.loads(path.read_text()))
    except (OSError, ValueError):
        return None
    return NavSeries(rows) if rows else None


def nav_history(codes: set[str], cache_dir: Path) -> dict[str, NavSeries]:
    """{amfi_code: NavSeries} for every code that could be loaded."""
    codes = {str(c) for c in codes if c}
    if not codes or not enabled():
        return {}
    cache_dir.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=15, headers={"User-Agent": "portfolio-tracker"}) as client, ThreadPoolExecutor(8) as pool:
        loaded = dict(zip(codes, pool.map(lambda c: _load(c, cache_dir, client), codes)))
    return {c: s for c, s in loaded.items() if s}
