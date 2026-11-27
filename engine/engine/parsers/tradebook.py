"""Broker tradebook parsers (plan §21.6, M21): CSV or Excel in, delivery equity/ETF trades out.

One profile per broker, picked by the header row (searched for in the first rows, never by filename: Groww and
Angel One files don't name the broker). The preamble rows above it (client name, client code, PAN) are read for the
PAN check only and never returned, except the PAN itself, which the Worker compares with the member's and drops.

Each trade: {date "YYYY-MM-DD", time "HH:MM:SS"|None, symbol|None, isin|None, name|None, side "buy"|"sell",
qty, price (per share, before charges), exchange "NSE"|"BSE"|None, id|None, product|None}.

F&O, currency, commodity and mutual-fund rows, and orders that didn't execute, are skipped and counted. Intraday
(bought and sold the same day) is found later, at build time, across every tradebook of the member (equity.py).

Never logs contents, never writes to disk.
"""

from __future__ import annotations

import csv
import io
import re
import zipfile
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Callable

MAX_ROWS = 100_000
HEADER_SCAN_ROWS = 60
PAN_RE = re.compile(r"\b([A-Z]{5}[0-9]{4}[A-Z])\b")
ISIN_RE = re.compile(r"^IN[A-Z0-9]{10}$")
OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"


class TradebookError(Exception):
    """code: unrecognised (no known broker header) | wrong_password (encrypted, no candidate opened it) | parse_error"""

    def __init__(self, code: str, message: str = ""):
        super().__init__(message or code)
        self.code = code


def norm(h: object) -> str:
    """'Trade Date', 'trade_date', 'Buy Qty.' → 'trade date', 'trade date', 'buy qty'."""
    return re.sub(r"[^a-z0-9]+", " ", str(h or "").lower()).strip()


# ─── reading the file ──────────────────────────────────────────────────────────────────────────────────────────

def looks_like_tradebook(data: bytes) -> bool:
    """Excel (zip or OLE) or text that isn't a PDF. The Worker uses its own copy of this check."""
    if data.startswith(b"%PDF"):
        return False
    if data.startswith(b"PK\x03\x04") or data.startswith(OLE_MAGIC):
        return True
    head = data[:4096]
    return b"\x00" not in head and (b"," in head or b"\t" in head or b";" in head)


def _decrypt(data: bytes, passwords: list[str]) -> bytes:
    import msoffcrypto  # only for encrypted Office files (Groww's reports open with the PAN)

    office = msoffcrypto.OfficeFile(io.BytesIO(data))
    if not office.is_encrypted():
        return data
    for pw in passwords:
        if not pw:
            continue
        try:
            office = msoffcrypto.OfficeFile(io.BytesIO(data))
            office.load_key(password=pw)
            out = io.BytesIO()
            office.decrypt(out)
            return out.getvalue()
        except Exception:  # wrong password (the library raises several classes)
            continue
    raise TradebookError("wrong_password", "This file is password-protected")


def _cell(v: object) -> object:
    if isinstance(v, float) and v.is_integer() and abs(v) < 1e15:
        return v  # keep numbers numeric; text conversion happens per column
    return v


def read_rows(data: bytes, passwords: list[str] | None = None) -> list[list]:
    """Every sheet's rows (first sheet with a known header wins later), as lists of cells."""
    return [row for s in read_sheets(data, passwords) for row in s + [[]]]


def read_sheets(data: bytes, passwords: list[str] | None = None) -> list[list[list]]:
    """Each sheet's rows in workbook order (a CSV is one sheet). Raises TradebookError."""
    if data.startswith(OLE_MAGIC):
        data = _decrypt(data, passwords or [])
    if data.startswith(b"PK\x03\x04") or data.startswith(OLE_MAGIC):
        try:
            from python_calamine import CalamineWorkbook

            wb = CalamineWorkbook.from_filelike(io.BytesIO(data))
            sheets = []
            for name in wb.sheet_names:
                rows = wb.get_sheet_by_name(name).to_python(skip_empty_area=False)
                sheets.append([[_cell(c) for c in r] for r in rows[:MAX_ROWS]])
            return _order_sheets(sheets)
        except (zipfile.BadZipFile, ValueError, OSError, Exception) as e:  # calamine raises its own classes
            if isinstance(e, TradebookError):
                raise
            raise TradebookError("parse_error", "Could not read this workbook") from None
    text = None
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            text = data.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    sample = (text or "")[:4096]
    delim = "\t" if sample.count("\t") > sample.count(",") else (";" if sample.count(";") > sample.count(",") else ",")
    return [[r for r in csv.reader(io.StringIO(text or ""), delimiter=delim)][:MAX_ROWS]]


