from __future__ import annotations

from io import BytesIO
from unittest.mock import Mock

from tests.conftest import ResponseStub


def test_billing_checkout_rejects_invalid_plan_id_before_any_gateway_call(main_client_module):
    main_client_module.gateway.fetch_me = Mock(side_effect=AssertionError("fetch_me must not be called"))
    main_client_module.gateway.call_json = Mock(side_effect=AssertionError("call_json must not be called"))

    client = main_client_module.app.test_client()
    client.set_cookie("access_token", "user-token")

    resp = client.post("/billing/create-checkout-session", json={"plan_id": "not-an-int"})

    assert resp.status_code == 400
    assert resp.get_json() == {"detail": "Invalid plan_id"}


def test_billing_checkout_fetches_missing_user_and_forwards_normalized_payload(main_client_module):
    main_client_module.gateway.fetch_me = Mock(
        return_value=({"user_id": 77, "email": "bill@example.com", "is_admin": False}, 200)
    )
    main_client_module.gateway.call_json = Mock(return_value=({"checkout_url": "https://pay.example/session"}, 200))

    client = main_client_module.app.test_client()
    client.set_cookie("access_token", "billing-token")

    resp = client.post("/billing/create-checkout-session", json={"plan_id": "2"})

    assert resp.status_code == 200
    assert resp.get_json() == {"checkout_url": "https://pay.example/session"}
    main_client_module.gateway.fetch_me.assert_called_once_with("billing-token")
    main_client_module.gateway.call_json.assert_called_once_with(
        "POST",
        "/billing/create-checkout-session",
        token="billing-token",
        json_data={"user_id": 77, "plan_id": 2, "email": "bill@example.com"},
    )

    with client.session_transaction() as sess:
        assert sess["current_user"]["user_id"] == 77
        assert sess["is_admin"] is False


def test_billing_checkout_clears_session_and_cookie_when_revalidation_fails(main_client_module):
    main_client_module.gateway.fetch_me = Mock(return_value=(None, 401))
    main_client_module.gateway.call_json = Mock(side_effect=AssertionError("call_json must not be called"))

    client = main_client_module.app.test_client()
    client.set_cookie("access_token", "expired-token")
    with client.session_transaction() as sess:
        sess["current_user"] = {"name": "incomplete-user"}
        sess["extra"] = "remove-me"

    resp = client.post(
        "/billing/create-checkout-session",
        json={"plan_id": 1},
        headers={"X-Forwarded-Proto": "https"},
    )
    clear_cookie_header = "\n".join(resp.headers.getlist("Set-Cookie"))

    assert resp.status_code == 401
    assert resp.get_json() == {"detail": "Unauthorized"}
    assert "access_token=" in clear_cookie_header
    assert "Expires=Thu, 01 Jan 1970" in clear_cookie_header
    assert "Secure" in clear_cookie_header

    with client.session_transaction() as sess:
        assert dict(sess) == {}


def test_checks_returns_502_when_gateway_answers_with_non_json(main_client_module, monkeypatch):
    def fake_post(url, headers, files, timeout):
        assert url == "http://gateway.test/checks"
        assert headers["Authorization"] == "Bearer check-token"
        assert files["file"][0] == "sample.png"
        assert files["file"][1] == b"binary-image"
        assert files["file"][2] == "image/png"
        assert timeout == 60
        return ResponseStub(200, json_exc=ValueError("not json"))

    monkeypatch.setattr(main_client_module.requests, "post", fake_post)

    client = main_client_module.app.test_client()
    client.set_cookie("access_token", "check-token")

    resp = client.post(
        "/checks",
        data={"file": (BytesIO(b"binary-image"), "sample.png", "image/png")},
        content_type="multipart/form-data",
    )

    assert resp.status_code == 502
    assert resp.get_json() == {"detail": "Invalid JSON from gateway on /checks"}


def test_billing_subscription_status_uses_session_user_and_proxies(main_client_module):
    main_client_module.gateway.call_json = Mock(
        return_value=({"status": "active", "cancel_at_period_end": False}, 200)
    )

    client = main_client_module.app.test_client()
    client.set_cookie("access_token", "billing-token")
    with client.session_transaction() as sess:
        sess["current_user"] = {"user_id": "u_42", "email": "u42@example.com"}

    resp = client.get("/billing/subscription/status")

    assert resp.status_code == 200
    assert resp.get_json() == {"status": "active", "cancel_at_period_end": False}
    main_client_module.gateway.call_json.assert_called_once_with(
        "GET",
        "/api/billing/subscription/status?user_id=u_42",
        token="billing-token",
    )


