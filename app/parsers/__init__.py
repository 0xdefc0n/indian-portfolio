from pathlib import Path

import pdfplumber

from .cdsl import CASParseError, Statement, parse_cdsl_cas
from .rta import parse_rta_cas


def detect_type(path: str | Path, password: str) -> str:
    """'CDSL' for the depository eCAS, 'RTA' for a CAMS/KFintech statement."""
    try:
        with pdfplumber.open(path, password=password) as pdf:
            text = " ".join((p.extract_text() or "") for p in pdf.pages[:2]).upper()
    except Exception as e:
        raise CASParseError("Could not open PDF (wrong password?)") from e
    if "HELD IN DEMAT" in text or "CAS ID" in text or "CENTRAL DEPOSITORY" in text:
        return "CDSL"
    if "KFIN" in text or "CAMS" in text or "COMPUTER AGE" in text:
        return "RTA"
    raise CASParseError("Unrecognised statement: upload a CDSL or CAMS/KFintech consolidated statement")


def parse_statement(path: str | Path, password: str) -> dict:
    """Parse either statement type into a plain dict (see cdsl.Statement / rta.parse_rta_cas)."""
    if detect_type(path, password) == "CDSL":
        return parse_cdsl_cas(path, password).to_dict()
    return parse_rta_cas(path, password)


__all__ = ["CASParseError", "Statement", "detect_type", "parse_cdsl_cas", "parse_rta_cas", "parse_statement"]
