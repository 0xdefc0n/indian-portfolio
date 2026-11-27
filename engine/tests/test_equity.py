"""Stock gains: buy prices and corporate actions (plan §21.6, M21). Golden cases worked out by hand."""

from __future__ import annotations

from datetime import date

import pytest

from engine import equity
from engine.analysis import fin_year, member_analysis
from engine.portfolio import build_portfolio
from tests.fixtures import synthetic

ISIN = "INE000S01EQ1"
OLD_ISIN = "INE000S01EQ0"  # before a split changed it
SYM = "SYNTH"
SYMBOLS = [{"symbol": SYM, "isin": ISIN, "name": "Synth Industries Limited"}]


def t(day, side, qty, price, **kw):
    return {"date": day, "time": None, "symbol": SYM, "isin": ISIN, "name": None, "side": side, "qty": qty, "price": price,
            "exchange": "NSE", "id": kw.pop("id", f"{day}-{side}-{qty}"), **kw}


def act(day, kind, num=None, den=None, amount=None):
    return {"symbol": SYM, "isin": ISIN, "ex_date": day, "kind": kind, "num": num, "den": den, "amount": amount, "subject": kind}


def held(units, as_of, isin=ISIN):
    return {"isin": isin, "raw_name": "SYNTH INDUSTRIES LIMITED", "asset_type": "equity_or_bond", "units": units,
            "as_of": as_of, "nav": 150.0, "value": units * 150.0}


def run(holdings, trades, actions=(), costs=None, today=date(2024, 3, 1), close=150.0, fmv=None, first_seen=None):
    mk = equity.Market.from_data(list(actions), SYMBOLS, fmv)
    return equity.member_stocks(holdings, trades, costs or {}, mk, first_seen or {}, today,
                                {h["isin"]: (today.isoformat(), close) for h in holdings})


def gains(res):
    return [(g["date"], g["long_term"], g["cost"], g["sale"], g["gain"]) for g in res["realised"]]


def test_fifo_with_a_split_and_a_bonus():
    trades = [t("2020-01-10", "buy", 10, 100), t("2021-06-01", "buy", 10, 200), t("2023-06-01", "sell", 30, 150),
              t("2023-09-01", "sell", 25, 150), t("2023-10-01", "buy", 5, 160)]
    actions = [act("2022-01-03", "split", 2, 1), act("2023-03-01", "bonus", 1, 1)]
    res = run([held(30, "2024-01-31")], trades, actions)
    # split: 20 @ ₹1,000 + 20 @ ₹2,000; bonus 1:1: + 40 at nil cost acquired 2023-03-01
    assert gains(res) == [
        ("2023-06-01", True, 1000.0, 3000.0, 2000.0),   # all of the first lot
        ("2023-06-01", True, 1000.0, 1500.0, 500.0),    # half of the second
        ("2023-09-01", True, 1000.0, 1500.0, 500.0),    # the rest of the second
        ("2023-09-01", False, 0.0, 2250.0, 2250.0),     # 15 bonus shares: nil cost, held under 12 months
    ]
    h = res["holdings"][ISIN]
    assert h["cost_source"] == "tradebook" and h["units"] == 30
    assert h["invested"] == 800.0 and h["avg_price"] == pytest.approx(26.6667)  # 25 bonus @ 0 + 5 @ 160, spread
    assert h["cashflows"] == [["2023-10-01", -800.0]]
    assert h["since"] == "2023-03-01"
    # on 1 Mar 2024 the bonus lot is 366 days old: long-term at nil cost; the 5 bought in October are short-term
    assert (h["tax"]["lt_units"], h["tax"]["lt_gain"], h["tax"]["st_gain"]) == (25, 25 * 150, 5 * 150 - 800)


def test_split_after_the_statement_date_scales_units_and_manual_price_is_in_todays_terms():
    res = run([held(10, "2026-10-31")], [], [act("2026-11-10", "split", 5, 1)], {ISIN: {"avg_price": 300, "since": "2025-02"}},
              today=date(2026, 11, 25), close=320.0)
    h = res["holdings"][ISIN]
    assert h["units"] == 50 and h["cost_source"] == "manual"
    assert h["invested"] == 15000.0 and h["since"] == "2025-02-01"
    assert h["tax"]["lt_value"] == 50 * 320 and h["tax"]["lt_gain"] == 50 * 320 - 15000


