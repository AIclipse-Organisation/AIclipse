from __future__ import annotations

import time
from unittest.mock import Mock


def test_middleware_redirects_and_clears_session_when_cookie_is_missing(auth_app_factory):
    gateway = Mock()
    app, _ = auth_app_factory(gateway=gateway, with_blueprint=False, with_middleware=True)

    @app.get("/protected")
    def protected():
        return "OK", 200

    client = app.test_client()
    with client.session_transaction() as sess:
        sess["current_user"] = {"user_id": 1}
        sess["is_admin"] = True

    resp = client.get("/protected")

    assert resp.status_code == 302
    assert resp.headers["Location"].endswith("/")
    assert "Cache-Control" in resp.headers
    assert "access_token=" not in "\n".join(resp.headers.getlist("Set-Cookie"))
    gateway.fetch_me.assert_not_called()

    with client.session_transaction() as sess:
        assert dict(sess) == {}


def test_middleware_uses_recent_session_cache_and_skips_gateway_lookup(auth_app_factory):
    gateway = Mock()
    app, _ = auth_app_factory(gateway=gateway, with_blueprint=False, with_middleware=True, cache_ttl=30)

    @app.get("/protected")
    def protected():
        return "OK", 200

    client = app.test_client()
    client.set_cookie("access_token", "cached-token")
    with client.session_transaction() as sess:
        sess["current_user"] = {"user_id": 123}
        sess["auth_checked_at"] = int(time.time())

    resp = client.get("/protected")

    assert resp.status_code == 200
    assert resp.get_data(as_text=True) == "OK"
    gateway.fetch_me.assert_not_called()


def test_middleware_revalidates_stale_session_and_clears_cookie_on_failure(auth_app_factory):
    gateway = Mock()
    gateway.fetch_me.return_value = (None, 401)

    app, _ = auth_app_factory(gateway=gateway, with_blueprint=False, with_middleware=True, cache_ttl=30)

    @app.get("/protected")
    def protected():
        return "OK", 200

    client = app.test_client()
    client.set_cookie("access_token", "expired-token")
    with client.session_transaction() as sess:
        sess["current_user"] = {"user_id": 1}
        sess["auth_checked_at"] = int(time.time()) - 60
        sess["extra"] = "should disappear"

    resp = client.get("/protected", headers={"X-Forwarded-Proto": "https"})
    clear_cookie_header = "\n".join(resp.headers.getlist("Set-Cookie"))

    assert resp.status_code == 302
    assert resp.headers["Location"].endswith("/")
    assert "access_token=" in clear_cookie_header
    assert "Expires=Thu, 01 Jan 1970" in clear_cookie_header
    assert "Secure" in clear_cookie_header
    gateway.fetch_me.assert_called_once_with("expired-token")

    with client.session_transaction() as sess:
        assert dict(sess) == {}
