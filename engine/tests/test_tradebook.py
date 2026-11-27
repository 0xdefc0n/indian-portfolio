"""Broker tradebook parsers (plan §21.6, M21) on synthetic files built to each broker's published layout.

Fake people and fake client codes only (`ABCDE1234F`). The formats come from broker help pages and open-source
parsers that document real exports (plan §21.6 "Brokers").
"""

from __future__ import annotations

import io
from datetime import datetime

import openpyxl
import pytest

from engine.parse import parse_trades
from engine.parsers.tradebook import BROKERS, TradebookError, looks_like_tradebook, parse_tradebook, to_date

PAN = "ABCDE1234F"


def xlsx(rows: list[list], sheet: str = "Sheet1") -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = sheet
    for r in rows:
        ws.append(r)
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def csv_bytes(rows: list[list]) -> bytes:
    return ("\n".join(",".join(str(c) for c in r) for r in rows) + "\n").encode()


def zerodha_csv() -> bytes:
    return csv_bytes([
        ["symbol", "isin", "trade_date", "exchange", "segment", "series", "trade_type", "auction", "quantity", "price",
         "trade_id", "order_id", "order_execution_time"],
        ["INFY", "INE009A01021", "2023-04-03", "NSE", "EQ", "EQ", "buy", "false", "10.000000", "1400.500000", "T1", "O1", "2023-04-03T09:20:11"],
        ["INFY", "INE009A01021", "2023-04-03", "NSE", "EQ", "EQ", "buy", "false", "5.000000", "1401.000000", "T2", "O1", "2023-04-03T09:20:12"],
        ["TCS", "INE467B01029", "2024-01-10", "BSE", "EQ", "A", "sell", "false", "2.000000", "3700.000000", "T3", "O2", "2024-01-10T13:01:00"],
        ["NIFTY24JANFUT", "", "2024-01-10", "NFO", "FO", "", "buy", "false", "50", "21500", "T4", "O3", "2024-01-10T13:02:00"],
    ])


def zerodha_xlsx() -> bytes:
    rows = [["Client ID", "AB1234"], [], [], [], ["Tradebook for Equity from 2023-04-01 to 2024-03-31"], [], [], [],
            ["Symbol", "ISIN", "Trade Date", "Exchange", "Segment", "Series", "Trade Type", "Auction", "Quantity", "Price",
             "Trade ID", "Order ID", "Order Execution Time"],
            ["INFY", "INE009A01021", datetime(2023, 4, 3), "NSE", "EQ", "EQ", "buy", "false", 10, 1400.5, "T1", "O1", datetime(2023, 4, 3, 9, 20, 11)]]
    return xlsx(rows)


def groww_rows() -> list[list]:
    return [["Name", "Asha Example"], ["Unique Client Code", "1234567890"], [], ["Order history for stocks from 01-04-2023 to 31-03-2024"], [],
            ["Stock name", "Symbol", "ISIN", "Type", "Quantity", "Value", "Exchange", "Exchange Order Id", "Execution date and time", "Order status"],
            ["INFOSYS LIMITED", "INFY", "INE009A01021", "BUY", 4, 5602.0, "NSE", "1100000001", "03-04-2023 09:20 AM", "Executed"],
            ["TATA CONSULTANCY SERV LT", "TCS", "INE467B01029", "SELL", 1, 3700.0, "NSE", "1100000002", "10-01-2024 01:05 PM", "Executed"],
            ["INFOSYS LIMITED", "INFY", "INE009A01021", "BUY", 1, 1400.0, "NSE", "1100000003", "11-01-2024 10:00 AM", "Cancelled"],
            ["NIFTY 21500 CE", "NIFTY", "", "BUY", 50, 1000.0, "NSE", "1100000004", "11-01-2024 10:00 AM", "Executed"]]


def encrypt(data: bytes, password: str) -> bytes:
    from msoffcrypto.format.ooxml import OOXMLFile

    out = io.BytesIO()
    OOXMLFile(io.BytesIO(data)).encrypt(password, out)
    return out.getvalue()


def angel_xlsx() -> bytes:
    pre = [["ClientCode", "X12345"], ["DateOfDownload", "2024-03-31"], ["StartDate", "2024-01-01"], ["EndDate", "2024-03-31"]]
    pre += [[]] * 28
    header = ["Scrip/Contract", "Buy/Sell", "Buy Price", "Sell Price", "Quantity", "Brokerage", "GST", "STT", "Sebi Tax",
              "Exchange Turnover Charges", "Stamp Duty", "Other Charges", "IPFT Charges", "Order Type", "Segment", "Exchange",
              "Order ID", "Trade ID", "Date"]
    rows = [["INFY-EQ", "Buy", 1500.25, "", 3, 0, 0, 4.5, 0, 0.1, 0.7, 0, 0, "Delivery", "CAPITAL", "NSE", "O1", "A1", datetime(2024, 2, 1)],
            ["INFY-EQ", "Sell", "", 1600, 1, 0, 0, 1.6, 0, 0.05, 0, 0, 0, "Delivery", "CAPITAL", "NSE", "O2", "A2", "3/5/24"],
            ["", "", "", "", 0, 20, 3.6, 0, 0, 0, 0, 0, 0, "", "CAPITAL", "NSE", "O2", "", datetime(2024, 3, 5)],
            ["BANKNIFTY24MAR", "Buy", 100, "", 15, 0, 0, 0, 0, 0, 0, 0, 0, "Carry", "FUTURES", "NFO", "O3", "A3", datetime(2024, 3, 6)]]
    return xlsx(pre + [header] + rows, "TradesAndCharges")


