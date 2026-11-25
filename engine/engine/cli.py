"""Dev tool: parse CAS PDFs with the engine (replaces the old top-level parse.py).

    uv run python -m engine.cli FILE.pdf [FILE.pdf ...] [--out=DIR] [--bench] [--show]

Passwords are tried in order: the PAN from the file name (<PAN>_<MONYYYY>....pdf), then $TEST_PDF_PASSWORD.
Passwords are never taken from the command line, so they don't land in shell history.

Output is redacted by default: counts, statement type, timings and memory only.
--out=DIR  also write each statement's JSON into DIR (keep DIR git-ignored).
--bench    print CPU time and peak RSS per file.
--show     opt-in: print holder name, period and holdings to the terminal.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

from .parse import parse_pdf

PAN_RE = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")


def mask(filename: str) -> str:
    """ABCDE1234F_OCT2026.pdf -> AB******4F_OCT2026.pdf"""
    return re.sub(r"^([A-Z]{2})[A-Z0-9]{6}([A-Z0-9]{2})", r"\1******\2", filename)


def candidates(pdf: Path) -> list[str]:
    out = []
    pan = pdf.stem.split("_")[0].upper()
    if PAN_RE.match(pan):
        out.append(pan)
    if os.getenv("TEST_PDF_PASSWORD"):
        out.append(os.environ["TEST_PDF_PASSWORD"])
    return out or [""]


def parse_file(pdf: Path) -> tuple[dict, int]:
    """(result, index of the password that worked or -1)."""
    data = pdf.read_bytes()
    result: dict = {"ok": False, "code": "wrong_password"}
    for i, pw in enumerate(candidates(pdf)):
        result = parse_pdf(data, pw)
        if result["ok"] or result["code"] != "wrong_password":
            return result, (i if result["ok"] else -1)
    return result, -1


def main(argv: list[str]) -> int:
    out_dir = next((Path(a.split("=", 1)[1]) for a in argv if a.startswith("--out=")), None)
    bench, show = "--bench" in argv, "--show" in argv
    paths = [Path(a) for a in argv if not a.startswith("--")]
    if not paths:
        print(__doc__)
        return 2
    failed = 0
    for pdf in paths:
        result, used = parse_file(pdf)
        m = result.get("metrics", {})
        perf = f" | cpu {m.get('cpu_ms')} ms, peak RSS {m.get('peak_rss_mb')} MB" if bench else ""
        if not result["ok"]:
            print(f"✗ {mask(pdf.name)}: {result['code']}{perf}")
            failed += 1
            continue
        st = result["statement"]
        n_warn = len(st.get("warnings", []))
        print(f"✓ {mask(pdf.name)} [{result['source']}] password #{used}: holdings {len(st.get('holdings', []))}, "
              f"transactions {len(st.get('transactions', []))}, warnings {n_warn}{perf}")
        if out_dir:
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / f"{pdf.stem}.json").write_text(json.dumps(st, indent=2, ensure_ascii=False))
        if show:  # opt-in only: personal data on screen
            print(f"  {st.get('holder_name')} | {st.get('period_from')} to {st.get('period_to')} | total {st.get('total_value')}")
            for h in st.get("holdings", []):
                print(f"  {h['isin']:<13} {h['name'][:48]:<48} {h.get('units') or 0:>12.3f} {h.get('value') or 0:>14.2f}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
