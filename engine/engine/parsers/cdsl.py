"""Parser for the CDSL Consolidated Account Statement (eCAS) PDF.

The CDSL eCAS is bilingual (Hindi overlaid on English), which garbles plain text
extraction. Table extraction is clean, so we:
  1. pull every table with pdfplumber,
  2. strip non-ASCII characters (the Hindi overlay),
  3. classify each table by its header keywords / row shape,
  4. attach holdings & transactions to the demat account whose section header
     ("DP Name : ... BO ID : ...") appears above the table on the page.

Covers: account summary, monthly valuation history, holdings, transactions,
pledge/pending rows. Mutual fund folios held outside demat (CAMS/KFin SOA
section) are detected but not yet parsed: no sample statement has one so far.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from datetime import datetime
from io import BytesIO

import pdfplumber

ISIN_RE = re.compile(r"^IN[A-Z0-9]{10}$")
DATE_RE = re.compile(r"^\d{2}-\d{2}-\d{4}$")
# Hindi lines sit between 'FROM <date>' and 'TO <date>', so match up to a bounded gap.
PERIOD_RE = re.compile(r"PERIOD FROM (\d{2}-\d{2}-\d{4}).{0,300}?\bTO (\d{2}-\d{2}-\d{4})", re.S)
CAS_ID_RE = re.compile(r"CAS ID:\s*(\w+)")
PAN_NAME_RE = re.compile(r"In the single name of\s+(.+?)\s*\(\s*PAN\s*:\s*([A-Z]{5}\d{4}[A-Z])\s*\)")
DP_ROW_RE = re.compile(r"^(?P<dp>.+?)\s+DP Id:\s*(?P<dp_id>\w+)\s+Client Id\s*:\s*(?P<client>\w+)")
MONTH_RE = re.compile(r"^[A-Z][a-z]{2} \d{4}$")


class CASParseError(Exception):
    """A statement that can't be parsed, with a stable machine-readable code.

    code: wrong_password | unrecognised | multi_pan | too_large | parse_error.
    Messages are safe to show to the user and never contain statement data.
    """

    def __init__(self, message: str, code: str = "parse_error"):
        super().__init__(message)
        self.code = code


# ---------------------------------------------------------------- helpers

def _ascii(s: str | None) -> str:
    if not s:
        return ""
    s = "".join(c for c in s if c.isascii())
    return re.sub(r"\s+", " ", s).strip()


def _squash(s: str | None) -> str:
    """Header text -> lowercase letters only, for keyword matching."""
    return re.sub(r"[^a-z]", "", _ascii(s).lower())


def _num(s: str | None) -> float | None:
    """'1,67,461.39' -> 167461.39 ; '--', '-', '' -> None ; '- 39.9040' -> 39.904"""
    s = _ascii(s).replace(",", "")
    if s in ("", "-", "--"):
        return None
    if re.fullmatch(r"-?\d+(?:\.\d+)?", s):  # a real (possibly negative) number
        return float(s)
    # Cells bleeding into each other ("- 39.9040", "--1502.745"): the dashes are
    # an empty neighbour cell, not a minus sign. Take the last unsigned number.
    m = re.findall(r"\d+(?:\.\d+)?", s)
    return float(m[-1]) if m else None


def _date(s: str) -> str:
    return datetime.strptime(s, "%d-%m-%Y").date().isoformat()


def _undouble(s: str) -> str:
    """CDSL renders section headers twice, interleaved: '11220088' -> '1208'."""
    return s[::2] if len(s) % 2 == 0 and s[::2] == s[1::2] else s


def _clean_security(raw: str) -> tuple[str, str]:
    """'HDFC AMC LTD#HDFC MF- HDFC NIFTY ... FUND-DIRECT- GROWTH'
    -> ('HDFC AMC LTD', 'HDFC NIFTY ... FUND-DIRECT-GROWTH')"""
    raw = _ascii(raw)
    raw = re.sub(r"\s*-\s*", "-", raw)  # 'FUND- DIRECT' -> 'FUND-DIRECT'
    issuer, _, name = raw.partition("#")
    if not name:
        return "", raw
    # drop the 'XYZ MF-' prefix CDSL puts before the scheme name
    name = re.sub(r"^.*?\bMF-", "", name, count=1).strip() or name
    return issuer.strip(), name


def _asset_type(isin: str) -> str:
    if isin.startswith("INF"):
        return "mutual_fund"
    if isin.startswith("INE") or isin.startswith("IN9"):
        return "equity_or_bond"
    return "other"


# ---------------------------------------------------------------- model

@dataclass
class Account:
    depository: str  # CDSL / NSDL
    dp_name: str
    dp_id: str
    client_id: str
    bo_id: str  # CDSL: 16 digits (dp_id + client_id); NSDL: DP ID + client id
    num_isins: int | None
    value: float | None
    # from the "Account Details" page; nominee *names* are never stored
    nominee_registered: bool | None = None
    status: str | None = None
    frozen: bool | None = None


@dataclass
class Holding:
    bo_id: str | None
    isin: str
    amc: str
    name: str
    asset_type: str
    units: float | None  # current balance
    frozen: float | None
    pledged: float | None
    pledge_setup: float | None
    free: float | None
    price: float | None  # NAV / market price on statement date
    value: float | None


@dataclass
class Transaction:
    bo_id: str | None
    isin: str
    amc: str
    name: str
    particulars: str
    date: str
    opening: float | None
    credit: float | None
    debit: float | None
    closing: float | None
    stamp_duty: float | None


@dataclass
class PendingEntry:
    bo_id: str | None
    isin: str
    name: str
    date: str
    description: str


@dataclass
class Statement:
    source: str
    statement_type: str = "CDSL_CAS"
    cas_id: str | None = None
    pan: str | None = None
    holder_name: str | None = None
    period_from: str | None = None
    period_to: str | None = None
    total_value: float | None = None
    accounts: list[Account] = field(default_factory=list)
    holdings: list[Holding] = field(default_factory=list)
    transactions: list[Transaction] = field(default_factory=list)
    pending: list[PendingEntry] = field(default_factory=list)
    valuation_history: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------- parsing

def _section_markers(page) -> list[tuple[float, str]]:
    """(top, bo_id) for each 'DP Name : ... BO ID : xxx' / 'DPID :: xxx' header on the page."""
    marks = []
    # Rendered doubled, e.g. 'BBOO IDID :: 1122008811...' (CDSL) or 'DDPPIIDD :: IINN3300...' (NSDL)
    for m in page.search(r"(?:IDID|IIDD|ID)\s*::?\s*([A-Z0-9]{8,})", regex=True):
        marks.append((m["top"], _undouble(m["groups"][0])))
    return marks


def _classify(rows: list[list[str]]) -> str:
    head = " ".join(_squash(c) for c in rows[0])
    if "accounttype" in head or "accounttype" in " ".join(_squash(c) for r in rows[:3] for c in r):
        return "accounts"
    if "monthyear" in head:
        return "valuation"
    if "currentbal" in head and "freebal" in head:
        return "holdings"
    if "lockin" in head:
        return "pending"
    if "assetclass" in head or "assetscla" in head:
        return "asset_class"
    body = [r for r in rows if r and ISIN_RE.match(_ascii(r[0]))]
    if body and len(body[0]) == 9 and DATE_RE.match(_ascii(body[0][3])):
        return "transactions"
    if body:
        return "unknown_isin_table"
    return "ignore"


def parse_cdsl_cas(data: bytes, password: str) -> Statement:
    """Parse an eCAS from bytes, in memory only. Nothing is written to disk."""
    st = Statement(source="statement.pdf")  # never the upload's file name (it often contains the PAN)
    try:
        pdf = pdfplumber.open(BytesIO(data), password=password)
    except Exception as e:  # pdfminer raises a generic exception on a bad password
        raise CASParseError("Could not open PDF (wrong password?)", "wrong_password") from e

    current_bo: str | None = None
    with pdf:
        first_text = "\n".join(_ascii(pg.extract_text()) for pg in pdf.pages[:2])
        if "CONSOLIDATED ACCOUNT STATEMENT" not in first_text:
            raise CASParseError("Not a CDSL Consolidated Account Statement", "parse_error")
        if m := PERIOD_RE.search(first_text):
            st.period_from, st.period_to = _date(m.group(1)), _date(m.group(2))
        if m := CAS_ID_RE.search(first_text):
            st.cas_id = m.group(1)
        if m := re.search(r"Total Portfolio Value\s+([\d,]+\.\d+)", first_text):
            st.total_value = _num(m.group(1))
        if "Mutual Fund Folios" in first_text and "No MF Folios" not in first_text:
            st.warnings.append("Statement has MF folios held outside demat; that section is not parsed yet.")

        pages_text = []
        for page in pdf.pages:
            raw = page.extract_text() or ""
            pages_text.append("\n".join(_ascii(l) for l in raw.splitlines()))
            text = _ascii(raw)
            if m := PAN_NAME_RE.search(text):
                st.holder_name, st.pan = m.group(1).strip(), m.group(2)

            markers = _section_markers(page)
            for tbl in sorted(page.find_tables(), key=lambda t: t.bbox[1]):
                top = tbl.bbox[1]
                for mtop, bo in markers:  # latest account header above this table
                    if mtop < top:
                        current_bo = bo
                rows = [[c if c is not None else "" for c in r] for r in tbl.extract()]
                if not rows:
                    continue
                kind = _classify(rows)

                if kind == "accounts":
                    for r in rows:
                        acct_type, details = _ascii(r[0]), _ascii(r[1]) if len(r) > 1 else ""
                        dm = DP_ROW_RE.match(details)
                        if not dm or "Demat" not in acct_type:
                            continue
                        dep = "NSDL" if acct_type.startswith("NSDL") else "CDSL"
                        dp_id, client = dm["dp_id"], dm["client"]
                        st.accounts.append(Account(
                            depository=dep, dp_name=dm["dp"].strip(), dp_id=dp_id, client_id=client,
                            bo_id=dp_id + client,
                            num_isins=int(_num(r[2]) or 0) if len(r) > 2 else None,
                            value=_num(r[3]) if len(r) > 3 else None,
                        ))

                elif kind == "valuation":
                    for r in rows[1:]:
                        if MONTH_RE.match(_ascii(r[0])):
                            st.valuation_history.append({"month": _ascii(r[0]), "value": _num(r[1])})

                elif kind == "holdings":
                    for r in rows[1:]:
                        isin = _ascii(r[0])
                        if not ISIN_RE.match(isin) or len(r) < 9:
                            continue
                        amc, name = _clean_security(r[1])
                        st.holdings.append(Holding(
                            bo_id=current_bo, isin=isin, amc=amc, name=name, asset_type=_asset_type(isin),
                            units=_num(r[2]), frozen=_num(r[3]), pledged=_num(r[4]),
                            pledge_setup=_num(r[5]), free=_num(r[6]), price=_num(r[7]), value=_num(r[8]),
                        ))

                elif kind == "transactions":
                    for r in rows:
                        isin = _ascii(r[0])
                        if not ISIN_RE.match(isin) or not DATE_RE.match(_ascii(r[3])):
                            continue
                        amc, name = _clean_security(r[1])
                        st.transactions.append(Transaction(
                            bo_id=current_bo, isin=isin, amc=amc, name=name, particulars=_ascii(r[2]),
                            date=_date(_ascii(r[3])), opening=_num(r[4]), credit=_num(r[5]),
                            debit=_num(r[6]), closing=_num(r[7]), stamp_duty=_num(r[8]),
                        ))

                elif kind == "pending":
                    for r in rows[1:]:
                        isin = _ascii(r[0])
                        if ISIN_RE.match(isin) and DATE_RE.match(_ascii(r[2])):
                            st.pending.append(PendingEntry(
                                bo_id=current_bo, isin=isin, name=_clean_security(r[1])[1],
                                date=_date(_ascii(r[2])), description=_ascii(r[3]),
                            ))

                elif kind == "unknown_isin_table":
                    st.warnings.append(
                        f"Page {page.page_number}: unrecognised table with ISIN rows "
                        f"(header: {_ascii(' | '.join(rows[0]))[:120]})"
                    )

        _account_details(pages_text, st)

    _validate(st)
    return st


ACCT_LINE_RE = re.compile(r"DP ID\s*:\s*(\S+)\s+CLIENT ID\s*:\s*(\S+)")
NOMINEE_RE = re.compile(r"Nominee\s*:\s*(.+?)(?:\s{2,}|\s+(?:BSDA|RGESS|BO Sub|Account Status)\b|$)", re.I)
STATUS_RE = re.compile(r"Account Status\s*:\s*([A-Za-z]+)")
FROZEN_RE = re.compile(r"Frozen Status\s*:\s*(Not Frozen|Frozen|[A-Za-z ]+?)(?:\s{2,}|$)")


def _account_details(pages_text: list[str], st: Statement) -> None:
    """Nominee / status / frozen flags per demat account from the Account Details page."""
    by_bo = {a.bo_id: a for a in st.accounts}
    current = None
    for text in pages_text:
        for line in text.splitlines():
            if m := ACCT_LINE_RE.search(line):
                current = by_bo.get(m.group(1) + m.group(2))
                continue
            if current is None:
                continue
            if m := NOMINEE_RE.search(line):
                current.nominee_registered = "NOT REGISTERED" not in m.group(1).upper()
            if m := STATUS_RE.search(line):
                current.status = m.group(1).title()
            if m := FROZEN_RE.search(line):
                current.frozen = m.group(1).strip().upper() != "NOT FROZEN"


def _validate(st: Statement) -> None:
    for h in st.holdings:
        if h.units is not None and h.price is not None and h.value is not None:
            if abs(h.units * h.price - h.value) > max(1.0, h.value * 0.001):
                st.warnings.append(f"{h.isin}: units x price ({h.units * h.price:,.2f}) != value ({h.value:,.2f})")
        parts = sum(x or 0 for x in (h.frozen, h.pledged, h.pledge_setup, h.free))
        if h.units is not None and abs(parts - h.units) > 0.001:
            st.warnings.append(f"{h.isin}: frozen+pledged+setup+free ({parts}) != current balance ({h.units})")
    if st.total_value is not None:
        total = sum(h.value or 0 for h in st.holdings)
        if abs(total - st.total_value) > 1:
            st.warnings.append(f"Sum of holdings ({total:,.2f}) != statement total ({st.total_value:,.2f})")
    for a in st.accounts:
        n = sum(1 for h in st.holdings if h.bo_id == a.bo_id)
        if a.num_isins is not None and n != a.num_isins:
            st.warnings.append(f"{a.dp_name}: statement says {a.num_isins} ISINs, parsed {n}")
