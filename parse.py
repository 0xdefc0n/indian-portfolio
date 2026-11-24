"""Parse CAS PDFs in data/ into JSON under data/parsed/.

Usage:
    .venv/bin/python parse.py                   # every data/*.pdf
    .venv/bin/python parse.py data/ABCDE1234F_OCT2026.pdf
    .venv/bin/python parse.py --show            # also print names/amounts (off by default)
    .venv/bin/python parse.py FILE --password=...   # CAMS/KFintech statements with their own password

Terminal output is redacted by default (counts only). Full data goes only to the JSON file.

The PDF password is taken from the file name (<PAN>_<MONYYYY>.pdf). CDSL uses the PAN.
"""

import json
import re
import sys
from pathlib import Path

from app.parsers import CASParseError, parse_statement

ROOT = Path(__file__).resolve().parent
DATA, OUT = ROOT / "data", ROOT / "data" / "parsed"


def inr(x: float | None) -> str:
    if x is None:
        return "-"
    whole, frac = f"{x:.2f}".split(".")
    neg = whole.startswith("-")
    whole = whole.lstrip("-")
    if len(whole) > 3:  # Indian grouping: 12,31,214.30
        head, tail = whole[:-3], whole[-3:]
        head = re.sub(r"(\d)(?=(\d{2})+$)", r"\1,", head)
        whole = f"{head},{tail}"
    return f"{'-' if neg else ''}₹{whole}.{frac}"


def main(paths: list[Path]) -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    failed = 0
    for pdf in paths:
        pan = pdf.stem.split("_")[0].upper()
        try:
            st = parse_statement(pdf, PASSWORD or pan)
        except CASParseError as e:
            print(f"✗ {mask(pdf.name)}: {str(e).split(':')[0]}")
            failed += 1
            continue
        out = OUT / f"{pdf.stem}.json"
        out.write_text(json.dumps(st, indent=2, ensure_ascii=False))

        # Default output is redacted: no names, PAN, account IDs, schemes or amounts.
        n_warn = len(st["warnings"])
        print(f"✓ {mask(pdf.name)} [{st.get('file_type') or 'CDSL'}]: holdings {len(st['holdings'])}, "
              f"transactions {len(st['transactions'])}, checks {f'{n_warn} warning(s)' if n_warn else 'passed'}")
        if SHOW:
            print(f"  {st['holder_name']} | {st['period_from']} to {st['period_to']} | total {inr(st['total_value'])}")
            for h in st["holdings"]:
                print(f"  {h['isin']:<13} {h['name'][:48]:<48} {h['units'] or 0:>10.3f} {h['price'] or 0:>9.4f} {inr(h['value']):>14}")
            for w in st["warnings"]:
                print(f"  ⚠ {w}")
        elif n_warn:
            print("  run with --show to see warning details")
    return 1 if failed else 0


SHOW = "--show" in sys.argv  # opt-in: print personal details to the terminal
PASSWORD = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--password=")), None)  # else PAN


def mask(filename: str) -> str:
    """ABCDE1234F_OCT2026.pdf -> AB******4F_OCT2026.pdf"""
    return re.sub(r"^([A-Z]{2})[A-Z0-9]{6}([A-Z0-9]{2})", r"\1******\2", filename)


if __name__ == "__main__":
    args = [Path(a) for a in sys.argv[1:] if not a.startswith("--")] or sorted(DATA.glob("*.pdf"))
    sys.exit(main(args))
