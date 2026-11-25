"""What the Python engine says about each private PDF, for the Worker pre-check agreement test (M3).

    uv run --directory engine python ../worker/test/helpers/engine_expect.py FILE.pdf [...]

Candidate passwords are engine.cli.candidates(): the PAN in the file name, then $TEST_PDF_PASSWORD. Prints one JSON
line to stdout for the test harness to read: per file the type, the index of the password that worked and a SHA-256 of
the parsed PAN. Never the PAN, the password or any statement content.
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path.cwd()))  # the engine package (uv project with package = false)

from engine.cli import parse_file  # noqa: E402


def main(paths: list[str]) -> None:
    out = []
    for p in paths:
        result, used = parse_file(Path(p))
        pan = result.get("pan") if result.get("ok") else None
        out.append(
            {
                "ok": bool(result.get("ok")),
                "code": None if result.get("ok") else result.get("code"),
                "kind": result.get("kind"),
                "password_index": used,
                "pan_sha256": hashlib.sha256(pan.encode()).hexdigest() if pan else None,
            }
        )
    sys.stdout.write(json.dumps(out) + "\n")


if __name__ == "__main__":
    main(sys.argv[1:])
