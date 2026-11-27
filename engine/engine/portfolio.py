"""Build the consolidated family portfolio from parsed statements. A pure function: statements and market data
come in the request, the snapshot goes out. No disk, no network, no clock (plan §10.2)."""

from __future__ import annotations

import bisect
import calendar
import re
from datetime import date, datetime, timedelta

from . import equity, holidays, market, projection, stocks
from .analysis import asset_class, category_from_sebi, member_analysis, scheme_info
from .market import NavSeries

CATEGORY_RULES: list[tuple[str, str]] = [
    (r"\bELSS\b|TAX SAVER", "ELSS"),
    (r"GOLD|SILVER", "Gold & silver"),
    (r"LIQUID|OVERNIGHT|MONEY MARKET|GILT|BOND|DEBT|CORPORATE|BANKING & PSU|DURATION|CREDIT RISK", "Debt"),
    (r"HYBRID|BALANCED|ARBITRAGE|ASSET ALLOCATION|MULTI[- ]?ASSET|EQUITY SAVINGS", "Hybrid"),
    (r"SMALL ?CAP", "Small cap"),
    (r"MID ?CAP", "Mid cap"),
    (r"LARGE ?& ?MID|LARGE AND MID", "Large & mid cap"),
    (r"LARGE ?CAP|BLUECHIP|BLUE CHIP|NIFTY 50\b|NIFTY50|SENSEX|NIFTY NEXT 50", "Large cap"),
    (r"FLEXI ?CAP|MULTI ?CAP|FOCUSED", "Flexi & multi cap"),
    (r"US |NASDAQ|S&P|INTERNATIONAL|GLOBAL|OVERSEAS", "International"),
]


def categorize(name: str, asset_type: str, isin: str | None = None) -> str:
    if asset_type == "equity_or_bond":
        return "Stocks & bonds"
    if isin and (cat := category_from_sebi(scheme_info(isin)[0])):
        return cat
    upper = name.upper()
    for pattern, cat in CATEGORY_RULES:
        if re.search(pattern, upper):
            return cat
    return "Other funds"


PLAN_SUFFIX = re.compile(
    r"[\s-]*(?:DIRECT|REGULAR)?\s*(?:PLAN)?[\s-]*(?:GROWTH|IDCW|DIVIDEND)?\s*(?:PL)?[\s-]*(?:GROWTH|IDCW)?\s*(?:OPTION|OPT)?\s*$"
)
ACRONYMS = {"Etf": "ETF", "Fof": "FoF", "Elss": "ELSS", "Psu": "PSU", "Us": "US", "Nasdaq": "NASDAQ", "Amc": "AMC",
            "S&P": "S&P", "Icici": "ICICI", "Hdfc": "HDFC", "Sbi": "SBI", "Uti": "UTI", "Dsp": "DSP", "Ppfas": "PPFAS",
            "Lic": "LIC", "Idfc": "IDFC", "Hsbc": "HSBC", "Jm": "JM", "Itc": "ITC", "Ltd": "Ltd"}


def display_name(raw: str) -> str:
    """'PARAG PARIKH FLEXI CAP FUND-DIRECT PLAN-GROWTH OPTION' -> 'Parag Parikh Flexi Cap Fund'"""
    name = raw.upper()
    name = re.sub(r"^[A-Z0-9]{2,8}-(?=[A-Z])", "", name) if re.match(r"^[A-Z]*\d[A-Z0-9]*-", name) else name  # RTA code prefix
    name = re.sub(r"\s*\((?:FORMERLY|ERSTWHILE|NON[- ]?DEMAT|DEMAT|ADVISOR)[^)]*\)?", "", name)  # trailing notes
    name = re.sub(r"\s*-\s*ISIN.*$", "", name)
    for _ in range(3):  # suffixes are stacked: 'DIRECT GROWTH PL-GROWTH OPT'
        stripped = PLAN_SUFFIX.sub("", name).strip(" -")
        if stripped == name or not stripped:
            break
        name = stripped
    words = [ACRONYMS.get(w.title(), w.title()) for w in re.split(r"(\s+|-)", name)]
    return re.sub(r"\s*-\s*", " ", "".join(words)).strip()


# Fund houses appear as "HDFC AMC LTD" (CDSL), "HDFC Mutual Fund" (KFintech), "HDFC Flexi Cap..." (name).
# Map them all to one brand. Longer/more specific keys first (QUANTUM before QUANT).
FUND_HOUSES = [
    ("ADITYA BIRLA", "Aditya Birla Sun Life"), ("BIRLA SUN", "Aditya Birla Sun Life"), ("AXIS", "Axis"),
    ("BANDHAN", "Bandhan"), ("IDFC", "Bandhan"), ("BANK OF INDIA", "Bank of India"), ("BARODA", "Baroda BNP Paribas"),
    ("CANARA", "Canara Robeco"), ("DSP", "DSP"), ("EDELWEISS", "Edelweiss"), ("FRANKLIN", "Franklin Templeton"),
    ("TEMPLETON", "Franklin Templeton"), ("HDFC", "HDFC"), ("HSBC", "HSBC"), ("ICICI", "ICICI Prudential"),
    ("INVESCO", "Invesco"), ("ITI ", "ITI"), ("JM FIN", "JM Financial"), ("KOTAK", "Kotak"), ("LIC ", "LIC"),
    ("MAHINDRA", "Mahindra Manulife"), ("MIRAE", "Mirae Asset"), ("MOTILAL", "Motilal Oswal"), ("NAVI", "Navi"),
    ("NIPPON", "Nippon India"), ("RELIANCE", "Nippon India"), ("NJ ", "NJ"), ("PGIM", "PGIM India"), ("PPFAS", "PPFAS"),
    ("PARAG PARIKH", "PPFAS"), ("QUANTUM", "Quantum"), ("QUANT", "Quant"), ("SBI", "SBI"), ("SAMCO", "Samco"),
    ("SUNDARAM", "Sundaram"), ("TATA", "Tata"), ("TAURUS", "Taurus"), ("TRUST", "Trust"), ("UNION", "Union"),
    ("UTI", "UTI"), ("WHITEOAK", "WhiteOak Capital"), ("WHITE OAK", "WhiteOak Capital"), ("ZERODHA", "Zerodha"),
    ("GROWW", "Groww"), ("360 ONE", "360 ONE"), ("IIFL", "360 ONE"), ("BAJAJ", "Bajaj Finserv"), ("HELIOS", "Helios"),
    ("OLD BRIDGE", "Old Bridge"), ("SHRIRAM", "Shriram"), ("UNIFI", "Unifi"), ("ANGEL", "Angel One"),
]


