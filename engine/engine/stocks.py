"""Stocks inside each mutual fund: name matching and the dashboard snapshot.

Pure functions over data supplied by the caller. Fetching (BharatStock fallback, AMC disclosures) is a Worker
job (plan §10.3.1, milestones M11 and M18); the engine never calls out.

`stock_data` has the same shape the local app kept in `data/.stock-cache/holdings.json`:
    {"enabled": bool, "matches": {isin: {scheme_name, checked_at, ...}},
     "holdings": {scheme_name: {month, data_month, rows: [{isin, symbol, name, sector, type, pct}]}}}
A fund with no `matches` entry (or one without `checked_at`) hasn't been looked up yet.

`wanted()` tells the Worker which funds the stocks view needs data for (M11): the Worker's job fetches them, and the
next build has them. That way the Worker never has to decide which funds count as equity.
"""

from __future__ import annotations

import re

STOP = {"fund", "plan", "direct", "regular", "growth", "option", "the", "scheme", "mutual", "and", "of", "erstwhile", "formerly"}
FUND_UNIT = "MUTUAL_FUND_UNIT"


def _tokens(name: str) -> set[str]:
    n = name.lower().replace("&", " and ").replace("fund of funds", "fof")
    n = re.sub(r"\(.*?\)", " ", n)
    return {t for t in re.findall(r"[a-z0-9]+", n) if t not in STOP}


def score(a: str, b: str) -> float:
    """Token overlap (Jaccard) between two scheme names; ≥ 0.6 counts as a match."""
    ta, tb = _tokens(a), _tokens(b)
    return len(ta & tb) / len(ta | tb) if ta and tb else 0.0


def query(name: str) -> str:
    """Search text for a portfolio list: the fund's own name without 'Fund' and plan words."""
    n = re.sub(r"\s*-\s*(direct|regular).*$", "", name, flags=re.I)
    n = re.sub(r"\bfund\b.*$", "", n, flags=re.I).strip()
    return n or name


def _expand(isin: str, data: dict, depth: int = 0) -> tuple[list[dict], dict]:
    """A fund's rows with fund-of-funds units replaced by the underlying fund's own rows (scaled)."""
    matches, holdings = data.get("matches", {}), data.get("holdings", {})
    h = holdings.get((matches.get(isin) or {}).get("scheme_name") or "")
    info = {"underlying": 0, "looked_through": 0, "month": (h or {}).get("data_month") or (h or {}).get("month")}
    if not h:
        return [], info
    out = []
    for r in h["rows"]:
        if r["type"] == FUND_UNIT and depth == 0:
            info["underlying"] += 1
            sub, _ = _expand(r["isin"], data, depth + 1)
            if sub:
                info["looked_through"] += 1
                out += [{**x, "pct": r["pct"] * x["pct"] / 100} for x in sub]
                continue
        out.append(r)
    return out, info


def equity_funds(holdings: list[dict]) -> list[dict]:
    """The funds the stocks view covers: equity holdings, one entry per ISIN."""
    return list({h["isin"]: {"isin": h["isin"], "name": h["name"]} for h in holdings if h.get("asset_class") == "Equity"}.values())


MAX_WANTED = 100


def wanted(holdings: list[dict], data: dict | None) -> list[list[str]]:
    """[[isin, name], ...]: every equity fund held, plus each fund held inside one of them (fund-of-funds units, one
    level deep, as `snapshot` looks through them). The name is what the Worker's job matches portfolios by: the
    holding's display name, or for a fund inside a fund-of-funds the household's own name for it, else the row's."""
    data = data or {}
    matches, holdings_data = data.get("matches", {}), data.get("holdings", {})
    names = {h["isin"]: h["name"] for h in holdings}
    out: dict[str, str] = {}
    for f in equity_funds(holdings):
        out.setdefault(f["isin"], f["name"] or "")
    for isin in list(out):
        h = holdings_data.get((matches.get(isin) or {}).get("scheme_name") or "")
        for r in (h or {}).get("rows", []):
            if r.get("type") == FUND_UNIT and str(r.get("isin") or "").startswith("INF"):
                out.setdefault(r["isin"], names.get(r["isin"]) or r.get("name") or "")
    return [[k, v] for k, v in sorted(out.items())][:MAX_WANTED]


def snapshot(funds: list[dict], data: dict | None, refreshing: bool | None = None) -> dict:
    """What the dashboard needs: each fund's weights (looked through fund-of-funds where possible) plus a lookup
    of every stock / instrument. Same output shape as the local app's `stocks.snapshot`. `refreshing` defaults to
    "enabled and some fund still waits for data" (plan §10.3.1)."""
    data = data or {}
    matches = data.get("matches", {})
    by_fund: dict[str, list] = {}
    items: dict[str, dict] = {}
    months, empty, look_through = [], [], {}
    for f in funds:
        rows, info = _expand(f["isin"], data)
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

    def checked(i: str):
        return (matches.get(i) or {}).get("checked_at")

    unmatched = [f["isin"] for f in funds if checked(f["isin"]) and not matches[f["isin"]].get("scheme_name")]
    pending = sum(1 for f in funds if f["isin"] not in by_fund and f["isin"] not in empty and f["isin"] not in unmatched)
    pending += sum(v["funds"] - v["looked_through"] for v in look_through.values())
    if refreshing is None:
        refreshing = bool(data.get("enabled")) and pending > 0
    return {
        "enabled": bool(data.get("enabled")),
        "funds": by_fund,
        "stocks": items,
        "month": max(months) if months else None,
        "oldest_month": min(months) if months else None,
        "unmatched": unmatched,
        "no_stocks": empty,
        "look_through": look_through,
        "pending": pending,
        "refreshing": refreshing,
    }
