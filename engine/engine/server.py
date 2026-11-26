"""Engine HTTP server (plan §14). Reached only through the Worker's EngineFast / EngineBatch Durable Objects.

POST /parse   body: the raw PDF bytes (application/pdf)
              headers: X-Pdf-Password (base64url of the UTF-8 password, may be empty), X-Statement-Kind (CDSL|RTA)
              → parse_pdf()'s result plus the engine `version`
              The body is read into memory. Multipart is deliberately not used: Starlette spools uploads over 1 MB
              to a temporary file on disk, and PDFs must never touch disk.
POST /build   JSON {statements, market, today} → the portfolio snapshot
GET  /health  {version, isin_db} (no auth, no data)

One job at a time per process: a second concurrent /parse or /build gets 503 `busy` straight away. EnginePool
should never send one; this is the safety net (§3.5).
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import hmac
import importlib.metadata
import json
import logging
import os
from datetime import date

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from . import VERSION
from .parse import parse_pdf, peak_rss_mb
from .portfolio import build_portfolio

MAX_PDF_BYTES = 10 * 1024 * 1024
MAX_BUILD_BYTES = 64 * 1024 * 1024

logging.basicConfig(level=os.getenv("ENGINE_LOG_LEVEL", "WARNING"), format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("engine.server")

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
_job = asyncio.Semaphore(1)


def _isin_db_version() -> str | None:
    try:
        return importlib.metadata.version("casparser-isin")
    except importlib.metadata.PackageNotFoundError:
        return None


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"ok": False, "code": code, "message": message}, status_code=status)


@app.middleware("http")
async def require_engine_key(request: Request, call_next):
    if request.url.path == "/health":
        return await call_next(request)
    secret = os.getenv("ENGINE_SHARED_SECRET", "")
    if not secret:  # fail closed: an unconfigured engine serves nothing
        return _error(503, "not_configured", "Engine key not configured")
    given = request.headers.get("x-engine-key", "")
    if not hmac.compare_digest(given.encode(), secret.encode()):
        return _error(401, "unauthorized", "Missing or wrong engine key")
    return await call_next(request)


@app.get("/health")
async def health():
    return {"ok": True, "version": VERSION, "isin_db": _isin_db_version(), "busy": _job.locked()}


async def _read_body(request: Request, limit: int) -> bytes | None:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        return None
    body = await request.body()  # in memory, never spooled to disk
    return None if len(body) > limit else body


@app.post("/parse")
async def parse(request: Request):
    if _job.locked():
        return _error(503, "busy", "Engine is busy")
    async with _job:
        data = await _read_body(request, MAX_PDF_BYTES)
        if data is None:
            return _error(413, "too_large", "PDF is larger than 10 MB")
        if not data.startswith(b"%PDF"):
            return JSONResponse({"ok": False, "code": "unrecognised", "message": "Not a PDF file"})
        try:
            raw = request.headers.get("x-pdf-password", "")
            padded = raw + "=" * (-len(raw) % 4)
            password = base64.b64decode(padded, altchars=b"-_", validate=True).decode() if raw else ""
        except (binascii.Error, UnicodeDecodeError):
            return _error(400, "bad_request", "X-Pdf-Password must be base64url")
        kind = request.headers.get("x-statement-kind") or None
        result = await asyncio.to_thread(parse_pdf, data, password, kind)
        del data, password
        return JSONResponse({**result, "version": VERSION})  # stored as statement.parser_version


@app.post("/build")
async def build(request: Request):
    if _job.locked():
        return _error(503, "busy", "Engine is busy")
    async with _job:
        body = await _read_body(request, MAX_BUILD_BYTES)
        if body is None:
            return _error(413, "too_large", "Build request too large")
        try:
            req = json.loads(body)
            statements = req["statements"]
            today = date.fromisoformat(req["today"]) if req.get("today") else None
        except (ValueError, KeyError, TypeError):
            return _error(400, "bad_request", "Expected JSON {statements, market?, today?}")
        try:
            snapshot = await asyncio.to_thread(build_portfolio, statements, req.get("market") or {}, today)
        except Exception as e:  # never log the data, only the class
            log.warning("build failed: %s", type(e).__name__)
            return _error(500, "build_error", "Could not build the portfolio")
        return JSONResponse({"ok": True, "snapshot": snapshot, "metrics": {"peak_rss_mb": peak_rss_mb()}})