def fund_house(amc: str, scheme: str) -> str:
    for text in (f" {amc.upper()} ", f" {scheme.upper()} "):
        for key, brand in FUND_HOUSES:
            if f" {key}" in text or text.strip().startswith(key.strip()):
                return brand
    cleaned = re.sub(r"\b(MUTUAL FUND|ASSET MANAGEMENT|AMC|AM|PVT|PRIVATE|LTD|LIMITED|COMPANY|CO)\b\.?", "", amc.upper())
    return display_name(re.sub(r"\s+", " ", cleaned).strip()) or "Other"


def _mask_pan(pan: str) -> str:
    return f"{pan[:2]}••••••{pan[-2:]}" if pan and len(pan) == 10 else pan


def _month_key(label: str) -> str:
    """'Oct 2026' -> '2026-10' for sorting."""
    return datetime.strptime(label, "%b %Y").strftime("%Y-%m")


def _as_of(st: dict) -> str:
    return st.get("valuation_date") or st.get("period_to") or ""


def _latest_by_member(statements: list[dict]) -> dict[str, dict]:
    """{member_id: {"pan", "name", "CDSL": statement, "RTA": statement, "CDSL_ALL": [...]}}, newest of each kind.

    statements: [{"member_id", "pan", "name"?, "data": parsed statement}] as decrypted by the Worker.
    """
    out: dict[str, dict] = {}
    for item in statements:
        st = item["data"]
        mid = item["member_id"]
        m = out.setdefault(mid, {"pan": item.get("pan") or st.get("pan") or "", "name": item.get("name")})
        kind = "RTA" if st.get("statement_type") == "RTA_CAS" else "CDSL"
        if kind == "CDSL":
            m.setdefault("CDSL_ALL", []).append(st)
        cur = m.get(kind)
        if cur is None or _as_of(st) > _as_of(cur):
            m[kind] = st
    return out


def _full_history(statements: list[dict]) -> list[dict]:
    """Month-end values from every CDSL statement of a member; a newer statement wins on overlap."""
    months: dict[str, float] = {}
    for st in sorted(statements, key=_as_of):
        for r in st.get("valuation_history", []):
            try:
                months[_month_key(r["month"])] = r["value"] or 0
            except (KeyError, ValueError):
                continue
    return [{"month": m, "value": v} for m, v in sorted(months.items())]


def _month_end(y: int, m: int) -> str:
    return date(y, m, calendar.monthrange(y, m)[1]).isoformat()


def _statement_prices(rta: dict, s: dict) -> list[tuple[str, float]]:
    """(date, NAV) points the statement itself carries for one fund: each transaction's NAV and the closing valuation."""
    pts = [(t["date"], t["nav"]) for t in rta.get("transactions", [])
           if t["isin"] == s["isin"] and t.get("folio") == s["folio"] and t.get("nav") and t.get("date")]
    for h in rta.get("holdings", []):
        if h.get("isin") == s["isin"] and h.get("folio") == s["folio"] and h.get("price") and h.get("valuation_date"):
            pts.append((h["valuation_date"], h["price"]))
    return sorted(pts)


def _price_from_statement(pts: list[tuple[str, float]], day: str) -> float | None:
    """The statement's last NAV on or before `day` (else its first one): a step-wise stand-in for the daily series."""
    if not pts:
        return None
    i = bisect.bisect_right(pts, (day, float("inf"))) - 1
    return pts[i][1] if i >= 0 else pts[0][1]


def _rta_history(rta: dict | None, navs: dict[str, NavSeries], today: date,
                 waiting: set[str] | None = None) -> tuple[list[dict], str | None]:
    """Month-end values rebuilt from a CAMS/KFintech statement: exact units (opening balance + every transaction) x that
    day's NAV. Empty unless every fund's units reconcile.

    A fund without NAV history (a fully redeemed fund whose backfill hasn't run yet, or one AMFI no longer lists) is
    valued at the NAVs the statement itself prints (its transactions and closing valuation) instead of dropping the
    chart. The second value says so: "waiting" while a backfill for such a fund is still running (the chart improves by
    itself on the next build), "estimated" when some months stay on statement prices, else None."""
    waiting = waiting or set()
    if not rta or not rta.get("period_from") or not rta.get("period_to"):
        return [], None
    funds = []
    for s in rta.get("schemes", []):
        txns = sorted((t for t in rta.get("transactions", [])
                       if t["isin"] == s["isin"] and t.get("folio") == s["folio"] and t.get("units")),
                      key=lambda t: t["date"])
        if abs((s["open"] or 0) + sum(t["units"] for t in txns) - (s["close"] or 0)) > 0.01:
            return []  # units don't add up; a rebuilt chart would be wrong
        funds.append((s, txns, _statement_prices(rta, s)))
    if not funds:
        return [], None

    flows: dict[str, float] = {}
    for t in rta.get("transactions", []):
        amt = abs(t.get("amount") or 0)
        if t.get("units"):
            flows[t["date"][:7]] = flows.get(t["date"][:7], 0.0) + (amt if t["units"] > 0 else -amt)
        elif t.get("type") == "DIVIDEND_PAYOUT":
            flows[t["date"][:7]] = flows.get(t["date"][:7], 0.0) - amt

    end = min(rta["period_to"], today.isoformat())
    y, m = int(rta["period_from"][:4]), int(rta["period_from"][5:7])
    out: list[dict] = []
    fallback: set[str] = set()  # funds valued from statement prices in some month
    while True:
        day = min(_month_end(y, m), end)
        total, known = 0.0, True
        for s, txns, pts in funds:
            units = (s["open"] or 0) + sum(t["units"] for t in txns if t["date"] <= day)
            if units < 1e-6:
                continue
            code = str(s.get("amfi") or "")
            series = navs.get(code)
            price = series.on(day) if series else None
            if price is None:
                price = _price_from_statement(pts, day)
                if price is None:
                    known = False
                    break
                fallback.add(code)
            total += units * price
        if known and (total > 0 or out):
            out.append({"month": f"{y}-{m:02d}", "value": round(total, 2), "flow": round(flows.get(f"{y}-{m:02d}", 0.0), 2)})
        if day >= end:
            break
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    if not fallback or not out:
        return out, None
    return out, ("waiting" if fallback & waiting else "estimated")