def _order_sheets(sheets: list[list[list]]) -> list[list[list]]:
    return sheets  # in workbook order; the header search stops at the first known header


# ─── values ────────────────────────────────────────────────────────────────────────────────────────────────────

def num(v: object) -> float | None:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", "").replace("₹", "").replace("Rs.", "").strip()
    if s in ("", "-", "--"):
        return None
    neg = s.startswith("(") and s.endswith(")")
    try:
        x = float(s.strip("()"))
    except ValueError:
        return None
    return -x if neg else x


_MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}


def to_date(v: object, order: str = "dmy") -> tuple[str, str | None] | None:
    """(YYYY-MM-DD, HH:MM:SS|None) from a cell. `order` breaks the tie for numeric d/m dates ('dmy' or 'mdy')."""
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v.date().isoformat(), (v.strftime("%H:%M:%S") if (v.hour or v.minute or v.second) else None)
    if isinstance(v, date):
        return v.isoformat(), None
    if isinstance(v, (int, float)) and 20000 < float(v) < 80000:  # an Excel serial that wasn't typed as a date
        d = datetime(1899, 12, 30) + timedelta(days=float(v))
        return to_date(d)
    s = str(v).strip()
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?", s)
    if m:
        y, mo, d = int(m[1]), int(m[2]), int(m[3])
        t = f"{int(m[4]):02d}:{m[5]}:{m[6] or '00'}" if m[4] else None
        return _ok(y, mo, d, t)
    m = re.match(r"^(\d{1,2})[-/ ]([A-Za-z]{3})[A-Za-z]*[-/ ,]+(\d{2,4})", s)
    if m and m[2].lower() in _MONTHS:
        y = int(m[3]) + (2000 if len(m[3]) == 2 else 0)
        return _ok(y, _MONTHS[m[2].lower()], int(m[1]), _time(s[m.end():]))
    m = re.match(r"^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})", s)
    if m:
        a, b, y = int(m[1]), int(m[2]), int(m[3]) + (2000 if len(m[3]) == 2 else 0)
        d, mo = (b, a) if order == "mdy" else (a, b)
        if mo > 12 and d <= 12:
            d, mo = mo, d
        return _ok(y, mo, d, _time(s[m.end():]))
    return None


def _time(rest: str) -> str | None:
    m = re.search(r"(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?", rest)
    if not m:
        return None
    h = int(m[1])
    if m[4]:
        h = h % 12 + (12 if m[4].lower() == "pm" else 0)
    return f"{h:02d}:{m[2]}:{m[3] or '00'}"


def _ok(y: int, mo: int, d: int, t: str | None) -> tuple[str, str | None] | None:
    try:
        return date(y, mo, d).isoformat(), t
    except ValueError:
        return None


def side_of(v: object) -> str | None:
    s = norm(v)
    if s in ("buy", "b", "bought", "purchase"):
        return "buy"
    if s in ("sell", "s", "sold", "sale"):
        return "sell"
    return None


def exchange_of(v: object) -> str | None:
    s = norm(v)
    if s.startswith("nse") or s == "n":
        return "NSE"
    if s.startswith("bse") or s == "b":
        return "BSE"
    return None


SERIES_SUFFIX = re.compile(r"-(EQ|BE|BZ|SM|ST|XT|E1|IL)$", re.I)


def clean_symbol(v: object) -> str | None:
    s = str(v or "").strip().upper()
    if not s:
        return None
    return SERIES_SUFFIX.sub("", s) or None


def clean_isin(v: object) -> str | None:
    s = str(v or "").strip().upper()
    return s if ISIN_RE.match(s) else None


# ─── broker profiles ───────────────────────────────────────────────────────────────────────────────────────────

Row = dict[str, object]


@dataclass(frozen=True)
class Profile:
    slug: str
    name: str
    required: frozenset[str]          # normalised header names that must all be present
    rows: Callable[[Row, "Counts"], list[dict]]
    date_order: str = "dmy"


class Counts(dict):
    def add(self, key: str, n: int = 1) -> None:
        self[key] = self.get(key, 0) + n


