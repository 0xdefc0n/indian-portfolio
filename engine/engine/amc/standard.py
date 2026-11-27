"""The SEBI monthly portfolio layout most AMCs use, one sheet per scheme (plan §10.3.1, M18).

A sheet looks like this (columns move around, titles vary a little):

    <AMC name> / <scheme name> (An open ended ... scheme)
    Monthly Portfolio Statement as on October 31, 2026
    Name of the Instrument | ISIN | Industry / Rating | Quantity | Market value | % to Net Assets | ...
    Equity & Equity related                       <- a section row: no ISIN, no weight
    (a) Listed / awaiting listing on Stock Exchanges
    HDFC Bank Limited | INE040A01034 | Banks | ... | 7.49
    ...
    Sub Total / Total                              <- skipped
    Debt Instruments / Money Market / TREPS / Net Receivables ...
    GRAND TOTAL                                    <- the end

Each holding becomes a row in the shape the stocks view already uses (BharatStock's, engine/stocks.py):
`{isin, symbol, name, sector, type, pct}`, where `type` is EQUITY, FOREIGN_EQUITY, MUTUAL_FUND_UNIT, DEBT, CASH or
OTHER, and `pct` is percent of net assets (AMCs that give fractions, like PPFAS's 0.0749, are scaled). Rows at or below
zero (short futures in arbitrage funds) are dropped, as for BharatStock, except negative cash (net payables), which
keeps the weights adding up to 100.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime

from .excel import Sheet

ISIN = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")
MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
HEADER_SCAN = 60  # the header row is within the first rows

_PCT = re.compile(r"%|percent|per cent", re.I)
_PCT_OF = re.compile(r"net\s*asset|nav|aum|net\s*worth|portfolio", re.I)
_NAME = re.compile(r"name\s*of\s*(the\s*)?(instrument|security|issuer|company)|^instrument|^security|^issuer|^company|^name", re.I)
_SECTOR = re.compile(r"industry|sector|rating", re.I)


@dataclass
class SchemePortfolio:
    scheme_name: str
    as_of: str | None  # YYYY-MM, from the sheet when it says
    rows: list[dict] = field(default_factory=list)
    sheet: str = ""


def text(v: object) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return re.sub(r"\s+", " ", str(v)).strip()


def number(v: object) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = text(v).replace(",", "").replace("%", "").strip()
    if s.startswith("(") and s.endswith(")"):
        s = "-" + s[1:-1]
    try:
        return float(s)
    except ValueError:
        return None


def month_of(v: object) -> str | None:
    """YYYY-MM from a date cell or text such as 'as on October 31, 2026' / '31.10.2026' / '31-Oct-26'."""
    if isinstance(v, (date, datetime)):
        return f"{v.year:04d}-{v.month:02d}"
    s = text(v).lower()
    if not s:
        return None
    m = re.search(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,.\-/']*(?:\d{1,2}(?:st|nd|rd|th)?[\s,.\-/']*)?((?:19|20)\d{2}|\d{2})\b", s)
    if m:
        y = int(m.group(2))
        return f"{y + 2000 if y < 100 else y:04d}-{MONTHS[m.group(1)]:02d}"
    m = re.search(r"\b(\d{1,2})[./\-](\d{1,2})[./\-]((?:19|20)\d{2})\b", s)
    if m and 1 <= int(m.group(2)) <= 12:
        return f"{int(m.group(3)):04d}-{int(m.group(2)):02d}"
    m = re.search(r"\b((?:19|20)\d{2})[./\-](\d{1,2})[./\-](\d{1,2})\b", s)
    if m and 1 <= int(m.group(2)) <= 12:
        return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}"
    return None


_AS_ON = re.compile(r"\b(as\s*(on|at|of)|portfolio\s*statement|statement\s*date|month\s*end(ed|ing)?|period\s*end)", re.I)


def as_of_month(rows: list[list[object]], scheme_name: str = "") -> str | None:
    """The month of the 'as on' date above the header: a cell with 'as on …' (or the cell after such a label), else a
    date cell, else any date-like text that isn't the scheme's name (target-maturity funds carry dates in names)."""
    for r in rows:
        for j, c in enumerate(r):
            t = text(c)
            if _AS_ON.search(t):
                m = month_of(t[_AS_ON.search(t).start():]) or next((month_of(x) for x in r[j + 1 : j + 4] if text(x)), None)
                if m:
                    return m
    for r in rows:
        for c in r:
            if isinstance(c, (date, datetime)):
                return month_of(c)
    name = scheme_name.lower()
    for r in rows:
        for c in r:
            t = text(c)
            if t and (not name or name not in t.lower()) and (m := month_of(t)):
                return m
    return None


@dataclass
class Header:
    row: int
    name: int
    isin: int
    pct: int
    sector: int | None


def find_header(rows: list[list[object]]) -> Header | None:
    for i, row in enumerate(rows[:HEADER_SCAN]):
        cells = [text(c) for c in row]
        isin = next((j for j, c in enumerate(cells) if re.fullmatch(r"isin(\s*(no\.?|number|code))?", c, re.I)), None)
        pct = next((j for j, c in enumerate(cells) if _PCT.search(c) and _PCT_OF.search(c)), None)
        if isin is None or pct is None:
            continue
        name = next((j for j, c in enumerate(cells) if j not in (isin, pct) and _NAME.search(c)), None)
        if name is None:  # no title: the first text column left of the ISIN
            name = next((j for j in range(isin - 1, -1, -1) if cells[j]), max(0, isin - 1))
        sector = next((j for j, c in enumerate(cells) if j not in (isin, pct, name) and _SECTOR.search(c)), None)
        return Header(i, name, isin, pct, sector)
    return None


_SKIP_TITLE = re.compile(r"portfolio\s*statement|monthly\s*portfolio|portfolio\s*as\s*(on|at)|^as\s*(on|at)\b|statement\s*of\s*portfolio|^\(?an?\s+open|^\(?a\s+close", re.I)
_SCHEME_LABEL = re.compile(r"^(scheme\s*name|name\s*of\s*(the\s*)?scheme|scheme)\s*[:\-–]\s*", re.I)
_FUNDISH = re.compile(r"\b(fund|fof|etf|plan|scheme|portfolio|index|series|sensex|nifty)\b", re.I)
_AMC_ONLY = re.compile(r"^[\w&.\s]*\bmutual\s*fund\b\.?$|asset\s*management|trustee", re.I)


def scheme_title(rows: list[list[object]], header_row: int, sheet_name: str = "") -> str | None:
    """The scheme's name from the rows above the header: a 'Scheme Name: …' cell, else the first fund-like title."""
    # A cell that is just the sheet's own code (ABSL starts each sheet with "NIFTY | <name>") is never the name.
    cells = [t for r in rows[:header_row] for c in r if (t := text(c)) and t.lower() != sheet_name.strip().lower()]
    for i, c in enumerate(cells):
        m = _SCHEME_LABEL.match(c)
        if m:
            rest = c[m.end():].strip() or (cells[i + 1] if i + 1 < len(cells) else "")
            if rest:
                return clean_name(rest)
    for c in cells:
        if _SKIP_TITLE.search(c) or _AMC_ONLY.search(c) or not _FUNDISH.search(c) or len(c) > 250:
            continue
        return clean_name(c)
    return clean_name(sheet_name) if _FUNDISH.search(sheet_name) else None


