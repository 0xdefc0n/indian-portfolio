"""Request a KFintech consolidated statement (CAMS + KFintech folios) by email.

Uses the "KFintech CAS Mailback Automation" API on RapidAPI (by CASParser), which submits
KFintech's public form at mfs.kfintech.com/investor/General/ConsolidatedAccountStatement.
KFintech emails the password-protected PDF to the investor's *registered* email only.

Without RAPIDAPI_KEY the UI falls back to a guided manual request on KFintech's site.

The PDF password is kept in data/.statement-requests.json (git-ignored, owner-only) so the
emailed PDF can be opened on upload without retyping it; the entry is deleted once used.
"""

from __future__ import annotations

import json
import os
import re
import secrets
import string
import time
from pathlib import Path

import httpx

RAPIDAPI_HOST = "kfintech-cas-mailback-automation.p.rapidapi.com"
RAPIDAPI_URL = f"https://{RAPIDAPI_HOST}/request_ecas"
KFINTECH_FORM_URL = "https://mfs.kfintech.com/investor/General/ConsolidatedAccountStatement"

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
SPECIALS = "@#$"
PENDING_TTL_SECONDS = 30 * 24 * 3600


def rapidapi_key() -> str | None:
    return os.getenv("RAPIDAPI_KEY") or None


def password_problem(pw: str, pan: str) -> str | None:
    """KFintech: 8+ chars, upper, lower, digit, special; must not contain the PAN."""
    if len(pw) < 8:
        return "Password needs at least 8 characters"
    if not (re.search(r"[A-Z]", pw) and re.search(r"[a-z]", pw) and re.search(r"\d", pw)):
        return "Password needs an upper-case letter, a lower-case letter and a number"
    if not re.search(r"[^A-Za-z0-9]", pw):
        return "Password needs a special character, e.g. @ # $"
    if pan.upper() in pw.upper():
        return "Password can't contain the PAN"
    return None


def generate_password() -> str:
    """12 chars that satisfy KFintech's rules, without look-alike characters."""
    upper, lower, digits = "ABCDEFGHJKMNPQRSTUVWXYZ", "abcdefghjkmnpqrstuvwxyz", "23456789"
    pool = upper + lower + digits
    chars = [secrets.choice(upper), secrets.choice(lower), secrets.choice(digits), secrets.choice(SPECIALS)]
    chars += [secrets.choice(pool) for _ in range(8)]
    secrets.SystemRandom().shuffle(chars)
    return "".join(chars)


# ---------------------------------------------------------------- pending passwords

def _store_path(data_dir: Path) -> Path:
    return data_dir / ".statement-requests.json"


def _load(data_dir: Path) -> dict:
    try:
        d = json.loads(_store_path(data_dir).read_text())
    except (OSError, ValueError):
        return {}
    now = time.time()
    return {pan: v for pan, v in d.items() if now - v.get("at", 0) < PENDING_TTL_SECONDS}


def _save(data_dir: Path, d: dict) -> None:
    data_dir.mkdir(exist_ok=True)
    p = _store_path(data_dir)
    p.write_text(json.dumps(d))
    os.chmod(p, 0o600)


def remember_password(data_dir: Path, pan: str, password: str) -> None:
    d = _load(data_dir)
    d[pan] = {"password": password, "at": time.time()}
    _save(data_dir, d)


def pending_password(data_dir: Path, pan: str) -> str | None:
    return _load(data_dir).get(pan, {}).get("password")


def forget_password(data_dir: Path, pan: str) -> None:
    d = _load(data_dir)
    if d.pop(pan, None) is not None:
        _save(data_dir, d)


# ---------------------------------------------------------------- request

class RequestError(Exception):
    pass


async def request_statement(email: str, pan: str, from_date: str, to_date: str, password: str) -> str:
    """Submit the mailback request. Dates are ISO (YYYY-MM-DD); the API wants DD/MM/YYYY."""
    key = rapidapi_key()
    if not key:
        raise RequestError("RAPIDAPI_KEY is not set")
    dmy = lambda iso: f"{iso[8:10]}/{iso[5:7]}/{iso[0:4]}"
    async with httpx.AsyncClient(timeout=90) as client:  # form automation can take a while
        try:
            r = await client.post(
                RAPIDAPI_URL,
                headers={"x-rapidapi-key": key, "x-rapidapi-host": RAPIDAPI_HOST, "Content-Type": "application/json"},
                json={"email": email, "pan_no": pan, "from_date": dmy(from_date), "to_date": dmy(to_date), "password": password},
            )
        except httpx.HTTPError as e:
            raise RequestError(f"Could not reach the request service ({type(e).__name__})") from e
    try:
        body = r.json()
    except ValueError:
        body = {}
    msg = (body.get("message") or body.get("msg") or body.get("status") or "") if isinstance(body, dict) else ""
    if r.status_code == 429:
        raise RequestError("Monthly request limit reached on the RapidAPI plan")
    if r.status_code in (401, 403):
        raise RequestError("RapidAPI key was rejected; check RAPIDAPI_KEY and that you're subscribed to the API")
    if r.status_code >= 400:
        raise RequestError(f"KFintech request failed ({r.status_code}){': ' + str(msg)[:200] if msg else ''}")
    return str(msg) or "Request submitted"
