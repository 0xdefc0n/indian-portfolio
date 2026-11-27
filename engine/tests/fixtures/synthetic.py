"""Synthetic, made-up statements and market data for tests. No real person, PAN, folio or fund.

Two members:
  m-alpha: a CDSL eCAS (Oct 2026) + a KFintech detailed CAS (to 20 Nov 2026). One fund is held in both
           (same units, so the cost from KFintech applies), one only in KFintech (non-demat folio), one only in
           demat (an index fund whose AMFI code comes from `isin_to_code`), plus a listed share.
  m-beta:  two CDSL statements (Sep and Oct 2026) whose valuation histories overlap; one demat account has no
           nominee and one is empty.
"""

from __future__ import annotations

import math
from datetime import date, timedelta

from engine.parsers.rta import detect_sips

PAN_A, PAN_B = "ABCDE1234F", "ABCDE5678G"
F1 = {"isin": "INF000S01FC1", "amfi": "900001", "name": "SYNTH FLEXI CAP FUND - DIRECT PLAN - GROWTH",
      "amc": "SYNTH MUTUAL FUND", "cdsl_amc": "SYNTH AMC LTD", "type": "EQUITY", "base": 40.0, "growth": 0.14}
F2 = {"isin": "INF000S02LQ2", "amfi": "900002", "name": "SYNTH LIQUID FUND - DIRECT PLAN - GROWTH",
      "amc": "SYNTH MUTUAL FUND", "type": "DEBT", "base": 2400.0, "growth": 0.068}
F3 = {"isin": "INF000S03NX3", "amfi": "900003", "name": "SYNTH NIFTY 50 INDEX FUND - DIRECT PLAN - GROWTH",
      "amc": "SYNTH MUTUAL FUND", "cdsl_amc": "SYNTH AMC LTD", "type": "EQUITY", "base": 150.0, "growth": 0.12}
BENCH = {"amfi": "120716", "base": 120.0, "growth": 0.11}
EQ = {"isin": "INE000S01EQ1", "name": "SYNTH INDUSTRIES LIMITED", "issuer": "SYNTH INDUSTRIES LTD",
      "base": 1200.0, "growth": 0.06}  # a listed share: daily exchange closes from the price store (M20)

START, END = date(2022, 12, 1), date(2026, 11, 24)
TODAY = date(2026, 11, 25)


def nav(fund: dict, d: date) -> float:
    """Smooth growth plus a small deterministic wiggle, rounded like real NAVs."""
    t = (d - START).days / 365.0
    return round(fund["base"] * (1 + fund["growth"]) ** t * (1 + 0.01 * math.sin(t * 25)), 4)


def business_days(a: date, b: date):
    d = a
    while d <= b:
        if d.weekday() < 5:
            yield d
        d += timedelta(days=1)


def nav_series(fund: dict) -> list[list]:
    return [[d.isoformat(), nav(fund, d)] for d in business_days(START, END)]


def _on_or_before(fund: dict, d: date) -> float:
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return nav(fund, d)