def _merge_holdings(cdsl: dict | None, rta: dict | None) -> list[dict]:
    """One row per fund. Both statements can list the same units (MF units held in demat
    also appear in the CAMS/KFintech statement), so never add them: take units/value from
    the newer statement and enrich with the other (pledges from CDSL, folio/cost from RTA)."""
    rows: dict[str, dict] = {}
    cdsl_date, rta_date = (_as_of(cdsl) if cdsl else ""), (_as_of(rta) if rta else "")
    acct_by_bo = {a["bo_id"]: a for a in (cdsl or {}).get("accounts", [])}

    for h in (cdsl or {}).get("holdings", []):
        acct = acct_by_bo.get(h.get("bo_id") or "", {})
        rows[h["isin"]] = {
            "isin": h["isin"], "raw_name": h["name"], "amc": h["amc"], "asset_type": h["asset_type"],
            "units": h["units"], "nav": h["price"], "value": h["value"] or 0, "as_of": cdsl_date,
            "pledged": h["pledged"] or 0, "broker": acct.get("dp_name") or "", "folio": None,
            "invested": None, "sources": ["CDSL"],
        }
    for h in _rta_by_isin(rta):
        row = rows.get(h["isin"])
        if row is None:
            rows[h["isin"]] = {
                "isin": h["isin"], "raw_name": h["name"], "amc": h["amc"], "asset_type": "mutual_fund",
                "units": h["units"], "nav": h["price"], "value": h["value"], "as_of": h.get("valuation_date") or rta_date,
                "pledged": 0, "broker": "", "folio": h.get("folio"), "invested": h.get("invested"),
                "sources": [rta.get("file_type") or "RTA"],
            }
            continue
        row["sources"].append(rta.get("file_type") or "RTA")
        row["folio"] = h.get("folio")
        same_units = abs((row["units"] or 0) - (h["units"] or 0)) < 0.001
        if (h.get("valuation_date") or rta_date) > row["as_of"]:  # RTA is newer: take its numbers
            row.update(units=h["units"], nav=h["price"], value=h["value"], as_of=h.get("valuation_date") or rta_date)
        if same_units:  # cost only applies if both describe the same position
            row["invested"] = h.get("invested")
        row["pledged"] = min(row["pledged"], row["units"] or 0)
    for row in rows.values():  # cash flows only where the invested amount is complete
        row["cashflows"] = _cashflows(rta, row["isin"]) if row["invested"] is not None else None
    return list(rows.values())


def _rta_by_isin(rta: dict | None) -> list[dict]:
    """One row per fund: a fund held in several folios is summed. Invested is only known if every folio has it."""
    out: dict[str, dict] = {}
    for h in (rta or {}).get("holdings", []):
        cur = out.get(h["isin"])
        if cur is None:
            out[h["isin"]] = dict(h)
            continue
        cur["units"] += h["units"]
        cur["value"] += h["value"]
        cur["invested"] = (cur["invested"] + h["invested"]) if cur["invested"] is not None and h["invested"] is not None else None
        cur["folio"] = f'{cur["folio"]}, {h["folio"]}'
        cur["valuation_date"] = max(cur.get("valuation_date") or "", h.get("valuation_date") or "") or None
    return list(out.values())


OUTFLOW = {"PURCHASE", "PURCHASE_SIP", "SWITCH_IN", "SWITCH_IN_MERGER", "STAMP_DUTY_TAX", "STT_TAX", "TDS_TAX"}
INFLOW = {"REDEMPTION", "SWITCH_OUT", "SWITCH_OUT_MERGER", "DIVIDEND_PAYOUT"}


def _cashflows(rta: dict | None, isin: str) -> list[list]:
    """[[date, amount]] from the investor's side: money in is negative, money out positive.
    Reinvested dividends move no cash, so they're skipped (their units are already in the value)."""
    flows: dict[str, float] = {}
    for t in (rta or {}).get("transactions", []):
        if t["isin"] != isin or not t.get("amount"):
            continue
        amt = abs(t["amount"])
        sign = -1 if t["type"] in OUTFLOW else 1 if t["type"] in INFLOW else 0
        if sign:
            flows[t["date"]] = flows.get(t["date"], 0.0) + sign * amt
    return [[d, round(a, 2)] for d, a in sorted(flows.items()) if a]


def _fund_codes(staged: list, isin_to_code: dict[str, str]) -> dict[str, str]:
    """{isin: amfi_code}: from the CAMS/KFintech statement, else the caller's ISIN map (demat-only funds)."""
    codes: dict[str, str] = {s["isin"]: str(s["amfi"]) for st in staged if st[2] for s in st[2].get("schemes", []) if s.get("amfi")}
    for st in staged:
        for h in st[3]:
            if h["isin"] not in codes and h["isin"] in isin_to_code:
                codes[h["isin"]] = str(isin_to_code[h["isin"]])
    return codes


# ─── Broker files (M34, plan §21.13) ─────────────────────────────────────────────────────────────────────────────

def _newest_per_account(files: list[dict]) -> list[dict]:
    """Each broker account's newest holdings file (the Worker keeps only that one, but builds don't rely on it)."""
    best: dict[tuple, dict] = {}
    for f in files:
        key = (f.get("broker"), f.get("account") or f.get("id"))
        cur = best.get(key)
        if cur is None or str(f.get("as_of") or "") >= str(cur.get("as_of") or ""):
            best[key] = f
    return list(best.values())


def _broker_asset_type(isin: str) -> str:
    return "mutual_fund" if isin.startswith("INF") else "equity_or_bond"


