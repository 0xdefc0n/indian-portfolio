"""Portfolio analysis built from the parsed statements.

Everything here only uses what the statements contain:
  - SEBI category / asset class from casparser-isin's scheme database (offline),
  - FIFO lots, realised capital gains and unrealised long/short-term gains, following the
    rules in casparser.analysis.gains (stamp duty in cost, 31-Jan-2018 grandfathering),
    but per fund, so one fund with an incomplete history doesn't block the rest,
  - money flows, costs and dividends from CAMS/KFintech transactions,
  - a health check from demat account details and folio KYC/nominee flags.

Tax treatment is an estimate for display (post-23-Jul-2024 rules); not tax advice.
"""

from __future__ import annotations

import os
import re
import sqlite3
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from functools import lru_cache

LTCG_EXEMPTION = 125_000  # equity LTCG exempt per person per financial year (from FY2024-25)
NEW_REGIME = date(2024, 7, 23)
GRANDFATHER_BUY_CUTOFF = date(2018, 1, 31)
GRANDFATHER_SELL_FROM = date(2018, 4, 1)
SPECIFIED_DEBT_FROM = date(2023, 4, 1)

BUY = {"PURCHASE", "PURCHASE_SIP", "SWITCH_IN", "SWITCH_IN_MERGER", "DIVIDEND_REINVEST"}
SELL = {"REDEMPTION", "SWITCH_OUT", "SWITCH_OUT_MERGER"}


# ---------------------------------------------------------------- scheme database

@lru_cache(maxsize=1)
def _db() -> sqlite3.Connection | None:
    try:
        import casparser_isin
        path = os.path.join(os.path.dirname(casparser_isin.__file__), "isin.db")
        return sqlite3.connect(f"file:{path}?mode=ro", uri=True, check_same_thread=False)
    except Exception:
        return None


@lru_cache(maxsize=4096)
def scheme_info(isin: str) -> tuple[str | None, str | None]:
    """(sebi_category, type) e.g. ('Equity Scheme - Mid Cap Fund', 'EQUITY')."""
    db = _db()
    if not db or not isin:
        return None, None
    row = db.execute("SELECT sebi_category, type FROM scheme WHERE isin = ? ORDER BY id DESC", (isin,)).fetchone()
    return (row[0], row[1]) if row else (None, None)


@lru_cache(maxsize=4096)
def nav_2018(isin: str) -> float | None:
    """NAV on 31-Jan-2018, for grandfathering."""
    db = _db()
    if not db or not isin:
        return None
    row = db.execute("SELECT nav FROM nav20180131 WHERE isin = ?", (isin,)).fetchone()
    return float(row[0]) if row and row[0] is not None else None


GOLD_RE = re.compile(r"GOLD|SILVER", re.I)
INTL_RE = re.compile(r"\bUS\b|NASDAQ|S&P|INTERNATIONAL|GLOBAL|OVERSEAS|WORLD|EMERGING|CHINA|JAPAN|HANG SENG|FANG", re.I)
# Funds that mix asset classes; matters for FoFs, whose SEBI label ("Other Scheme - FoF Domestic") doesn't say what they hold.
HYBRID_NAME_RE = re.compile(r"MULTI[- ]?ASSET|ASSET ALLOCATION|HYBRID|BALANCED|ARBITRAGE|EQUITY SAVINGS", re.I)
DEBT_NAME_RE = re.compile(r"GILT|G-SEC|GSEC|SDL|BOND|DEBT|PSU|LIQUID|OVERNIGHT|MONEY MARKET|CORPORATE|T-BILL|CRISIL IBX|TARGET MATURITY", re.I)


def asset_class(name: str, sebi: str | None, kind: str | None) -> str:
    """Equity / Debt / Hybrid / Gold & silver / International / Stocks & bonds."""
    s = (sebi or "").lower()
    if kind == "equity_or_bond":
        return "Stocks & bonds"
    if GOLD_RE.search(name):
        return "Gold & silver"
    if INTL_RE.search(name) or "overseas" in s:
        return "International"
    if s.startswith("equity"):
        return "Equity"
    if s.startswith("debt"):
        return "Debt"
    if s.startswith("hybrid") or s.startswith("solution") or HYBRID_NAME_RE.search(name):
        return "Hybrid"
    if DEBT_NAME_RE.search(name):
        return "Debt"
    return "Equity"  # index funds / ETFs / other schemes not caught above


SEBI_TO_CATEGORY = [
    ("large & mid cap", "Large & mid cap"), ("large cap", "Large cap"), ("mid cap", "Mid cap"),
    ("small cap", "Small cap"), ("elss", "ELSS"), ("sectoral", "Sectoral & thematic"),
    ("flexi cap", "Flexi & multi cap"), ("multi cap", "Flexi & multi cap"), ("focused", "Flexi & multi cap"),
    ("value", "Flexi & multi cap"), ("contra", "Flexi & multi cap"), ("dividend yield", "Flexi & multi cap"),
]