def upstox_xlsx() -> bytes:
    pre = [["UPSTOX SECURITIES PRIVATE LIMITED"], ["UCC", "AB1234"], ["Name", "Asha Example"], ["Report Period", "01-04-2023 to 31-03-2024"],
           ["Generated On", "01-04-2024"], [], [], [], [], []]
    header = ["Date", "Company", "Amount", "Exchange", "Segment", "Scrip Code", "Instrument Type", "Strike Price", "Expiry",
              "Trade Num", "Trade Time", "Side", "Quantity", "Price"]
    rows = [["03-04-2023", "INFOSYS LIMITED", 14005.0, "NSE", "EQ", "INFY", "EQUITY", "", "", "U1", "09:20:11", "Buy", 10, 1400.5],
            ["10-01-2024", "NIFTY", 5000, "FON", "FO", "NIFTY", "European Call", 21500, "25-01-2024", "U2", "10:00:00", "Buy", 50, 100]]
    return xlsx(pre + [header] + rows, "TRADE")


def icici_csv() -> bytes:
    return csv_bytes([
        ["Date", "Stock", "Action", "Qty", "Price", "Trade Value", "Order Ref.", "Settlement", "Segment", "DP Id - Client DP Id", "Exchange",
         "STT", "Transaction and SEBI Turnover charges", "Stamp Duty", "Brokerage + Service Tax"],
        ["03-Apr-2023", "INFTEC", "Buy", "10", "1400.50", "14005", "R1", "2023065", "Rolling", "IN30", "NSE", "14", "0.5", "2", "20"],
    ])


def paytm_xlsx() -> bytes:
    pre = [["UCC", "PM123"], ["Name", "Asha Example"], ["PAN Number", PAN], ["Period", "01-04-2023 to 31-03-2024"]]
    header = ["Date", "Script", "ISIN", "Exchange", "Product Type", "Type", "Quantity", "Price", "Brokerage", "ETT", "GST",
              "STT", "SEBI", "Stamp Duty", "Order Number", "Trade Number", "Trade Time"]
    rows = [["03-04-2023", "INFY", "INE009A01021", "NSE", "Delivery", "Buy", 10, 1400.5, 0, 0, 0, 14, 0, 2, "P1", "PT1", "09:20:11"],
            ["04-04-2023", "500209", "INE009A01021", "BSE", "Delivery", "Buy", 1, 1401, 0, 0, 0, 1, 0, 0, "P2", "0", ""]]
    return xlsx(pre + [header] + rows)


def dhan_csv() -> bytes:
    return csv_bytes([
        ["Date", "Scrip Name", "Exchange", "Bill No.", "Buy Qty.", "Buy Value", "Sell Qty.", "Sell Value", "Brokerage", "GST", "STT",
         "SEBI Fees", "Stamp Duty", "Txn. Charges", "Oth. Charges", "Gross Amount"],
        ["03/04/2023", "INFY", "NSE", "B1", "10", "14005", "0", "0", "0", "0", "14", "0", "2", "0.5", "0", "-14021.5"],
        ["10/01/2024", "TCS", "NSE", "B2", "0", "0", "2", "7400", "0", "0", "7.4", "0", "0", "0.2", "0", "7392.4"],
    ])


def test_zerodha_csv_keeps_equity_fills_and_skips_fno():
    tb = parse_tradebook(zerodha_csv())
    assert tb["broker"] == "zerodha"
    assert [(t["symbol"], t["side"], t["qty"], t["id"]) for t in tb["trades"]] == [
        ("INFY", "buy", 10, "T1"), ("INFY", "buy", 5, "T2"), ("TCS", "sell", 2, "T3")]
    first = tb["trades"][0]
    assert (first["date"], first["time"], first["isin"], first["price"], first["exchange"]) == ("2023-04-03", "09:20:11", "INE009A01021", 1400.5, "NSE")
    assert tb["counts"]["skipped_fno"] == 1 and tb["counts"]["trades"] == 3
    assert (tb["period_from"], tb["period_to"]) == ("2023-04-03", "2024-01-10")
    assert tb["pan"] is None


def test_zerodha_xlsx_header_after_preamble():
    tb = parse_tradebook(zerodha_xlsx())
    assert tb["broker"] == "zerodha" and len(tb["trades"]) == 1
    assert tb["trades"][0]["date"] == "2023-04-03" and tb["trades"][0]["time"] == "09:20:11"


