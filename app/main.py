"""Fetch CDSL CAS PDFs via CASParser's OTP flow and save them under data/.

Parsing is intentionally NOT done here (we parse PDFs ourselves later).
"""

import json
import logging
import os
import secrets
import re
import time
from pathlib import Path
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, field_validator

from . import kfintech
from .portfolio import build_portfolio, parse_and_store

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

API_BASE = os.getenv("CASPARSER_BASE_URL", "https://api.casparser.in")
API_KEY = os.getenv("CASPARSER_API_KEY", "sandbox-with-json-responses")
NUM_PERIODS = int(os.getenv("NUM_PERIODS", "1"))
DATA_DIR = Path(os.getenv("DATA_DIR", ROOT / "data"))  # override for demo/testing
PARSED_DIR = Path(os.getenv("PARSED_DIR", DATA_DIR / "parsed"))  # override for demo data
WEB_DIST = ROOT / "web" / "dist"
# Only download from CASParser-controlled hosts (subdomains of casparser.in),
# plus any extra hosts listed in DOWNLOAD_HOSTS (comma separated) if their CDN changes.
EXTRA_DOWNLOAD_HOSTS = {h.strip() for h in os.getenv("DOWNLOAD_HOSTS", "").split(",") if h.strip()}


def _allowed_host(url: str) -> bool:
    u = urlparse(url)
    host = (u.hostname or "").lower()
    return u.scheme == "https" and (
        host == "casparser.in" or host.endswith(".casparser.in") or host in EXTRA_DOWNLOAD_HOSTS
    )


SESSION_TTL_SECONDS = 10 * 60  # CDSL OTP expires in 5 min; keep a margin

PAN_RE = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")
BOID_RE = re.compile(r"^[0-9]{16}$")
PERIOD_RE = re.compile(r"_([A-Z]{3}\d{4})\.pdf$", re.IGNORECASE)

log = logging.getLogger("demat")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
# httpx logs full URLs at INFO, which include session IDs and file names with the BO ID.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

app = FastAPI(title="PocketFolio")

# session_id -> {"pan": str, "created": float}. Server-side so the client
# can't choose the filename by sending a different PAN at verify time.
SESSIONS: dict[str, dict] = {}


class FetchRequest(BaseModel):
    pan: str
    bo_id: str
    dob: str  # YYYY-MM-DD (HTML date input format)

    @field_validator("pan")
    @classmethod
    def _pan(cls, v: str) -> str:
        v = v.strip().upper()
        if not PAN_RE.match(v):
            raise ValueError("PAN must look like ABCDE1234F")
        return v

    @field_validator("bo_id")
    @classmethod
    def _bo(cls, v: str) -> str:
        v = re.sub(r"\s", "", v)
        if not BOID_RE.match(v):
            raise ValueError("CDSL BO ID must be 16 digits")
        return v

    @field_validator("dob")
    @classmethod
    def _dob(cls, v: str) -> str:
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", v):
            raise ValueError("DOB must be YYYY-MM-DD")
        return v


class VerifyRequest(BaseModel):
    session_id: str
    otp: str

    @field_validator("otp")
    @classmethod
    def _otp(cls, v: str) -> str:
        v = v.strip()
        if not re.match(r"^\d{4,8}$", v):
            raise ValueError("OTP must be digits")
        return v


def _headers() -> dict:
    return {"x-api-key": API_KEY, "Content-Type": "application/json"}


def _api_error(resp: httpx.Response) -> HTTPException:
    try:
        body = resp.json()
        msg = body.get("msg") or body.get("message") or str(body)
    except ValueError:
        msg = resp.text[:300]
    status = resp.status_code if 400 <= resp.status_code < 500 else 502
    return HTTPException(status_code=status, detail=f"CASParser: {msg}")


def _purge_sessions() -> None:
    now = time.time()
    for sid in [s for s, v in SESSIONS.items() if now - v["created"] > SESSION_TTL_SECONDS]:
        SESSIONS.pop(sid, None)


def _target_path(pan: str, remote_name: str, index: int) -> Path:
    """data/<PAN>_<MONYYYY>.pdf, so monthly fetches don't overwrite each other."""
    m = PERIOD_RE.search(remote_name or "")
    suffix = m.group(1).upper() if m else str(index + 1)
    return DATA_DIR / f"{pan}_{suffix}.pdf"


MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]


@app.post("/api/upload")
async def upload(pan: str = Form(...), password: str = Form(""), file: UploadFile = File(...)):
    """Manual path: a CDSL eCAS or a CAMS/KFintech statement. Type and date come from the PDF.

    The password (when the statement isn't protected by the PAN) is used once to read the
    PDF and is never stored or logged.
    """
    pan = pan.strip().upper()
    if not PAN_RE.match(pan):
        raise HTTPException(422, "PAN must look like ABCDE1234F")
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File is larger than 10 MB")
    if not content.startswith(b"%PDF"):
        raise HTTPException(422, "That file is not a PDF")

    DATA_DIR.mkdir(exist_ok=True)
    tmp = DATA_DIR / f".upload-{secrets.token_hex(6)}.pdf"
    tmp.write_bytes(content)
    tmp_json = PARSED_DIR / f"{tmp.stem}.json"
    try:
        res = parse_and_store(tmp, PARSED_DIR, password.strip() or pan)
        remembered = kfintech.pending_password(DATA_DIR, pan)
        if not res["ok"] and not password.strip() and remembered:
            # statement requested from this app: try the password we generated for it
            res = parse_and_store(tmp, PARSED_DIR, remembered)
            if res["ok"]:
                kfintech.forget_password(DATA_DIR, pan)
        elif res["ok"] and remembered and password.strip() == remembered:
            kfintech.forget_password(DATA_DIR, pan)
        if not res["ok"]:
            raise HTTPException(422, res["error"])
        if res.get("pan") and res["pan"] != pan:
            raise HTTPException(422, "This statement belongs to a different PAN than the one entered")
        st = json.loads(tmp_json.read_text())
        as_of = st.get("valuation_date") or st.get("period_to") or ""
        tag = f"{MONTHS[int(as_of[5:7]) - 1]}{as_of[:4]}" if len(as_of) >= 7 else "UNDATED"
        stem = f"{pan}_{tag}_{res['type']}"
        tmp.replace(DATA_DIR / f"{stem}.pdf")
        tmp_json.replace(PARSED_DIR / f"{stem}.json")
    finally:
        tmp.unlink(missing_ok=True)  # unreadable or rejected uploads are not kept
        tmp_json.unlink(missing_ok=True)
    log.info("Statement uploaded")
    return {"saved": [f"{stem}.pdf"], "failed": [], "parsed": [res]}


@app.get("/api/portfolio")
def portfolio():
    return build_portfolio(PARSED_DIR)


