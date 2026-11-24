"""Stocks inside each mutual fund, from BharatStock's monthly portfolio disclosures
(https://bharatstockapi.com). Built to spend as few API requests as possible:

* Fund -> portfolio-name matches are looked up once and remembered.
* A fund's holdings are fetched once, then again only when its fund house has published a newer
  month. That check uses the free, unauthenticated /v1/mf-coverage endpoint, at most once a day.
* Paid requests are counted per day (UTC) in the cache file and stop at BHARATSTOCK_DAILY_LIMIT
  (default 50 of the free plan's 60); anything left over continues the next day.
* Refreshes run in a background thread; page loads only ever read the cache.

Only scheme names are sent. No PAN, units or amounts leave the machine.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

import httpx

log = logging.getLogger("stocks")

BASE = "https://bharatstockapi.com"
COVERAGE_MAX_AGE = 24 * 3600
UNMATCHED_RETRY = 30 * 24 * 3600
MIN_CHECK_INTERVAL = 3600  # don't even look at the cache more often than this while the server runs

_lock = threading.Lock()
_last_check = 0.0
_running = False


def api_key() -> str:
    return os.getenv("BHARATSTOCK_API_KEY", "").strip().strip('"').strip("'")


def daily_limit() -> int:
    try:
        return max(0, int(os.getenv("BHARATSTOCK_DAILY_LIMIT", "50")))
    except ValueError:
        return 50


# ---------------------------------------------------------------- cache

def _cache_path(cache_dir: Path) -> Path:
    return cache_dir / "holdings.json"


def load_cache(cache_dir: Path) -> dict:
    try:
        return json.loads(_cache_path(cache_dir).read_text())
    except (OSError, ValueError):
        return {}


def _save(cache_dir: Path, cache: dict) -> None:
    cache_dir.mkdir(parents=True, exist_ok=True)
    tmp = _cache_path(cache_dir).with_suffix(".tmp")
    tmp.write_text(json.dumps(cache))
    tmp.replace(_cache_path(cache_dir))


def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def requests_today(cache: dict) -> int:
    u = cache.get("usage") or {}
    return u.get("count", 0) if u.get("date") == _today() else 0


# ---------------------------------------------------------------- matching

STOP = {"fund", "plan", "direct", "regular", "growth", "option", "the", "scheme", "mutual", "and", "of", "erstwhile", "formerly"}


def _tokens(name: str) -> set[str]:
    n = name.lower().replace("&", " and ").replace("fund of funds", "fof")
    n = re.sub(r"\(.*?\)", " ", n)
    return {t for t in re.findall(r"[a-z0-9]+", n) if t not in STOP}


def _score(a: str, b: str) -> float:
    ta, tb = _tokens(a), _tokens(b)
    return len(ta & tb) / len(ta | tb) if ta and tb else 0.0


def _query(name: str) -> str:
    """Search text for the portfolio list: the fund's own name without 'Fund' and plan words."""
    n = re.sub(r"\s*-\s*(direct|regular).*$", "", name, flags=re.I)
    n = re.sub(r"\bfund\b.*$", "", n, flags=re.I).strip()
    return n or name


# ---------------------------------------------------------------- HTTP

class _Budget(Exception):
    pass


class _Client:
    def __init__(self, cache: dict, cache_dir: Path):
        self.cache, self.cache_dir = cache, cache_dir
        self.http = httpx.Client(base_url=BASE, timeout=30, headers={"X-API-Key": api_key(), "User-Agent": "portfolio-tracker"})

    def get(self, path: str, **params) -> dict:
        if requests_today(self.cache) >= daily_limit():
            raise _Budget()
        u = self.cache.setdefault("usage", {})
        if u.get("date") != _today():
            u.update(date=_today(), count=0)
        u["count"] = u.get("count", 0) + 1  # counted before sending: a failed call still uses quota
        _save(self.cache_dir, self.cache)
        r = self.http.get(path, params={k: v for k, v in params.items() if v is not None})
        if r.status_code == 429:
            u["count"] = daily_limit()  # provider says we're out; stop until tomorrow
            raise _Budget()
        r.raise_for_status()
        return r.json()


def _coverage(cache: dict) -> dict[str, str]:
    """{fund house: latest month}. Free endpoint, refreshed at most daily."""
    cov = cache.get("coverage") or {}
    if time.time() - cov.get("fetched_at", 0) > COVERAGE_MAX_AGE:
        try:
            r = httpx.get(f"{BASE}/v1/mf-coverage", timeout=30)
            r.raise_for_status()
            houses = {h["fund_house"]: h.get("latest_month") for h in r.json().get("houses", [])}
            cov = cache["coverage"] = {"fetched_at": time.time(), "houses": houses}
        except (httpx.HTTPError, ValueError, KeyError) as e:
            log.warning("Coverage check failed (%s)", type(e).__name__)
    return cov.get("houses", {})


