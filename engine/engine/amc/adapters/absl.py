"""Aditya Birla Sun Life MF (worker/src/market/amc/absl.ts): one zip with one .xls, one sheet per scheme.

Each sheet starts:
    row 0: <sheet code, e.g. NIFTY> | ADITYA BIRLA SUN LIFE NIFTY 50 INDEX FUND (FORMERLY KNOWN AS …)
    row 1: An open ended scheme tracking Nifty 50 index
    row 2: Portfolio Statement as on October 31, 2026
    row 3: the standard header (% to AUM as fractions)
The standard title search trips on three things here, so this module names the scheme and dates the sheet itself:
  - the sheet code comes first and can look fund-like ("NIFTY"), so it would win over the real name;
  - names without a fund word ("… BAL BHAVISHYA YOJNA") are skipped, and the sheet is dropped;
  - target-maturity names ("… NIFTY SDL APR 2027 INDEX FUND") carry a month, which the standard parser takes as the
    as-of month before it reaches "Portfolio Statement as on …".
Names also carry "(FORMERLY KNOWN AS …)", which AMFI's names don't.
"""

from __future__ import annotations

import re

from ..excel import Sheet
from ..standard import SchemePortfolio, clean_name, find_header, month_of, parse_sheet, text

_FORMERLY = re.compile(r"\s*\(?\s*\bformerly\s+(known\s+as\s+)?.*$", re.I)
_AS_ON = re.compile(r"\bas\s*(on|at|of)\b", re.I)
_SKIP = re.compile(r"^\(?an?\s+(open|close|interval)|portfolio\s*statement|^as\s*(on|at)\b", re.I)


def _above_header(sheet: Sheet) -> list[str]:
    h = find_header(sheet.rows)
    if h is None:
        return []
    return [c for r in sheet.rows[: h.row] for c in (text(x) for x in r) if c]


def scheme_name(sheet: Sheet) -> str | None:
    """The first title cell above the header that isn't the sheet code, a scheme description or the date line."""
    for c in _above_header(sheet):
        if c.upper() == sheet.name.strip().upper() or _SKIP.search(c) or len(c) > 250:
            continue
        name = clean_name(_FORMERLY.sub("", c))
        if len(name) >= 4:
            return name
    return None


def _as_of(sheet: Sheet) -> str | None:
    cells = _above_header(sheet)
    return next((m for c in cells if _AS_ON.search(c) and (m := month_of(c))), None)


def parse(sheets: list[Sheet]) -> list[SchemePortfolio]:
    out: list[SchemePortfolio] = []
    for s in sheets:
        p = parse_sheet(s, scheme_name=scheme_name(s))
        if p is None:
            continue
        p.as_of = _as_of(s) or p.as_of
        out.append(p)
    return out