def _trade(r: Row, c: Counts, *, day, side, qty, price, symbol=None, isin=None, name=None, exchange=None, tid=None,
           product=None, order="dmy") -> list[dict]:
    when = to_date(day, order)
    s = side_of(side) if not isinstance(side, str) or side not in ("buy", "sell") else side
    q, p = num(qty), num(price)
    if not when or not s or not q or q <= 0 or p is None or p < 0:
        c.add("bad_rows")
        return []
    sym = clean_symbol(symbol)
    isn = clean_isin(isin)
    nm = str(name).strip() if name else None
    if not (sym or isn or nm):
        c.add("bad_rows")
        return []
    return [{"date": when[0], "time": when[1], "symbol": sym, "isin": isn, "name": nm, "side": s, "qty": round(q, 6),
             "price": round(p, 6), "exchange": exchange_of(exchange), "id": (str(tid).strip() or None) if tid not in (None, "") else None,
             "product": norm(product) or None}]


def _equity_isin(isin: object) -> bool:
    """Shares (INE…) and ETFs (INF…) on the exchange. Bonds and G-secs (IN0…/IN9…) are kept too when listed."""
    i = clean_isin(isin)
    return bool(i)


def _zerodha(r: Row, c: Counts) -> list[dict]:
    seg = norm(r.get("segment"))
    if seg and seg not in ("eq", "equity", "cash"):
        c.add("skipped_fno")
        return []
    if not _equity_isin(r.get("isin")):
        c.add("skipped_other")
        return []
    return _trade(r, c, day=r.get("order execution time") or r.get("trade date"), side=r.get("trade type"), qty=r.get("quantity"),
                  price=r.get("price"), symbol=r.get("symbol"), isin=r.get("isin"), exchange=r.get("exchange"),
                  tid=r.get("trade id"), order="ymd")


def _groww(r: Row, c: Counts) -> list[dict]:
    status = norm(r.get("order status"))
    if status and status not in ("executed", "complete", "completed", "traded"):
        c.add("skipped_not_executed")
        return []
    if not _equity_isin(r.get("isin")):
        c.add("skipped_fno")
        return []
    q, v = num(r.get("quantity")), num(r.get("value"))
    price = (v / q) if q and v is not None else None
    return _trade(r, c, day=r.get("execution date and time"), side=r.get("type"), qty=q, price=price,
                  symbol=r.get("symbol"), isin=r.get("isin"), name=r.get("stock name"), exchange=r.get("exchange"),
                  tid=r.get("exchange order id"))


def _angel(r: Row, c: Counts) -> list[dict]:
    seg = norm(r.get("segment"))
    if seg and seg not in ("capital", "cash", "equity", "eq", "capital market"):
        c.add("skipped_fno")
        return []
    q = num(r.get("quantity"))
    if not q:
        c.add("skipped_other")  # per-order brokerage lines
        return []
    s = side_of(r.get("buy sell"))
    price = r.get("buy price") if s == "buy" else r.get("sell price")
    return _trade(r, c, day=r.get("date"), side=s, qty=q, price=price, symbol=r.get("scrip contract"),
                  exchange=r.get("exchange"), tid=r.get("trade id"), product=r.get("order type"), order="mdy")


FNO_WORDS = re.compile(r"call|put|fut|opt|option|future|cur|com", re.I)


def _upstox(r: Row, c: Counts) -> list[dict]:
    seg, inst, exch = norm(r.get("segment")), norm(r.get("instrument type")), norm(r.get("exchange"))
    if (num(r.get("strike price")) or str(r.get("expiry") or "").strip() not in ("", "-")
            or FNO_WORDS.search(inst) or exch in ("fon", "nfo", "bfo", "mcx", "cds")
            or (seg and seg not in ("eq", "equity", "cash", "capital market"))):
        c.add("skipped_fno")
        return []
    day = r.get("date")
    t = r.get("trade time")
    if t and isinstance(day, str):
        day = f"{day} {t}"
    return _trade(r, c, day=day, side=r.get("side"), qty=r.get("quantity"), price=r.get("price"),
                  symbol=r.get("scrip code"), name=r.get("company"), exchange=r.get("exchange"), tid=r.get("trade num"))


def _icici(r: Row, c: Counts) -> list[dict]:
    seg = norm(r.get("segment") or r.get("exchange segment"))
    if seg and FNO_WORDS.search(seg):
        c.add("skipped_fno")
        return []
    return _trade(r, c, day=r.get("date") or r.get("trade date"), side=r.get("action") or r.get("buy sell"),
                  qty=r.get("qty") or r.get("quantity"), price=r.get("price") or r.get("trade price"),
                  symbol=r.get("stock") or r.get("stock code"), exchange=r.get("exchange"),
                  tid=r.get("order ref") or r.get("trade id"))