def clean_name(s: str) -> str:
    s = re.sub(r"\s*\(\s*(an?|the)\s+(open|close|interval)[^)]*\)?.*$", "", s, flags=re.I)  # "(An open ended … scheme …)"
    s = re.sub(r"\s*[-–:,]?\s*(monthly\s*)?portfolio\s*(statement)?\s*(as\s*(on|at|of)\b.*)?$", "", s, flags=re.I)
    s = re.sub(r"\s+as\s*(on|at)\b.*$", "", s, flags=re.I)
    return re.sub(r"\s+", " ", s).strip(" -–:,")


# Section rows: what the rows below them are, until the next section row.
_SECTIONS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"treps|tri[\s-]*party|reverse\s*repo|\brepo\b|cblo|net\s*receivable|net\s*current\s*asset|net\s*payable|cash|margin|other\s*current", re.I), "cash"),
    (re.compile(r"mutual\s*fund\s*units?|units?\s*of\s*mutual|investment\s*funds?|exchange\s*traded\s*funds?|\betfs?\b|domestic\s*mutual|overseas\s*mutual|foreign\s*mutual|fund\s*of\s*fund|units\s*issued\s*by", re.I), "fund"),
    (re.compile(r"reit|invit|real\s*estate\s*investment|infrastructure\s*investment|\bgold\b|\bsilver\b|commodit|precious\s*metal", re.I), "other"),
    (re.compile(r"derivative|futures?\b|options?\b|swap|forward", re.I), "derivative"),
    (re.compile(r"debt|bond|debenture|money\s*market|certificate\s*of\s*deposit|commercial\s*paper|treasury\s*bill|t[\s-]?bill|government\s*securit|g[\s-]?sec|state\s*development|\bsdl\b|\bncd|securitised|pass\s*through|fixed\s*deposit|deposits?\b|gilt", re.I), "debt"),
    (re.compile(r"foreign|overseas|international|global|adr|gdr", re.I), "foreign"),
    (re.compile(r"equity|shares|stocks?\b|listed|unlisted|awaiting\s*listing|preference", re.I), "equity"),
]
_CASH_ROW = re.compile(r"^(treps|tri[\s-]*party|reverse\s*repo|cblo|net\s*receivables?|net\s*current\s*assets?|net\s*payables?|cash\b|margin)", re.I)
_BULLION = re.compile(r"^(physical\s*)?(gold|silver)\b(?!.*\b(ltd|limited|etf|fund)\b)", re.I)
_TOTAL = re.compile(r"^(sub[\s-]*)?total\b|^grand\s*total|^net\s*assets|^total\s*net\s*assets|^aum\b", re.I)
_END = re.compile(r"^grand\s*total|^total\s*net\s*assets|^net\s*assets\s*$|^net\s*asset\s*value|^notes?\s*[:\-]?$|^notes?\s*&", re.I)


