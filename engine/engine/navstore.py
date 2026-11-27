"""NAV series for /build, read from the Worker's NAV store (plan §10.2, M10).

The Worker writes the full series of every tracked scheme to R2 as `market/nav/{code}.json`
(`{amfi_code, dates: [ISO...], navs: [...]}`). The engine reads them over plain HTTP from `NAV_STORE_URL`
(`http://market.internal/nav/`). The container has no internet: EngineBatch routes that one host to a Worker
entrypoint that reads R2 (worker/src/market-gateway.ts), so no R2 credentials ever enter the container.

Series are cached in-process, keyed by (code, nav_key). The Worker's nav_key changes whenever the night's rows land
(date, coverage, final), so a cached series is never older than the store's. Missing series (404) are not cached,
and `refresh` codes (backfill still running) always read fresh. The cache is bounded by the NAV points it holds.
Public market data only: no statement data is ever sent.

Exchange prices for shares and bonds (M20) come the same way from `market/px/{isin}.json`
(`{isin, dates, closes}`), at `http://market.internal/px/`, cached by (isin, price_key).
"""

from __future__ import annotations

import json
import os
import re
import threading
import urllib.error
import urllib.request
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor

from .market import NavSeries

CODE_RE = re.compile(r"^\d{1,9}$")
ISIN_RE = re.compile(r"^IN[E9][0-9A-Z]{9}$")
MAX_CACHED_POINTS = 1_000_000  # ~100 MB of Python lists at most; a 20-year daily series is ~5,000 points
FETCH_THREADS = 8
TIMEOUT_S = 20


class NavStoreError(Exception):
    """The NAV store couldn't be read (not a missing series: that's just None)."""


def store_url() -> str | None:
    return os.getenv("NAV_STORE_URL") or None


class NavCache:
    def __init__(self, max_points: int = MAX_CACHED_POINTS):
        self.max_points = max_points
        self.points = 0
        self.hits = 0
        self.misses = 0
        self._items: OrderedDict[tuple[str, str], NavSeries] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: tuple[str, str]) -> tuple[bool, NavSeries | None]:
        with self._lock:
            if key not in self._items:
                return False, None
            self._items.move_to_end(key)
            return True, self._items[key]

    def put(self, key: tuple[str, str], series: NavSeries) -> None:
        size = len(series.dates)
        with self._lock:
            if key in self._items:
                return
            self._items[key] = series
            self.points += size
            while self.points > self.max_points and len(self._items) > 1:
                _, old = self._items.popitem(last=False)
                self.points -= len(old.dates)

    def __len__(self) -> int:
        return len(self._items)


CACHE = NavCache()


def price_url(base: str | None = None) -> str | None:
    """The price series' base URL: the NAV store's with /nav/ replaced by /px/."""
    base = base or store_url()
    return re.sub(r"/nav/?$", "/px/", base.rstrip("/") + "/") if base else None


def _fetch(base: str, code: str, field: str = "navs") -> NavSeries | None:
    try:
        with urllib.request.urlopen(f"{base.rstrip('/')}/{code}.json", timeout=TIMEOUT_S) as res:  # noqa: S310 (fixed host)
            body = json.loads(res.read())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None  # not tracked or not backfilled yet: the build degrades gracefully
        raise NavStoreError(f"status {e.code}") from None
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as e:
        raise NavStoreError(type(e).__name__) from None
    dates, navs = body.get("dates") or [], body.get(field) or []
    if len(dates) != len(navs):
        raise NavStoreError("malformed series")
    return NavSeries(list(zip(dates, navs))) if dates else None


def load(codes: list[str], nav_key: str, base: str | None = None, cache: NavCache | None = None,
         refresh: set[str] | None = None) -> dict[str, NavSeries]:
    """{code: NavSeries} for the codes the store has. Raises NavStoreError if the store can't be reached."""
    cache = cache or CACHE
    refresh = refresh or set()
    base = base or store_url()
    if not base:
        return {}
    wanted = sorted({str(c) for c in codes if CODE_RE.match(str(c))})
    out: dict[str, NavSeries] = {}
    missing = []
    for code in wanted:
        hit, series = (False, None) if code in refresh else cache.get((code, nav_key))
        if hit:
            cache.hits += 1
            if series:
                out[code] = series
        else:
            missing.append(code)
    if missing:
        cache.misses += len(missing)
        with ThreadPoolExecutor(max_workers=min(FETCH_THREADS, len(missing))) as pool:
            for code, series in zip(missing, pool.map(lambda c: _fetch(base, c), missing)):
                if series:
                    out[code] = series
                    if code not in refresh:
                        cache.put((code, nav_key), series)
    return out


def load_prices(isins: list[str], price_key: str, base: str | None = None, cache: NavCache | None = None,
                refresh: set[str] | None = None) -> dict[str, NavSeries]:
    """{isin: NavSeries of daily closes} for the shares and bonds the store has (M20). Same rules as load()."""
    cache = cache or CACHE
    refresh = refresh or set()
    base = price_url(base)
    if not base:
        return {}
    wanted = sorted({str(i) for i in isins if ISIN_RE.match(str(i))})
    out: dict[str, NavSeries] = {}
    missing = []
    for isin in wanted:
        hit, series = (False, None) if isin in refresh else cache.get((f"px:{isin}", price_key))
        if hit:
            cache.hits += 1
            if series:
                out[isin] = series
        else:
            missing.append(isin)
    if missing:
        cache.misses += len(missing)
        with ThreadPoolExecutor(max_workers=min(FETCH_THREADS, len(missing))) as pool:
            for isin, series in zip(missing, pool.map(lambda i: _fetch(base, i, "closes"), missing)):
                if series:
                    out[isin] = series
                    if isin not in refresh:
                        cache.put((f"px:{isin}", price_key), series)
    return out