def _kfintech() -> dict:
    txns = []
    # F1: monthly SIP of ₹5,000 (₹4,999.75 + ₹0.25 stamp duty) from Jan 2023 to Oct 2026, one partial redemption
    d = date(2023, 1, 5)
    while d <= date(2026, 10, 5):
        price = _on_or_before(F1, d)
        units = round(4999.75 / price, 3)
        txns.append({"isin": F1["isin"], "name": F1["name"], "folio": "F-1001", "date": d.isoformat(),
                     "type": "PURCHASE_SIP", "units": units, "amount": 4999.75, "nav": price})
        txns.append({"isin": F1["isin"], "name": F1["name"], "folio": "F-1001", "date": d.isoformat(),
                     "type": "STAMP_DUTY_TAX", "units": 0.0, "amount": 0.25, "nav": None})
        d = date(d.year + (d.month == 12), d.month % 12 + 1, 5)
    red_day = date(2025, 6, 10)
    red_units = 150.0
    txns.append({"isin": F1["isin"], "name": F1["name"], "folio": "F-1001", "date": red_day.isoformat(),
                 "type": "REDEMPTION", "units": -red_units, "amount": -round(red_units * _on_or_before(F1, red_day), 2),
                 "nav": _on_or_before(F1, red_day)})
    # F2: one lump sum
    lq_day = date(2024, 3, 15)
    lq_units = round(99995.0 / _on_or_before(F2, lq_day), 3)
    txns.append({"isin": F2["isin"], "name": F2["name"], "folio": "F-2002", "date": lq_day.isoformat(),
                 "type": "PURCHASE", "units": lq_units, "amount": 99995.0, "nav": _on_or_before(F2, lq_day)})
    txns.append({"isin": F2["isin"], "name": F2["name"], "folio": "F-2002", "date": lq_day.isoformat(),
                 "type": "STAMP_DUTY_TAX", "units": 0.0, "amount": 5.0, "nav": None})
    txns.sort(key=lambda t: t["date"])

    val_day = date(2026, 11, 20)
    f1_units = round(sum(t["units"] for t in txns if t["isin"] == F1["isin"]), 3)
    f2_units = round(lq_units, 3)
    p1, p2 = _on_or_before(F1, val_day), _on_or_before(F2, val_day)
    f1_cost = sum(t["amount"] for t in txns if t["isin"] == F1["isin"] and t["type"] in ("PURCHASE_SIP", "STAMP_DUTY_TAX"))
    holdings = [
        {"isin": F1["isin"], "amfi": F1["amfi"], "amc": F1["amc"], "name": F1["name"], "folio": "F-1001", "rta": "KFINTECH",
         "asset_type": "mutual_fund", "units": f1_units, "price": p1, "value": round(f1_units * p1, 2),
         "valuation_date": val_day.isoformat(), "invested": round(f1_cost * 0.9, 2)},
        {"isin": F2["isin"], "amfi": F2["amfi"], "amc": F2["amc"], "name": F2["name"], "folio": "F-2002", "rta": "KFINTECH",
         "asset_type": "mutual_fund", "units": f2_units, "price": p2, "value": round(f2_units * p2, 2),
         "valuation_date": val_day.isoformat(), "invested": 100000.0},
    ]
    schemes = [
        {"folio": "F-1001", "isin": F1["isin"], "amfi": F1["amfi"], "name": F1["name"], "amc": F1["amc"], "open": 0.0,
         "close": f1_units, "type": "EQUITY", "plan": "Direct", "kyc_ok": True, "pan_kyc_ok": True, "nominee": True},
        {"folio": "F-2002", "isin": F2["isin"], "amfi": F2["amfi"], "name": F2["name"], "amc": F2["amc"], "open": 0.0,
         "close": f2_units, "type": "DEBT", "plan": "Direct", "kyc_ok": True, "pan_kyc_ok": True, "nominee": False},
    ]
    held_units = {(h["folio"], h["isin"]): h["units"] for h in holdings}
    return {
        "statement_type": "RTA_CAS", "file_type": "KFINTECH", "cas_type": "DETAILED", "pan": PAN_A,
        "holder_name": "ALPHA SAMPLE PERSON", "period_from": "2023-01-01", "period_to": val_day.isoformat(),
        "valuation_date": val_day.isoformat(), "total_value": round(sum(h["value"] for h in holdings), 2),
        "holdings": holdings, "transactions": txns, "schemes": schemes,
        "sips": detect_sips(txns, val_day.isoformat(), held_units), "warnings": [],
    }


def _cdsl(pan: str, name: str, period_to: date, holdings: list[tuple[dict, float]], accounts: list[dict],
          history: list[tuple[str, float]], transactions: list[dict] | None = None) -> dict:
    rows = []
    for fund, units in holdings:
        is_mf = fund["isin"].startswith("INF")
        price = _on_or_before(fund, period_to) if is_mf else 1500.0
        amc = fund.get("cdsl_amc", fund.get("issuer", ""))
        rows.append({"bo_id": accounts[0]["bo_id"], "isin": fund["isin"], "amc": amc, "name": fund["name"],
                     "asset_type": "mutual_fund" if is_mf else "equity_or_bond", "units": units, "frozen": 0.0,
                     "pledged": 5.0 if not is_mf else 0.0, "pledge_setup": 0.0, "free": units - (5.0 if not is_mf else 0.0),
                     "price": price, "value": round(units * price, 2)})
    return {
        "source": "statement.pdf", "statement_type": "CDSL_CAS", "cas_id": "SYNTH000", "pan": pan, "holder_name": name,
        "period_from": period_to.replace(day=1).isoformat(), "period_to": period_to.isoformat(),
        "total_value": round(sum(r["value"] for r in rows), 2), "accounts": accounts, "holdings": rows,
        "transactions": transactions or [], "pending": [],
        "valuation_history": [{"month": m, "value": v} for m, v in history], "warnings": [],
    }


