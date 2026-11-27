"""Broker holdings statements as a source (plan §21.13, D29, M34): parsers on synthetic files, and golden builds.

Fake people, fake client codes and fake shares only. Groww's layout is the owner's file's (no values copied);
Zerodha's and Dhan's come from open-source parsers checked against real exports (§21.13 "As built").
"""

from __future__ import annotations

from datetime import date

import pytest

from engine.parse import parse_broker
from engine.parsers.broker_holdings import parse_holdings
from engine.parsers.tradebook import TradebookError
from engine.portfolio import build_portfolio
from tests.fixtures import synthetic
from tests.test_tradebook import PAN, csv_bytes, encrypt, groww_rows, xlsx

EQ = synthetic.EQ["isin"]          # Synth Industries, in m-alpha's CDSL statement (10 units on 31 Oct 2026)
OTHER = "INE000S02EQ2"             # a share in no statement
ETF = "INF000S03ET3"
TODAY = synthetic.TODAY            # 25 Nov 2026


def groww_holdings(rows: list[list], *, as_on="20-11-2026", name="Gamma Sample Person", code="9876543210") -> bytes:
    return xlsx([["Name", name], ["Unique Client Code", code], [], [f"Holdings statement for stocks as on {as_on}"], [],
                 ["Summary"], ["Invested Value", 1], ["Closing Value", 1], ["Unrealised P&L", 0], [],
                 ["Stock Name", "ISIN", "Quantity", "Average buy price", "Buy value", "Closing price", "Closing value", "Unrealised P&L"],
                 *rows])


def hrow(name, isin, qty, avg, close):
    return [name, isin, qty, avg, qty * avg, close, qty * close, qty * (close - avg)]


# ─── parsers ─────────────────────────────────────────────────────────────────────────────────────────────────

def test_groww_holdings_plain():
    data = groww_holdings([hrow("SYNTH INDUSTRIES LTD", EQ, 10, 120.5, 150), hrow("OTHER SYNTH LTD", OTHER, 4, 50, 55),
                           hrow("SYNTH NIFTY ETF", ETF, 20, 10, 11), ["", "", "", "", "", "", "", ""]])
    st = parse_holdings(data)
    assert (st["broker"], st["holder_name"], st["client_code"], st["as_of"]) == ("groww", "Gamma Sample Person", "9876543210", "2026-11-20")
    assert [(h["isin"], h["qty"], h["avg_price"], h["close"]) for h in st["holdings"]] == [
        (EQ, 10, 120.5, 150), (OTHER, 4, 50, 55), (ETF, 20, 10, 11)]
    assert st["counts"]["holdings"] == 3


def test_groww_encrypted_opens_with_a_candidate_pan_only():
    enc = encrypt(groww_holdings([hrow("SYNTH INDUSTRIES LTD", EQ, 10, 120.5, 150)]), PAN)
    assert parse_broker(enc, ["ZZZZZ9999Z"])["code"] == "wrong_password"
    ok = parse_broker(enc, ["ZZZZZ9999Z", PAN.lower()])  # tried upper-cased too
    assert ok["ok"] and ok["kind"] == "HOLDINGS" and ok["source"] == "groww"
    assert ok["statement"]["holdings"][0]["qty"] == 10


def test_one_upload_tells_a_holdings_statement_from_a_tradebook():
    assert parse_broker(groww_holdings([hrow("SYNTH", EQ, 1, 1, 1)]), [])["kind"] == "HOLDINGS"
    tb = parse_broker(xlsx(groww_rows()), [])
    assert tb["ok"] and tb["kind"] == "TRADEBOOK" and tb["source"] == "groww"
    assert parse_broker(csv_bytes([["a", "b"], [1, 2]]), [])["code"] == "unrecognised"


def test_zerodha_reads_the_equity_sheet_only_and_long_term_is_not_extra():
    import io

    import openpyxl

    header = ["Symbol", "ISIN", "Sector", "Quantity Available", "Quantity Discrepant", "Quantity Long Term",
              "Quantity Pledged (Margin)", "Quantity Pledged (Loan)", "Average Price", "Previous Closing Price",
              "Unrealized P&L", "Unrealized P&L Pct."]
    pre = [["Client ID", "AB1234"], [], ["Equity Holdings Statement as on 2026-11-21"], [], ["Summary", "Invested Value", "Present Value"], [], []]
    wb = openpyxl.Workbook()
    eq = wb.active
    eq.title = "Equity"
    for r in pre + [header, ["SYNTH", EQ, "Industrials", 8, 0, 8, 2, 0, 100.0, 150.0, 0, 0]]:
        eq.append(r)
    mf = wb.create_sheet("Mutual Funds")
    for r in pre + [["Symbol", "ISIN", "Instrument Type", "Quantity Available", "Quantity Discrepant", "Quantity Pledged (Margin)",
                     "Quantity Pledged (Loan)", "Average Price", "Previous Closing Price"], ["SYNTH FUND", "INF000S09MF9", "MF", 3, 0, 0, 0, 10, 11]]:
        mf.append(r)
    comb = wb.create_sheet("Combined")
    for r in pre + [["Asset Type", *header], ["Equity", "SYNTH", EQ, "Industrials", 8, 0, 8, 2, 0, 100.0, 150.0, 0, 0]]:
        comb.append(r)
    out = io.BytesIO()
    wb.save(out)
    st = parse_broker(out.getvalue(), [])
    assert st["ok"] and st["source"] == "zerodha" and st["statement"]["client_code"] == "AB1234"
    assert st["statement"]["as_of"] == "2026-11-21"
    assert [(h["isin"], h["qty"], h["avg_price"], h["name"]) for h in st["statement"]["holdings"]] == [(EQ, 10, 100.0, "SYNTH")]


