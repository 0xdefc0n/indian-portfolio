"""Statement parsers. Every function takes the PDF as bytes and works in memory: nothing is written to disk."""

from __future__ import annotations

from io import BytesIO

import pdfplumber
from pdfminer.pdfdocument import PDFPasswordIncorrect

from .cdsl import CASParseError, Statement, parse_cdsl_cas
from .rta import parse_rta_cas

MAX_PAGES = 300  # plan §14: larger files are rejected before parsing


def _password_error(e: BaseException) -> bool:
    while e is not None:
        if isinstance(e, PDFPasswordIncorrect):
            return True
        e = e.__cause__ or e.__context__
    return False


def detect_type(data: bytes, password: str) -> str:
    """'CDSL' for the depository eCAS, 'RTA' for a CAMS/KFintech statement. Same rules as the Worker pre-check."""
    try:
        with pdfplumber.open(BytesIO(data), password=password) as pdf:
            if len(pdf.pages) > MAX_PAGES:
                raise CASParseError(f"Statement has more than {MAX_PAGES} pages", "too_large")
            text = " ".join((p.extract_text() or "") for p in pdf.pages[:2]).upper()
    except CASParseError:
        raise
    except Exception as e:
        if _password_error(e):
            raise CASParseError("Could not open PDF (wrong password?)", "wrong_password") from e
        raise CASParseError("Could not read this file as a PDF", "unrecognised") from e
    if "HELD IN DEMAT" in text or "CAS ID" in text or "CENTRAL DEPOSITORY" in text:
        return "CDSL"
    if "KFIN" in text or "CAMS" in text or "COMPUTER AGE" in text:
        return "RTA"
    raise CASParseError("Unrecognised statement: upload a CDSL or CAMS/KFintech consolidated statement", "unrecognised")


def parse_statement(data: bytes, password: str, kind: str | None = None) -> dict:
    """Parse either statement type into a plain dict (see cdsl.Statement / rta.parse_rta_cas).

    kind: the type already detected (e.g. by the Worker pre-check). It's re-checked, not trusted.
    """
    detected = detect_type(data, password)
    if kind and kind != detected:
        raise CASParseError("Statement type differs from the pre-check", "precheck_disagree")
    if detected == "CDSL":
        return parse_cdsl_cas(data, password).to_dict()
    return parse_rta_cas(data, password)


__all__ = ["CASParseError", "MAX_PAGES", "Statement", "detect_type", "parse_cdsl_cas", "parse_rta_cas", "parse_statement"]