# ---------------------------------------------------------------- refresh

FUND_UNIT = "MUTUAL_FUND_UNIT"
STOCK_TYPES = {"EQUITY", "FOREIGN_EQUITY"}


def _prev_month(m: str) -> str:
    y, mo = int(m[:4]), int(m[5:7])
    return f"{y - 1}-12" if mo == 1 else f"{y}-{mo - 1:02d}"


def _match(funds: list[dict], client: _Client, cache: dict, cache_dir: Path, stats: dict) -> None:
    """Find each fund's portfolio name once; unmatched funds are retried after a month."""
    matches = cache.setdefault("matches", {})
    for f in funds:
        m = matches.get(f["isin"])
        if m and (m.get("scheme_name") or time.time() - m.get("checked_at", 0) < UNMATCHED_RETRY):
            continue
        best, best_score = None, 0.0
        if f.get("name"):
            for q in dict.fromkeys([_query(f["name"]), " ".join(_query(f["name"]).split()[:2])]):
                for r in client.get("/v1/mf/portfolios", q=q, limit=50).get("data", []):
                    sc = _score(f["name"], r["scheme_name"])
                    if sc > best_score:
                        best, best_score = r, sc
                if best_score >= 0.6:
                    break
        ok = best is not None and best_score >= 0.6
        matches[f["isin"]] = {
            "scheme_name": best["scheme_name"] if ok else None,
            "fund_house": best["fund_house"] if ok else None,
            "score": round(best_score, 2), "checked_at": time.time(),
        }
        stats["matched"] += ok
        _save(cache_dir, cache)


def _fetch_rows(client: _Client, name: str, month: str | None = None) -> tuple[list, dict]:
    rows, page, meta = [], 1, {}
    while True:
        d = client.get(f"/v1/mf/portfolios/{quote(name, safe='')}/holdings", page=page, page_size=100, month=month)
        meta = d
        rows += d.get("data", [])
        if page >= (d.get("pagination") or {}).get("total_pages", 1):
            return rows, meta
        page += 1


def _fetch(funds: list[dict], client: _Client, cache: dict, cache_dir: Path, houses: dict, stats: dict) -> None:
    """Holdings for funds that have none yet, or whose fund house has published a newer month."""
    matches, holdings = cache.setdefault("matches", {}), cache.setdefault("holdings", {})
    for f in funds:
        m = matches.get(f["isin"]) or {}
        name = m.get("scheme_name")
        if not name:
            continue
        have = holdings.get(name)
        latest = houses.get(m.get("fund_house") or "")
        if have and (not latest or have.get("month", "") >= latest):
            continue
        rows, meta = _fetch_rows(client, name)
        month = (meta.get("portfolio_date") or "")[:7]
        if not rows and latest:
            # nothing for the newest month yet: fall back to the month before, once per new month
            rows, meta = _fetch_rows(client, name, _prev_month(latest))
            month = (meta.get("portfolio_date") or "")[:7] or month
        holdings[name] = {
            # the house's latest month is recorded even when empty, so it isn't fetched again until a newer one
            "month": max(month, latest or "") or datetime.now(timezone.utc).strftime("%Y-%m"),
            "data_month": month or None,
            "fetched_at": time.time(),
            "rows": [
                {"isin": r.get("isin") or r.get("symbol") or r.get("company_name"), "symbol": r.get("symbol"),
                 "name": r.get("company_name"), "sector": r.get("sector"), "type": r.get("instrument_type"),
                 "pct": r.get("pct_of_aum") or 0}
                for r in rows if (r.get("pct_of_aum") or 0) > 0
            ],
        }
        stats["fetched"] += 1
        _save(cache_dir, cache)


def _underlying(funds: list[dict], cache: dict, names: dict[str, str]) -> list[dict]:
    """Funds held inside fund-of-funds portfolios, to look through to their stocks (one level deep)."""
    matches, holdings = cache.get("matches", {}), cache.get("holdings", {})
    out: dict[str, dict] = {}
    for f in funds:
        h = holdings.get((matches.get(f["isin"]) or {}).get("scheme_name") or "")
        for r in (h or {}).get("rows", []):
            if r["type"] == FUND_UNIT and str(r["isin"]).startswith("INF"):
                out[r["isin"]] = {"isin": r["isin"], "name": names.get(r["isin"]) or r.get("name") or ""}
    return list(out.values())


