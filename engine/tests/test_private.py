"""Real statements (git-ignored, never committed). Skipped when none are present, e.g. in CI.

Put PDFs in engine/tests/private/ or point PRIVATE_DATA_DIR at a folder (e.g. ../data). Passwords: the PAN in the
file name (<PAN>_<MONYYYY>…pdf), then $TEST_PDF_PASSWORD. Assertions report counts and paths only, never values.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import time
from datetime import date
from pathlib import Path

import pytest

from engine.cli import candidates, parse_file
from engine.portfolio import build_portfolio
from tests.conftest import ROOT, assert_same, diff_paths, roundtrip

PRIVATE = Path(os.getenv("PRIVATE_DATA_DIR") or Path(__file__).parent / "private")
PDFS = sorted(PRIVATE.glob("*.pdf")) if PRIVATE.is_dir() else []
pytestmark = pytest.mark.skipif(not PDFS, reason="no private statements available")
PAN_RE = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")


def _ids():
    return [f"pdf{i}" for i in range(len(PDFS))]  # never the file name: it contains the PAN


@pytest.mark.parametrize("pdf", PDFS, ids=_ids())
def test_parses_in_memory(pdf):
    result, used = parse_file(pdf)
    ok = result["ok"]
    assert ok, f"parse failed with code {result.get('code')}"
    st = result["statement"]
    assert len(st.get("holdings", [])) > 0
    assert st.get("source") in (None, "statement.pdf")  # never the uploaded file name
    pan = pdf.stem.split("_")[0].upper()
    if PAN_RE.match(pan):
        same_pan = result["pan"] == pan
        assert same_pan, "parsed PAN differs from the file-name PAN"


@pytest.fixture
def legacy(monkeypatch):
    if not (ROOT / "app" / "portfolio.py").exists():
        pytest.skip("app/ removed")
    monkeypatch.syspath_prepend(str(ROOT))
    import httpx

    def offline(*a, **k):
        raise httpx.ConnectError("offline in tests")

    monkeypatch.setattr(httpx.Client, "get", offline)
    monkeypatch.setattr(httpx, "get", offline)
    from app import portfolio as legacy_portfolio
    from app.parsers import parse_statement as legacy_parse

    return legacy_portfolio, legacy_parse


def _parsed_pairs(legacy_parse):
    """(engine statement, legacy statement) per private PDF."""
    out = []
    for pdf in PDFS:
        result, used = parse_file(pdf)
        assert result["ok"]
        pw = candidates(pdf)[used]
        out.append((pdf, result["statement"], legacy_parse(pdf, pw)))
    return out


def test_parser_output_matches_legacy(legacy):
    _, legacy_parse = legacy
    for i, (_, new, old) in enumerate(_parsed_pairs(legacy_parse)):
        old.pop("source", None), new.pop("source", None)  # legacy kept the file name; the engine never does
        paths = diff_paths(roundtrip(old), roundtrip(new))
        same = not paths
        assert same, f"pdf{i}: legacy vs engine parse differ at {paths}"


@pytest.mark.parametrize("with_navs", [False, True])
def test_build_matches_legacy_on_real_statements(tmp_path, monkeypatch, legacy, with_navs):
    legacy_portfolio, legacy_parse = legacy
    pairs = _parsed_pairs(legacy_parse)
    parsed = tmp_path / "parsed"
    parsed.mkdir()
    statements = []
    for i, (pdf, new, old) in enumerate(pairs):
        pan = new.get("pan") or pdf.stem.split("_")[0]
        (parsed / f"{pan}_{i:02d}.json").write_text(json.dumps(old))
        statements.append({"member_id": f"member-{pan[-4:]}", "pan": pan, "data": new})

    market = {}
    nav_cache = ROOT / "data" / ".nav-cache"
    if with_navs:
        if not nav_cache.is_dir():
            pytest.skip("no local NAV cache")
        cache = tmp_path / ".nav-cache"
        shutil.copytree(nav_cache, cache)
        now = time.time()
        for f in cache.iterdir():
            os.utime(f, (now, now))  # fresh, so the legacy app reads it instead of fetching
        navs = {}
        for f in cache.glob("*.json"):
            if f.name == "scheme-list.json":
                continue
            rows = []
            for r in json.loads(f.read_text()).get("data", []):
                try:
                    d = r["date"]
                    rows.append([f"{d[6:10]}-{d[3:5]}-{d[0:2]}", float(r["nav"])])
                except (KeyError, ValueError, TypeError):
                    continue
            navs[f.stem] = rows
        sl = cache / "scheme-list.json"
        isin_to_code = {k: v[0] for k, v in json.loads(sl.read_text()).items()} if sl.exists() else {}
        market = {"navs": navs, "isin_to_code": isin_to_code}
    monkeypatch.setenv("NAV_HISTORY", "1" if with_navs else "0")

    old = roundtrip(legacy_portfolio.build_portfolio(parsed))
    new = build_portfolio(statements, market, date.today())
    ids = [m["id"] for m in new["members"]]
    mapping = {m["id"]: ids[i] for i, m in enumerate(old["members"])}
    for m in old["members"]:
        m["id"] = mapping[m["id"]]
    for key in ("holdings", "activity", "sips"):
        for row in old[key]:
            row["member_id"] = mapping[row["member_id"]]
    assert_same(old, new, "legacy vs engine snapshot (real statements)")
