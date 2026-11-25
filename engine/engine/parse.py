"""The engine's /parse operation: one PDF and one password in, a statement dict or an error code out.

Never raises, never logs statement contents, never writes to disk.
"""

from __future__ import annotations

import logging
import resource
import sys
import time

from .parsers import CASParseError, parse_statement

log = logging.getLogger("engine.parse")

KINDS = {"CDSL", "RTA"}


def peak_rss_mb() -> float:
    """Peak resident memory of this process so far (Linux reports KiB, macOS bytes)."""
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return round(rss / (1e6 if sys.platform == "darwin" else 1024), 1)


def parse_pdf(data: bytes, password: str, kind: str | None = None) -> dict:
    """{ok: True, kind, source, pan, statement, metrics} or {ok: False, code, message, metrics}.

    kind: "CDSL" | "RTA" when the caller has already verified the password and type (the Worker's pre-check).
    Then a password the engine can't use, or a different type, is reported as `precheck_disagree` (a bug, not a
    user error). Without `kind` (dev tools), the plain codes are returned.
    """
    t0 = time.process_time()
    if kind is not None and kind not in KINDS:
        return {"ok": False, "code": "bad_request", "message": "Unknown statement kind", "metrics": _metrics(t0)}
    try:
        st = parse_statement(data, password or "", kind)
    except CASParseError as e:
        code = e.code
        if kind is not None and code in ("wrong_password", "unrecognised"):
            code = "precheck_disagree"
        log.info("parse failed: %s", code)
        return {"ok": False, "code": code, "message": str(e), "metrics": _metrics(t0)}
    except Exception as e:  # an unexpected layout: report the class only
        log.warning("parser crashed: %s", type(e).__name__)
        return {"ok": False, "code": "parse_error", "message": "Could not read this statement", "metrics": _metrics(t0)}
    rta = st.get("statement_type") == "RTA_CAS"
    return {
        "ok": True,
        "kind": "RTA" if rta else "CDSL",
        "source": (st.get("file_type") or "RTA") if rta else "CDSL",  # CDSL | CAMS | KFINTECH
        "pan": st.get("pan"),
        "statement": st,
        "metrics": _metrics(t0),
    }


def _metrics(t0: float) -> dict:
    return {"cpu_ms": round((time.process_time() - t0) * 1000), "peak_rss_mb": peak_rss_mb()}
