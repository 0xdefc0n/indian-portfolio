"""AMC disclosure parsing and matching (plan §10.3.1, M18). Synthetic workbooks only: built here with openpyxl in
the SEBI layout, so the tests carry no AMC's file. Real files are checked with `python -m engine.amc.cli`."""

from __future__ import annotations

import io
import json
import zipfile
from datetime import datetime

import openpyxl
import pytest
from fastapi.testclient import TestClient

from engine import amc, server
from engine.amc.excel import UnreadableFile, read_sheets
from engine.amc.standard import clean_name, month_of, parse_sheets

KEY = "test-key"


def sheet_rows(scheme: str, *, fraction: bool = False, as_on: object = "Monthly Portfolio Statement as on October 31, 2026") -> list[list]:
    f = (lambda p: p / 100) if fraction else (lambda p: p)
    return [
        ["SYNTH MUTUAL FUND"],
        [f"{scheme} (An open ended equity scheme investing across large, mid and small cap stocks)"],
        [as_on],
        [],
        ["Name of the Instrument", "ISIN", "Industry / Rating", "Quantity", "Market value (Rs. in Lakhs)", "% to Net Assets"],
        ["Equity & Equity related"],
        ["(a) Listed / awaiting listing on Stock Exchanges"],
        ["Synth Bank Limited", "INE000A01011", "Banks", 1000, 500.0, f(40.0)],
        ["Synth Power Limited", "INE000B01012", "Power", 2000, 300.0, f(20.0)],
        ["Sub Total", "", "", "", 800.0, f(60.0)],
        ["Foreign Securities and /or overseas ETF"],
        ["Synth Inc", "US0000000001", "Software", 10, 100.0, f(10.0)],
        ["Derivatives"],
        ["Synth Index Futures", "", "", "", -50.0, f(-5.0)],
        ["Debt Instruments"],
        ["7.1% Synth Bank NCD", "INE000A08013", "CRISIL AAA", 10, 100.0, f(10.0)],
        ["Mutual Fund Units"],
        ["Synth Liquid Fund - Direct Plan - Growth", "INF000A01AA1", "", 5, 50.0, f(5.0)],
        ["Treps / Reverse Repo"],
        ["TREPS 03-Nov-2026", "", "", "", 120.0, f(12.0)],
        ["Net Receivables / (Payables)", "", "", "", 30.0, f(3.0)],
        ["GRAND TOTAL (AUM)", "", "", "", 1000.0, f(100.0)],
        ["Synth after the end", "INE000C01013", "Banks", 1, 1.0, f(99.0)],
    ]


def workbook(sheets: dict[str, list[list]]) -> bytes:
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for name, rows in sheets.items():
        ws = wb.create_sheet(name)
        for r in rows:
            ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


FLEXI = "Synth Flexi Cap Fund"
LARGE = "Synth Large Cap Fund"


@pytest.fixture(scope="module")
def book() -> bytes:
    return workbook({"SFCF": sheet_rows(FLEXI), "SLCF": sheet_rows(LARGE, fraction=True), "Index": [["Scheme index"], ["SFCF", FLEXI]]})


def test_standard_layout(book):
    ps = parse_sheets(read_sheets(book, "synth.xlsx"))
    assert [p.scheme_name for p in ps] == [FLEXI, LARGE]  # the index sheet isn't a portfolio
    p = ps[0]
    assert p.as_of == "2026-10"
    by = {r["name"]: r for r in p.rows}
    assert by["Synth Bank Limited"] == {"isin": "INE000A01011", "symbol": None, "name": "Synth Bank Limited", "sector": "Banks", "type": "EQUITY", "pct": 40.0}
    assert by["Synth Inc"]["type"] == "FOREIGN_EQUITY"
    assert by["7.1% Synth Bank NCD"]["type"] == "DEBT" and by["7.1% Synth Bank NCD"]["sector"] is None  # INE, but a bond; a rating isn't a sector
    assert by["Synth Liquid Fund - Direct Plan - Growth"]["type"] == "MUTUAL_FUND_UNIT"
    assert by["TREPS 03-Nov-2026"]["type"] == "CASH" and by["TREPS 03-Nov-2026"]["isin"] == "TREPS 03-Nov-2026"
    assert by["Net Receivables / (Payables)"]["type"] == "CASH"
    assert "Sub Total" not in by and "Synth Index Futures" not in by and "Synth after the end" not in by
    assert round(sum(r["pct"] for r in p.rows), 4) == 100.0


def test_fractions_are_scaled(book):
    p = parse_sheets(read_sheets(book, "synth.xlsx"))[1]
    assert {r["name"]: r["pct"] for r in p.rows}["Synth Bank Limited"] == 40.0
    assert round(sum(r["pct"] for r in p.rows), 4) == 100.0


def test_format_comes_from_the_bytes(book):
    assert len(read_sheets(book, "named-wrong.xls")) == 3  # an xlsx called .xls (PPFAS does this)
    with pytest.raises(UnreadableFile):
        read_sheets(b"<html><title>Just a moment...</title></html>", "x.xlsx")
    with pytest.raises(UnreadableFile):
        read_sheets(b"%PDF-1.7", "x.xls")


def test_zip_of_workbooks(book):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("Oct 2026/SFCF.xlsx", workbook({"SFCF": sheet_rows(FLEXI)}))
        z.writestr("Oct 2026/SLCF.xlsx", workbook({"SLCF": sheet_rows(LARGE)}))
        z.writestr("readme.txt", "not a workbook")
        z.writestr("__MACOSX/Oct 2026/._SFCF.xlsx", b"junk")
    assert [p.scheme_name for p in parse_sheets(read_sheets(buf.getvalue(), "oct.zip"))] == [FLEXI, LARGE]


