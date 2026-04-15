from __future__ import annotations

from flask import make_response, request

from auth.cookies import clear_access_cookie, is_request_secure, set_access_cookie
from auth.request_policy import is_api_request, json_error


def test_is_request_secure_prefers_forwarded_proto_over_scheme(flask_app):
    with flask_app.test_request_context("/", base_url="http://example.test", headers={"X-Forwarded-Proto": "https, http"}):
        assert is_request_secure(request) is True

    with flask_app.test_request_context("/", base_url="https://example.test", headers={"X-Forwarded-Proto": "http"}):
        assert is_request_secure(request) is False


def test_set_and_clear_access_cookie_apply_expected_security_flags(flask_app):
    with flask_app.test_request_context("/", base_url="https://example.test"):
        login_resp = make_response("ok")
        set_access_cookie(login_resp, request, "secret-token", max_age_seconds=321)
        set_cookie_header = login_resp.headers.get("Set-Cookie", "")

        assert "access_token=secret-token" in set_cookie_header
        assert "HttpOnly" in set_cookie_header
        assert "Secure" in set_cookie_header
        assert "SameSite=Lax" in set_cookie_header
        assert "Max-Age=321" in set_cookie_header
        assert "Path=/" in set_cookie_header

        logout_resp = make_response("ok")
        clear_access_cookie(logout_resp, request)
        clear_cookie_header = logout_resp.headers.get("Set-Cookie", "")

        assert "access_token=" in clear_cookie_header
        assert "Expires=Thu, 01 Jan 1970" in clear_cookie_header
        assert "HttpOnly" in clear_cookie_header
        assert "Secure" in clear_cookie_header
        assert "SameSite=Lax" in clear_cookie_header
        assert "Path=/" in clear_cookie_header


def test_is_api_request_detects_only_real_api_signals(flask_app):
    with flask_app.test_request_context("/profile", method="GET", headers={"Accept": "text/html"}):
        assert is_api_request(request) is False

    with flask_app.test_request_context("/community/posts", method="GET"):
        assert is_api_request(request) is True

    with flask_app.test_request_context("/profile", method="GET", headers={"Accept": "application/json"}):
        assert is_api_request(request) is True

    with flask_app.test_request_context("/profile", method="GET", headers={"X-Requested-With": "XMLHttpRequest"}):
        assert is_api_request(request) is True

    with flask_app.test_request_context("/profile", method="OPTIONS"):
        assert is_api_request(request) is True


def test_json_error_returns_expected_shape():
    payload, status = json_error("bad request", status=400)
    assert payload == {"detail": "bad request"}
    assert status == 400