def category_from_sebi(sebi: str | None) -> str | None:
    """Dashboard category from the official SEBI category; None for index funds / ETFs / FoFs,
    where SEBI's label doesn't say what the fund tracks (the caller falls back to the name)."""
    s = (sebi or "").lower()
    if not s or s.startswith("other") or "fof" in s:
        return None
    if s.startswith("debt"):
        return "Debt"
    if s.startswith("hybrid") or s.startswith("solution"):
        return "Hybrid"
    for key, cat in SEBI_TO_CATEGORY:
        if key in s:
            return cat
    return None


def equity_oriented(name: str, sebi: str | None, rta_type: str | None = None) -> bool:
    """Taxed as equity: equity schemes, equity-heavy hybrids, equity index funds/ETFs.
    Falls back to the statement's own fund type when the scheme isn't in the ISIN database."""
    s = (sebi or "").lower()
    if not s and rta_type:
        return rta_type.upper() == "EQUITY" and not (GOLD_RE.search(name) or INTL_RE.search(name) or DEBT_NAME_RE.search(name))
    if GOLD_RE.search(name) or INTL_RE.search(name) or "fof" in s or "fund of funds" in s:
        return False
    if s.startswith("equity"):
        return True
    if s.startswith("hybrid"):
        return any(k in s for k in ("aggressive", "arbitrage", "equity savings", "balanced advantage", "dynamic asset"))
    if "index" in s or "etf" in s:
        return not DEBT_NAME_RE.search(name)
    return False


def is_long_term(buy: date, on: date, equity: bool, sebi: str | None, name: str) -> bool:
    if equity:
        return (on - buy).days > 365
    debt = (sebi or "").lower().startswith("debt") or bool(DEBT_NAME_RE.search(name))
    if debt and buy >= SPECIFIED_DEBT_FROM:
        return False  # specified debt funds: always taxed at slab rate
    months = 24 if on >= NEW_REGIME else 36
    return (on.year - buy.year) * 12 + (on.month - buy.month) > months or (
        (on.year - buy.year) * 12 + (on.month - buy.month) == months and on.day > buy.day
    )


def fin_year(d: date) -> str:
    start = d.year if d.month > 3 else d.year - 1
    return f"FY{start}-{(start + 1) % 100:02d}"


def _d(s: str) -> date:
    return datetime.fromisoformat(s[:10]).date()


# ---------------------------------------------------------------- FIFO

@dataclass
class Lot:
    bought: date
    units: float
    cost: float  # incl. stamp duty


def fifo(txns: list[dict], isin: str, name: str, sebi: str | None, rta_type: str | None = None):
    """Replay one scheme's transactions. Returns (open lots, realised gains) or None if it can't be replayed."""
    equity = equity_oriented(name, sebi, rta_type)
    duty: dict[str, float] = defaultdict(float)
    for t in txns:
        if t["type"] == "STAMP_DUTY_TAX":
            duty[t["date"]] += abs(t.get("amount") or 0)
    lots: list[Lot] = []
    gains = []
    for t in txns:
        u = t.get("units") or 0
        if not u or t["type"] in ("STAMP_DUTY_TAX", "STT_TAX", "TDS_TAX"):
            continue
        when = _d(t["date"])
        if u > 0:
            amount = abs(t.get("amount") or 0) or u * (t.get("nav") or 0)
            lots.append(Lot(when, u, amount + duty.pop(t["date"], 0.0)))
            continue
        # sale: consume oldest lots first
        left, sale_total = -u, abs(t.get("amount") or 0) or -u * (t.get("nav") or 0)
        while left > 1e-6:
            if not lots:
                return None  # sold more than we know was bought: history incomplete
            lot = lots[0]
            take = min(left, lot.units)
            cost = lot.cost * take / lot.units
            sale = sale_total * take / -u
            coa = cost
            if equity and lot.bought <= GRANDFATHER_BUY_CUTOFF and when >= GRANDFATHER_SELL_FROM:
                fmv = (nav_2018(isin) or 0) * take
                coa = max(cost, min(fmv, sale)) if fmv else cost
            lt = is_long_term(lot.bought, when, equity, sebi, name)
            gains.append({
                "fy": fin_year(when), "date": t["date"], "isin": isin, "equity": equity,
                "long_term": lt, "units": round(take, 4), "cost": round(cost, 2), "sale": round(sale, 2),
                "gain": round(sale - coa, 2),
            })
            lot.cost -= cost
            lot.units -= take
            left -= take
            if lot.units <= 1e-6:
                lots.pop(0)
    return lots, gains