_FOREIGN = re.compile(r"foreign|overseas|international|global", re.I)


def section_kind(label: str, current: str | None) -> str | None:
    if _FOREIGN.search(label) and not re.search(r"mutual\s*fund|units", label, re.I) and not re.search(r"debt|bond", label, re.I):
        return "foreign"  # "Foreign Securities and/or overseas ETF": shares abroad, not fund units
    for pat, kind in _SECTIONS:
        if pat.search(label):
            # "(a) Listed / awaiting listing" under a foreign equity section stays foreign; under debt, stays debt.
            if kind == "equity" and current in ("foreign", "debt") and not re.search(r"equity|shares", label, re.I):
                return current
            if kind == "foreign" and current in ("debt", "fund"):
                return current
            return kind
    return None


def row_type(isin: str, kind: str | None) -> str:
    """The section decides (an `INE…` ISIN is a share in the equity section and a bond in the debt one); the ISIN
    only fills in: INF is always a fund unit, a non-Indian ISIN among equities is a foreign share."""
    if isin.startswith("INF"):
        return "MUTUAL_FUND_UNIT"
    if kind == "fund":
        return "MUTUAL_FUND_UNIT" if isin else "OTHER"
    if kind == "foreign":
        return "FOREIGN_EQUITY"
    if kind == "equity":
        return "EQUITY" if not isin or isin.startswith("IN") else "FOREIGN_EQUITY"
    if kind is None and isin:  # no section row before it: guess from the ISIN
        if isin.startswith("INE"):
            return "EQUITY"
        return "DEBT" if isin.startswith("IN") else "FOREIGN_EQUITY"
    return {"debt": "DEBT", "cash": "CASH"}.get(kind or "", "OTHER")


def parse_sheet(sheet: Sheet, *, scheme_name: str | None = None) -> SchemePortfolio | None:
    """One scheme from one sheet, or None when the sheet isn't a portfolio (an index, notes, a blank sheet)."""
    rows = sheet.rows
    h = find_header(rows)
    if h is None:
        return None
    name = scheme_name or scheme_title(rows, h.row, sheet.name)
    if not name:
        return None
    as_of = as_of_month(rows[: h.row], name)
    out: list[dict] = []
    kind: str | None = None
    for r in rows[h.row + 1 :]:
        cell = lambda j: r[j] if j is not None and j < len(r) else None  # noqa: E731
        label = text(cell(h.name)) or next((text(c) for c in r if text(c) and number(c) is None), "")
        isin = text(cell(h.isin)).upper()
        pct = number(cell(h.pct))
        if _END.search(label):
            break
        if not ISIN.match(isin):
            isin = ""
        if not isin and (pct is None or _TOTAL.search(label) or not label):
            k = section_kind(label, kind) if label and not _TOTAL.search(label) else None
            kind = k or kind
            continue
        if _TOTAL.search(label) and not isin:
            continue
        if pct is None or pct == 0 or not label:
            continue
        t = row_type(isin, kind)
        if _CASH_ROW.search(label) and not isin:
            t = "CASH"  # "Net current assets" under an "Others" heading is still cash
        elif _BULLION.match(label):
            t = "OTHER"  # gold / silver bullion in commodity ETFs (ISIN IDIA…), whatever section it sits in
        if pct < 0 and t != "CASH":
            continue  # short futures in arbitrage funds; a negative net payable is kept, so the weights add up
        if kind == "derivative" and not isin:
            continue  # futures and options: exposure, not holdings
        out.append({
            "isin": isin or label[:120],
            "symbol": None,
            "name": label[:200],
            "sector": text(cell(h.sector))[:80] or None,
            "type": t,
            "pct": pct,
        })
    if not out:
        return None
    total = sum(x["pct"] for x in out)
    if total <= 1.5:  # fractions of net assets (PPFAS): scale to percent
        for x in out:
            x["pct"] *= 100
    for x in out:
        x["pct"] = round(x["pct"], 4)
        if x["type"] not in ("EQUITY", "FOREIGN_EQUITY"):
            x["sector"] = x["sector"] if x["type"] == "MUTUAL_FUND_UNIT" else None  # a rating isn't a sector
    return SchemePortfolio(scheme_name=name, as_of=as_of, rows=out, sheet=sheet.name)


def parse_sheets(sheets: list[Sheet]) -> list[SchemePortfolio]:
    return [p for s in sheets if (p := parse_sheet(s))]