def _broker_rows(files: list[dict], cdsl: dict | None, rta: dict | None) -> tuple[list[dict], dict[str, list[dict]], list[dict]]:
    """A member's broker holdings files → (rows to add to the merged holdings, buy prices by ISIN, notes).

    Rule 1: with a CDSL statement, CDSL's quantities win; the files only give buy prices, and a share that is only in a
    file newer than the statement gets a note ("bought after your CDSL statement"). Rule 2: without one, quantities
    add up across broker accounts (each account's newest file). The as-on date of a row is its newest file's.
    """
    files = _newest_per_account(files)
    costs: dict[str, list[dict]] = {}
    for f in files:
        for h in f.get("holdings") or []:
            if h.get("isin") and h.get("qty"):
                costs.setdefault(h["isin"], []).append({"qty": h["qty"], "avg_price": h.get("avg_price"), "as_of": f.get("as_of")})
    if cdsl:
        held = {h["isin"] for h in cdsl.get("holdings", [])} | {h["isin"] for h in (rta or {}).get("holdings", [])}
        stmt = _as_of(cdsl)
        notes: dict[str, dict] = {}
        for f in files:
            if str(f.get("as_of") or "") <= stmt:
                continue
            for h in f.get("holdings") or []:
                if h.get("isin") and h["isin"] not in held:
                    notes.setdefault(h["isin"], {"isin": h["isin"], "name": display_name(h.get("name") or h["isin"]),
                                                 "broker": f.get("broker_name") or f.get("broker"), "as_of": f.get("as_of")})
        return [], costs, sorted(notes.values(), key=lambda n: n["name"])
    rta_isins = {h["isin"] for h in (rta or {}).get("holdings", [])}
    rows: dict[str, dict] = {}
    for f in sorted(files, key=lambda f: str(f.get("as_of") or "")):
        name = f.get("broker_name") or f.get("broker") or ""
        for h in f.get("holdings") or []:
            isin, qty = h.get("isin"), float(h.get("qty") or 0)
            if not isin or qty <= 0 or isin in rta_isins:
                continue
            r = rows.get(isin)
            if r is None:
                rows[isin] = r = {"isin": isin, "raw_name": h.get("name") or isin, "amc": "", "asset_type": _broker_asset_type(isin),
                                  "units": 0.0, "nav": None, "value": 0.0, "as_of": "", "pledged": 0, "broker": "", "folio": None,
                                  "invested": None, "sources": [], "cashflows": None}
            r["units"] = round(r["units"] + qty, 6)
            r["as_of"] = max(r["as_of"], str(f.get("as_of") or ""))
            if h.get("close"):
                r["nav"] = h["close"]  # the newest file's closing price, until the exchange series arrives
            if name and name not in r["sources"]:
                r["sources"].append(name)
            r["broker"] = ", ".join(r["sources"])
    for r in rows.values():
        r["value"] = round(r["units"] * r["nav"], 2) if r["nav"] else 0.0
    return list(rows.values()), costs, []


def _tradebook_rows(trades: list[dict], corp: "equity.Market", today: date) -> list[dict]:
    """Shares a member holds by their tradebooks alone (no CDSL statement and no holdings file): the units left after
    replaying every trade, valued at the last trade price until the exchange series arrives. The as-on date is the
    last trade's, so build-time corporate actions after it still apply."""
    pos = equity.derived_positions(trades, corp, today)
    return [{"isin": p["isin"], "raw_name": p["name"], "amc": "", "asset_type": _broker_asset_type(p["isin"]),
             "units": p["units"], "nav": p["price"], "value": round(p["units"] * p["price"], 2) if p["price"] else 0.0,
             "as_of": p["as_of"], "pledged": 0, "broker": p["broker"], "folio": None, "invested": None,
             "sources": ["Tradebook"], "cashflows": None} for p in pos]


def _stage(statements: list[dict], broker_holdings: list[dict] | None, trades: list[dict] | None,
           members: list[dict] | None, corp: "equity.Market", today: date) -> tuple[dict, list]:
    """by_member (statements plus members known only from broker files or tradebooks) and the staged rows:
    [(member_id, cdsl, rta, merged rows, total, CDSL history, broker costs, notes)]."""
    by_member = _latest_by_member(statements)
    files_by: dict[str, list[dict]] = {}
    for f in broker_holdings or []:
        files_by.setdefault(f.get("member_id"), []).append({**f, "as_of": str(f.get("as_of") or today.isoformat())[:10]})
    trades_by: dict[str, list[dict]] = {}
    for tb in trades or []:
        for t in tb.get("trades") or []:
            trades_by.setdefault(tb.get("member_id"), []).append({**t, "broker": tb.get("broker")})
    names = {m.get("member_id"): m.get("name") for m in members or []}
    for mid in list(files_by) + list(trades_by):
        if mid and mid not in by_member:
            holder = next((f.get("holder_name") for f in files_by.get(mid, []) if f.get("holder_name")), None)
            by_member[mid] = {"pan": "", "name": names.get(mid) or (holder.title() if holder else None)}
    staged = []
    for mid, kinds in by_member.items():
        cdsl, rta = kinds.get("CDSL"), kinds.get("RTA")
        merged = _merge_holdings(cdsl, rta)
        extra, costs, notes = _broker_rows(files_by.get(mid, []), cdsl, rta)
        merged += extra
        if not cdsl and not files_by.get(mid) and trades_by.get(mid):
            have = {h["isin"] for h in merged}
            merged += [r for r in _tradebook_rows(trades_by[mid], corp, today) if r["isin"] not in have]
        staged.append((mid, cdsl, rta, merged, sum(h["value"] for h in merged), _full_history(kinds.get("CDSL_ALL", [])), costs, notes))
    return by_member, staged


def market_requirements(statements: list[dict], isin_to_code: dict[str, str] | None = None,
                        broker_holdings: list[dict] | None = None, trades: list[dict] | None = None,
                        symbols: list[dict] | None = None, today: date | None = None) -> dict:
    """What market data a build of these statements can use, so the caller sends only that.

    {"codes": AMFI codes whose NAV series are needed (benchmark included),
     "isins_without_code": held ISINs with no code yet (look them up, e.g. in the scheme table),
     "held_isins": every ISIN held (stock data is only used for the equity ones),
     "price_isins": shares and bonds held in demat, whose exchange-price series are needed (M20)}
    """
    corp = equity.Market.from_data(None, symbols)
    _, staged = _stage(statements, broker_holdings, trades, None, corp, today or date.today())
    codes = _fund_codes(staged, isin_to_code or {})
    held = {h["isin"] for st in staged for h in st[3]}
    return {
        "codes": sorted(set(codes.values()) | {market.BENCHMARK_CODE}),
        "isins_without_code": sorted(i for i in held if i not in codes),
        "held_isins": sorted(held),
        "price_isins": sorted({h["isin"] for st in staged for h in st[3] if h["asset_type"] == "equity_or_bond"}),
    }


def _overrides_by_member(overrides: list[dict] | None) -> dict[str, dict]:
    """[{member_id, isin, folio, kind: skip|cancel, due}] → {member_id: {(folio, isin): {"skip": set, "cancel": date}}}.
    The earliest cancel wins."""
    out: dict[str, dict] = {}
    for o in overrides or []:
        try:
            key = (o.get("folio"), o["isin"])
            slot = out.setdefault(o["member_id"], {}).setdefault(key, {"skip": set(), "cancel": None})
            due = str(o["due"])[:10]
        except (KeyError, TypeError, AttributeError):
            continue
        if o.get("kind") == "skip":
            slot["skip"].add(due)
        elif o.get("kind") == "cancel" and (slot["cancel"] is None or due < slot["cancel"]):
            slot["cancel"] = due
    return out


