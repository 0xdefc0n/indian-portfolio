from __future__ import annotations

import pytest

from engine.market import NavSeries, replay, series_map, trailing_returns


def test_nav_on_or_before_with_staleness_limit():
    s = NavSeries([["2026-01-05", 10.0], ["2026-01-01", 9.0]])
    assert s.on("2026-01-03") == 9.0 and s.on("2026-01-05") == 10.0 and s.on("2025-12-31") is None
    assert s.on("2026-01-16") is None  # more than 10 days after the last NAV


def test_trailing_returns():
    s = NavSeries([["2021-11-01", 100.0], ["2023-11-01", 121.0], ["2025-11-01", 144.0], ["2026-11-01", 150.0]])
    r = trailing_returns(s)
    assert r["1y"] == pytest.approx(150 / 144 - 1, abs=1e-5) and r["5y"] == pytest.approx(0.08447, abs=1e-5)
    assert trailing_returns(None) == {"1y": None, "3y": None, "5y": None}


def test_replay_buys_the_benchmark_with_the_same_cash_flows():
    bench = NavSeries([["2025-01-01", 100.0], ["2026-01-01", 120.0]])
    assert replay([["2025-01-01", -1000.0]], bench, "2026-01-01") == 1200.0
    assert replay([["2024-01-01", -1000.0]], bench, "2026-01-01") is None  # no NAV that day


def test_series_map_skips_empty():
    assert set(series_map({"1": [["2026-01-01", 1.0]], "2": []})) == {"1"}