def test_build_applies_a_split_after_the_statement_and_keeps_units_in_todays_terms():
    market = synthetic.market()
    market["corp_actions"] = [act("2026-11-10", "split", 5, 1), act("2026-11-12", "dividend", amount=2.5),
                              act("2026-06-01", "dividend", amount=9.0)]  # before the first statement: not counted
    market["symbols"] = SYMBOLS
    snap = build_portfolio(synthetic.statements(), market, synthetic.TODAY)
    h = next(x for x in snap["holdings"] if x["isin"] == ISIN)
    assert h["units"] == 50.0 and h["statement"]["units"] == 10.0
    assert h["value"] == round(50 * h["nav"], 2)
    assert h["units_timeline"][-1][1] == 50.0 and all(u == 50.0 for _, u in h["units_timeline"])
    assert h["corp_actions_tracked"] is True and h["notice"] is None
    assert h["cost_source"] == "none" and h["invested"] is None
    # 10 shares → 50 on 10 Nov; the 12 Nov dividend is on 50 shares
    assert h["dividends"] == [["2026-11-12", 125.0]]
    alpha = next(m for m in snap["members"] if m["id"] == "m-alpha")
    assert alpha["dividend_income"] == [{"fy": "FY2026-27", "amount": 125.0}]
    assert any(a["kind"] == "dividend" and a["estimated"] and a["amount"] == 125.0 for a in snap["activity"])


def test_a_merger_after_the_statement_shows_the_banner_and_changes_no_units():
    market = synthetic.market()
    market["corp_actions"] = [act("2026-11-05", "demerger")]
    market["symbols"] = SYMBOLS
    snap = build_portfolio(synthetic.statements(), market, synthetic.TODAY)
    h = next(x for x in snap["holdings"] if x["isin"] == ISIN)
    assert h["units"] == 10.0
    assert h["notice"] == {"kind": "demerger", "ex_date": "2026-11-05",
                           "text": "Demerger on 5 Nov 2026. Upload a newer statement to update it."}
    # one before the statement date is already in the statement's units: no banner
    market["corp_actions"] = [act("2026-10-05", "merger")]
    snap = build_portfolio(synthetic.statements(), market, synthetic.TODAY)
    assert next(x for x in snap["holdings"] if x["isin"] == ISIN)["notice"] is None


def test_build_with_a_tradebook_and_a_manual_price():
    trades = [{"member_id": "m-alpha", "broker": "zerodha", "trades": [t("2025-01-15", "buy", 6, 1000)]}]
    market = {**synthetic.market(), "symbols": SYMBOLS}
    snap = build_portfolio(synthetic.statements(), market, synthetic.TODAY, trades=trades)
    h = next(x for x in snap["holdings"] if x["isin"] == ISIN)
    assert h["cost_source"] == "partial" and h["unknown_units"] == 4.0 and h["invested"] is None and h["cashflows"] is None
    costs = [{"member_id": "m-alpha", "isin": ISIN, "avg_price": 900.0, "since": "2023-05"}]
    snap = build_portfolio(synthetic.statements(), market, synthetic.TODAY, trades=trades, stock_costs=costs)
    h = next(x for x in snap["holdings"] if x["isin"] == ISIN)
    assert h["cost_source"] == "tradebook+manual" and h["unknown_units"] == 0
    assert h["invested"] == 6 * 1000 + 4 * 900
    assert h["cashflows"] == [["2023-05-01", -3600.0], ["2025-01-15", -6000.0]]  # joins Funds & stocks XIRR
    assert h["tax"]["lt_units"] == 10  # both lots over 12 months by today
    alpha = next(m for m in snap["members"] if m["id"] == "m-alpha")
    assert alpha["stocks"]["trades"] == 1


def test_partial_and_sold_elsewhere_reconcile_to_cdsl_units():
    res = run([held(10, "2024-01-31")], [t("2023-05-01", "buy", 15, 100)])
    h = res["holdings"][ISIN]
    assert h["units"] == 10 and h["invested"] == 1000.0  # the oldest 5 left through another broker
    assert res["counts"]["sold_elsewhere"] == 1 and res["realised"] == []


