"""CAMS / KFintech consolidated statement (the RTA "CAS"), via the open-source
`casparser` library (runs locally; this is not the CASParser web API).

Unlike the CDSL eCAS, this statement:
  - has a password the investor chose (not necessarily the PAN),
  - lists every MF folio (demat or not) with full transaction history and amounts,
  - has no monthly valuation history or pledge information.

Only what the dashboard needs is kept: address, email and mobile are dropped.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

import casparser

from .cdsl import CASParseError

# Transaction types that move units and money (others: stamp duty, nominee updates, etc.)
BUY_TYPES = {"PURCHASE", "PURCHASE_SIP", "SWITCH_IN", "SWITCH_IN_MERGER", "DIVIDEND_REINVEST"}
SELL_TYPES = {"REDEMPTION", "SWITCH_OUT", "SWITCH_OUT_MERGER"}
# cash-only rows (no units) that still matter for invested amount / XIRR
CASH_TYPES = {"STAMP_DUTY_TAX", "STT_TAX", "TDS_TAX", "DIVIDEND_PAYOUT"}


def _f(x) -> float:
    return float(x) if x not in (None, "") else 0.0


def _ok(v) -> bool | None:
    """KYC fields: 'OK' -> True, an explicit other value -> False, missing -> unknown."""
    if v in (None, ""):
        return None
    return str(v).strip().upper() == "OK"


def _plan(name: str, advisor) -> str:
    n = name.upper()
    if "DIRECT" in n:
        return "Direct"
    if "REGULAR" in n or str(advisor or "").upper().startswith("ARN"):
        return "Regular"
    return "Unknown"


def _iso(d: str | None) -> str | None:
    """casparser gives the statement period as '20-Nov-2026'; everything else is ISO."""
    if not d:
        return None
    for fmt in ("%Y-%m-%d", "%d-%b-%Y", "%d-%B-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(str(d), fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _average_cost(txns: list[dict]) -> float:
    """Cost of the units still held, using average cost. Stamp duty counts as cost."""
    units = cost = 0.0
    for t in txns:
        u, amt = _f(t.get("units")), _f(t.get("amount"))
        if t.get("type") == "STAMP_DUTY_TAX":
            cost += abs(amt)
        elif u > 0:
            units += u
            cost += abs(amt)
        elif u < 0 and units > 0:
            cost *= max(0.0, (units + u) / units)  # sell part of the position at average cost
            units += u
    return round(cost, 2)


def parse_rta_cas(path: str | Path, password: str) -> dict:
    try:
        data = casparser.read_cas_pdf(str(path), password).model_dump(mode="json")
    except Exception as e:  # casparser raises its own exceptions for bad password / unsupported layout
        msg = str(e).lower()
        if "password" in msg or "incorrect" in msg or "decrypt" in msg:
            raise CASParseError("Could not open PDF (wrong password?)") from e
        raise CASParseError("Not a CAMS/KFintech consolidated statement") from e

    folios = data.get("folios") or []
    pans = {f.get("PAN") for f in folios if f.get("PAN")}
    if len(pans) > 1:
        raise CASParseError("Statement covers more than one PAN; upload one statement per member")
    raw_period = data.get("statement_period") or {}
    period = {"from_": _iso(raw_period.get("from_")), "to": _iso(raw_period.get("to"))}

    holdings, transactions, warnings, schemes = [], [], [], []
    for folio in folios:
        for s in folio.get("schemes", []):
            close = _f(s.get("close"))
            val = s.get("valuation") or {}
            txns = s.get("transactions") or []
            full_history = _f(s.get("open")) == 0
            if close > 0:
                holdings.append({
                    "isin": s.get("isin"), "amfi": s.get("amfi"), "amc": folio.get("amc") or "",
                    "name": s.get("scheme") or "", "folio": folio.get("folio"), "rta": s.get("rta"),
                    "asset_type": "mutual_fund", "units": close,
                    "price": _f(val.get("nav")) or None, "value": _f(val.get("value")),
                    "valuation_date": val.get("date"),
                    "invested": _average_cost(txns) if full_history else None,
                })
            for t in txns:
                # stamp duty rows are kept (no units) so SIP instalments can be rebuilt as purchase + duty
                if t.get("type") in BUY_TYPES | SELL_TYPES | CASH_TYPES or _f(t.get("units")):
                    transactions.append({
                        "isin": s.get("isin"), "name": s.get("scheme") or "", "folio": folio.get("folio"),
                        "date": t.get("date"), "type": t.get("type"), "units": _f(t.get("units")),
                        "amount": _f(t.get("amount")), "nav": _f(t.get("nav")) or None,
                    })
            schemes.append({
                "folio": folio.get("folio"), "isin": s.get("isin"), "amfi": s.get("amfi"),
                "name": s.get("scheme") or "", "amc": folio.get("amc") or "",
                "open": _f(s.get("open")), "close": close, "type": s.get("type"),
                "plan": _plan(s.get("scheme") or "", s.get("advisor")),
                "kyc_ok": _ok(folio.get("KYC")), "pan_kyc_ok": _ok(folio.get("PANKYC")),
                # only whether a nominee is on record; names are never stored
                "nominee": bool(s.get("nominees")) if "nominees" in s else None,
            })
            if abs(_f(s.get("close")) - _f(s.get("close_calculated"))) > 0.01:
                warnings.append(f"{s.get('isin')}: closing units don't match the transaction total")

    total = round(sum(h["value"] for h in holdings), 2)
    dates = sorted({h["valuation_date"] for h in holdings if h.get("valuation_date")})
    held_units = {(h["folio"], h["isin"]): h["units"] for h in holdings}
    sips = detect_sips(transactions, period.get("to") or (dates[-1] if dates else None), held_units)
    return {
        "statement_type": "RTA_CAS",
        "file_type": data.get("file_type"),  # CAMS or KFINTECH
        "cas_type": data.get("cas_type"),  # DETAILED or SUMMARY
        "pan": next(iter(pans), None),
        "holder_name": (data.get("investor_info") or {}).get("name"),
        "period_from": period.get("from_"),
        "period_to": period.get("to"),
        "valuation_date": dates[-1] if dates else period.get("to"),
        "total_value": total,
        "holdings": holdings,
        "transactions": transactions,
        "schemes": schemes,
        "sips": sips,
        "warnings": warnings,
    }


FREQUENCIES = [(10, "weekly", 7), (20, "fortnightly", 14), (45, "monthly", 30), (100, "quarterly", 91)]


def detect_sips(transactions: list[dict], as_of: str | None, held_units: dict) -> list[dict]:
    """Rebuild SIPs from PURCHASE_SIP rows, one per (folio, fund).

    instalment = purchase amount + stamp duty on the same day (₹9,999.50 + ₹0.50 = ₹10,000)
    frequency  = median gap between instalments
    active     = last instalment within 1.5 intervals (+7 days) of the statement end date,
                 and the fund is still held
    """
    if not as_of:
        return []
    end = date.fromisoformat(as_of)
    duty: dict[tuple, float] = defaultdict(float)
    buys: dict[tuple, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    names: dict[tuple, str] = {}
    for t in transactions:
        key = (t.get("folio"), t.get("isin"))
        if t["type"] == "STAMP_DUTY_TAX":
            duty[(*key, t["date"])] += abs(t["amount"])
        elif t["type"] == "PURCHASE_SIP" and t["amount"]:
            buys[key][t["date"]] += abs(t["amount"])
            names[key] = t["name"]

    sips = []
    for key, by_date in buys.items():
        days = sorted(by_date)
        amounts = [by_date[d] + duty.get((*key, d), 0.0) for d in days]
        gaps = [(date.fromisoformat(b) - date.fromisoformat(a)).days for a, b in zip(days, days[1:])]
        median_gap = sorted(gaps)[len(gaps) // 2] if gaps else 30
        label, interval = next(((lbl, iv) for limit, lbl, iv in FREQUENCIES if median_gap <= limit), ("irregular", median_gap))
        last = date.fromisoformat(days[-1])
        active = (end - last).days <= interval * 1.5 + 7 and held_units.get(key, 0) > 0
        sips.append({
            "folio": key[0], "isin": key[1], "name": names[key],
            "amount": float(round(amounts[-1])),  # instalments are whole rupees
            "frequency": label, "interval_days": interval,
            "start_date": days[0], "last_date": days[-1],
            "next_date": (last + timedelta(days=interval)).isoformat() if active else None,
            "instalments": len(days), "invested": round(sum(amounts), 2),
            "status": "active" if active else "stopped",
        })
    sips.sort(key=lambda s: (s["status"] != "active", -s["amount"]))
    return sips
