"""HTTP layer: auth, the one-job rule, raw-body /parse, /build."""

from __future__ import annotations

import asyncio
import base64
import json

import pytest
from fastapi.testclient import TestClient

from engine import server
from tests.conftest import FIXTURES, assert_same, make_pdf
from tests.fixtures import synthetic

KEY = "test-engine-key"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("ENGINE_SHARED_SECRET", KEY)
    return TestClient(server.app)


def _pw(p: str) -> str:
    return base64.urlsafe_b64encode(p.encode()).decode().rstrip("=")


def test_health_needs_no_key_and_shows_no_data(client):
    r = client.get("/health")
    assert r.status_code == 200 and set(r.json()) == {"ok", "version", "isin_db", "busy"}


def test_key_required(client):
    assert client.post("/parse", content=b"%PDF").status_code == 401
    assert client.post("/parse", content=b"%PDF", headers={"X-Engine-Key": "nope"}).status_code == 401


def test_unconfigured_engine_fails_closed(monkeypatch):
    monkeypatch.delenv("ENGINE_SHARED_SECRET", raising=False)
    assert TestClient(server.app).post("/parse", content=b"%PDF", headers={"X-Engine-Key": ""}).status_code == 503


def test_parse_raw_body(client):
    pdf = make_pdf("s3cret p@ss")  # spaces and symbols survive base64url
    h = {"X-Engine-Key": KEY, "Content-Type": "application/pdf"}
    assert client.post("/parse", content=pdf, headers={**h, "X-Pdf-Password": _pw("nope")}).json()["code"] == "wrong_password"
    r = client.post("/parse", content=pdf, headers={**h, "X-Pdf-Password": _pw("s3cret p@ss")}).json()
    assert r["code"] == "unrecognised"  # opened, but a blank page isn't a statement
    assert r["version"] == server.VERSION  # the Worker stores it as statement.parser_version
    r = client.post("/parse", content=pdf, headers={**h, "X-Pdf-Password": _pw("nope"), "X-Statement-Kind": "CDSL"}).json()
    assert r["code"] == "precheck_disagree"
    assert client.post("/parse", content=b"not a pdf", headers=h).json()["code"] == "unrecognised"
    assert client.post("/parse", content=pdf, headers={**h, "X-Pdf-Password": "@@@"}).status_code == 400


def test_parse_size_limit(client):
    big = b"%PDF" + b"0" * (server.MAX_PDF_BYTES + 1)
    assert client.post("/parse", content=big, headers={"X-Engine-Key": KEY}).status_code == 413


def test_busy_engine_answers_503_immediately(client, monkeypatch):
    monkeypatch.setattr(server, "_job", asyncio.Semaphore(0))  # as if a job were running
    r = client.post("/parse", content=make_pdf(None), headers={"X-Engine-Key": KEY})
    assert r.status_code == 503 and r.json()["code"] == "busy"
    assert client.post("/build", json={"statements": []}, headers={"X-Engine-Key": KEY}).status_code == 503
    assert client.get("/health").json()["busy"] is True


def test_build_endpoint_matches_golden(client):
    body = {"statements": synthetic.statements(), "market": synthetic.market(), "today": synthetic.TODAY.isoformat()}
    r = client.post("/build", content=json.dumps(body), headers={"X-Engine-Key": KEY, "Content-Type": "application/json"})
    assert r.status_code == 200 and r.json()["ok"] is True
    assert_same(r.json()["snapshot"], json.loads((FIXTURES / "golden_snapshot.json").read_text()), "API snapshot vs golden")


def test_build_bad_request(client):
    assert client.post("/build", content=b"{}", headers={"X-Engine-Key": KEY}).status_code == 400
    assert client.post("/build", content=b"nope", headers={"X-Engine-Key": KEY}).status_code == 400