# ---------------------------------------------------------------- per member

def member_analysis(rta: dict | None, cdsl: dict | None, holdings: list[dict], today: date | None = None) -> dict:
    today = today or date.today()
    fy_now = fin_year(today)
    by_scheme: dict[tuple, list[dict]] = defaultdict(list)
    for t in (rta or {}).get("transactions", []):
        by_scheme[(t.get("folio"), t["isin"])].append(t)

    # FIFO per scheme with full history
    realised, lots_by_isin, replayed, types = [], defaultdict(list), set(), {}
    for sc in (rta or {}).get("schemes", []):
        if sc["open"] > 0.001:
            continue
        sebi, _ = scheme_info(sc["isin"])
        res = fifo(by_scheme.get((sc["folio"], sc["isin"]), []), sc["isin"], sc["name"], sebi, sc.get("type"))
        types[sc["isin"]] = sc.get("type")
        if res is None:
            continue
        lots, gains = res
        replayed.add(sc["isin"])
        for g in gains:
            g["name"] = sc["name"]
        realised += gains
        lots_by_isin[sc["isin"]] += lots

    # unrealised long/short-term split for holdings whose lots we know and whose units match
    unrealised = {}
    for h in holdings:
        lots = lots_by_isin.get(h["isin"])
        if not lots or h.get("invested") is None or not h.get("nav"):
            continue
        if abs(sum(l.units for l in lots) - (h["units"] or 0)) > 0.01:
            continue
        on = _d(h["as_of"])
        sebi = h.get("sebi_category")
        eq = equity_oriented(h["raw_name"], sebi, types.get(h["isin"]))
        lt = [l for l in lots if is_long_term(l.bought, on, eq, sebi, h["raw_name"])]
        st = [l for l in lots if l not in lt]
        val = lambda ls: sum(l.units for l in ls) * h["nav"]
        cost = lambda ls: sum(l.cost for l in ls)
        unrealised[h["isin"]] = {
            "equity": eq, "since": min(l.bought for l in lots).isoformat(),
            "lt_value": round(val(lt), 2), "lt_gain": round(val(lt) - cost(lt), 2),
            "st_value": round(val(st), 2), "st_gain": round(val(st) - cost(st), 2),
            "lt_units": round(sum(l.units for l in lt), 3),
        }

    # this financial year's equity LTCG and how much more can be booked tax-free
    ltcg_fy = sum(g["gain"] for g in realised if g["fy"] == fy_now and g["equity"] and g["long_term"])
    lt_available = sum(max(0.0, u["lt_gain"]) for u in unrealised.values() if u["equity"])
    harvest = {
        "fy": fy_now, "exemption": LTCG_EXEMPTION, "realised_ltcg": round(ltcg_fy, 2),
        "unrealised_lt_gain": round(lt_available, 2),
        "can_book": round(max(0.0, min(lt_available, LTCG_EXEMPTION - max(0.0, ltcg_fy))), 2),
        "funds_covered": len(unrealised), "funds_total": len(holdings),
    }

    # realised gains summarised by financial year
    fy_rows: dict[str, dict] = {}
    for g in realised:
        r = fy_rows.setdefault(g["fy"], {"fy": g["fy"], "ltcg": 0.0, "stcg": 0.0, "equity_ltcg": 0.0, "sale": 0.0})
        r["ltcg" if g["long_term"] else "stcg"] += g["gain"]
        r["equity_ltcg"] += g["gain"] if (g["long_term"] and g["equity"]) else 0
        r["sale"] += g["sale"]
    gains_by_fy = sorted(({k: (round(v, 2) if isinstance(v, float) else v) for k, v in r.items()} for r in fy_rows.values()),
                         key=lambda r: r["fy"], reverse=True)

    # money flow, costs, dividends (statement period)
    flows: dict[str, dict] = {}
    sip = lumpsum = stamp = stt = tds = dividends = redeemed = switched = 0.0
    for t in (rta or {}).get("transactions", []):
        amt = abs(t.get("amount") or 0)
        m = t["date"][:7]
        row = flows.setdefault(m, {"month": m, "invested": 0.0, "withdrawn": 0.0})
        if t["type"] == "STAMP_DUTY_TAX":
            stamp += amt
            row["invested"] += amt
        elif t["type"] == "STT_TAX":
            stt += amt
        elif t["type"] == "TDS_TAX":
            tds += amt
        elif t["type"] == "DIVIDEND_PAYOUT":
            dividends += amt
        elif t["type"].startswith("SWITCH"):
            # money moving between funds: neither new money in nor money taken out
            switched += amt if (t.get("units") or 0) < 0 else 0
        elif t["type"] in BUY - {"DIVIDEND_REINVEST"} and (t.get("units") or 0) > 0:
            row["invested"] += amt
            if t["type"] == "PURCHASE_SIP":
                sip += amt
            else:
                lumpsum += amt
        elif (t.get("units") or 0) < 0 and t["type"] in SELL:
            row["withdrawn"] += amt
            redeemed += amt
    money = {
        "monthly": [{k: (round(v, 2) if isinstance(v, float) else v) for k, v in r.items()} for _, r in sorted(flows.items())],
        "sip": round(sip, 2), "lumpsum": round(lumpsum, 2), "stamp_duty": round(stamp, 2), "stt": round(stt, 2),
        "dividends": round(dividends, 2), "redeemed": round(redeemed, 2), "tds": round(tds, 2),
        "switched": round(switched, 2),
        "period": [(rta or {}).get("period_from"), (rta or {}).get("period_to")] if rta else None,
    }

    return {
        "gains_by_fy": gains_by_fy, "realised_funds": len({g["isin"] for g in realised}),
        "replayed_funds": len(replayed), "unrealised": unrealised, "harvest": harvest,
        "money": money, "health": health_check(rta, cdsl, holdings),
    }


