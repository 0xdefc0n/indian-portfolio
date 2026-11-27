"""UTI Mutual Fund: every scheme stacked in one sheet ("Sebi Exposure as on <date>.xlsx", sheet `exposure`, inside the
month's zip). Each scheme is a block that opens with `SCHEME CODE017STARTS` and closes with `SCHEME CODE017ENDS`, with
`SCHEME: UTI - Large Cap Fund` and the as-of line above its own header row. Split on the markers and run the standard
parser on each block. A block without its ENDS marker (the sheet cut short) is dropped rather than parsed partially.

Within a block the holdings end at `TOTAL : <scheme name>`; below it come notes and small tables (defaulted securities,
whose "%AGE TO NAV" column sits where the holdings' % column was, but holds "Total Amt Due" in lakhs), so the block
is cut there. Rows without an ISIN named "Net current assets" / "Net receivables" are cash, and gold or silver bullion
is OTHER, whatever section they follow (UTI puts them under "Others" or under the equity heading).
Sheets without markers (the zip's dividend, futures and riskometer workbooks) go to the standard parser as usual.
"""

from __future__ import annotations

import re

from ..excel import Sheet
from ..standard import SchemePortfolio, parse_sheet, text

_MARK = re.compile(r"^scheme\s*code\s*(\w+?)\s*(starts|ends)$", re.I)
_SCHEME = re.compile(r"^scheme\s*:\s*(.+)$", re.I)
_CUT = re.compile(r"^name\s*of\s*the\s*security\b|^\*\s*percentage\s*to\s*nav|^\(a\)\s*details\s*of\s*default", re.I)
_CASH = re.compile(r"net\s*current\s*assets?|net\s*receivables?|net\s*payables?|cash\s*(and|&)\s*cash", re.I)
_BULLION = re.compile(r"\b(gold|silver)\b.*\bbullion\b|\bbullion\b", re.I)


def _first(row: list[object]) -> str:
    return next((text(c) for c in row if text(c)), "")


def _key(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def _block(rows: list[list[object]]) -> list[list[object]]:
    """The block's rows down to (not including) the scheme's grand total, or the first note/sub-table."""
    scheme = next((m.group(1) for r in rows[:10] if (m := _SCHEME.match(_first(r)))), None)
    for i, r in enumerate(rows):
        f = _first(r)
        if i > 5 and _CUT.search(f):
            return rows[:i]
        m = re.match(r"^total\s*:\s*(.+)$", f, re.I)
        if scheme and m and _key(m.group(1)) == _key(scheme):
            return rows[:i]
    return rows


def _fix_types(p: SchemePortfolio) -> SchemePortfolio:
    for r in p.rows:
        if r["isin"] != r["name"][:120]:
            continue  # has a real ISIN
        if _CASH.search(r["name"]):
            r["type"], r["sector"] = "CASH", None
        elif _BULLION.search(r["name"]):
            r["type"], r["sector"] = "OTHER", None
    p.scheme_name = p.scheme_name.rstrip(" .")
    return p


def parse(sheets: list[Sheet]) -> list[SchemePortfolio]:
    out: list[SchemePortfolio] = []
    for s in sheets:
        marks = [(i, m.group(1), m.group(2).lower()) for i, r in enumerate(s.rows) if (m := _MARK.match(_first(r)))]
        if not marks:
            if p := parse_sheet(s):
                out.append(p)
            continue
        start: tuple[int, str] | None = None
        for i, code, kind in marks:
            if kind == "starts":
                start = (i, code)
            elif start and start[1] == code:
                block = Sheet(s.file, f"{s.name}:{code}", _block(s.rows[start[0] + 1 : i]))
                if p := parse_sheet(block):
                    out.append(_fix_types(p))
                start = None
    return out
