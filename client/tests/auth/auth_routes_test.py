from __future__ import annotations

from unittest.mock import Mock


def test_signup_is_blocked_when_feature_toggle_is_disabled(auth_app_factory):
    gateway = Mock()
    app, _ = auth_app_factory(gateway=gateway, signup_enabled=lambda: False)
    client = app.test_client()

    resp = client.post(
        "/auth/signup",
        json={"user_name": "alice", "email": "alice@example.com", "password": "secret"},
    )

    assert resp.status_code == 403
    assert resp.get_json() == {"detail": "Public registration is currently disabled"}
    gateway.signup.assert_not_called()


def test_login_success_strips_bearer_prefix_sets_session_and_secure_cookie(auth_app_factory):
    gateway = Mock()
    gateway.login.return_value = (
        {
            "token": "Bearer super-secret-token",
            "user": {"user_id": 17, "email": "alice@example.com", "is_admin": True},
        },
        200,
    )

    app, _ = auth_app_factory(gateway=gateway)
    client = app.test_client()

    resp = client.post(
        "/auth/login",
        json={"email": "  alice@example.com  ", "password": "pw"},
        headers={"X-Forwarded-Proto": "https"},
    )
    set_cookie_header = "\n".join(resp.headers.getlist("Set-Cookie"))

    assert resp.status_code == 200
    assert resp.get_json() == {
        "user": {"user_id": 17, "email": "alice@example.com", "is_admin": True}
    }
    assert "access_token=super-secret-token" in set_cookie_header
    assert "HttpOnly" in set_cookie_header
    assert "Secure" in set_cookie_header
    assert "SameSite=Lax" in set_cookie_header

    gateway.login.assert_called_once_with("alice@example.com", "pw")

    with client.session_transaction() as sess:
        assert sess["current_user"]["user_id"] == 17
        assert sess["is_admin"] is True


def test_login_rejects_gateway_payload_without_token_or_user(auth_app_factory):
    gateway = Mock()
    gateway.login.return_value = ({"user": {"user_id": 1}}, 200)

    app, _ = auth_app_factory(gateway=gateway)
    client = app.test_client()

    resp = client.post("/auth/login", json={"email": "alice@example.com", "password": "pw"})

    assert resp.status_code == 502
    assert resp.get_json() == {"detail": "Gateway login response missing token or user"}

    with client.session_transaction() as sess:
        assert dict(sess) == {}


def test_auth_me_clears_session_and_cookie_on_unauthorized(auth_app_factory):
    gateway = Mock()
    gateway.fetch_me.return_value = (None, 401)

    app, _ = auth_app_factory(gateway=gateway)
    client = app.test_client()
    client.set_cookie("access_token", "bad-token")
    with client.session_transaction() as sess:
        sess["current_user"] = {"user_id": 1}
        sess["is_admin"] = True

    resp = client.get("/auth/me", headers={"X-Forwarded-Proto": "https"})
    clear_cookie_header = "\n".join(resp.headers.getlist("Set-Cookie"))

    assert resp.status_code == 401
    assert resp.get_json() == {"detail": "Unauthorized"}
    assert "access_token=" in clear_cookie_header
    assert "Expires=Thu, 01 Jan 1970" in clear_cookie_header
    assert "Secure" in clear_cookie_header

    with client.session_transaction() as sess:
        assert dict(sess) == {}


def test_admin_route_denies_non_admin_user_after_gateway_revalidation(auth_app_factory):
    gateway = Mock()
    gateway.fetch_me.return_value = ({"user_id": 1, "is_admin": False}, 200)
    app, _ = auth_app_factory(gateway=gateway)
    client = app.test_client()
    client.set_cookie("access_token", "valid-token")
    with client.session_transaction() as sess:
        sess["current_user"] = {"user_id": 1, "is_admin": False}
        sess["is_admin"] = False

    resp = client.get("/admin")

    assert resp.status_code == 403
    assert resp.get_data(as_text=True) == "Forbidden: Admin access required"
    gateway.fetch_me.assert_called_once_with("valid-token")