# Built React dashboard (web/dist). In development, run `npm run dev` in web/ instead.
if (WEB_DIST / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")


@app.get("/favicon.svg")
def favicon():
    return FileResponse(WEB_DIST / "favicon.svg")


@app.get("/")
def index():
    if (WEB_DIST / "index.html").exists():
        return FileResponse(WEB_DIST / "index.html")
    return FileResponse(ROOT / "static" / "index.html")


@app.get("/api/config")
def config():
    return {
        "sandbox": API_KEY.startswith("sandbox"),
        "num_periods": NUM_PERIODS,
        "kfintech_auto": kfintech.rapidapi_key() is not None,
        "kfintech_form_url": kfintech.KFINTECH_FORM_URL,
    }


class StatementRequest(BaseModel):
    pan: str
    email: str
    from_date: str  # YYYY-MM-DD
    to_date: str
    password: str = ""

    @field_validator("pan")
    @classmethod
    def _pan(cls, v: str) -> str:
        v = v.strip().upper()
        if not PAN_RE.match(v):
            raise ValueError("PAN must look like ABCDE1234F")
        return v

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = v.strip()
        if not kfintech.EMAIL_RE.match(v):
            raise ValueError("Enter the email registered with the mutual fund folios")
        return v

    @field_validator("from_date", "to_date")
    @classmethod
    def _date(cls, v: str) -> str:
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", v):
            raise ValueError("Dates must be YYYY-MM-DD")
        return v


@app.post("/api/kfintech/request")
async def kfintech_request(req: StatementRequest):
    """Ask KFintech to email a detailed statement (all CAMS + KFintech folios) to the investor.

    Returns the PDF password either way. mode='sent' when the RapidAPI request went through,
    'manual' when no RAPIDAPI_KEY is configured (the UI then guides the user through KFintech's form).
    PAN, email and password are never logged.
    """
    if req.from_date >= req.to_date:
        raise HTTPException(422, "Start date must be before end date")
    password = req.password.strip() or kfintech.generate_password()
    if problem := kfintech.password_problem(password, req.pan):
        raise HTTPException(422, problem)
    kfintech.remember_password(DATA_DIR, req.pan, password)

    if not kfintech.rapidapi_key():
        return {"mode": "manual", "password": password, "form_url": kfintech.KFINTECH_FORM_URL}
    try:
        msg = await kfintech.request_statement(req.email, req.pan, req.from_date, req.to_date, password)
    except kfintech.RequestError as e:
        log.warning("Statement request failed")
        raise HTTPException(502, str(e)) from e
    log.info("Statement requested")
    return {"mode": "sent", "password": password, "msg": msg}


@app.post("/api/cdsl/request-otp")
async def request_otp(req: FetchRequest):
    _purge_sessions()
    async with httpx.AsyncClient(timeout=60) as client:  # captcha solving ~15-20s
        try:
            resp = await client.post(
                f"{API_BASE}/v4/cdsl/fetch",
                headers=_headers(),
                json={"pan": req.pan, "bo_id": req.bo_id, "dob": req.dob},
            )
        except httpx.HTTPError as e:
            raise HTTPException(502, f"Could not reach CASParser: {e}") from e
    if resp.status_code != 200:
        raise _api_error(resp)
    data = resp.json()
    session_id = data.get("session_id")
    if data.get("status") != "success" or not session_id:
        raise HTTPException(502, f"CASParser: {data.get('msg', 'unexpected response')}")
    SESSIONS[session_id] = {"pan": req.pan, "created": time.time()}
    log.info("OTP requested")
    return {"session_id": session_id, "msg": data.get("msg", "OTP sent")}


@app.post("/api/cdsl/verify")
async def verify(req: VerifyRequest):
    _purge_sessions()
    sess = SESSIONS.get(req.session_id)
    if not sess:
        raise HTTPException(404, "Session expired. Request a new OTP.")
    pan = sess["pan"]

    async with httpx.AsyncClient(timeout=60) as client:
        try:
            resp = await client.post(
                f"{API_BASE}/v4/cdsl/fetch/{req.session_id}/verify",
                headers=_headers(),
                json={"otp": req.otp, "num_periods": NUM_PERIODS},
            )
        except httpx.HTTPError as e:
            raise HTTPException(502, f"Could not reach CASParser: {e}") from e
        if resp.status_code != 200:
            raise _api_error(resp)
        data = resp.json()
        files = data.get("files") or []
        if data.get("status") != "success" or not files:
            raise HTTPException(502, f"CASParser: {data.get('msg', 'no files returned')}")

        DATA_DIR.mkdir(exist_ok=True)
        saved, failed = [], []
        for i, f in enumerate(files):
            url = f.get("url", "")
            if not _allowed_host(url):
                failed.append({"file": f.get("filename"), "error": "unexpected download host"})
                continue
            try:
                dl = await client.get(url, follow_redirects=True)
                dl.raise_for_status()
            except httpx.HTTPError as e:
                failed.append({"file": f.get("filename"), "error": str(e)})
                continue
            if not dl.content.startswith(b"%PDF"):
                failed.append({"file": f.get("filename"), "error": "downloaded file is not a PDF"})
                continue
            path = _target_path(pan, f.get("filename", ""), i)
            path.write_bytes(dl.content)
            saved.append(path)

    SESSIONS.pop(req.session_id, None)
    log.info("Saved %d file(s), %d failed", len(saved), len(failed))
    for n, f in enumerate(failed, 1):  # file names contain the BO ID, so don't log them
        log.warning("Download %d failed: %s", n, f["error"])
    if not saved:
        msg = "Fetched, but no PDF could be saved"
        if API_KEY.startswith("sandbox"):
            msg += " (sandbox key: CASParser returns fake download links; set a real CASPARSER_API_KEY in .env)"
        raise HTTPException(502, {"msg": msg, "failed": failed})
    parsed = [parse_and_store(p, PARSED_DIR) for p in saved]
    return {"msg": data.get("msg"), "saved": [p.name for p in saved], "failed": failed, "parsed": parsed}
