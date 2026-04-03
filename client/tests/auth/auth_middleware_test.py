from __future__ import annotations

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
    assert resp.headers["Location"].endswith("/login")
    assert "Cache-Control" in resp.headers
    assert "access_token=" not in "\n".join(resp.headers.getlist("Set-Cookie"))
    gateway.fetch_me.assert_not_called()

    with client.session_transaction() as sess:
        assert dict(sess) == {}


def test_middleware_revalidates_protected_pages_even_when_session_has_cached_user(auth_app_factory):
    gateway = Mock()
    gateway.fetch_me.return_value = ({"user_id": 123, "is_admin": False}, 200)
    app, _ = auth_app_factory(gateway=gateway, with_blueprint=False, with_middleware=True)

    @app.get("/protected")
    def protected():
        return "OK", 200

    client = app.test_client()
    client.set_cookie("access_token", "cached-token")
    with client.session_transaction() as sess:
        sess["current_user"] = {"user_id": 123}

    resp = client.get("/protected")

    assert resp.status_code == 200
    assert resp.get_data(as_text=True) == "OK"
    gateway.fetch_me.assert_called_once_with("cached-token")


def test_middleware_revalidates_stale_session_and_clears_cookie_on_failure(auth_app_factory):
    gateway = Mock()
    gateway.fetch_me.return_value = (None, 401)

    app, _ = auth_app_factory(gateway=gateway, with_blueprint=False, with_middleware=True)

    @app.get("/protected")
    def protected():
        return "OK", 200

    client = app.test_client()
    client.set_cookie("access_token", "expired-token")
    with client.session_transaction() as sess:
        sess["current_user"] = {"user_id": 1}
        sess["extra"] = "should disappear"

    resp = client.get("/protected", headers={"X-Forwarded-Proto": "https"})
    clear_cookie_header = "\n".join(resp.headers.getlist("Set-Cookie"))

    assert resp.status_code == 302
    assert resp.headers["Location"].endswith("/login")
    assert "access_token=" in clear_cookie_header
    assert "Expires=Thu, 01 Jan 1970" in clear_cookie_header
    assert "Secure" in clear_cookie_header
    gateway.fetch_me.assert_called_once_with("expired-token")

    with client.session_transaction() as sess:
        assert dict(sess) == {}


def test_middleware_blocks_cross_site_mutation_when_auth_cookie_is_present(auth_app_factory):
    gateway = Mock()
    app, _ = auth_app_factory(gateway=gateway, with_blueprint=False, with_middleware=True)

    @app.post("/protected-action")
    def protected_action():
        return "OK", 200

    client = app.test_client()
    client.set_cookie("access_token", "user-token")

    resp = client.post("/protected-action", headers={"Origin": "https://evil.example"})

    assert resp.status_code == 403
    assert resp.get_json() == {"detail": "Cross-site request blocked"}
    gateway.fetch_me.assert_not_called()


def test_middleware_allows_same_origin_mutation_when_auth_cookie_is_present(auth_app_factory):
    gateway = Mock()
    gateway.fetch_me.return_value = ({"user_id": 123, "is_admin": False}, 200)
    app, _ = auth_app_factory(gateway=gateway, with_blueprint=False, with_middleware=True)

    @app.post("/protected-action")
    def protected_action():
        return "OK", 200

    client = app.test_client()
    client.set_cookie("access_token", "user-token")
    with client.session_transaction() as sess:
        sess["current_user"] = {"user_id": 123}

    resp = client.post("/protected-action", headers={"Origin": "http://localhost"})

    assert resp.status_code == 200
    assert resp.get_data(as_text=True) == "OK"
    gateway.fetch_me.assert_called_once_with("user-token")
