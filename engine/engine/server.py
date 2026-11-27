"""Engine HTTP server (plan §14). Reached only through the Worker's EngineFast / EngineBatch Durable Objects.

POST /parse   body: the raw PDF bytes (application/pdf)
              headers: X-Pdf-Password (base64url of the UTF-8 password, may be empty), X-Statement-Kind (CDSL|RTA)
              → parse_pdf()'s result plus the engine `version`
              The body is read into memory. Multipart is deliberately not used: Starlette spools uploads over 1 MB
              to a temporary file on disk, and PDFs must never touch disk.
POST /build   JSON {statements, market, today, format?, overrides?} → the portfolio snapshot
              overrides: the user's SIP skips and cancels, [{member_id, isin, folio, kind: skip|cancel, due}] (M12);
              market.holidays: exchange holiday dates for SIP run days (M12)
              market.market_date set and no market.navs: the NAV series come from the NAV store (navstore.py),
              cached by market.nav_key (default: the market date); market.refresh lists codes to always read fresh.
              format "gzip": the body is the gzip-compressed snapshot JSON itself (application/x-snapshot+gzip, no
              Content-Encoding), with the metrics in X-Engine-* headers. The Worker seals those bytes as they are and
              never parses the snapshot (plan §10.2 "stream, don't parse").
              market.stocks: stock data the Worker loaded (stocks.py), or null. The funds the stocks view needs data
              for come back as X-Engine-Stocks-Want (base64url JSON [[isin, name], ...]; `stocks_want` in the JSON
              metrics), so the Worker's BharatStock job can fetch them (plan §10.3.1, M11). Public scheme ids only.
POST /stocks/parse  one AMC monthly portfolio disclosure file (plan §10.3.1, M18). Body: the want JSON
              ([[isin, name, amfi_name], ...], the AMC's funds the stocks view needs) followed by the file's raw bytes;
              headers X-Want-Bytes (the JSON's length), X-Amc (adapter slug), X-Filename. The Worker downloaded the
              file; the engine never calls out. → {ok, schemes, months, matched: {isin: {scheme_name, score, as_of,
              rows}}}, or {ok: false, code: unreadable} (422) when it isn't a workbook. Public market data only.
GET  /health  {version, isin_db} (no auth, no data)

One job at a time per process: a second concurrent /parse or /build gets 503 `busy` straight away. EnginePool
should never send one; this is the safety net (§3.5).
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import gzip
import hmac
import importlib.metadata
import json
import logging
import os
from datetime import date

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

from . import VERSION, amc, navstore, stocks
from .parse import parse_pdf, peak_rss_mb
from .portfolio import build_portfolio, market_requirements

MAX_PDF_BYTES = 10 * 1024 * 1024
MAX_BUILD_BYTES = 64 * 1024 * 1024
MAX_DISCLOSURE_BYTES = 48 * 1024 * 1024
MAX_WANT_BYTES = 1024 * 1024

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
            del body
            statements = req["statements"]
            today = date.fromisoformat(req["today"]) if req.get("today") else None
            market = dict(req.get("market") or {})
            market_date = market.get("market_date")
            if market_date is not None:
                date.fromisoformat(market_date)
            overrides = req.get("overrides") or []  # the user's SIP skips and cancels (M12)
            if not isinstance(overrides, list):
                raise TypeError("overrides")
        except (ValueError, KeyError, TypeError):
            return _error(400, "bad_request", "Expected JSON {statements, market?, today?, overrides?}")
        try:
            result, want = await asyncio.to_thread(_build, statements, market, today, req.get("format") == "gzip", overrides)
        except navstore.NavStoreError as e:
            log.warning("nav store failed: %s", e)
            return _error(502, "nav_store_error", "Could not read NAVs")
        except Exception as e:  # never log the data, only the class
            log.warning("build failed: %s", type(e).__name__)
            return _error(500, "build_error", "Could not build the portfolio")
        del req, statements
        if isinstance(result, bytes):
            return Response(result, media_type="application/x-snapshot+gzip", headers=_metric_headers(want))
        return JSONResponse({"ok": True, "snapshot": result, "metrics": {**_metrics(), "stocks_want": want}})


@app.post("/stocks/parse")
async def stocks_parse(request: Request):
    if _job.locked():
        return _error(503, "busy", "Engine is busy")
    async with _job:
        slug = request.headers.get("x-amc", "")
        filename = request.headers.get("x-filename", "")[:200]
        want_bytes = request.headers.get("x-want-bytes", "")
        if slug not in amc.SLUGS or not want_bytes.isdigit() or int(want_bytes) > MAX_WANT_BYTES:
            return _error(400, "bad_request", "Expected X-Amc, X-Want-Bytes and a body")
        body = await _read_body(request, MAX_DISCLOSURE_BYTES + MAX_WANT_BYTES)
        if body is None:
            return _error(413, "too_large", "Disclosure file too large")
        n = int(want_bytes)
        try:
            want = json.loads(body[:n])
            if not isinstance(want, list) or not all(isinstance(w, list) and w and isinstance(w[0], str) for w in want):
                raise TypeError("want")
        except (ValueError, TypeError):
            return _error(400, "bad_request", "Bad want list")
        content = body[n:]
        del body
        try:
            result = await asyncio.to_thread(amc.parse_file, slug, content, filename, want)
        except amc.UnreadableFile as e:
            return _error(422, "unreadable", str(e)[:40])
        except Exception as e:  # public data, but keep logs to the class like everywhere else
            log.warning("disclosure parse failed: %s", type(e).__name__)
            return _error(500, "parse_error", "Could not parse the disclosure")
        return JSONResponse({**result, "metrics": {"peak_rss_mb": peak_rss_mb()}})


def _build(statements: list, market: dict, today: date | None, gz: bool,
           overrides: list | None = None) -> tuple[dict | bytes, list[list[str]]]:
    """The CPU part of /build (a thread). NAVs come from the NAV store unless the request carries them."""
    if market.get("market_date") and market.get("navs") is None and navstore.store_url():
        need = market_requirements(statements, market.get("isin_to_code") or {})
        refresh = {str(c) for c in market.get("refresh") or []}
        market["navs"] = navstore.load(need["codes"], str(market.get("nav_key") or market["market_date"]), refresh=refresh)
    snapshot = build_portfolio(statements, market, today, overrides)
    want = stocks.wanted(snapshot["holdings"], market.get("stocks"))
    if not gz:
        return snapshot, want
    body = json.dumps(snapshot, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()
    return gzip.compress(body, compresslevel=6, mtime=0), want


def _metrics() -> dict:
    c = navstore.CACHE
    return {"peak_rss_mb": peak_rss_mb(), "nav_cache": {"series": len(c), "points": c.points, "hits": c.hits, "misses": c.misses}}


def _metric_headers(want: list[list[str]]) -> dict:
    m = _metrics()
    return {"X-Engine-Peak-Rss-Mb": str(m["peak_rss_mb"]), "X-Engine-Nav-Hits": str(m["nav_cache"]["hits"]),
            "X-Engine-Nav-Misses": str(m["nav_cache"]["misses"]), "X-Engine-Stocks-Want": encode_want(want)}


def encode_want(want: list[list[str]]) -> str:
    """base64url (no padding) of the compact JSON, so any scheme name fits in a header."""
    raw = json.dumps(want, separators=(",", ":"), ensure_ascii=False).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")
