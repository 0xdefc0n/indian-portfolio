"""Broker holdings statements (plan §21.13, D29, M34): CSV or Excel in, one row per share held out.

A broker's holdings statement already has what returns need: the quantity and the average buy price of each share
in that broker account. Header-driven like tradebook.py: the profile is picked by the header row (searched for in the
first rows of every sheet, never by filename), with the preamble above it read for three things only:
- the holder's name, to suggest the member's name (Groww's files carry no PAN);
- the client code, which the Worker turns into an HMAC to key "same account" and never stores in clear;
- the "as on" date of the statement.

Each holding: {isin, name|None, symbol|None, qty, avg_price|None, close|None}. `close` is the statement's closing
price (public market data), used only until the exchange price series arrives.

Never logs contents, never writes to disk.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .tradebook import (
    HEADER_SCAN_ROWS,
    PAN_RE,
    TradebookError,
    clean_isin,
    clean_symbol,
    norm,
    num,
    read_sheets,
    to_date,
)


@dataclass(frozen=True)
class HoldingsProfile:
    slug: str
    name: str
    required: frozenset[str]           # normalised header names that must all be present
    isin: str
    qty: tuple[str, ...]               # summed (some brokers split free, pledged and unsettled quantities)
    avg: tuple[str, ...]               # the first present one wins
    stock_name: tuple[str, ...] = ()
    symbol: tuple[str, ...] = ()
    close: tuple[str, ...] = ()
    date_order: str = "dmy"
    # preamble labels (normalised): the value is the next non-empty cell in the same row
    name_labels: frozenset[str] = field(default_factory=lambda: frozenset({"name", "client name", "account holder name"}))
    code_labels: frozenset[str] = field(default_factory=lambda: frozenset({"unique client code", "client code", "client id", "ucc"}))


PROFILES: list[HoldingsProfile] = [
    # Groww: Holdings statement for stocks (Excel), layout from the owner's file, 2026-11-28 (§21.13)
    HoldingsProfile("groww", "Groww", frozenset({"stock name", "isin", "quantity", "average buy price"}),
                    isin="isin", qty=("quantity",), avg=("average buy price",), stock_name=("stock name",),
                    close=("closing price",)),
    # Zerodha Console → Portfolio → Holdings → Download (XLSX; sheets Equity, Mutual Funds, Combined; the Equity sheet
    # is read). "Quantity Long Term" is part of "Quantity Available", so it isn't added (§21.13 "As built").
    HoldingsProfile("zerodha", "Zerodha", frozenset({"symbol", "isin", "quantity available", "average price"}),
                    isin="isin", qty=("quantity available", "quantity discrepant", "quantity pledged margin", "quantity pledged loan"),
                    avg=("average price",), symbol=("symbol",), close=("previous closing price",), date_order="ymd"),
    # Dhan → Holding summary download (XLSX or CSV): quantities and the closing price, no buy price
    HoldingsProfile("dhan", "Dhan", frozenset({"scrip name", "isin code", "free holding", "closing price"}),
                    isin="isin code", qty=("free holding", "locked in", "safe keep", "mtf pledge", "margin pledge", "cusa pledge"),
                    avg=(), stock_name=("scrip name",), close=("closing price",)),
]
BROKERS = {p.slug: p.name for p in PROFILES}

AS_ON = re.compile(r"\bas\s+on\b(?:\s+date)?\s*[:\-]?\s*(.*)$|^\s*for\s+(\d.*)$", re.I)
TOTAL_ROW = re.compile(r"^(grand\s+)?total\b", re.I)


def find_header(rows: list[list]) -> tuple[HoldingsProfile, int, list[str]] | None:
    """The first row (in each sheet's first HEADER_SCAN_ROWS non-blank rows) that matches a holdings profile."""
    since_blank = 0
    for i, row in enumerate(rows):
        if not any(str(c).strip() for c in row if c is not None):
            since_blank = 0
            continue
        since_blank += 1
        if since_blank > HEADER_SCAN_ROWS:
            continue
        names = [norm(c) for c in row]
        have = set(names)
        for p in PROFILES:
            if p.required <= have:
                return p, i, names
    return None


def _label_value(row: list, labels: frozenset[str]) -> str | None:
    cells = [c for c in row if c is not None and str(c).strip() != ""]
    for j, c in enumerate(cells):
        text = str(c).strip()
        key = norm(text.split(":", 1)[0])
        if key in labels:
            after = text.split(":", 1)[1].strip() if ":" in text else ""
            if after:
                return after
            if j + 1 < len(cells):
                return str(cells[j + 1]).strip()
    return None


def _preamble(rows: list[list], order: str, p: HoldingsProfile) -> dict:
    holder = code = as_on = None
    pans: set[str] = set()
    for row in rows:
        holder = holder or _label_value(row, p.name_labels)
        code = code or _label_value(row, p.code_labels)
        for c in row:
            if c is None:
                continue
            s = str(c)
            pans.update(PAN_RE.findall(s.upper()))
            if as_on is None and (m := AS_ON.search(s)):
                rest = (m[1] if m[1] is not None else m[2] or "").strip()
                if not rest:  # "As on" in one cell, the date in the next
                    nxt = [x for x in row[row.index(c) + 1:] if x not in (None, "")]
                    rest = nxt[0] if nxt else ""
                got = to_date(rest, order) if rest != "" else None
                as_on = got[0] if got else None
    return {"holder_name": _clean_name(holder), "client_code": _clean_code(code), "as_of": as_on,
            "pan": next(iter(pans)) if len(pans) == 1 else None}


def _clean_name(v: str | None) -> str | None:
    if not v:
        return None
    s = re.sub(r"\s+", " ", str(v)).strip()
    if not s or len(s) > 80 or not re.search(r"[A-Za-z]", s):
        return None
    return s


def _clean_code(v: str | None) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    if s.endswith(".0") and s[:-2].isdigit():  # a numeric code Excel stored as a float
        s = s[:-2]
    s = re.sub(r"\s+", "", s).upper()
    return s if 3 <= len(s) <= 40 else None


def _first(r: dict, cols: tuple[str, ...]) -> object:
    for c in cols:
        v = r.get(c)
        if v not in (None, ""):
            return v
    return None


def parse_holdings_rows(rows: list[list], found: tuple[HoldingsProfile, int, list[str]]) -> dict:
    """{broker, broker_name, holder_name, client_code, as_of, pan, holdings, counts} from rows with a known header."""
    prof, at, names = found
    pre = _preamble(rows[:at], prof.date_order, prof)
    counts: dict[str, int] = {}

    def add(k: str) -> None:
        counts[k] = counts.get(k, 0) + 1

    by_isin: dict[str, dict] = {}
    blank_run = 0
    for row in rows[at + 1:]:
        if not any(str(c).strip() for c in row if c is not None):
            blank_run += 1
            if blank_run >= 3 and by_isin:
                break  # the table ended
            continue
        blank_run = 0
        if [norm(v) for v in row[: len(names)]] == names:
            continue  # a repeated header
        r: dict = {}
        for k, v in zip(names, row):
            if k and k not in r:
                r[k] = v
        first = next((str(c).strip() for c in row if c not in (None, "")), "")
        if TOTAL_ROW.match(first):
            break
        add("rows")
        isin = clean_isin(r.get(prof.isin))
        if not isin:
            add("skipped_other")
            continue
        qty = sum(q for c in prof.qty if (q := num(r.get(c))) is not None)
        if qty <= 0:
            add("skipped_zero")
            continue
        avg = num(_first(r, prof.avg))
        close = num(_first(r, prof.close))
        sym = clean_symbol(_first(r, prof.symbol)) if prof.symbol else None
        name = _first(r, prof.stock_name) if prof.stock_name else sym
        avg = avg if avg is not None and avg > 0 else None
        cur = by_isin.get(isin)
        if cur is None:
            by_isin[isin] = {"isin": isin, "name": str(name).strip() if name else None, "symbol": sym, "qty": qty,
                             "avg_price": avg, "close": close if close and close > 0 else None}
        else:  # the same share twice (NSE and BSE rows): quantities add, averages weigh by quantity
            if cur["avg_price"] is not None and avg is not None:
                cur["avg_price"] = (cur["avg_price"] * cur["qty"] + avg * qty) / (cur["qty"] + qty)
            else:
                cur["avg_price"] = None
            cur["qty"] += qty
    holdings = []
    for h in by_isin.values():
        h["qty"] = round(h["qty"], 6)
        h["avg_price"] = round(h["avg_price"], 4) if h["avg_price"] is not None else None
        holdings.append(h)
    holdings.sort(key=lambda h: h["isin"])
    counts["holdings"] = len(holdings)
    counts["no_price"] = sum(1 for h in holdings if h["avg_price"] is None)
    if not holdings and counts.get("rows", 0) == 0:
        raise TradebookError("parse_error", "The holdings statement has no rows")
    return {"broker": prof.slug, "broker_name": prof.name, **pre, "holdings": holdings, "counts": counts}


def parse_holdings(data: bytes, passwords: list[str] | None = None) -> dict:
    """A holdings statement on its own (tests and dev tools). Raises TradebookError."""
    for rows in read_sheets(data, passwords):
        found = find_header(rows)
        if found:
            return parse_holdings_rows(rows, found)
    raise TradebookError("unrecognised", "Not a holdings statement we know")