def _refresh(funds: list[dict], cache_dir: Path, names: dict[str, str]) -> None:
    """funds: [{"isin", "name"}] for equity funds. Updates the cache within the daily budget."""
    cache = load_cache(cache_dir)
    houses = _coverage(cache)
    _save(cache_dir, cache)
    client = _Client(cache, cache_dir)
    stats = {"matched": 0, "fetched": 0}
    try:
        _match(funds, client, cache, cache_dir, stats)
        _fetch(funds, client, cache, cache_dir, houses, stats)
        nested = _underlying(funds, cache, names)
        _match(nested, client, cache, cache_dir, stats)
        _fetch(nested, client, cache, cache_dir, houses, stats)
    except _Budget:
        log.info("Stock holdings: daily request limit reached; continuing tomorrow")
    except httpx.HTTPError as e:
        log.warning("Stock holdings refresh stopped (%s)", type(e).__name__)
    finally:
        _save(cache_dir, cache)
        client.http.close()
        log.info("Stock holdings refresh: %d matched, %d portfolios fetched, %d requests today",
                 stats["matched"], stats["fetched"], requests_today(cache))


def ensure_fresh(funds: list[dict], cache_dir: Path, names: dict[str, str]) -> None:
    """Start a background refresh if one might be needed. Never blocks, never runs twice at once."""
    global _last_check, _running
    if not api_key() or not funds:
        return
    with _lock:
        if _running or time.time() - _last_check < MIN_CHECK_INTERVAL:
            return
        _last_check, _running = time.time(), True

    def run():
        global _running
        try:
            _refresh(funds, cache_dir, names)
        except Exception:  # never let a refresh crash the server
            log.exception("Stock holdings refresh failed")
        finally:
            _running = False

    threading.Thread(target=run, daemon=True, name="stock-holdings").start()


def _expand(isin: str, cache: dict, depth: int = 0) -> tuple[list[dict], dict]:
    """A fund's rows with fund-of-funds units replaced by the underlying fund's own rows (scaled).
    Returns (rows, info) where info counts how many underlying funds were looked through."""
    matches, holdings = cache.get("matches", {}), cache.get("holdings", {})
    h = holdings.get((matches.get(isin) or {}).get("scheme_name") or "")
    info = {"underlying": 0, "looked_through": 0, "month": (h or {}).get("data_month") or (h or {}).get("month")}
    if not h:
        return [], info
    out = []
    for r in h["rows"]:
        if r["type"] == FUND_UNIT and depth == 0:
            info["underlying"] += 1
            sub, _ = _expand(r["isin"], cache, depth + 1)
            if sub:
                info["looked_through"] += 1
                out += [{**x, "pct": r["pct"] * x["pct"] / 100} for x in sub]
                continue
        out.append(r)
    return out, info


def snapshot(funds: list[dict], cache_dir: Path) -> dict:
    """What the dashboard needs, from the cache only: each fund's weights (looked through
    fund-of-funds where possible) plus a lookup of every stock / instrument."""
    cache = load_cache(cache_dir)
    matches = cache.get("matches", {})
    by_fund: dict[str, list] = {}
    items: dict[str, dict] = {}
    months, empty, look_through = [], [], {}
    for f in funds:
        rows, info = _expand(f["isin"], cache)
        if not (matches.get(f["isin"]) or {}).get("scheme_name") or not info["month"]:
            continue
        if not rows:
            empty.append(f["isin"])  # the provider has no portfolio rows for this fund
            continue
        if info["month"]:
            months.append(info["month"])
        if info["underlying"]:
            look_through[f["isin"]] = {"funds": info["underlying"], "looked_through": info["looked_through"]}
        weights: dict[str, float] = {}
        for r in rows:
            weights[r["isin"]] = weights.get(r["isin"], 0) + r["pct"]
            items.setdefault(r["isin"], {"symbol": r["symbol"], "name": r["name"], "sector": r["sector"], "type": r["type"]})
        by_fund[f["isin"]] = [[k, round(v, 4)] for k, v in weights.items()]
    checked = lambda i: (matches.get(i) or {}).get("checked_at")
    unmatched = [f["isin"] for f in funds if checked(f["isin"]) and not matches[f["isin"]].get("scheme_name")]
    pending = sum(1 for f in funds if f["isin"] not in by_fund and f["isin"] not in empty and f["isin"] not in unmatched)
    pending += sum(v["funds"] - v["looked_through"] for v in look_through.values())
    return {
        "enabled": bool(api_key()),
        "funds": by_fund,
        "stocks": items,
        "month": max(months) if months else None,
        "oldest_month": min(months) if months else None,
        "unmatched": unmatched,
        "no_stocks": empty,
        "look_through": look_through,
        "pending": pending,
        "refreshing": _running,
    }
