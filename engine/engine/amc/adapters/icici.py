"""ICICI Prudential Mutual Fund: a zip of one workbook per scheme (~150), standard SEBI layout.

Each portfolio sheet starts:
    ICICI Prudential Mutual Fund
    ICICI Prudential Flexi Cap Fund
    Portfolio as on Oct 31,2026
    Company/Issuer/Instrument Name | ISIN | Coupon | Industry/Rating | Quantity | Exposure/Market Value(Rs.Lakh) | % to Nav
Fix over the standard parser: ICICI puts the section's subtotal on the section row itself
    Equity & Equity Related Instruments (Not …) |  |  |  |  | 2475726.56 | 0.9754
    Listed / Awaiting Listing On Stock Exchanges |  |  |  |  | 2475726.56 | 0.9754
    TVS Motor Company Ltd. | INE494B01023 | … | 0.1001
so the standard parser takes those rows for holdings (weights add up to ~300%, and the section never changes, which
types the bonds by ISIN as EQUITY). Here an ISIN-less row with a weight is a heading, and its subtotal is blanked before
the standard parser runs, unless it is a cash or bullion line (TREPS, Net Current Assets, Cash Margin, "Gold (995
Purity)") that isn't itself a subtotal. Those labels head sections too ("Reverse Repo" over two REVERSE REPO lines,
"Gold" over the bullion line), so a cash/bullion row counts as a heading when the rows right below it (up to the next
blank row) add up to its weight. "Nil" sections are already non-numeric.
"""

from __future__ import annotations

import re

from ..excel import Sheet
from ..standard import ISIN, SchemePortfolio, find_header, number, parse_sheet, text

# ISIN-less lines that can be holdings, not headings (the standard parser types them CASH / OTHER).
_CASH_LINE = re.compile(r"^(treps|tri[\s-]*party|reverse\s*repo|cblo|net\s*receivables?|net\s*current\s*assets?|net\s*payables?|cash\b|margin)", re.I)
_BULLION = re.compile(r"^(physical\s*)?(gold|silver)\b(?!.*\b(ltd|limited|etf|fund)\b)", re.I)


def _cell(r: list[object], j: int) -> object:
    return r[j] if j < len(r) else None


def _strip_subtotals(sheet: Sheet) -> Sheet:
    h = find_header(sheet.rows)
    if h is None:
        return sheet
    rows = [list(r) for r in sheet.rows]
    body = rows[h.row + 1 :]
    for i, r in enumerate(body):
        label, isin, pct = text(_cell(r, h.name)), text(_cell(r, h.isin)).upper(), number(_cell(r, h.pct))
        if not label or ISIN.match(isin) or pct is None:
            continue
        if _CASH_LINE.search(label) or _BULLION.match(label):
            below: list[float] = []
            for nxt in body[i + 1 :]:
                if not any(text(c) for c in nxt):
                    break
                below.append(number(_cell(nxt, h.pct)) or 0.0)
            if not below or abs(sum(below) - pct) > max(1e-6, abs(pct) * 1e-4):
                continue  # a holding: TREPS, Net Current Assets, the bullion line itself
        r[h.pct] = ""  # a heading with its subtotal ("Total Net Assets" keeps its label and still ends the table)
    return Sheet(file=sheet.file, name=sheet.name, rows=rows)


def parse(sheets: list[Sheet]) -> list[SchemePortfolio]:
    return [p for s in sheets if (p := parse_sheet(_strip_subtotals(s)))]
