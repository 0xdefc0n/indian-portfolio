"""Shared test helpers. Tests never print statement data; failures report paths, not values."""

from __future__ import annotations

import io
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]  # repo root
FIXTURES = Path(__file__).parent / "fixtures"


def roundtrip(obj):
    """JSON round trip, so tuples/lists and float formatting match what the API returns."""
    return json.loads(json.dumps(obj))


def diff_paths(a, b, path: str = "$", out: list | None = None, limit: int = 20) -> list[str]:
    """Where two JSON values differ, as paths only (no values), so a failure never prints personal data."""
    out = [] if out is None else out
    if len(out) >= limit:
        return out
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b), key=str):
            if k not in a or k not in b:
                out.append(f"{path}.{k} (missing on one side)")
            else:
                diff_paths(a[k], b[k], f"{path}.{k}", out, limit)
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            out.append(f"{path} (length {len(a)} vs {len(b)})")
        for i, (x, y) in enumerate(zip(a, b)):
            diff_paths(x, y, f"{path}[{i}]", out, limit)
    elif isinstance(a, float) and isinstance(b, (int, float)) or isinstance(b, float) and isinstance(a, (int, float)):
        if abs(a - b) > 1e-6:
            out.append(path)
    elif a != b:
        out.append(path)
    return out


def assert_same(a, b, what: str) -> None:
    paths = diff_paths(roundtrip(a), roundtrip(b))
    ok = not paths
    assert ok, f"{what} differ at: {paths}"  # paths only, never values


def make_pdf(password: str | None = None, pages: int = 1) -> bytes:
    """A blank PDF (optionally AES-256 encrypted) for parser error-path tests."""
    from pypdf import PdfWriter

    w = PdfWriter()
    for _ in range(pages):
        w.add_blank_page(width=595, height=842)
    if password is not None:
        w.encrypt(password, algorithm="AES-256")
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


@pytest.fixture(autouse=True)
def _no_stock_key(monkeypatch):
    # the legacy app reads this from the environment; parity tests need it off
    monkeypatch.delenv("BHARATSTOCK_API_KEY", raising=False)
