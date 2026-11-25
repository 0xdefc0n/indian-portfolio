"""Parser entry point: error codes on synthetic PDFs. Real statements are covered in test_private.py."""

from __future__ import annotations

from engine.parse import parse_pdf
from engine.parsers import MAX_PAGES
from tests.conftest import make_pdf


def test_wrong_password():
    assert parse_pdf(make_pdf("right-one"), "wrong")["code"] == "wrong_password"


def test_right_password_but_not_a_statement():
    r = parse_pdf(make_pdf("right-one"), "right-one")
    assert r == {**r, "ok": False, "code": "unrecognised"}


def test_unencrypted_blank_pdf_is_unrecognised():
    assert parse_pdf(make_pdf(None), "")["code"] == "unrecognised"


def test_not_a_pdf():
    assert parse_pdf(b"hello, not a pdf", "")["code"] == "unrecognised"


def test_too_many_pages():
    assert parse_pdf(make_pdf("pw", pages=MAX_PAGES + 1), "pw")["code"] == "too_large"


def test_precheck_disagreement_is_reported_as_such():
    # the Worker says it verified the password and type; if the engine can't agree, that's a bug, not a user error
    assert parse_pdf(make_pdf("right-one"), "wrong", kind="CDSL")["code"] == "precheck_disagree"
    assert parse_pdf(make_pdf("right-one"), "right-one", kind="RTA")["code"] == "precheck_disagree"


def test_unknown_kind():
    assert parse_pdf(make_pdf(None), "", kind="NSDL")["code"] == "bad_request"


def test_results_carry_metrics_and_safe_messages():
    r = parse_pdf(make_pdf("right-one"), "wrong")
    assert r["metrics"]["cpu_ms"] >= 0 and r["metrics"]["peak_rss_mb"] > 0
    assert "right-one" not in r["message"] and "wrong" not in r["message"].replace("wrong password", "")
