"""Expected portfolios for the private statements, for the Worker snapshot parity test (M10).

    uv run --directory engine python ../worker/test/helpers/portfolio_expect.py FILE.pdf [...]

Writes one JSON document to stdout for the test harness (never printed by it):
  engine:  build_portfolio() run directly on the engine's parse of each PDF, with the local NAV cache
  navs:    {code: {dates, navs}} for the codes a build needs, as the Worker's R2 series store them
  isin_to_code: {isin: code} for the held ISINs (what the Worker's tracked_scheme gives the engine)
  members: [sha256(PAN)] per engine member id, so the test can map member ids without seeing a PAN
Passwords: engine.cli.candidates() (the PAN in the file name, then $TEST_PDF_PASSWORD). Nothing is written to disk.
Until M10 deleted it, this also built the original local app's /api/portfolio, and the Worker matched it.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path.cwd()))  # the engine package (uv project with package = false)
ROOT = Path.cwd().parent

from engine.cli import parse_file  # noqa: E402
from engine.portfolio import build_portfolio, market_requirements  # noqa: E402


def nav_cache() -> tuple[dict[str, list], dict[str, str]]:
    cache = Path(os.getenv("NAV_CACHE_DIR") or ROOT / "data" / ".nav-cache")
    navs: dict[str, list] = {}
    isin_to_code: dict[str, str] = {}
    if not cache.is_dir():
        return navs, isin_to_code
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
        navs[f.stem] = sorted(rows)
    sl = cache / "scheme-list.json"
    if sl.exists():
        isin_to_code = {k: str(v[0]) for k, v in json.loads(sl.read_text()).items()}
    return navs, isin_to_code


def main(paths: list[str]) -> None:
    pdfs = [Path(p) for p in paths]
    statements = []
    for pdf in pdfs:
        result, _ = parse_file(pdf)
        if not result.get("ok"):
            continue
        pan = result["pan"]
        statements.append({"member_id": "pan-" + hashlib.sha256(pan.encode()).hexdigest()[:16], "pan": pan, "data": result["statement"]})
    navs, all_codes = nav_cache()
    need = market_requirements(statements, all_codes)
    held = set(need["held_isins"])
    isin_to_code = {i: c for i, c in all_codes.items() if i in held}
    # Stocks (M11): the Worker's tests have a (test-only) BharatStock key and no stock data stored yet.
    stocks = {"enabled": True, "matches": {}, "holdings": {}}
    market = {"navs": {c: navs[c] for c in need["codes"] if c in navs}, "isin_to_code": isin_to_code, "stocks": stocks}
    engine = json.loads(json.dumps(build_portfolio(statements, market, date.today())))
    out = {
        "engine": engine,
        "navs": {c: {"dates": [d for d, _ in rows], "navs": [n for _, n in rows]} for c, rows in market["navs"].items()},
        "isin_to_code": isin_to_code,
        "members": {s["member_id"]: hashlib.sha256(s["pan"].encode()).hexdigest() for s in statements},
        "today": date.today().isoformat(),
    }
    sys.stdout.write(json.dumps(out) + "\n")


if __name__ == "__main__":
    main(sys.argv[1:])