def build_portfolio(statements: list[dict], market_data: dict | None = None, today: date | None = None,
                    overrides: list[dict] | None = None, trades: list[dict] | None = None,
                    stock_costs: list[dict] | None = None, broker_holdings: list[dict] | None = None,
                    members_in: list[dict] | None = None) -> dict:
    """Newest CDSL + newest CAMS/KFintech statement per member, merged into one family view.

    statements:  [{"member_id", "pan", "name"?, "data"}]: decrypted parsed statements of one household.
    market_data: {"navs": {amfi_code: [[iso_date, nav], ...]}, "isin_to_code": {isin: amfi_code},
                  "prices": {isin: [[iso_date, close], ...]} for shares and bonds (M20),
                  "stocks": stock data (see stocks.py) or None,
                  "scores": {isin: benchmark score view} (M28, copied onto the holding)}. Missing pieces degrade gracefully.
    today:       the build date (the caller's clock), so builds are reproducible.
    overrides:   the user's SIP changes the statements can't show yet: skip one instalment, or cancel (M12).
    trades:      broker tradebooks (M21), [{"member_id", "broker", "trades": [...]}] (parsers/tradebook.py).
    stock_costs: manual average buy prices (M21), [{"member_id", "isin", "avg_price", "since"?}].
                 market_data also carries "corp_actions", "symbols" and "fmv_2018" for them (equity.py).
    broker_holdings: broker holdings statements (M34), [{"member_id", "broker", "broker_name", "account", "as_of",
                 "holder_name"?, "holdings": [{isin, name, qty, avg_price, close}]}] (parsers/broker_holdings.py).
    members_in:  [{"member_id", "name"}] for members with no statement (their name; a PAN-less member, D29).
    """
    market_data = market_data or {}
    today = today or date.today()
    corp = equity.Market.from_data(market_data.get("corp_actions"), market_data.get("symbols"), market_data.get("fmv_2018"))
    by_member, staged = _stage(statements, broker_holdings, trades, members_in, corp, today)

    members, holdings, activity, sips = [], [], [], []

    codes = _fund_codes(staged, market_data.get("isin_to_code") or {})
    navs = market.series_map(market_data.get("navs"))
    prices = market.series_map(market_data.get("prices"))  # shares and bonds: daily exchange closes by ISIN (M20)
    bench = navs.get(market.BENCHMARK_CODE)
    hols = holidays.calendar(market_data.get("holidays"))
    user_overrides = _overrides_by_member(overrides)
    waiting = {str(c) for c in market_data.get("refresh") or []}  # codes whose NAV backfill is still running
    scores = market_data.get("scores") or {}  # benchmark scores by ISIN, computed by the Worker (M28)
    trades_by: dict[str, list[dict]] = {}
    for tb in trades or []:
        for t in tb.get("trades") or []:
            trades_by.setdefault(tb.get("member_id"), []).append({**t, "broker": tb.get("broker")})
    costs_by: dict[str, dict[str, dict]] = {}
    for c in stock_costs or []:
        if c.get("member_id") and c.get("isin"):
            costs_by.setdefault(c["member_id"], {})[c["isin"]] = c
    t_iso = today.isoformat()

    for mid, cdsl, rta, merged, total, full_hist, broker_costs, broker_notes in sorted(staged, key=lambda s: -s[4]):
        pan = by_member[mid]["pan"]
        name = by_member[mid]["name"] or ((cdsl or {}).get("holder_name") or (rta or {}).get("holder_name") or "").title() or _mask_pan(pan) or "Member"
        hist = (cdsl or {}).get("valuation_history", [])
        cdsl_isins = {h["isin"] for h in (cdsl or {}).get("holdings", [])}
        rta_isins = {s["isin"] for s in (rta or {}).get("schemes", [])}
        # Prefer the transaction rebuild when the CAMS/KFintech statement covers every fund held:
        # it goes back to the statement start. Otherwise the CDSL month-end values.
        rebuilt, rebuilt_note = (_rta_history(rta, navs, today, waiting)
                                 if merged and all(h["isin"] in rta_isins for h in merged) else ([], None))
        use_rta = len(rebuilt) > len(full_hist)
        members.append({
            "id": mid, "name": name, "pan": _mask_pan(pan),
            "as_of": max((h["as_of"] for h in merged), default=None),
            "total": round(total, 2),
            # month-on-month change only from the CDSL history, which is internally consistent
            "previous_total": hist[-2]["value"] if len(hist) >= 2 else None,
            "history": rebuilt if use_rta else full_hist,
            "history_covers_all": use_rta or all(h["isin"] in cdsl_isins for h in merged),
            "history_source": "transactions" if use_rta else "cdsl",
            # "waiting": some months use the statement's own NAVs while a fund's NAV history downloads (the next build
            # fixes them); "estimated": some stay that way (no NAV history exists). None: every month at daily NAVs.
            "history_note": rebuilt_note if use_rta else None,
            "sources": sorted({k if k == "CDSL" else (st.get("file_type") or "RTA")
                               for k, st in (("CDSL", cdsl), ("RTA", rta)) if st}
                              | {s for h in merged if "CDSL" not in h["sources"] for s in h["sources"]
                                 if s not in ("CAMS", "KFINTECH", "RTA")}),
            # shares only in a broker file newer than the CDSL statement: not counted (rule 1), a newer one is asked for
            "broker_notes": broker_notes,
            "accounts": [
                {"depository": a["depository"], "broker": a["dp_name"].title(), "funds": a["num_isins"], "value": a["value"]}
                for a in (cdsl or {}).get("accounts", [])
            ],
        })
        for h in merged:
            h["sebi_category"] = scheme_info(h["isin"])[0]
        # shares and ETFs (M21): lots from tradebooks and manual prices, corporate actions, gains and tax
        first_seen: dict[str, str] = {}
        for st in sorted(by_member[mid].get("CDSL_ALL", []), key=_as_of):
            for x in st.get("holdings", []):
                first_seen.setdefault(x["isin"], _as_of(st))
        close = {}
        for h in merged:
            series = prices.get(h["isin"]) if h["asset_type"] == "equity_or_bond" else navs.get(codes.get(h["isin"], ""))
            if series and series.dates:
                close[h["isin"]] = (series.dates[-1], series.navs[-1])
            elif h.get("nav"):
                close[h["isin"]] = (h["as_of"], h["nav"])
        eq = equity.member_stocks(merged, trades_by.get(mid, []), costs_by.get(mid, {}), corp, first_seen, today, close, broker_costs)
        analysis = member_analysis(rta, cdsl, merged, today, eq["realised"],
                                   {i: x["tax"] for i, x in eq["holdings"].items() if x.get("tax")})
        members[-1]["analysis"] = {k: v for k, v in analysis.items() if k != "unrealised"}
        member_sips: dict[str, list[dict]] = {}
        for s in (rta or {}).get("sips", []):
            member_sips.setdefault(s["isin"], []).append(s)
        estimates: dict[str, dict] = {}
        first = len(holdings)
        for h in merged:
            sebi = h["sebi_category"]
            holdings.append({
                "member_id": mid, "isin": h["isin"], "name": display_name(h["raw_name"]), "amc": fund_house(h["amc"], h["raw_name"]),
                "category": categorize(h["raw_name"], h["asset_type"], h["isin"]), "broker": (h["broker"] or "").title(),
                "sebi_category": sebi.split(" - ", 1)[-1] if sebi else None,
                "asset_class": asset_class(h["raw_name"], sebi, h["asset_type"]),
                "folio": h["folio"], "sources": h["sources"],
                "units": h["units"], "pledged": h["pledged"], "nav": h["nav"], "value": h["value"],
                "invested": h["invested"], "as_of": h["as_of"], "cashflows": h["cashflows"],
                "tax": analysis["unrealised"].get(h["isin"]),  # long/short-term split, when lots are known
                "returns": market.trailing_returns(navs.get(codes.get(h["isin"], ""))),
                "score": scores.get(h["isin"]),
            })
            code = codes.get(h["isin"])
            est = _carry_forward(holdings[-1], h, code, navs.get(code or ""), member_sips.get(h["isin"], []), rta,
                                 by_member[mid].get("CDSL_ALL", []), today, hols, user_overrides.get(mid), prices.get(h["isin"]))
            _apply_stock(holdings[-1], h, eq["holdings"].get(h["isin"]), corp, t_iso)
            if h["asset_type"] == "mutual_fund" and code and not holdings[-1].get("notice"):
                s_ = navs.get(code)
                holdings[-1]["notice"] = equity.fund_notice(s_.dates if s_ else None, market_data.get("market_date"), h["as_of"])
            # what the same rupees on the same days would be worth in a Nifty 50 index fund
            holdings[-1]["benchmark_value"] = market.replay(holdings[-1]["cashflows"], bench, holdings[-1]["as_of"])
            if est:
                estimates[h["isin"]] = est

        mine = holdings[first:]
        m = members[-1]
        m["statement_total"] = m["total"]
        m["total"] = round(sum(h["value"] for h in mine), 2)
        m["value_date"] = max((h["as_of"] for h in mine), default=None)
        inst = [i for e in estimates.values() for i in e["instalments"]]
        running = [i for e in estimates.values() for i in e["instalments"] + e["pending"] if i["status"] == "in_progress"]
        m["estimated"] = {"instalments": len(inst), "amount": round(sum(i["amount"] for i in inst), 2),
                          "pending": sum(len(e["pending"]) for e in estimates.values()),
                          "pending_amount": round(sum(i["amount"] for e in estimates.values() for i in e["pending"]), 2),
                          "in_progress": len(running), "in_progress_amount": round(sum(i["amount"] for i in running), 2)}
        m["history"] = _extend_history(m, mine, navs, estimates, prices)

        activity.extend(_member_activity(mid, cdsl, rta))
        div_fy: dict[str, float] = {}
        for x in mine:
            for d, amt in x.get("dividends") or []:
                activity.append({"member_id": mid, "isin": x["isin"], "name": x["name"], "date": d, "units": 0.0,
                                 "amount": amt, "sip": False, "kind": "dividend", "source": "Estimate", "estimated": True})
                fy = equity.fin_year(date.fromisoformat(d))
                div_fy[fy] = round(div_fy.get(fy, 0.0) + amt, 2)
        m["dividend_income"] = [{"fy": k, "amount": v} for k, v in sorted(div_fy.items(), reverse=True)]
        m["stocks"] = {k: (round(v, 4) if isinstance(v, float) else v) for k, v in eq["counts"].items()}
        for isin, e in estimates.items():
            name = next(h["name"] for h in mine if h["isin"] == isin)
            for i in e["instalments"] + e["pending"]:
                activity.append({"member_id": mid, "isin": isin, "name": name, "date": i["date"], "units": i["units"] or 0.0,
                                 "amount": i["amount"], "sip": True, "kind": "sip", "source": "Estimate", "estimated": True,
                                 "status": i["status"], "due": i["due"], "moved": i["moved"], "units_by": i["units_by"]})

        # SIPs only come from CAMS/KFintech (CDSL doesn't say which purchases are SIPs)
        cats = {h["isin"]: categorize(h["raw_name"], h["asset_type"], h["isin"]) for h in merged}
        for s in (rta or {}).get("sips", []):
            series = navs.get(codes.get(s["isin"], ""))
            day = projection.sip_day(rta.get("transactions", []), s.get("folio"), s["isin"], series, hols)
            o = projection.override_for(user_overrides.get(mid), s)
            status = "cancelled" if s["status"] == "active" and o["cancel"] else s["status"]
            # the next run date, moved past weekends and holidays as the broker would (owner request, M12)
            nxt = projection.next_run(s, day, today, series, hols, o["skip"]) if status == "active" else None
            e = estimates.get(s["isin"], {})
            done = [i for i in e.get("instalments", []) if i["folio"] == s.get("folio")]
            ran = sorted(done + [i for i in e.get("pending", []) if i["folio"] == s.get("folio")], key=lambda i: i["date"])
            latest = ran[-1] if ran else None
            sips.append({**s, "status": status, "member_id": mid, "name": display_name(s["name"]),
                         "category": cats.get(s["isin"], categorize(s["name"], "mutual_fund", s["isin"])),
                         "sip_day": day, "next_date": nxt["date"] if nxt else None,
                         "next_due": nxt["due"] if nxt else None, "next_moved": nxt["moved"] if nxt else None,
                         "latest": ({k: latest[k] for k in ("due", "date", "moved", "amount", "status", "units_by")}
                                    if latest else None),
                         "estimated": {"instalments": len(done), "amount": round(sum(i["amount"] for i in done), 2)},
                         # the user's own changes: an upcoming instalment they skipped, the day they cancelled
                         "skipped": sorted(d for d in o["skip"] if d >= (today - timedelta(days=10)).isoformat()),
                         "cancelled_on": o["cancel"]})
        m["sips_known"] = rta is not None

    # Label each holding with its active SIP(s): same member and fund (a fund can have SIPs in two folios)
    active: dict[tuple, list[dict]] = {}
    for s in sips:
        if s["status"] == "active":
            active.setdefault((s["member_id"], s["isin"]), []).append(s)
    for h in holdings:
        found = active.get((h["member_id"], h["isin"]), [])
        h["sip"] = ({"amount": sum(s["amount"] for s in found), "frequency": found[0]["frequency"]}
                    if found and len({s["frequency"] for s in found}) == 1
                    else ({"amount": sum(s["amount"] for s in found), "frequency": "mixed"} if found else None))

    holdings.sort(key=lambda h: -h["value"])
    activity.sort(key=lambda a: a["date"], reverse=True)
    benchmark = {"name": market.BENCHMARK_NAME, "returns": market.trailing_returns(bench)} if bench else None

    # Stocks inside each equity fund, from data the caller fetched (plan §10.3.1)
    stock_data = stocks.snapshot(stocks.equity_funds(holdings), market_data.get("stocks"))

    return {"members": members, "holdings": holdings, "activity": activity, "sips": sips, "benchmark": benchmark,
            "stocks": stock_data}


