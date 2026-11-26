"""Expected portfolios for the private statements, for the Worker snapshot parity test (M10).

    uv run --directory engine python ../worker/test/helpers/portfolio_expect.py FILE.pdf [...]

Writes one JSON document to stdout for the test harness (never printed by it):
  engine:  build_portfolio() run directly on the engine's parse of each PDF, with the local NAV cache
  legacy:  the original local app's GET /api/portfolio (app/portfolio.py) on the same PDFs, offline, same NAV cache;
           null once app/ is gone
  navs:    {code: {dates, navs}} for the codes a build needs, as the Worker's R2 series store them
  isin_to_code: {isin: code} for the held ISINs (what the Worker's tracked_scheme gives the engine)
  members: [sha256(PAN)] per engine member id, so the test can map member ids without seeing a PAN
Passwords: engine.cli.candidates() (the PAN in the file name, then $TEST_PDF_PASSWORD). Nothing is written to disk
except the legacy app's parsed JSON in a temporary folder that is removed afterwards.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import tempfile
import time
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path.cwd()))  # the engine package (uv project with package = false)
ROOT = Path.cwd().parent

from engine.cli import candidates, parse_file  # noqa: E402
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


def legacy_build(pdfs: list[Path], passwords: list[str]) -> dict | None:
    if not (ROOT / "app" / "portfolio.py").exists():
        return None
    sys.path.insert(0, str(ROOT))
    import httpx

    def offline(*a, **k):
        raise httpx.ConnectError("offline")

    httpx.Client.get = offline  # type: ignore[method-assign]
    httpx.get = offline  # type: ignore[assignment]
    os.environ.pop("BHARATSTOCK_API_KEY", None)
    os.environ["NAV_HISTORY"] = "1"
    from app import portfolio as legacy_portfolio
    from app.parsers import parse_statement as legacy_parse

    tmp = Path(tempfile.mkdtemp(prefix="pf-legacy-"))
    try:
        parsed = tmp / "parsed"
        parsed.mkdir()
        src = ROOT / "data" / ".nav-cache"
        if src.is_dir():
            shutil.copytree(src, tmp / ".nav-cache")
            now = time.time()
            for f in (tmp / ".nav-cache").iterdir():
                os.utime(f, (now, now))  # fresh, so the legacy app reads it instead of fetching
        for i, (pdf, pw) in enumerate(zip(pdfs, passwords)):
            st = legacy_parse(pdf, pw)
            pan = st.get("pan") or f"X{i}"
            (parsed / f"{pan}_{i:02d}.json").write_text(json.dumps(st))
        return json.loads(json.dumps(legacy_portfolio.build_portfolio(parsed)))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main(paths: list[str]) -> None:
    pdfs = [Path(p) for p in paths]
    statements, passwords, ok_pdfs = [], [], []
    for pdf in pdfs:
        result, used = parse_file(pdf)
        if not result.get("ok"):
            continue
        ok_pdfs.append(pdf)
        passwords.append(candidates(pdf)[used])
        pan = result["pan"]
        statements.append({"member_id": "pan-" + hashlib.sha256(pan.encode()).hexdigest()[:16], "pan": pan, "data": result["statement"]})
    navs, all_codes = nav_cache()
    need = market_requirements(statements, all_codes)
    held = set(need["held_isins"])
    isin_to_code = {i: c for i, c in all_codes.items() if i in held}
    market = {"navs": {c: navs[c] for c in need["codes"] if c in navs}, "isin_to_code": isin_to_code, "stocks": None}
    engine = json.loads(json.dumps(build_portfolio(statements, market, date.today())))
    out = {
        "engine": engine,
        "legacy": legacy_build(ok_pdfs, passwords),
        "navs": {c: {"dates": [d for d, _ in rows], "navs": [n for _, n in rows]} for c, rows in market["navs"].items()},
        "isin_to_code": isin_to_code,
        "members": {s["member_id"]: hashlib.sha256(s["pan"].encode()).hexdigest() for s in statements},
        "today": date.today().isoformat(),
    }
    sys.stdout.write(json.dumps(out) + "\n")


if __name__ == "__main__":
    main(sys.argv[1:])