def test_dhan_has_quantities_but_no_buy_price():
    data = csv_bytes([["Holding summary", "For 22-11-2026"], [], [],
                      ["Scrip Name", "ISIN Code", "Free Holding", "Locked In", "Safe Keep", "MTF Pledge", "Margin Pledge", "CUSA Pledge", "Closing Price", "Valuation"],
                      ["SYNTH INDUSTRIES", EQ, 6, 0, 0, 1, 0, 0, 150, 1050],
                      ["Valuation", "", "", "", "", "", "", "", "", 1050], ["Total Number of Securities", 1]])
    st = parse_holdings(data)
    assert (st["broker"], st["as_of"]) == ("dhan", "2026-11-22")
    assert [(h["isin"], h["qty"], h["avg_price"]) for h in st["holdings"]] == [(EQ, 7, None)]


def test_files_with_no_holdings_header_are_refused():
    with pytest.raises(TradebookError) as e:
        parse_holdings(csv_bytes([["Stock Name", "Quantity"], ["X", 1]]))
    assert e.value.code == "unrecognised"


# ─── golden builds (worked out by hand) ──────────────────────────────────────────────────────────────────────

def bfile(member, holdings, *, as_of="2026-11-20", account="acct-1", broker="groww", holder=None):
    return {"member_id": member, "broker": broker, "broker_name": broker.title(), "account": account, "as_of": as_of,
            "holder_name": holder, "holdings": [{"isin": i, "name": n, "qty": q, "avg_price": a, "close": c} for i, n, q, a, c in holdings]}


def build(statements, broker, *, trades=None, members=None, market=None):
    return build_portfolio(statements, market or synthetic.market(), TODAY, trades=trades, broker_holdings=broker, members_in=members)


def holding(snap, member, isin):
    return next(h for h in snap["holdings"] if h["member_id"] == member and h["isin"] == isin)


def test_broker_file_only_value_invested_returns_and_no_xirr():
    snap = build([], [bfile("m-new", [(EQ, "SYNTH INDUSTRIES LTD", 10, 120.0, 140.0), (OTHER, "OTHER SYNTH LTD", 4, 50.0, 55.0)],
                            holder="GAMMA SAMPLE PERSON")])
    [m] = snap["members"]
    assert (m["id"], m["name"], m["pan"]) == ("m-new", "Gamma Sample Person", "")
    eq = holding(snap, "m-new", EQ)
    # valued at the latest exchange close (M20); invested from the average; no buy dates, so no XIRR or tax lots
    close = synthetic.market()["prices"][EQ][-1][1]
    assert eq["units"] == 10 and eq["value"] == round(10 * close, 2) and eq["price_source"] == "exchange"
    assert eq["invested"] == 1200.0 and eq["avg_price"] == 120.0 and eq["cost_source"] == "broker"
    assert eq["cashflows"] is None and eq["tax"] is None
    other = holding(snap, "m-new", OTHER)  # no exchange series yet: the file's closing price
    assert (other["value"], other["invested"], other["price_source"]) == (220.0, 200.0, "statement")
    assert m["total"] == round(eq["value"] + other["value"], 2)
    assert "Groww" in m["sources"]


def test_cdsl_quantity_wins_and_the_broker_file_gives_the_price_only():
    snap = build(synthetic.statements(), [bfile("m-alpha", [(EQ, "SYNTH INDUSTRIES LTD", 6, 100.0, 140.0)], as_of="2026-10-15")])
    eq = holding(snap, "m-alpha", EQ)
    # CDSL says 10; the file covers 6 of them at ₹100 and the other 4 have no price: cost unknown for 4, no double count
    assert eq["units"] == 10 and eq["cost_source"] == "partial" and eq["unknown_units"] == 4
    assert [h["isin"] for h in snap["holdings"] if h["member_id"] == "m-alpha"].count(EQ) == 1
    snap = build(synthetic.statements(), [bfile("m-alpha", [(EQ, "SYNTH INDUSTRIES LTD", 10, 100.0, 140.0)], as_of="2026-10-15")])
    eq = holding(snap, "m-alpha", EQ)
    assert (eq["units"], eq["cost_source"], eq["invested"], eq["cashflows"]) == (10, "broker", 1000.0, None)