def _apply_stock(out: dict, h: dict, info: dict | None, corp: "equity.Market", today: str) -> None:
    """Shares and ETFs (M21): units after the splits, bonuses and trades since the statement, the cost and gain from
    the lots, units over time in today's terms, estimated dividends and the merger banner. Changes `out` in place."""
    out.setdefault("notice", None)
    if h["asset_type"] != "equity_or_bond" and info is None:
        return
    stmt = h["as_of"][:10]
    if h["asset_type"] == "equity_or_bond":
        out["notice"] = equity.notice(h["isin"], corp, stmt, today)
        out["corp_actions_tracked"] = corp.symbol_of(h["isin"]) is not None
    timeline = equity.today_terms(out.get("units_timeline"), h["isin"], corp, today)
    if info is None:
        units = round((h["units"] or 0) * corp.growth(h["isin"], stmt, today), 4)
        info = {"cost_source": "none", "units": units, "unknown_units": units, "traded_after": 0.0}
    units = info["units"]
    if timeline is not None and abs(units - (timeline[-1][1] if timeline else 0)) > 1e-4:
        point = [out.get("as_of") or today, units]
        timeline = [p for p in timeline if p[0] < point[0]] + [point]
    if timeline is not None:
        out["units_timeline"] = timeline
    if abs(units - (out["units"] or 0)) > 1e-6:
        out["units"] = units
        if out.get("nav") is not None and out.get("price_source") in ("exchange", "nav"):
            out["value"] = round(units * out["nav"], 2)
    out["cost_source"] = info["cost_source"]
    out["unknown_units"] = info.get("unknown_units", 0.0)
    if info.get("invested") is not None:
        out["invested"] = info["invested"]
        out["avg_price"] = info.get("avg_price")
        out["cashflows"] = info.get("cashflows")
        out["lots_since"] = info.get("since")
        if info.get("tax"):
            out["tax"] = info["tax"]
    elif h["asset_type"] == "equity_or_bond":
        out["invested"], out["cashflows"] = None, None
    first = (out.get("units_timeline") or [[stmt]])[0][0]
    out["dividends"] = equity.dividends(h["isin"], corp, out.get("units_timeline") or [[stmt, units]], min(first, stmt), today)