def health_check(rta: dict | None, cdsl: dict | None, holdings: list[dict]) -> list[dict]:
    """Checklist items: level is 'ok', 'warn' or 'info'. Never includes names of nominees."""
    items = []
    accounts = (cdsl or {}).get("accounts", [])
    # Warnings only concern accounts that hold something; empty accounts have nothing at stake.
    funded = [a for a in accounts if (a.get("value") or 0) > 0]
    if accounts:
        missing = [a["dp_name"].title() for a in funded if a.get("nominee_registered") is False]
        known = [a for a in funded if a.get("nominee_registered") is not None]
        if missing:
            items.append({"level": "warn", "title": f"No nominee on {len(missing)} demat account{'s' if len(missing) > 1 else ''}",
                          "detail": ", ".join(missing) + ". Add one through the broker's app; it takes a few minutes."})
        elif known:
            items.append({"level": "ok", "title": "Nominee registered on every demat account with holdings", "detail": None})
        frozen = [a["dp_name"].title() for a in funded if a.get("frozen")]
        if frozen:
            items.append({"level": "warn", "title": "Frozen demat account", "detail": ", ".join(frozen)})
        unused = [a["dp_name"].title() for a in accounts if (a.get("num_isins") or 0) == 0]
        if unused:
            items.append({"level": "info", "title": f"{len(unused)} demat account{'s' if len(unused) > 1 else ''} with no holdings",
                          "detail": ", ".join(unused) + ". Close unused accounts if they charge annual maintenance."})

    held = {(h["isin"]) for h in holdings}
    schemes = [s for s in (rta or {}).get("schemes", []) if s["close"] > 0 and s["isin"] in held]
    if schemes:
        no_nom = sorted({s["name"] for s in schemes if s.get("nominee") is False})
        if no_nom:
            items.append({"level": "warn", "title": f"No nominee shown on {len(no_nom)} folio{'s' if len(no_nom) > 1 else ''}",
                          "detail": "Add nominees with the fund house or on MF Central."})
        elif all(s.get("nominee") for s in schemes):
            items.append({"level": "ok", "title": "Nominee on every mutual fund folio", "detail": None})
        bad_kyc = [s for s in schemes if s.get("kyc_ok") is False or s.get("pan_kyc_ok") is False]
        if bad_kyc:
            items.append({"level": "warn", "title": "KYC not OK on some folios",
                          "detail": "Transactions can be blocked until KYC is updated with a KRA."})
        elif any(s.get("kyc_ok") or s.get("pan_kyc_ok") for s in schemes):
            items.append({"level": "ok", "title": "KYC verified on reported folios", "detail": None})
        regular = sorted({s["name"] for s in schemes if s.get("plan") == "Regular"})
        if regular:
            items.append({"level": "warn", "title": f"{len(regular)} regular plan{'s' if len(regular) > 1 else ''}",
                          "detail": "Regular plans pay a distributor commission, typically 0.5–1.5% a year more than direct plans."})
        elif all(s.get("plan") == "Direct" for s in schemes):
            items.append({"level": "ok", "title": "All funds are direct plans", "detail": None})

    pledged = [h for h in holdings if (h.get("pledged") or 0) > 0]
    if pledged:
        items.append({"level": "info", "title": f"{len(pledged)} fund{'s' if len(pledged) > 1 else ''} pledged as margin",
                      "detail": "Pledged units can't be redeemed until the broker releases the pledge."})
    return items