def test_billing_subscription_status_fetches_user_when_missing(main_client_module):
    main_client_module.gateway.fetch_me = Mock(
        return_value=({"user_id": "u_99", "email": "u99@example.com", "is_admin": False}, 200)
    )
    main_client_module.gateway.call_json = Mock(
        return_value=({"status": "active", "billing_period_end": "2026-06-01T00:00:00+00:00"}, 200)
    )

    client = main_client_module.app.test_client()
    client.set_cookie("access_token", "billing-token")

    resp = client.get("/billing/subscription/status")

    assert resp.status_code == 200
    assert resp.get_json()["status"] == "active"
    main_client_module.gateway.fetch_me.assert_called_once_with("billing-token")
    main_client_module.gateway.call_json.assert_called_once_with(
        "GET",
        "/api/billing/subscription/status?user_id=u_99",
        token="billing-token",
    )


def test_billing_subscription_status_clears_session_on_revalidation_401(main_client_module):
    main_client_module.gateway.fetch_me = Mock(return_value=(None, 401))
    main_client_module.gateway.call_json = Mock(side_effect=AssertionError("call_json must not be called"))

    client = main_client_module.app.test_client()
    client.set_cookie("access_token", "expired-token")
    with client.session_transaction() as sess:
        sess["current_user"] = {"name": "incomplete-user"}
        sess["extra"] = "remove-me"

    resp = client.get("/billing/subscription/status", headers={"X-Forwarded-Proto": "https"})
    clear_cookie_header = "\n".join(resp.headers.getlist("Set-Cookie"))

    assert resp.status_code == 401
    assert resp.get_json() == {"detail": "Unauthorized"}
    assert "access_token=" in clear_cookie_header
    assert "Expires=Thu, 01 Jan 1970" in clear_cookie_header
    assert "Secure" in clear_cookie_header

    with client.session_transaction() as sess:
        assert dict(sess) == {}


def test_billing_cancel_subscription_requires_reason(main_client_module):
    main_client_module.gateway.call_json = Mock(side_effect=AssertionError("call_json must not be called"))

    client = main_client_module.app.test_client()
    client.set_cookie("access_token", "billing-token")

    resp = client.post("/billing/subscription/cancel-at-period-end", json={"reason": "   "})

    assert resp.status_code == 400
    assert resp.get_json() == {"detail": "Cancellation reason is required"}
    main_client_module.gateway.call_json.assert_not_called()


def test_billing_cancel_subscription_fetches_user_and_proxies_reason(main_client_module):
    main_client_module.gateway.fetch_me = Mock(
        return_value=({"user_id": "u_42", "email": "u42@example.com", "is_admin": False}, 200)
    )
    main_client_module.gateway.call_json = Mock(
        return_value=({"ok": True, "status": "cancel_scheduled"}, 200)
    )

    client = main_client_module.app.test_client()
    client.set_cookie("access_token", "billing-token")

    resp = client.post(
        "/billing/subscription/cancel-at-period-end",
        json={"reason": "Too expensive"},
    )

    assert resp.status_code == 200
    assert resp.get_json() == {"ok": True, "status": "cancel_scheduled"}
    main_client_module.gateway.fetch_me.assert_called_once_with("billing-token")
    main_client_module.gateway.call_json.assert_called_once_with(
        "POST",
        "/api/billing/subscription/cancel-at-period-end",
        token="billing-token",
        json_data={"user_id": "u_42", "reason": "Too expensive"},
    )


def test_billing_cancel_subscription_clears_session_on_revalidation_401(main_client_module):
    main_client_module.gateway.fetch_me = Mock(return_value=(None, 401))
    main_client_module.gateway.call_json = Mock(side_effect=AssertionError("call_json must not be called"))

    client = main_client_module.app.test_client()
    client.set_cookie("access_token", "expired-token")
    with client.session_transaction() as sess:
        sess["current_user"] = {"name": "incomplete-user"}
        sess["extra"] = "remove-me"

    resp = client.post(
        "/billing/subscription/cancel-at-period-end",
        json={"reason": "Too expensive"},
        headers={"X-Forwarded-Proto": "https"},
    )
    clear_cookie_header = "\n".join(resp.headers.getlist("Set-Cookie"))

    assert resp.status_code == 401
    assert resp.get_json() == {"detail": "Unauthorized"}
    assert "access_token=" in clear_cookie_header
    assert "Expires=Thu, 01 Jan 1970" in clear_cookie_header
    assert "Secure" in clear_cookie_header

    with client.session_transaction() as sess:
        assert dict(sess) == {}


def test_community_comments_rejects_invalid_post_id_without_calling_backend(main_client_module, monkeypatch):
    backend_get = Mock(side_effect=AssertionError("backend must not be called"))
    monkeypatch.setattr(main_client_module.requests, "get", backend_get)

    client = main_client_module.app.test_client()
    resp = client.get("/community/posts/comments?post_id=../../etc/passwd")

    assert resp.status_code == 400
    assert resp.get_json() == {"error": "Invalid post_id parameter"}
    backend_get.assert_not_called()
