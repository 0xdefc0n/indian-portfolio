"""Kotak Mahindra Mutual Fund: one workbook per scheme (`<CODE>.xlsx`, one sheet named by the code), standard SEBI layout.

Each sheet starts:
    | | Portfolio of Kotak Flexi Cap Fund as on 31-Oct-2026
    Name of Instrument | | | ISIN Code | Industry | Yield | Quantity | Market Value (Rs.in Lacs) | % to Net Assets
Fix over the standard parser: the name drops the leading "Portfolio of " (the standard title search keeps it, which
dilutes the AMFI name match: "Kotak Flexi Cap Fund" scores 0.75 against "Portfolio of Kotak Flexi Cap Fund").
"""

from __future__ import annotations

import re

from ..excel import Sheet
from ..standard import clean_name, find_header, scheme_title

_PORTFOLIO_OF = re.compile(r"^\s*(monthly\s+)?portfolio\s+(statement\s+)?of\s+(the\s+)?", re.I)


def scheme_name(sheet: Sheet) -> str | None:
    h = find_header(sheet.rows)
    if h is None:
        return None
    name = scheme_title(sheet.rows, h.row, sheet.name)
    if not name:
        return None
    return clean_name(_PORTFOLIO_OF.sub("", name)) or None
