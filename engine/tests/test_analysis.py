"""Tax and analysis rules: FIFO lots, long/short term, grandfathering, merge rules."""

from __future__ import annotations

from datetime import date

import pytest

from engine import analysis
from engine.analysis import fifo, fin_year, is_long_term
from engine.portfolio import _merge_holdings


def _t(d, type_, units, amount, nav=None):
    return {"date": d, "type": type_, "units": units, "amount": amount, "nav": nav}


def test_fifo_consumes_oldest_lots_first_and_keeps_stamp_duty_in_cost():
    txns = [
        _t("2023-01-10", "PURCHASE", 100.0, 1000.0), _t("2023-01-10", "STAMP_DUTY_TAX", 0.0, 0.05),
        _t("2024-06-10", "PURCHASE", 100.0, 2000.0),
        _t("2024-08-01", "REDEMPTION", -150.0, -3600.0),
    ]
    lots, gains = fifo(txns, "INF000S01FC1", "SYNTH FLEXI CAP FUND", "Equity Scheme - Flexi Cap Fund")
    assert len(lots) == 1 and lots[0].units == pytest.approx(50.0) and lots[0].cost == pytest.approx(1000.0)
    first, second = gains
    assert first["units"] == 100.0 and first["cost"] == pytest.approx(1000.05) and first["long_term"] is True
    assert second["units"] == 50.0 and second["long_term"] is False  # held < 1 year
    assert first["gain"] + second["gain"] == pytest.approx(3600.0 - 1000.05 - 1000.0, abs=0.02)


def test_fifo_gives_up_when_history_is_incomplete():
    assert fifo([_t("2024-01-01", "REDEMPTION", -10.0, -100.0)], "INF000S01FC1", "X FUND", None) is None


def test_long_term_rules():
    eq = dict(equity=True, sebi="Equity Scheme - Large Cap Fund", name="X LARGE CAP FUND")
    assert is_long_term(date(2024, 1, 1), date(2025, 1, 1), **eq) is True   # 366 days
    assert is_long_term(date(2024, 1, 2), date(2025, 1, 1), **eq) is False  # 365 days
    debt = dict(equity=False, sebi="Debt Scheme - Liquid Fund", name="X LIQUID FUND")
    assert is_long_term(date(2023, 4, 1), date(2026, 4, 1), **debt) is False  # specified debt: always slab
    assert is_long_term(date(2022, 1, 1), date(2024, 8, 1), **debt) is True   # > 24 months after 23-Jul-2024


def test_fin_year():
    assert fin_year(date(2026, 3, 31)) == "FY2025-26" and fin_year(date(2026, 4, 1)) == "FY2026-27"


def test_grandfathering_uses_31_jan_2018_nav():
    db = analysis._db()
    if db is None:
        pytest.skip("casparser-isin database not installed")
    row = db.execute(
        "SELECT n.isin, n.nav FROM nav20180131 n JOIN scheme s ON s.isin = n.isin "
        "WHERE s.sebi_category LIKE 'Equity Scheme%' AND n.nav > 10 LIMIT 1").fetchone()
    if row is None:
        pytest.skip("no equity scheme with a 2018 NAV in this database version")
    isin, nav18 = row[0], float(row[1])
    sebi = analysis.scheme_info(isin)[0]
    # bought below the Jan-2018 NAV, sold above it: cost of acquisition is the 2018 fair value
    txns = [_t("2017-06-01", "PURCHASE", 10.0, nav18 * 10 * 0.5), _t("2025-06-01", "REDEMPTION", -10.0, -nav18 * 10 * 2)]
    _, gains = fifo(txns, isin, "SYNTH EQUITY FUND", sebi)
    assert gains[0]["long_term"] is True
    assert gains[0]["gain"] == pytest.approx(nav18 * 10 * 2 - nav18 * 10, rel=1e-6)


def test_merge_takes_newer_numbers_and_cost_only_for_same_units():
    cdsl = {"period_to": "2026-10-31", "accounts": [{"bo_id": "B1", "dp_name": "SYNTH BROKER"}],
            "holdings": [{"bo_id": "B1", "isin": "INF000S01FC1", "name": "X FUND", "amc": "X AMC", "asset_type": "mutual_fund",
                          "units": 10.0, "price": 50.0, "value": 500.0, "pledged": 2.0}]}
    rta = {"file_type": "KFINTECH", "period_to": "2026-11-20", "transactions": [],
           "holdings": [{"isin": "INF000S01FC1", "name": "X FUND", "amc": "X AMC", "units": 10.0, "price": 55.0,
                         "value": 550.0, "valuation_date": "2026-11-20", "folio": "F1", "invested": 400.0}]}
    (row,) = _merge_holdings(cdsl, rta)
    assert row["value"] == 550.0 and row["as_of"] == "2026-11-20" and row["invested"] == 400.0 and row["pledged"] == 2.0
    rta["holdings"][0]["units"] = 12.0  # different position: units from the newer statement, but no cost
    (row,) = _merge_holdings(cdsl, rta)
    assert row["units"] == 12.0 and row["invested"] is None
