"""Mirae Asset Mutual Fund (worker/src/market/amc/mirae.ts): one xlsx per scheme, standard SEBI layout.

The title cell of renamed schemes carries the old name, "Mirae Asset Short Term Fund (Erstwhile known as Mirae Asset
Short Duration Fund)". The old name's words would drag the match score down and could match the wrong scheme, so the
hook drops that tail. Everything else is the standard parser.
"""

from __future__ import annotations

import re

from ..excel import Sheet
from ..standard import find_header, scheme_title

_OLD_NAME = re.compile(r"\s*\(\s*(erstwhile|formerly)\b.*$", re.I)


def scheme_name(sheet: Sheet) -> str | None:
    h = find_header(sheet.rows)
    if h is None:
        return None
    name = scheme_title(sheet.rows, h.row, sheet.name)
    if not name:
        return None
    return _OLD_NAME.sub("", name).strip() or name