def test_sells_after_the_statement_count_for_tax_and_units():
    res = run([held(10, "2024-01-31")], [t("2023-05-01", "buy", 10, 100), t("2024-02-10", "sell", 4, 130)])
    h = res["holdings"][ISIN]
    assert h["units"] == 6 and h["traded_after"] == -4
    assert gains(res) == [("2024-02-10", False, 400.0, 520.0, 120.0)]


def test_intraday_is_left_out_of_capital_gains():
    res = run([held(10, "2024-01-31")], [t("2023-05-01", "buy", 10, 100), t("2023-06-01", "buy", 5, 110),
                                         t("2023-06-01", "sell", 5, 112)])
    assert res["realised"] == [] and res["counts"]["intraday_qty"] == 5
    assert res["holdings"][ISIN]["invested"] == 1000.0


def test_an_old_isin_is_linked_by_symbol_and_trades_dedupe_across_tradebooks():
    old = {**t("2023-05-01", "buy", 10, 100), "isin": OLD_ISIN, "symbol": None}
    mk = equity.Market.from_data([{**act("2023-08-01", "split", 2, 1), "isin": OLD_ISIN}], SYMBOLS)
    assert mk.resolve(old) == ISIN
    res = equity.member_stocks([held(20, "2024-01-31")], [old, dict(old)], {}, mk, {}, date(2024, 3, 1),
                               {ISIN: ("2024-03-01", 60.0)})
    assert res["counts"]["trades"] == 1
    assert res["holdings"][ISIN]["units"] == 20 and res["holdings"][ISIN]["invested"] == 1000.0


def test_grandfathering_uses_the_2018_high_in_the_terms_of_the_sale():
    # bought 2017, sold 2019; split 2:1 in 2020, so the adjusted 31 Jan 2018 high of 125 was 250 per share then
    res = run([], [t("2017-05-01", "buy", 10, 100), t("2019-01-01", "sell", 10, 300)], [act("2020-02-01", "split", 2, 1)],
              fmv={ISIN: 125.0})
    [g] = res["realised"]
    assert (g["cost"], g["sale"], g["gain"], g["long_term"]) == (1000.0, 3000.0, 500.0, True)


def test_stock_gains_share_the_ltcg_exemption_with_funds():
    today = date(2026, 11, 25)
    res = run([], [t("2024-05-01", "buy", 10, 100), t("2026-06-01", "sell", 10, 200)], today=today)
    a = member_analysis(None, None, [], today, res["realised"], {})
    assert a["harvest"]["realised_ltcg"] == 1000.0
    assert a["gains_by_fy"] == [{"fy": fin_year(today), "ltcg": 1000.0, "stcg": 0.0, "equity_ltcg": 1000.0, "sale": 2000.0}]
    assert a["realised_stocks"] == 1 and a["realised_funds"] == 0


def test_gold_etf_is_listed_non_equity():
    assert equity.is_equity_listed("INE000S01EQ1", "X") and equity.is_equity_listed("INF000E01NF0", "NIFTY BEES")
    assert not equity.is_equity_listed("INF000G01GD0", "SYNTH GOLD ETF")
    # after 23 Jul 2024: over 12 months is long-term for both
    assert equity._long_term(date(2024, 8, 1), date(2025, 8, 5), False)
    assert not equity._long_term(date(2022, 1, 1), date(2024, 1, 1), False)  # before: 36 months


def test_fund_notice_when_its_nav_stopped():
    assert equity.fund_notice(["2026-11-01", "2026-11-10"], "2026-11-24", "2026-10-31")["kind"] == "fund_merger"
    assert equity.fund_notice(["2026-11-20"], "2026-11-24", "2026-10-31") is None
    assert equity.fund_notice(["2026-10-20"], "2026-11-24", "2026-10-31") is None  # stopped before the statement


def test_factor():
    assert equity.factor({"kind": "split", "num": 5, "den": 1}) == 5
    assert equity.factor({"kind": "bonus", "num": 3, "den": 2}) == 2.5
    assert equity.factor({"kind": "bonus", "num": None, "den": 2}) == 1
