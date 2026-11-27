"""AMC monthly portfolio disclosures: parse a file and match its schemes to the funds we track (plan §10.3.1, M18).

The Worker finds and downloads the files (worker/src/market/amc/<slug>.ts) and sends each one here as raw bytes
with the funds it wants from that AMC. The engine never calls out. This module:
  1. reads the workbook (excel.py: xls, xlsx, xlsb or a zip of them, in memory);
  2. turns each sheet into a scheme portfolio, with the standard SEBI layout parser (standard.py) unless the AMC's
     adapter module (adapters/<slug>.py) says otherwise;
  3. matches each wanted ISIN to one scheme by name: the token matcher of stocks.py over the fund's display name and
     AMFI's scheme name, plan words and option words ignored, best score ≥ MATCH_SCORE, and a tie is no match. An
     adapter's OVERRIDES map {isin: scheme name in the file} wins over the score.

An adapter module may define (all optional):
    OVERRIDES: dict[str, str]                               # isin -> scheme name exactly as parsed from the file
    def scheme_name(sheet: Sheet) -> str | None              # the scheme's name, when the standard title search fails
    def parse(sheets: list[Sheet]) -> list[SchemePortfolio]  # a whole custom parser
Public market data only: scheme names and holdings that AMCs publish. Nothing here sees user data.
"""

from __future__ import annotations

import importlib
import re
from types import ModuleType

from .. import stocks
from .excel import Sheet, UnreadableFile, read_sheets
from .standard import SchemePortfolio, parse_sheet

__all__ = ["SLUGS", "UnreadableFile", "match", "parse_file", "parse_portfolios"]

# The adapters that exist (worker/src/market/amc/index.ts has the same list). Rollout step 2: the 10 largest AMCs.
SLUGS = ("sbi", "icici", "hdfc", "nippon", "kotak", "axis", "uti", "absl", "mirae", "ppfas")
MATCH_SCORE = 0.6
_SLUG = re.compile(r"^[a-z][a-z0-9_]{1,30}$")
# Words that tell a plan or an option apart, never a scheme: AMFI names carry them, disclosure sheets don't.
_OPTION_WORDS = {"idcw", "dividend", "payout", "reinvestment", "reinvest", "bonus", "transfer", "sweep", "institutional",
                 "retail", "super", "premium", "daily", "weekly", "fortnightly", "quarterly", "half", "yearly", "annual",
                 "periodic"}
_OPTION_TAIL = re.compile(r"\s*[-–(]\s*(direct|regular|growth|idcw|dividend|bonus|payout|institutional|retail)\b.*$", re.I)


def adapter(slug: str) -> ModuleType | None:
    if slug not in SLUGS or not _SLUG.match(slug):
        return None
    try:
        return importlib.import_module(f"{__name__}.adapters.{slug}")
    except ModuleNotFoundError:
        return None


def parse_portfolios(slug: str, content: bytes, filename: str) -> list[SchemePortfolio]:
    sheets = read_sheets(content, filename)
    mod = adapter(slug)
    if mod is not None and hasattr(mod, "parse"):
        return list(mod.parse(sheets))
    name_hook = getattr(mod, "scheme_name", None) if mod else None
    out: list[SchemePortfolio] = []
    for s in sheets:
        p = parse_sheet(s, scheme_name=name_hook(s) if name_hook else None)
        if p:
            out.append(p)
    return out


_FOF = re.compile(r"\bfund\s+of\s+fund\b(?!s)", re.I)


def _tokens(name: str) -> set[str]:
    # "Fund of Fund" (singular, SBI) must read as a fund of funds too, or it ties with the ETF it invests in.
    return stocks._tokens(_FOF.sub("fund of funds", _OPTION_TAIL.sub("", name))) - _OPTION_WORDS


def name_score(a: str, b: str) -> float:
    ta, tb = _tokens(a), _tokens(b)
    return len(ta & tb) / len(ta | tb) if ta and tb else 0.0


def match(portfolios: list[SchemePortfolio], want: list[list[str]], overrides: dict[str, str] | None = None) -> dict[str, dict]:
    """{isin: {scheme_name, score, as_of, rows}} for each wanted [isin, name, amfi_name?] that one scheme matches."""
    overrides = overrides or {}
    by_name: dict[str, SchemePortfolio] = {}
    for p in portfolios:  # the same scheme twice (a sheet repeated): keep the one with more rows
        if p.scheme_name not in by_name or len(p.rows) > len(by_name[p.scheme_name].rows):
            by_name[p.scheme_name] = p
    out: dict[str, dict] = {}
    for w in want:
        isin, names = w[0], [n for n in w[1:3] if isinstance(n, str) and n.strip()]
        best: SchemePortfolio | None = None
        best_score, tie = 0.0, False
        if isin in overrides:
            best, best_score = by_name.get(overrides[isin]), 1.0
        else:
            for p in by_name.values():
                s = max((name_score(n, p.scheme_name) for n in names), default=0.0)
                if s > best_score + 1e-9:
                    best, best_score, tie = p, s, False
                elif abs(s - best_score) <= 1e-9 and s > 0:
                    tie = True
        if best is None or best_score < MATCH_SCORE or tie:
            continue
        out[isin] = {"scheme_name": best.scheme_name, "score": round(best_score, 2), "as_of": best.as_of, "rows": best.rows}
    return out


def parse_file(slug: str, content: bytes, filename: str, want: list[list[str]]) -> dict:
    """The /stocks/parse result: counts plus the matched funds' rows. Raises UnreadableFile."""
    portfolios = parse_portfolios(slug, content, filename)
    mod = adapter(slug)
    matched = match(portfolios, want, getattr(mod, "OVERRIDES", None) if mod else None)
    months = sorted({p.as_of for p in portfolios if p.as_of})
    return {"ok": True, "schemes": len(portfolios), "months": months, "matched": matched}
