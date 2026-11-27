"""SBI Mutual Fund: the combined monthly workbook, one sheet per scheme (plus an `Index` sheet), standard SEBI layout.

Each sheet starts:
    SBI Mutual Fund | <scheme code> | Back to Index
    SCHEME NAME : | SBI Aggressive Hybrid Fund (Erstwhile known as SBI Equity Hybrid Fund)
    PORTFOLIO STATEMENT AS ON : | 2026-10-31
Fixes over the standard parser and matcher:
  - the name drops "(Erstwhile known as …)", the scheme's old name, which would otherwise dilute the AMFI name match;
  - the as-of month comes from the "PORTFOLIO STATEMENT AS ON" cell, not the first date-like cell: target-maturity
    funds carry a date in the name ("SBI CRISIL IBX Gilt Index- June 2036 Fund") that comes first;
  - a few names are respelled as AMFI has them (_RENAMES: "SBI Smallcap Fund" is "SBI SMALL CAP FUND" at AMFI);
  - OVERRIDES for schemes whose names tie with a sibling once plan/option words go: the Silver ETF and its Fund of
    Fund ("fund", "of" are stop words), and the two 1D Rate Liquid ETFs ("- Growth" / "- IDCW" are option words).
"""

from __future__ import annotations

import re

from ..excel import Sheet
from ..standard import SchemePortfolio, clean_name, find_header, month_of, parse_sheet, text

# ISIN -> scheme name as parsed (AMFI NAVAll.txt, checked 2026-11-27).
OVERRIDES = {
    **dict.fromkeys(["INF200KB1225", "INF200KB1274", "INF200KB1233", "INF200KB1241", "INF200KB1258", "INF200KB1266"],
                    "SBI Silver ETF Fund of Fund"),
    "INF200KB1217": "SBI Silver ETF",
    "INF200KB1969": "SBI Nifty 1D Rate Liquid ETF - Growth",
    "INF200KA13Z8": "SBI NIFTY 1D Rate Liquid ETF - IDCW",
}
# Sheet spelling -> AMFI's, where a joined or split word ("Smallcap" / "Small Cap", "Nifty 200" / "Nifty200") would
# lose the match or hand it to a sibling scheme (the Midcap 150 ETF to the Midcap 150 Momentum 50 ETF).
_RENAMES = {
    "sbi smallcap fund": "SBI Small Cap Fund",
    "sbi nifty midcap150 etf": "SBI Nifty Midcap 150 ETF",
    "sbi nifty small cap 250 etf": "SBI Nifty Smallcap 250 ETF",
    "sbi nifty 200 value 30 etf": "SBI Nifty200 Value 30 ETF",
}
_AS_ON = re.compile(r"portfolio\s*statement\s*as\s*(on|at)", re.I)
_ERSTWHILE = re.compile(r"\s*\(\s*(erstwhile|formerly)\b[^)]*\)?", re.I)


def _cells(sheet: Sheet, upto: int) -> list[str]:
    return [text(c) for r in sheet.rows[:upto] for c in r if text(c)]


def scheme_name(sheet: Sheet) -> str | None:
    h = find_header(sheet.rows)
    if h is None:
        return None
    cells = _cells(sheet, h.row)
    for i, c in enumerate(cells):
        m = re.match(r"^scheme\s*name\s*:\s*(.*)$", c, re.I)
        if m:
            rest = m.group(1).strip() or (cells[i + 1] if i + 1 < len(cells) else "")
            name = clean_name(_ERSTWHILE.sub("", rest))
            return _RENAMES.get(name.lower(), name) or None
    return None


def _as_of(sheet: Sheet, upto: int) -> str | None:
    cells = _cells(sheet, upto)
    for i, c in enumerate(cells):
        if _AS_ON.search(c):
            for v in (c, cells[i + 1] if i + 1 < len(cells) else ""):
                if m := month_of(v):
                    return m
    return None


def parse(sheets: list[Sheet]) -> list[SchemePortfolio]:
    out: list[SchemePortfolio] = []
    for s in sheets:
        p = parse_sheet(s, scheme_name=scheme_name(s))
        if p is None:
            continue
        h = find_header(s.rows)
        if h is not None and (m := _as_of(s, h.row)):
            p.as_of = m
        out.append(p)
    return out