def test_scheme_name_label_and_date_cell():
    rows = sheet_rows("x")
    rows[1] = ["SCHEME NAME :", "Synth Midcap Fund"]
    rows[2] = ["Portfolio as on", datetime(2026, 9, 30)]
    p = parse_sheets([read_sheets(workbook({"s": rows}), "s.xlsx")[0]])[0]
    assert (p.scheme_name, p.as_of) == ("Synth Midcap Fund", "2026-09")


@pytest.mark.parametrize(("text", "month"), [
    ("Monthly Portfolio Statement as on October 31, 2026", "2026-10"),
    ("PORTFOLIO STATEMENT AS ON 30-Sep-26", "2026-09"),
    ("as at 31.12.2025", "2025-12"),
    ("Statement date 2026-01-31", "2026-01"),
    ("no date here", None),
])
def test_month_of(text, month):
    assert month_of(text) == month


def test_clean_name():
    assert clean_name("Synth Arbitrage Fund ( An open ended scheme investing in arbitrage)") == "Synth Arbitrage Fund"
    assert clean_name("Synth Value Fund - Monthly Portfolio Statement as on 31 Oct 2026") == "Synth Value Fund"


def test_match_by_name(book):
    ps = amc.parse_portfolios("ppfas", book, "synth.xlsx")
    want = [
        ["INF000X01AA1", "Synth Flexi Cap Fund - Direct Plan - Growth", ""],
        ["INF000X01AB9", "", "Synth Large Cap Fund - Regular Plan - IDCW Payout"],  # AMFI's name only, option words ignored
        ["INF000X01AC7", "Synth Small Cap Fund - Direct Growth", ""],  # not in the file
    ]
    m = amc.match(ps, want)
    assert set(m) == {"INF000X01AA1", "INF000X01AB9"}
    assert m["INF000X01AA1"]["scheme_name"] == FLEXI and m["INF000X01AA1"]["score"] == 1.0 and m["INF000X01AA1"]["as_of"] == "2026-10"


def test_a_tie_is_no_match_and_overrides_win(book):
    ps = amc.parse_portfolios("ppfas", book, "synth.xlsx")
    want = [["INF000X01AD5", "Synth Cap Fund", ""]]  # scores the same against both schemes
    assert amc.match(ps, want) == {}
    assert amc.match(ps, want, {"INF000X01AD5": LARGE})["INF000X01AD5"]["scheme_name"] == LARGE


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("ENGINE_SHARED_SECRET", KEY)
    return TestClient(server.app)


def _post(client, slug: str, want: list, content: bytes, **headers):
    head = json.dumps(want).encode()
    h = {"X-Engine-Key": KEY, "X-Amc": slug, "X-Want-Bytes": str(len(head)), "X-Filename": "synth.xlsx", **headers}
    return client.post("/stocks/parse", content=head + content, headers=h)


def test_stocks_parse_route(client, book):
    res = _post(client, "ppfas", [["INF000X01AA1", "Synth Flexi Cap Fund - Direct Plan - Growth"]], book)
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] and body["schemes"] == 2 and body["months"] == ["2026-10"]
    assert list(body["matched"]) == ["INF000X01AA1"] and len(body["matched"]["INF000X01AA1"]["rows"]) == 7


def test_stocks_parse_refusals(client, book):
    assert _post(client, "nope", [], book).status_code == 400  # unknown adapter
    assert _post(client, "ppfas", [], book, **{"X-Want-Bytes": "x"}).status_code == 400
    assert _post(client, "ppfas", {"not": "a list"}, book).status_code == 400
    res = _post(client, "ppfas", [], b"<html>error page</html>")
    assert res.status_code == 422 and res.json()["code"] == "unreadable"
    assert client.post("/stocks/parse", content=b"x", headers={"X-Engine-Key": "wrong"}).status_code == 401


def test_layout_quirks_found_on_real_files():
    """Each found on a real disclosure (M18): a date in the scheme name, a sheet code before the name, bullion,
    cash under an 'Others' heading, a negative net payable, and a sheet longer than a few thousand rows."""
    rows = [
        ["SGILT36", "Synth Gilt Index - June 2036 Fund"],  # ABSL/SBI: the code first; the name carries a date
        ["Portfolio Statement as on October 31, 2026"],
        ["Name of the Instrument", "ISIN", "Rating", "% to NAV"],
        ["Debt Instruments"],
        ["7.1% GOI 2036", "IN0020260001", "SOV", 90.0],
        ["Gold", "IDIA00500001", "", 5.0],  # bullion, no section of its own
        ["Others"],
        ["Net Current Assets", "", "", 7.0],
        ["Net Receivables / (Payables)", "", "", -2.0],
    ] + [["", "", "", ""]] * 6_000 + [["Grand Total", "", "", 100.0]]
    p = parse_sheets(read_sheets(workbook({"SGILT36": rows}), "s.xlsx"))[0]
    assert (p.scheme_name, p.as_of) == ("Synth Gilt Index - June 2036 Fund", "2026-10")
    types = {r["name"]: (r["type"], r["pct"]) for r in p.rows}
    assert types == {"7.1% GOI 2036": ("DEBT", 90.0), "Gold": ("OTHER", 5.0), "Net Current Assets": ("CASH", 7.0), "Net Receivables / (Payables)": ("CASH", -2.0)}
    assert round(sum(r["pct"] for r in p.rows), 4) == 100.0


def test_fund_of_fund_singular_does_not_tie_with_its_etf():
    name = "Synth Silver ETF Fund of Fund - Direct Plan - Growth"
    assert amc.name_score(name, "Synth Silver ETF Fund of Fund") == 1.0
    assert amc.name_score(name, "Synth Silver ETF") < 1.0  # no tie: the fund of funds wins