def _carry_forward(out: dict, h: dict, code: str | None, series: NavSeries | None, sips: list[dict], rta: dict | None,
                   cdsl_all: list[dict], today: date, hols: frozenset[str] = holidays.FALLBACK_HOLIDAYS,
                   overrides: dict | None = None, price: NavSeries | None = None) -> dict | None:
    """Units over time, estimated SIP instalments since the statement, and the value at the latest NAV (§10.5.1).

    `out` is the snapshot holding (changed in place); `h` the merged statement row. The statement's own figures stay
    in `out["statement"]`. Returns the estimate ({"instalments", "pending"}) or None when there's nothing to estimate.
    Shares and bonds (M20) are valued at `price`, their latest exchange close; `price_source` says which applied.
    """
    as_of = h["as_of"]
    out["statement"] = {"units": h["units"], "nav": h["nav"], "value": h["value"], "as_of": as_of}
    out["amfi_code"] = code
    out["units_timeline"], out["units_exact"], out["payouts"], out["estimated"] = None, False, [], None
    out["price_source"] = "statement"
    if h["asset_type"] == "equity_or_bond" and price and price.dates:
        # CDSL units at each statement date (constant in between), valued at the exchange close
        timeline, exact = projection.units_timeline(h["isin"], None, cdsl_all, as_of, h["units"])
        out["units_timeline"], out["units_exact"], out["price_source"] = timeline, exact, "exchange"
        if price.dates[-1] > as_of[:10]:
            close = price.navs[-1]
            out.update(nav=close, value=round((h["units"] or 0) * close, 2), as_of=price.dates[-1])
        return None
    if h["asset_type"] != "mutual_fund" or not code:
        return None  # no NAV or exchange price (unlisted, or not fetched yet): shown as on the statement
    if series and series.dates:
        out["price_source"] = "nav"
    rta_for = rta if any(s.get("isin") == h["isin"] for s in (rta or {}).get("schemes", [])) else None
    timeline, exact = projection.units_timeline(h["isin"], rta_for, cdsl_all, as_of, h["units"])
    est = (projection.estimate_sips(sips, (rta or {}).get("transactions", []), as_of, series, today, hols, overrides)
           if sips else {"instalments": [], "pending": []})
    inst = est["instalments"]
    out["units_timeline"] = projection.extend_timeline(timeline, inst)
    out["units_exact"] = exact
    if rta_for:
        paid: dict[str, float] = {}
        for t in rta_for.get("transactions", []):
            if t.get("isin") == h["isin"] and t.get("type") == "DIVIDEND_PAYOUT" and t.get("amount"):
                paid[t["date"][:10]] = paid.get(t["date"][:10], 0.0) + abs(t["amount"])
        out["payouts"] = [[d, round(a, 2)] for d, a in sorted(paid.items())]

    extra = sum(i["units"] for i in inst)
    amount = sum(i["amount"] for i in inst)
    if series and series.dates and series.dates[-1] > as_of[:10]:
        units = round((h["units"] or 0) + extra, 4)
        price = series.navs[-1]
        out.update(units=units, nav=price, value=round(units * price, 2), as_of=series.dates[-1])
    if inst:
        if out["invested"] is not None:
            out["invested"] = round(out["invested"] + amount, 2)
        if out["cashflows"] is not None:
            flows = {d: a for d, a in out["cashflows"]}
            for i in inst:
                flows[i["date"]] = round(flows.get(i["date"], 0.0) - i["amount"], 2)
            out["cashflows"] = [[d, a] for d, a in sorted(flows.items()) if a]
    if not inst and not est["pending"]:
        return None
    running = [i for i in inst + est["pending"] if i["status"] == "in_progress"]
    out["estimated"] = {"since": as_of, "instalments": len(inst), "amount": round(amount, 2), "units": round(extra, 4),
                        "pending": len(est["pending"]), "in_progress": len(running),
                        "in_progress_amount": round(sum(i["amount"] for i in running), 2)}
    return est


