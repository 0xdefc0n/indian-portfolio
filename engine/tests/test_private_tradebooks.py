"""Real broker tradebooks (git-ignored, never committed; plan §21.6, M21). Skipped when none are present.

Put CSV/XLSX tradebooks in engine/tests/private/tradebooks/ (or PRIVATE_TRADEBOOKS_DIR). A password-protected one
(Groww) opens with $TEST_TRADEBOOK_PASSWORD (the PAN). Assertions and output are counts and ok/fail only, never values.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from engine.parsers.tradebook import BROKERS, TradebookError, parse_tradebook

DIR = Path(os.getenv("PRIVATE_TRADEBOOKS_DIR") or Path(__file__).parent / "private" / "tradebooks")
FILES = sorted(p for p in DIR.glob("*") if p.suffix.lower() in (".csv", ".xlsx", ".xls")) if DIR.is_dir() else []
pytestmark = pytest.mark.skipif(not FILES, reason="no private tradebooks available")


@pytest.mark.parametrize("path", FILES, ids=[f"tradebook{i}" for i in range(len(FILES))])
def test_private_tradebook_parses(path):
    pw = os.getenv("TEST_TRADEBOOK_PASSWORD", "")
    try:
        tb = parse_tradebook(path.read_bytes(), [pw] if pw else [])
    except TradebookError as e:
        pytest.fail(f"failed: {e.code}")  # the code only
    assert tb["broker"] in BROKERS
    c = tb["counts"]
    print(f"\n{tb['broker']}: rows={c.get('rows', 0)} trades={c.get('trades', 0)} "
          f"skipped={sum(v for k, v in c.items() if k.startswith('skipped'))} bad={c.get('bad_rows', 0)}")
    assert c.get("trades", 0) > 0
    assert c.get("bad_rows", 0) <= max(2, c.get("rows", 0) // 50)  # a few odd rows at most
    assert all(t["isin"] or t["symbol"] or t["name"] for t in tb["trades"])