def test_groww_executed_only_price_from_value():
    tb = parse_tradebook(xlsx(groww_rows()))
    assert tb["broker"] == "groww"
    assert [(t["symbol"], t["side"], t["qty"], t["price"]) for t in tb["trades"]] == [("INFY", "buy", 4, 1400.5), ("TCS", "sell", 1, 3700)]
    assert tb["trades"][1]["time"] == "13:05:00"
    assert tb["counts"]["skipped_not_executed"] == 1 and tb["counts"]["skipped_fno"] == 1


def test_groww_encrypted_opens_with_the_pan_only():
    enc = encrypt(xlsx(groww_rows()), PAN)
    assert looks_like_tradebook(enc)
    with pytest.raises(TradebookError) as e:
        parse_tradebook(enc, ["WRONG1234X"])
    assert e.value.code == "wrong_password"
    assert len(parse_tradebook(enc, [PAN])["trades"]) == 2
    # through /parse's function: the Worker sends the member's PAN as the password
    r = parse_trades(enc, PAN)
    assert r["ok"] and r["kind"] == "TRADEBOOK" and r["source"] == "groww"
    assert parse_trades(enc, "")["code"] == "wrong_password"


def test_angel_one_price_by_side_and_brokerage_lines_skipped():
    tb = parse_tradebook(angel_xlsx())
    assert tb["broker"] == "angel_one"
    assert [(t["symbol"], t["side"], t["qty"], t["price"], t["date"]) for t in tb["trades"]] == [
        ("INFY", "buy", 3, 1500.25, "2024-02-01"), ("INFY", "sell", 1, 1600, "2024-03-05")]  # m/d/yy
    assert tb["counts"]["skipped_fno"] == 1 and tb["counts"]["skipped_other"] == 1


def test_upstox_equity_only():
    tb = parse_tradebook(upstox_xlsx())
    assert tb["broker"] == "upstox"
    [t] = tb["trades"]
    assert (t["symbol"], t["name"], t["date"], t["time"], t["isin"]) == ("INFY", "INFOSYS LIMITED", "2023-04-03", "09:20:11", None)
    assert tb["counts"]["skipped_fno"] == 1


def test_icici_direct():
    tb = parse_tradebook(icici_csv())
    assert tb["broker"] == "icici_direct"
    [t] = tb["trades"]
    assert (t["symbol"], t["side"], t["qty"], t["price"], t["date"]) == ("INFTEC", "buy", 10, 1400.5, "2023-04-03")


def test_paytm_money_pan_read_from_preamble_and_numeric_script_dropped():
    tb = parse_tradebook(paytm_xlsx())
    assert tb["broker"] == "paytm_money" and tb["pan"] == PAN
    assert [t["symbol"] for t in tb["trades"]] == ["INFY", None]
    assert all(t["isin"] == "INE009A01021" for t in tb["trades"])
    assert [t["id"] for t in tb["trades"]] == ["PT1", None]  # trade number 0 isn't an id


def test_dhan_daily_totals_become_trades():
    tb = parse_tradebook(dhan_csv())
    assert tb["broker"] == "dhan"
    assert [(t["name"], t["side"], t["qty"], t["price"]) for t in tb["trades"]] == [("INFY", "buy", 10, 1400.5), ("TCS", "sell", 2, 3700)]


def test_every_broker_has_a_fixture():
    files = {"zerodha": zerodha_csv(), "groww": xlsx(groww_rows()), "angel_one": angel_xlsx(), "upstox": upstox_xlsx(),
             "icici_direct": icici_csv(), "paytm_money": paytm_xlsx(), "dhan": dhan_csv()}
    assert set(files) == set(BROKERS)
    for slug, data in files.items():
        assert looks_like_tradebook(data)
        assert parse_tradebook(data)["broker"] == slug


def test_unknown_files_are_refused():
    with pytest.raises(TradebookError) as e:
        parse_tradebook(csv_bytes([["a", "b"], ["1", "2"]]))
    assert e.value.code == "unrecognised"
    assert not looks_like_tradebook(b"%PDF-1.7 ...")
    assert parse_trades(b"garbage,\x00\x01", "")["ok"] is False


@pytest.mark.parametrize("cell,order,want", [
    ("2023-04-03", "dmy", ("2023-04-03", None)),
    ("03-04-2023 09:20 AM", "dmy", ("2023-04-03", "09:20:00")),
    ("10-01-2024 01:05 PM", "dmy", ("2024-01-10", "13:05:00")),
    ("03-Apr-2023", "dmy", ("2023-04-03", None)),
    ("3/5/24", "mdy", ("2024-03-05", None)),
    ("13/05/2024", "mdy", ("2024-05-13", None)),
    (45000, "dmy", ("2023-03-15", None)),
])
def test_dates(cell, order, want):
    assert to_date(cell, order) == want