def _account(bo: str, broker: str, n: int, value: float, nominee: bool | None = True) -> dict:
    return {"depository": "CDSL", "dp_name": broker, "dp_id": bo[:8], "client_id": bo[8:], "bo_id": bo, "num_isins": n,
            "value": value, "nominee_registered": nominee, "status": "Active", "frozen": False}


def statements() -> list[dict]:
    """[{"member_id", "pan", "data"}] as the Worker would send them (decrypted)."""
    kf = _kfintech()
    f1_units = next(h["units"] for h in kf["holdings"] if h["isin"] == F1["isin"])
    oct31 = date(2026, 10, 31)
    oct_sip = next(t for t in kf["transactions"] if t["date"] == "2026-10-05" and t["type"] == "PURCHASE_SIP")
    alpha_cdsl = _cdsl(
        PAN_A, "ALPHA SAMPLE PERSON", oct31, [(F1, f1_units), (F3, 200.0), (EQ, 10.0)],
        [_account("1208000000000001", "SYNTH BROKING LIMITED", 3, 0.0)],
        [("May 2026", 610000.0), ("Jun 2026", 618500.0), ("Jul 2026", 625900.0), ("Aug 2026", 631000.0),
         ("Sep 2026", 640250.0), ("Oct 2026", 652300.0)],
        # the October SIP also shows up in CDSL two days later: it must be listed once in activity
        [{"bo_id": "1208000000000001", "isin": F1["isin"], "amc": F1["cdsl_amc"], "name": F1["name"],
          "particulars": "BY TRANSFER", "date": "2026-10-07", "opening": round(f1_units - oct_sip["units"], 3),
          "credit": oct_sip["units"], "debit": None, "closing": f1_units, "stamp_duty": None}],
    )
    alpha_cdsl["accounts"][0]["value"] = alpha_cdsl["total_value"]
    beta_accounts = [_account("1208000000000002", "SYNTH SECURITIES PVT LTD", 2, 0.0, nominee=False),
                     _account("1208000000000003", "OTHER SYNTH BROKER LTD", 0, 0.0)]
    beta_sep = _cdsl(PAN_B, "BETA SAMPLE PERSON", date(2026, 9, 30), [(F3, 100.0), (F1, 50.0)], beta_accounts,
                     [("Jul 2026", 15000.0), ("Aug 2026", 15100.0), ("Sep 2026", 15250.0)])
    beta_oct = _cdsl(PAN_B, "BETA SAMPLE PERSON", oct31, [(F3, 100.0), (F1, 50.0)], beta_accounts,
                     [("Aug 2026", 15150.0), ("Sep 2026", 15300.0), ("Oct 2026", 15400.0)])  # newer wins on overlap
    for st in (beta_sep, beta_oct):
        st["accounts"] = [dict(a) for a in st["accounts"]]
        st["accounts"][0]["value"] = st["total_value"]
    return [
        {"member_id": "m-alpha", "pan": PAN_A, "data": alpha_cdsl},
        {"member_id": "m-alpha", "pan": PAN_A, "data": kf},
        {"member_id": "m-beta", "pan": PAN_B, "data": beta_sep},
        {"member_id": "m-beta", "pan": PAN_B, "data": beta_oct},
    ]


def market() -> dict:
    return {
        "navs": {f["amfi"]: nav_series(f) for f in (F1, F2, F3, BENCH)},
        "isin_to_code": {F3["isin"]: F3["amfi"]},  # demat-only fund: code from the scheme table
        "prices": {EQ["isin"]: nav_series(EQ)},  # the share's exchange closes (M20)
        "stocks": None,
    }