def test_two_broker_accounts_add_up_and_their_averages_weigh_by_quantity():
    snap = build([], [bfile("m-new", [(OTHER, "OTHER SYNTH LTD", 4, 50.0, 55.0)], account="groww-1"),
                      bfile("m-new", [(OTHER, "OTHER SYNTH LTD", 6, 60.0, 55.0)], account="zerodha-1", broker="zerodha", as_of="2026-11-21")])
    h = holding(snap, "m-new", OTHER)
    assert h["units"] == 10 and h["invested"] == 4 * 50 + 6 * 60 and h["avg_price"] == 56.0
    assert h["as_of"] == "2026-11-21" and h["broker"] == "Groww, Zerodha"


def test_a_newer_file_from_the_same_account_replaces_the_older_one():
    snap = build([], [bfile("m-new", [(OTHER, "OTHER SYNTH LTD", 4, 50.0, 55.0), (ETF, "SYNTH ETF", 1, 9.0, 10.0)], as_of="2026-10-01"),
                      bfile("m-new", [(OTHER, "OTHER SYNTH LTD", 6, 52.0, 55.0)], as_of="2026-11-20")])
    rows = [h for h in snap["holdings"] if h["member_id"] == "m-new"]
    assert [(h["isin"], h["units"], h["invested"]) for h in rows] == [(OTHER, 6, 312.0)]  # the ETF was sold since


def test_tradebook_lots_beat_the_holdings_average_for_the_shares_they_cover():
    trades = [{"member_id": "m-new", "broker": "zerodha", "trades": [
        {"date": "2025-01-10", "time": None, "symbol": None, "isin": OTHER, "name": None, "side": "buy", "qty": 3, "price": 40.0,
         "exchange": "NSE", "id": "T1"}]}]
    snap = build([], [bfile("m-new", [(OTHER, "OTHER SYNTH LTD", 10, 50.0, 55.0)])], trades=trades)
    h = holding(snap, "m-new", OTHER)
    # 3 from the tradebook at ₹40 (dated), the other 7 at the file's ₹50 (undated): invested known, XIRR isn't
    assert h["units"] == 10 and h["cost_source"] == "tradebook+broker" and h["invested"] == 3 * 40 + 7 * 50
    assert h["cashflows"] is None


def test_a_share_only_in_a_newer_broker_file_gets_a_note_not_a_row():
    snap = build(synthetic.statements(), [bfile("m-alpha", [(EQ, "SYNTH INDUSTRIES LTD", 10, 100.0, 140.0),
                                                           (OTHER, "OTHER SYNTH LTD", 4, 50.0, 55.0)], as_of="2026-11-20")])
    alpha = next(m for m in snap["members"] if m["id"] == "m-alpha")
    assert [(n["isin"], n["as_of"]) for n in alpha["broker_notes"]] == [(OTHER, "2026-11-20")]
    assert not [h for h in snap["holdings"] if h["isin"] == OTHER]
    # an older file than the statement: nothing to say
    snap = build(synthetic.statements(), [bfile("m-alpha", [(OTHER, "OTHER SYNTH LTD", 4, 50.0, 55.0)], as_of="2026-10-01")])
    assert next(m for m in snap["members"] if m["id"] == "m-alpha")["broker_notes"] == []


def test_a_tradebook_alone_shows_what_it_still_holds():
    trades = [{"member_id": "m-tb", "broker": "zerodha", "trades": [
        {"date": "2025-01-10", "time": None, "symbol": None, "isin": OTHER, "name": "OTHER SYNTH LTD", "side": "buy", "qty": 5, "price": 40.0, "exchange": "NSE", "id": "T1"},
        {"date": "2025-06-10", "time": None, "symbol": None, "isin": OTHER, "name": "OTHER SYNTH LTD", "side": "sell", "qty": 2, "price": 60.0, "exchange": "NSE", "id": "T2"},
        {"date": "2025-02-10", "time": None, "symbol": None, "isin": ETF, "name": "SYNTH ETF", "side": "buy", "qty": 1, "price": 9.0, "exchange": "NSE", "id": "T3"},
        {"date": "2025-03-10", "time": None, "symbol": None, "isin": ETF, "name": "SYNTH ETF", "side": "sell", "qty": 1, "price": 9.5, "exchange": "NSE", "id": "T4"}]}]
    snap = build([], [], trades=trades, members=[{"member_id": "m-tb", "name": "Delta"}])
    [m] = snap["members"]
    assert m["name"] == "Delta"
    [h] = [h for h in snap["holdings"] if h["member_id"] == "m-tb"]
    assert (h["isin"], h["units"], h["invested"], h["cost_source"], h["value"]) == (OTHER, 3, 120.0, "tradebook", 180.0)
    assert h["cashflows"] == [["2025-01-10", -120.0]]  # dated lots: XIRR works
    assert m["analysis"]["realised_stocks"]  # the sale counts for tax


def test_market_requirements_include_broker_shares():
    from engine.portfolio import market_requirements

    need = market_requirements([], {}, [bfile("m-new", [(OTHER, "OTHER SYNTH LTD", 4, 50.0, 55.0), (ETF, "SYNTH ETF", 1, 9.0, 10.0)])],
                               today=date(2026, 11, 25))
    assert OTHER in need["price_isins"] and ETF in need["isins_without_code"]