def _paytm(r: Row, c: Counts) -> list[dict]:
    if not _equity_isin(r.get("isin")):
        c.add("skipped_other")
        return []
    sym = r.get("script")
    sym = None if re.fullmatch(r"\d+(\.0)?", str(sym or "").strip()) else sym  # a numeric scrip code, not a symbol
    return _trade(r, c, day=r.get("date"), side=r.get("type"), qty=r.get("quantity"), price=r.get("price"),
                  symbol=sym, isin=r.get("isin"), exchange=r.get("exchange"), tid=None if norm(r.get("trade number")) in ("", "0") else r.get("trade number"),
                  product=r.get("product type"))


def _dhan(r: Row, c: Counts) -> list[dict]:
    out = []
    for side, q, v in (("buy", r.get("buy qty"), r.get("buy value")), ("sell", r.get("sell qty"), r.get("sell value"))):
        qty, val = num(q), num(v)
        if qty and qty > 0 and val is not None:
            out += _trade(r, c, day=r.get("date"), side=side, qty=qty, price=abs(val) / qty, name=r.get("scrip name"),
                          symbol=r.get("scrip name") if re.fullmatch(r"[A-Z0-9&\-]+", str(r.get("scrip name") or "").strip()) else None,
                          exchange=r.get("exchange"), tid=f'{r.get("bill no") or ""}:{side}:{norm(r.get("scrip name"))}')
    if not out:
        c.add("skipped_other")
    return out


PROFILES: list[Profile] = [
    # most specific header sets first
    Profile("paytm_money", "Paytm Money", frozenset({"date", "script", "isin", "type", "quantity", "price"}), _paytm),
    Profile("zerodha", "Zerodha", frozenset({"symbol", "isin", "trade date", "trade type", "quantity", "price"}), _zerodha),
    Profile("groww", "Groww", frozenset({"stock name", "isin", "type", "quantity", "value", "execution date and time"}), _groww),
    Profile("angel_one", "Angel One", frozenset({"scrip contract", "buy sell", "buy price", "sell price", "quantity"}), _angel, "mdy"),
    Profile("upstox", "Upstox", frozenset({"date", "company", "scrip code", "side", "quantity", "price"}), _upstox),
    Profile("dhan", "Dhan", frozenset({"date", "scrip name", "buy qty", "buy value", "sell qty", "sell value"}), _dhan),
    Profile("icici_direct", "ICICI Direct", frozenset({"date", "stock", "action", "qty", "price"}), _icici),
]
BROKERS = {p.slug: p.name for p in PROFILES}


def find_header(rows: list[list]) -> tuple[Profile, int, list[str]] | None:
    """The first row (in each sheet's first HEADER_SCAN_ROWS) that matches a profile."""
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


def parse_tradebook(data: bytes, passwords: list[str] | None = None) -> dict:
    """{broker, broker_name, pan, period_from, period_to, trades, counts}. Raises TradebookError."""
    rows = read_rows(data, passwords)
    found = find_header(rows)
    if not found:
        raise TradebookError("unrecognised", "Not a tradebook we know")
    return parse_tradebook_rows(rows, found)


def parse_tradebook_rows(rows: list[list], found: tuple[Profile, int, list[str]]) -> dict:
    """parse_tradebook() on rows already read, with the header found (M34 reads a broker file once for both kinds)."""
    prof, at, names = found
    pans = {m for row in rows[:at] for c in row if c is not None for m in PAN_RE.findall(str(c).upper())}
    counts = Counts()
    trades: list[dict] = []
    blank_run = 0
    for row in rows[at + 1:]:
        if not any(str(c).strip() for c in row if c is not None):
            blank_run += 1
            if blank_run >= 3 and trades:
                break  # the table ended (a summary block may follow)
            continue
        blank_run = 0
        r: Row = {}
        for k, v in zip(names, row):
            if k and k not in r:
                r[k] = v
        if [norm(v) for v in row[: len(names)]] == names:
            continue  # a repeated header
        counts.add("rows")
        trades += prof.rows(r, counts)
    if not trades and counts.get("rows", 0) == 0:
        raise TradebookError("parse_error", "The tradebook has no rows")
    trades.sort(key=lambda t: (t["date"], t["time"] or "", t["side"] != "buy"))
    counts["trades"] = len(trades)
    return {
        "broker": prof.slug,
        "broker_name": prof.name,
        "pan": next(iter(pans)) if len(pans) == 1 else None,
        "period_from": trades[0]["date"] if trades else None,
        "period_to": trades[-1]["date"] if trades else None,
        "trades": trades,
        "counts": dict(counts),
    }
