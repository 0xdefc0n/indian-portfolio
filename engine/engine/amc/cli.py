"""Parse downloaded AMC disclosure files and print what came out (plan §10.3.1, M18). Public market data only.

    uv run python -m engine.amc.cli <slug> <file> [<file> ...] [--rows]

Prints, per scheme: the parsed scheme name, the as-of month, the row count, the weight sum and the rows per type.
`--rows` also prints the first rows of each scheme (name, ISIN, type, weight) to check a parser change.
"""

from __future__ import annotations

import collections
import sys
import time
from pathlib import Path

from . import parse_portfolios
from .excel import UnreadableFile


def main(argv: list[str]) -> int:
    show_rows = "--rows" in argv
    args = [a for a in argv if a != "--rows"]
    if len(args) < 2:
        print(__doc__)
        return 2
    slug, files = args[0], args[1:]
    total = 0
    for f in files:
        t0 = time.perf_counter()
        try:
            ps = parse_portfolios(slug, Path(f).read_bytes(), Path(f).name)
        except UnreadableFile as e:
            print(f"{Path(f).name}: unreadable ({e})")
            continue
        total += len(ps)
        print(f"{Path(f).name}: {len(ps)} scheme(s), {int((time.perf_counter() - t0) * 1000)} ms")
        for p in ps:
            types = dict(collections.Counter(r["type"] for r in p.rows))
            pct = round(sum(r["pct"] for r in p.rows), 1)
            flag = "" if 95 <= pct <= 105 else "   <-- weights don't sum to ~100"
            print(f"  [{p.sheet[:20]}] {p.scheme_name[:70]} | {p.as_of} | {len(p.rows)} rows | {pct}% | {types}{flag}")
            if show_rows:
                for r in p.rows[:6]:
                    print(f"      {r['name'][:40]:40} {r['isin'][:12]:12} {r['type']:16} {r['pct']}")
    print(f"total {total} scheme(s) in {len(files)} file(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