def _extend_history(m: dict, holdings: list[dict], navs: dict[str, NavSeries], estimates: dict[str, dict],
                    prices: dict[str, NavSeries] | None = None) -> list[dict]:
    """Month-end values after the newest statement, up to the latest NAV, from the units timelines (estimated SIPs
    included). Only when the history already covers every fund and every fund has NAVs (shares and bonds: exchange
    closes, M20); otherwise unchanged."""
    hist = m["history"]
    since, value_date = m.get("as_of"), m.get("value_date")
    if not hist or not m["history_covers_all"] or not holdings or not since or not value_date or value_date <= since:
        return hist
    prices = prices or {}
    pairs = [(h, prices.get(h["isin"]) if h.get("price_source") == "exchange" else navs.get(h.get("amfi_code") or ""))
             for h in holdings]
    if any(s is None or not h.get("units_timeline") for h, s in pairs):
        return hist
    flows = m["history_source"] == "transactions"
    est_by_month: dict[str, float] = {}
    for e in estimates.values():
        for i in e["instalments"]:
            est_by_month[i["date"][:7]] = est_by_month.get(i["date"][:7], 0.0) + i["amount"]
    out = {p["month"]: dict(p) for p in hist}
    y, mo = int(since[:4]), int(since[5:7])
    while f"{y}-{mo:02d}" <= value_date[:7]:
        key, end = f"{y}-{mo:02d}", projection.month_end(y, mo)
        if end > since:
            day = min(end, value_date)
            total = 0.0
            for h, s in pairs:
                units = projection.units_on(h["units_timeline"], day)
                if units < 1e-6:
                    continue
                price = s.on(day)
                if price is None:
                    return [out[k] for k in sorted(out)]
                total += units * price
            point = {"month": key, "value": round(total, 2)}
            if flows:
                point["flow"] = round(out.get(key, {}).get("flow", 0.0) + est_by_month.get(key, 0.0), 2)
            out[key] = point
        y, mo = (y + 1, 1) if mo == 12 else (y, mo + 1)
    return [out[k] for k in sorted(out)]


DEDUPE_WINDOW_DAYS = 7

KINDS = {
    "PURCHASE_SIP": "sip", "PURCHASE": "purchase", "REDEMPTION": "redemption",
    "SWITCH_IN": "switch_in", "SWITCH_IN_MERGER": "switch_in", "SWITCH_OUT": "switch_out",
    "SWITCH_OUT_MERGER": "switch_out", "DIVIDEND_REINVEST": "dividend",
}


def _kind(rta_type: str | None, units: float) -> str:
    """sip / purchase / redemption / switch_in / switch_out / dividend (CDSL rows: by unit direction)."""
    return KINDS.get(rta_type or "", "purchase" if units > 0 else "redemption")


def _member_activity(mid: str, cdsl: dict | None, rta: dict | None) -> list[dict]:
    """Purchases/redemptions for one member, each listed once.

    The same SIP instalment appears in both statements: CAMS/KFintech with the ₹ amount on the
    transaction date, CDSL with only units on the credit date (often 1–3 days later). Prefer the
    CAMS/KFintech row and drop a CDSL row for the same fund and units within ±7 days. Each
    CAMS/KFintech row can absorb at most one CDSL row, so two genuine identical buys still show.
    """
    out = []
    all_rta = (rta or {}).get("transactions", [])
    # stamp duty is a separate row in the statement; fold it into that day's purchase so the
    # amount shown is what actually left the bank (₹9,999.50 + ₹0.50 = ₹10,000)
    duty: dict[tuple, float] = {}
    for t in all_rta:
        if t.get("type") == "STAMP_DUTY_TAX":
            k = (t.get("folio"), t["isin"], t["date"])
            duty[k] = duty.get(k, 0.0) + abs(t.get("amount") or 0)
    rta_rows = [t for t in all_rta if t.get("units")]
    unmatched = list(rta_rows)
    for t in rta_rows:
        amount = t.get("amount") or None
        if amount and t["units"] > 0:
            amount = round(abs(amount) + duty.pop((t.get("folio"), t["isin"], t["date"]), 0.0), 2)
        out.append({"member_id": mid, "isin": t["isin"], "name": display_name(t["name"]), "date": t["date"],
                    "units": t["units"], "amount": amount,
                    "sip": t.get("type") == "PURCHASE_SIP", "kind": _kind(t.get("type"), t["units"]),
                    "source": rta.get("file_type") or "RTA"})
    for t in (cdsl or {}).get("transactions", []):
        units = (t["credit"] or 0) - (t["debit"] or 0)
        if not units:
            continue
        d = datetime.fromisoformat(t["date"]).date()
        match = next((r for r in unmatched
                      if r["isin"] == t["isin"] and abs(abs(r["units"]) - abs(units)) < 0.001
                      and (r["units"] > 0) == (units > 0)
                      and abs((datetime.fromisoformat(r["date"]).date() - d).days) <= DEDUPE_WINDOW_DAYS), None)
        if match:
            unmatched.remove(match)
            continue
        out.append({"member_id": mid, "isin": t["isin"], "name": display_name(t["name"]), "date": t["date"],
                    "units": units, "amount": None, "sip": False, "kind": _kind(None, units), "source": "CDSL"})
    return out
