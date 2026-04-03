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
    proxy_call = Mock(return_value=({"detail": "Invalid JSON from gateway on /checks"}, 502))
    monkeypatch.setattr(main_client_module.route_detection, "proxy_gateway_multipart_request", proxy_call)

    client = main_client_module.app.test_client()
    client.set_cookie("access_token", "check-token")

    resp = client.post(
        "/checks",
        data={"file": (BytesIO(b"binary-image"), "sample.png", "image/png")},
        content_type="multipart/form-data",
    )

    assert resp.status_code == 502
    assert resp.get_json() == {"detail": "Invalid JSON from gateway on /checks"}
    proxy_call.assert_called_once()
    assert proxy_call.call_args.kwargs == {
        "method": "POST",
        "base_url": "http://gateway.test",
        "path": "/checks",
        "token": "check-token",
        "files": {"file": ("sample.png", b"binary-image", "image/png")},
        "invalid_json_detail": "Invalid JSON from gateway on /checks",
    }


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


def test_get_image_proxies_through_gateway_media_service(main_client_module, monkeypatch):
    proxy_call = Mock(return_value=({"item": {"image_id": "img_123"}}, 200))
    monkeypatch.setattr(main_client_module.route_library, "proxy_gateway_json_request", proxy_call)

    client = main_client_module.app.test_client()
    client.set_cookie("access_token", "img-token")

    resp = client.get("/image/img_123")

    assert resp.status_code == 200
    assert resp.get_json() == {"item": {"image_id": "img_123"}}
    proxy_call.assert_called_once_with(
        method="GET",
        base_url="http://gateway.test",
        path="/image/img_123",
        token="img-token",
        invalid_json_detail="Invalid JSON from gateway on /image",
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


def test_community_moderation_status_forwards_request_correctly(main_client_module, monkeypatch):
    def fake_request(method, url, headers=None, json=None, params=None, timeout=None):
        assert method == "POST"
        assert url == "http://gateway.test/community/posts/moderation-status"
        assert json == {"image_ids": ["img_123", "img_456"]}
        assert headers["Content-Type"] == "application/json"
        assert headers["Accept"] == "application/json"
        assert params is None
        assert timeout == 10
        return ResponseStub(200, {"items": [{"image_id": "img_123", "moderation_status": "removed"}]})

    monkeypatch.setattr(main_client_module.requests, "request", fake_request)

    client = main_client_module.app.test_client()
    resp = client.post(
        "/community/posts/moderation-status",
        json={"image_ids": ["img_123", "img_456"]},
        headers={"Content-Type": "application/json"}
    )

    assert resp.status_code == 200
    data = resp.get_json()
    assert "items" in data
    assert len(data["items"]) == 1
    assert data["items"][0]["image_id"] == "img_123"
    assert data["items"][0]["moderation_status"] == "removed"


def test_community_moderation_status_handles_invalid_json(main_client_module):
    client = main_client_module.app.test_client()
    resp = client.post(
        "/community/posts/moderation-status",
        data="invalid-json",
        headers={"Content-Type": "application/json"}
    )

    assert resp.status_code == 400
    assert resp.get_json() == {"error": "Invalid JSON"}


def test_community_moderation_status_handles_service_unavailable(main_client_module, monkeypatch):
    def fake_request(method, url, headers=None, json=None, params=None, timeout=None):
        raise main_client_module.requests.RequestException("Connection failed")

    monkeypatch.setattr(main_client_module.requests, "request", fake_request)

    client = main_client_module.app.test_client()
    resp = client.post(
        "/community/posts/moderation-status",
        json={"image_ids": ["img_123"]},
        headers={"Content-Type": "application/json"}
    )

    assert resp.status_code == 502
    assert resp.get_json() == {"detail": "Gateway unreachable"}


def test_create_community_post_uses_proxy_status_and_token(main_client_module, monkeypatch):
    def fake_request(method, url, headers=None, json=None, params=None, timeout=None):
        assert method == "POST"
        assert url == "http://gateway.test/community/posts"
        assert headers == {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": "Bearer user-token",
        }
        assert json == {"image_id": "img_123", "description": "hello"}
        assert params is None
        assert timeout == 10
        return ResponseStub(201, {"post_id": "post_123"})

    monkeypatch.setattr(main_client_module.requests, "request", fake_request)

    client = main_client_module.app.test_client()
    client.set_cookie("access_token", "user-token")

    resp = client.post("/community/posts", json={"image_id": "img_123", "description": "hello"})

    assert resp.status_code == 201
    assert resp.get_json() == {"post_id": "post_123"}


def test_community_notifications_read_returns_proxy_status(main_client_module, monkeypatch):
    def fake_request(method, url, headers=None, json=None, params=None, timeout=None):
        assert method == "POST"
        assert url == "http://gateway.test/community/notifications/read"
        assert headers == {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": "Bearer notify-token",
        }
        assert json == {"notification_ids": ["n_1"]}
        assert params is None
        assert timeout == 10
        return ResponseStub(204, {})

    monkeypatch.setattr(main_client_module.requests, "request", fake_request)

    client = main_client_module.app.test_client()
    client.set_cookie("access_token", "notify-token")

    resp = client.post("/community/notifications/read", json={"notification_ids": ["n_1"]})

    assert resp.status_code == 204


def test_viewscan_html_route_bootstraps_canonical_image_id(main_client_module):
    main_client_module.gateway.fetch_me = Mock(
        return_value=({"user_id": "u_1", "email": "user@example.com", "is_admin": False}, 200)
    )

    client = main_client_module.app.test_client()
    client.set_cookie("access_token", "user-token")

    resp = client.get("/viewscan/img_123")

    assert resp.status_code == 200
    html = resp.get_data(as_text=True)
    assert 'id="viewscan-bootstrap"' in html
    assert 'data-image-id="img_123"' in html


def test_profile_route_does_not_inline_scans_bootstrap(main_client_module):
    client = main_client_module.app.test_client()
    client.set_cookie("access_token", "user-token")
    with client.session_transaction() as sess:
        sess["current_user"] = {"user_id": "u_1", "email": "user@example.com", "is_admin": False}
        sess["auth_checked_at"] = 9999999999

    resp = client.get("/profile")

    assert resp.status_code == 200
    html = resp.get_data(as_text=True)
    assert 'id="scans-page-model"' not in html


def test_viewscan_html_route_embeds_server_page_model_when_available(main_client_module, monkeypatch):
    main_client_module.gateway.fetch_me = Mock(
        return_value=({"user_id": "u_1", "email": "user@example.com", "is_admin": False}, 200)
    )

    def fake_get(url, headers=None, params=None, timeout=None):
        if url == "http://gateway.test/image/img_123":
            return ResponseStub(
                200,
                {"item": {"image_id": "img_123", "url": "https://cdn.example/img.png", "is_public": False}},
            )
        raise AssertionError(f"Unexpected GET {url}")

    def fake_post(url, headers=None, data=None, files=None, json=None, timeout=None):
        assert url == "http://gateway.test/community/posts/moderation-status"
        assert json == {"image_ids": ["img_123"]}
        return ResponseStub(200, {"items": []})

    monkeypatch.setattr(main_client_module.requests, "get", fake_get)
    monkeypatch.setattr(main_client_module.requests, "post", fake_post)

    client = main_client_module.app.test_client()
    client.set_cookie("access_token", "user-token")

    resp = client.get("/viewscan/img_123")

    assert resp.status_code == 200
    html = resp.get_data(as_text=True)
    assert 'id="viewscan-page-model"' in html
    assert '"image_id": "img_123"' in html
    assert '"user_id": "u_1"' in html


def test_viewscan_route_without_id_redirects_to_scans(main_client_module):
    main_client_module.gateway.fetch_me = Mock(
        return_value=({"user_id": "u_1", "email": "user@example.com", "is_admin": False}, 200)
    )

    client = main_client_module.app.test_client()
    client.set_cookie("access_token", "user-token")

    resp = client.get("/viewscan")

    assert resp.status_code == 302
    assert resp.headers["Location"].endswith("/scans")


def test_viewscan_html_route_embeds_public_page_model_from_gateway_and_community(main_client_module, monkeypatch):
    main_client_module.gateway.fetch_me = Mock(
        return_value=({"user_id": "u_1", "email": "user@example.com", "is_admin": False}, 200)
    )

    def fake_get(url, headers=None, params=None, timeout=None):
        if url == "http://gateway.test/image/img_123":
            assert headers["Authorization"] == "Bearer user-token"
            assert timeout == 10
            return ResponseStub(
                200,
                {
                    "item": {
                        "image_id": "img_123",
                        "user_id": "u_1",
                        "is_public": True,
                        "verdict": "fake",
                        "confidence": 0.91,
                    }
                },
            )

        if url == "http://gateway.test/community/posts":
            assert headers == {"Accept": "application/json"}
            assert params == {"image_id": "img_123"}
            assert timeout == 10
            return ResponseStub(
                200,
                {
                    "items": [
                        {
                            "post_id": "post_9",
                            "image_id": "img_123",
                            "description": "Community description",
                            "up_vote_count": 7,
                            "down_vote_count": 2,
                            "comment_count": 3,
                        }
                    ]
                },
            )

        raise AssertionError(f"Unexpected GET {url}")

    def fake_post(url, headers=None, data=None, files=None, json=None, timeout=None):
        assert url == "http://gateway.test/community/posts/moderation-status"
        assert json == {"image_ids": ["img_123"]}
        assert headers == {"Accept": "application/json", "Content-Type": "application/json"}
        assert timeout == 10
        return ResponseStub(200, {"items": []})

    monkeypatch.setattr(main_client_module.requests, "get", fake_get)
    monkeypatch.setattr(main_client_module.requests, "post", fake_post)

    client = main_client_module.app.test_client()
    client.set_cookie("access_token", "user-token")

    resp = client.get("/viewscan/img_123")

    assert resp.status_code == 200
    html = resp.get_data(as_text=True)
    assert '"title": "View Scan"' in html
    assert '"image_id": "img_123"' in html
    assert '"post_id": "post_9"' in html
    assert '"description": "Community description"' in html
    assert '"comment_count": 3' in html
    assert '"user_id": "u_1"' in html
    assert '"actions": {' in html
    assert '"show_delete_scan": true' in html
    assert '"show_make_private": true' in html
    assert '"show_publish": false' in html
    assert '"show_edit_description": true' in html
    assert '"show_comments": true' in html


def test_viewscan_html_route_carries_post_owner_into_merged_image_when_media_payload_lacks_it(main_client_module, monkeypatch):
    main_client_module.gateway.fetch_me = Mock(
        return_value=({"user_id": "u_1", "email": "user@example.com", "is_admin": False}, 200)
    )

    def fake_get(url, headers=None, params=None, timeout=None):
        if url == "http://gateway.test/image/img_123":
            return ResponseStub(
                200,
                {
                    "item": {
                        "image_id": "img_123",
                        "is_public": True,
                        "verdict": "fake",
                        "confidence": 0.91,
                    }
                },
            )

        if url == "http://gateway.test/community/posts":
            return ResponseStub(
                200,
                {
                    "items": [
                        {
                            "post_id": "post_9",
                            "image_id": "img_123",
                            "user_id": "u_1",
                            "user_name": "Roma Dev",
                            "description": "Community description",
                        }
                    ]
                },
            )

        raise AssertionError(f"Unexpected GET {url}")

    def fake_post(url, headers=None, data=None, files=None, json=None, timeout=None):
        assert url == "http://gateway.test/community/posts/moderation-status"
        assert json == {"image_ids": ["img_123"]}
        return ResponseStub(200, {"items": []})

    monkeypatch.setattr(main_client_module.requests, "get", fake_get)
    monkeypatch.setattr(main_client_module.requests, "post", fake_post)

    client = main_client_module.app.test_client()
    client.set_cookie("access_token", "user-token")

    resp = client.get("/viewscan/img_123")

    assert resp.status_code == 200
    html = resp.get_data(as_text=True)
    assert '"user_id": "u_1"' in html
    assert '"user_name": "Roma Dev"' in html
    assert '"show_make_private": true' in html
    assert '"show_edit_description": true' in html


def test_viewscan_html_route_action_state_does_not_depend_on_post_id(main_client_module, monkeypatch):
    main_client_module.gateway.fetch_me = Mock(
        return_value=({"user_id": "u_1", "email": "user@example.com", "is_admin": False}, 200)
    )

    def fake_get(url, headers=None, params=None, timeout=None):
        if url == "http://gateway.test/image/img_123":
            return ResponseStub(
                200,
                {
                    "item": {
                        "image_id": "img_123",
                        "user_id": "u_1",
                        "is_public": True,
                    }
                },
            )

        if url == "http://gateway.test/community/posts":
            return ResponseStub(
                200,
                {
                    "items": [
                        {
                            "image_id": "img_123",
                            "description": "Community description",
                        }
                    ]
                },
            )

        raise AssertionError(f"Unexpected GET {url}")

    def fake_post(url, headers=None, data=None, files=None, json=None, timeout=None):
        assert url == "http://gateway.test/community/posts/moderation-status"
        assert json == {"image_ids": ["img_123"]}
        return ResponseStub(200, {"items": []})

    monkeypatch.setattr(main_client_module.requests, "get", fake_get)
    monkeypatch.setattr(main_client_module.requests, "post", fake_post)

    client = main_client_module.app.test_client()
    client.set_cookie("access_token", "user-token")

    resp = client.get("/viewscan/img_123")

    assert resp.status_code == 200
    html = resp.get_data(as_text=True)
    assert '"show_delete_scan": true' in html
    assert '"show_make_private": true' in html
    assert '"show_edit_description": true' in html


def test_viewscan_html_route_embeds_private_image_without_community_lookup(main_client_module, monkeypatch):
    main_client_module.gateway.fetch_me = Mock(
        return_value=({"user_id": "u_1", "email": "user@example.com", "is_admin": False}, 200)
    )

    def fake_get(url, headers=None, params=None, timeout=None):
        if url == "http://gateway.test/image/img_private":
            return ResponseStub(
                200,
                {
                    "item": {
                        "image_id": "img_private",
                        "user_id": "u_1",
                        "is_public": False,
                    }
                },
            )
        raise AssertionError(f"Unexpected GET {url}")

    def fake_post(url, headers=None, data=None, files=None, json=None, timeout=None):
        assert url == "http://gateway.test/community/posts/moderation-status"
        assert json == {"image_ids": ["img_private"]}
        return ResponseStub(200, {"items": []})

    monkeypatch.setattr(main_client_module.requests, "get", fake_get)
    monkeypatch.setattr(main_client_module.requests, "post", fake_post)

    client = main_client_module.app.test_client()
    client.set_cookie("access_token", "user-token")

    resp = client.get("/viewscan/img_private")

    assert resp.status_code == 200
    html = resp.get_data(as_text=True)
    assert '"image_id": "img_private"' in html
    assert '"user_id": "u_1"' in html
    assert '"post":' not in html
    assert '"show_delete_scan": true' in html
    assert '"show_publish": true' in html
    assert '"show_make_private": false' in html
    assert '"show_edit_description": false' in html
    assert '"show_comments": false' in html


def test_viewscan_html_route_embeds_removed_moderation_state_for_private_scan(main_client_module, monkeypatch):
    main_client_module.gateway.fetch_me = Mock(
        return_value=({"user_id": "u_1", "email": "user@example.com", "is_admin": False}, 200)
    )

    def fake_get(url, headers=None, params=None, timeout=None):
        if url == "http://gateway.test/image/img_private":
            return ResponseStub(
                200,
                {
                    "item": {
                        "image_id": "img_private",
                        "user_id": "u_1",
                        "is_public": False,
                    }
                },
            )
        raise AssertionError(f"Unexpected GET {url}")

    def fake_post(url, headers=None, data=None, files=None, json=None, timeout=None):
        assert url == "http://gateway.test/community/posts/moderation-status"
        assert json == {"image_ids": ["img_private"]}
        return ResponseStub(
            200,
            {
                "items": [
                    {
                        "image_id": "img_private",
                        "moderation_status": "removed",
                        "moderation_reason": "Content removed by moderation team",
                    }
                ]
            },
        )

    monkeypatch.setattr(main_client_module.requests, "get", fake_get)
    monkeypatch.setattr(main_client_module.requests, "post", fake_post)

    client = main_client_module.app.test_client()
    client.set_cookie("access_token", "user-token")

    resp = client.get("/viewscan/img_private")

    assert resp.status_code == 200
    html = resp.get_data(as_text=True)
    assert '"moderation_status": "removed"' in html
    assert '"moderation_reason": "Content removed by moderation team"' in html
    assert '"show_publish": false' in html
    assert '"show_make_private": false' in html


def test_results_route_bootstraps_server_viewer_context(main_client_module):
    main_client_module.gateway.fetch_me = Mock(
        return_value=({"user_id": "u_results", "email": "viewer@example.com", "is_admin": False}, 200)
    )

    client = main_client_module.app.test_client()
    client.set_cookie("access_token", "user-token")

    with client.session_transaction() as sess:
        sess["current_user"] = {
            "user_id": "u_results",
            "email": "viewer@example.com",
            "is_admin": False,
        }
        sess["auth_checked_at"] = 9999999999

    resp = client.get("/results")

    assert resp.status_code == 200
    html = resp.get_data(as_text=True)
    assert 'id="results-bootstrap"' in html
    assert 'data-user-id="u_results"' in html


def test_results_save_private_uses_single_server_owned_upload_flow(main_client_module, monkeypatch):
    calls = []

    def fake_request(method, url, headers=None, data=None, files=None, json=None, params=None, timeout=None):
        calls.append(
            {
                "method": method,
                "url": url,
                "headers": headers,
                "data": data,
                "files": files,
                "json": json,
                "params": params,
                "timeout": timeout,
            }
        )
        assert method == "POST"
        if url == "http://gateway.test/upload/image":
            assert headers["Authorization"] == "Bearer user-token"
            assert data["detection_token"] == "det_tok"
            assert data["is_public"] == "false"
            assert files["file"][0] == "upload.jpg"
            assert files["file"][1] == b"binary-image"
            assert params is None
            return ResponseStub(201, {"body": {"image_id": "img_saved"}})
        raise AssertionError(f"Unexpected request {method} {url}")

    monkeypatch.setattr(main_client_module.requests, "request", fake_request)

    client = main_client_module.app.test_client()
    client.set_cookie("access_token", "user-token")
    with client.session_transaction() as sess:
        sess["current_user"] = {"user_id": "u_1", "email": "u@example.com", "is_admin": False}
        sess["auth_checked_at"] = 9999999999

    resp = client.post(
        "/results/save",
        data={
            "file": (BytesIO(b"binary-image"), "upload.jpg", "image/jpeg"),
            "detection_token": "det_tok",
            "is_public": "false",
            "description": "",
        },
        content_type="multipart/form-data",
    )

    assert resp.status_code == 200
    assert resp.get_json()["image_id"] == "img_saved"
    assert resp.get_json()["published"] is False
    assert len(calls) == 1


def test_results_save_public_publishes_with_server_side_user_context(main_client_module, monkeypatch):
    calls = []

    def fake_request(method, url, headers=None, data=None, files=None, json=None, params=None, timeout=None):
        calls.append(
            {
                "method": method,
                "url": url,
                "headers": headers,
                "data": data,
                "files": files,
                "json": json,
                "params": params,
                "timeout": timeout,
            }
        )
        if url == "http://gateway.test/upload/image":
            assert method == "POST"
            assert params is None
            assert data["is_public"] == "false"
            return ResponseStub(201, {"body": {"image_id": "img_public", "label": "fake", "confidence": 0.9}})
        if url == "http://gateway.test/community/posts":
            assert method == "POST"
            assert headers["Authorization"] == "Bearer user-token"
            assert json["image_id"] == "img_public"
            assert json["description"] == "Server-owned publish"
            return ResponseStub(200, {"post_id": "post_123"})
        raise AssertionError(f"Unexpected request {method} {url}")

    monkeypatch.setattr(main_client_module.requests, "request", fake_request)

    client = main_client_module.app.test_client()
    client.set_cookie("access_token", "user-token")
    with client.session_transaction() as sess:
        sess["current_user"] = {"user_id": "u_server", "email": "u@example.com", "is_admin": False}
        sess["auth_checked_at"] = 9999999999

    resp = client.post(
        "/results/save",
        data={
            "file": (BytesIO(b"binary-image"), "upload.jpg", "image/jpeg"),
            "detection_token": "det_tok",
            "is_public": "true",
            "description": "Server-owned publish",
        },
        content_type="multipart/form-data",
    )

    assert resp.status_code == 200
    assert resp.get_json()["image_id"] == "img_public"
    assert resp.get_json()["post_id"] == "post_123"
    assert resp.get_json()["published"] is True
    assert len(calls) == 2


def test_viewscan_publish_uses_server_owned_post_and_visibility_flow(main_client_module, monkeypatch):
    calls = []

    def fake_get(url, headers=None, params=None, timeout=None):
        if url == "http://gateway.test/community/posts":
            assert params == {"image_id": "img_123"}
            return ResponseStub(200, {"items": []})
        raise AssertionError(f"Unexpected GET {url}")

    def fake_post(url, headers=None, data=None, files=None, json=None, timeout=None):
        calls.append({"url": url, "headers": headers, "json": json, "timeout": timeout})
        if url == "http://gateway.test/community/posts":
            assert headers["Authorization"] == "Bearer user-token"
            assert json["image_id"] == "img_123"
            assert json["description"] == "Hello world"
            assert "user_id" not in json
            return ResponseStub(201, {"post_id": "post_new"})
        raise AssertionError(f"Unexpected POST {url}")

    def fake_request(method, url, headers=None, params=None, json=None, timeout=None):
        assert method == "PATCH"
        if url == "http://gateway.test/image/img_123":
            assert headers["Authorization"] == "Bearer user-token"
            assert json == {"is_public": True}
            assert params is None
            return ResponseStub(200, {"item": {"image_id": "img_123", "is_public": True}})
        raise AssertionError(f"Unexpected request {method} {url}")

    monkeypatch.setattr(main_client_module.requests, "get", fake_get)
    monkeypatch.setattr(main_client_module.requests, "post", fake_post)
    monkeypatch.setattr(main_client_module.requests, "request", fake_request)

    client = main_client_module.app.test_client()
    client.set_cookie("access_token", "user-token")
    with client.session_transaction() as sess:
        sess["current_user"] = {"user_id": "u_1", "email": "u@example.com", "is_admin": False}
        sess["auth_checked_at"] = 9999999999

    resp = client.post(
        "/viewscan/img_123/publish",
        json={"description": "Hello world", "verdict": "fake", "label": "fake", "confidence": 0.91},
    )

    assert resp.status_code == 200
    assert resp.get_json()["post_id"] == "post_new"
    assert resp.get_json()["is_public"] is True
    assert len(calls) == 1


def test_viewscan_update_description_hides_post_lookup_behind_image_id(main_client_module, monkeypatch):
    def fake_get(url, headers=None, params=None, timeout=None):
        if url == "http://gateway.test/community/posts":
            assert params == {"image_id": "img_123"}
            return ResponseStub(200, {"items": [{"post_id": "post_9", "image_id": "img_123"}]})
        raise AssertionError(f"Unexpected GET {url}")

    def fake_patch(url, headers=None, params=None, json=None, timeout=None):
        assert url == "http://gateway.test/community/posts"
        assert headers["Authorization"] == "Bearer user-token"
        assert params == {"post_id": "post_9"}
        assert json == {"description": "Updated text"}
        return ResponseStub(200, {"message": "Post updated successfully"})

    monkeypatch.setattr(main_client_module.requests, "get", fake_get)
    monkeypatch.setattr(main_client_module.requests, "patch", fake_patch)

    client = main_client_module.app.test_client()
    client.set_cookie("access_token", "user-token")
    with client.session_transaction() as sess:
        sess["current_user"] = {"user_id": "u_1", "email": "u@example.com", "is_admin": False}
        sess["auth_checked_at"] = 9999999999

    resp = client.patch("/viewscan/img_123/description", json={"description": "Updated text"})

    assert resp.status_code == 200
    assert resp.get_json()["image_id"] == "img_123"
    assert resp.get_json()["post_id"] == "post_9"


def test_viewscan_make_private_and_delete_use_server_owned_routes(main_client_module, monkeypatch):
    patch_calls = []
    delete_calls = []

    def fake_request(method, url, headers=None, params=None, json=None, timeout=None):
        assert params is None
        if method == "PATCH":
            patch_calls.append(url)
            assert url == "http://gateway.test/image/img_123"
            assert json == {"is_public": False}
            return ResponseStub(200, {"item": {"image_id": "img_123", "is_public": False}})
        if method == "DELETE":
            delete_calls.append(url)
            assert url == "http://gateway.test/image/img_123"
            assert json is None
            return ResponseStub(200, {"deleted": True})
        raise AssertionError(f"Unexpected request {method} {url}")

    monkeypatch.setattr(main_client_module.requests, "request", fake_request)

    client = main_client_module.app.test_client()
    client.set_cookie("access_token", "user-token")
    with client.session_transaction() as sess:
        sess["current_user"] = {"user_id": "u_1", "email": "u@example.com", "is_admin": False}
        sess["auth_checked_at"] = 9999999999

    private_resp = client.post("/viewscan/img_123/make-private")
    delete_resp = client.delete("/viewscan/img_123")

    assert private_resp.status_code == 200
    assert private_resp.get_json()["is_public"] is False
    assert delete_resp.status_code == 200
    assert delete_resp.get_json()["deleted"] is True
    assert patch_calls == ["http://gateway.test/image/img_123"]
    assert delete_calls == ["http://gateway.test/image/img_123"]


def test_viewscan_comments_routes_hide_post_lookup_and_user_context(main_client_module, monkeypatch):
    main_client_module.gateway.fetch_me = Mock(
        return_value=({"user_id": "u_42", "user_name": "Roma Dev", "email": "user@example.com", "is_admin": False}, 200)
    )

    get_calls = []
    post_calls = []
    delete_calls = []

    def fake_get(url, headers=None, params=None, timeout=None):
        get_calls.append((url, headers, params, timeout))
        if url == "http://gateway.test/community/posts":
            return ResponseStub(200, {"items": [{"post_id": "post_123", "image_id": "img_123"}]})
        if url == "http://gateway.test/community/posts/comments":
            return ResponseStub(200, {"items": [{"comment_id": "c_1", "text": "hello"}]})
        raise AssertionError(f"Unexpected GET {url}")

    def fake_post(url, headers=None, data=None, files=None, json=None, timeout=None):
        post_calls.append((url, json, headers, timeout))
        assert url == "http://gateway.test/community/posts/comments"
        return ResponseStub(201, {"comment_id": "c_2", "text": "Nice", "comment_count": 3})

    def fake_delete(url, headers=None, params=None, timeout=None):
        delete_calls.append((url, headers, params, timeout))
        assert url == "http://gateway.test/community/posts/comments"
        return ResponseStub(200, {"comment_id": "c_2", "comment_count": 2})

    monkeypatch.setattr(main_client_module.requests, "get", fake_get)
    monkeypatch.setattr(main_client_module.requests, "post", fake_post)
    monkeypatch.setattr(main_client_module.requests, "delete", fake_delete)

    client = main_client_module.app.test_client()
    client.set_cookie("access_token", "user-token")

    list_resp = client.get("/viewscan/img_123/comments")
    create_resp = client.post("/viewscan/img_123/comments", json={"text": "Nice"})
    delete_resp = client.delete("/viewscan/img_123/comments/c_2")

    assert list_resp.status_code == 200
    assert list_resp.get_json() == {"items": [{"comment_id": "c_1", "text": "hello"}]}

    assert create_resp.status_code == 201
    assert create_resp.get_json()["comment_count"] == 3

    assert delete_resp.status_code == 200
    assert delete_resp.get_json() == {"comment_id": "c_2", "comment_count": 2}

    assert get_calls == [
        ("http://gateway.test/community/posts", {"Accept": "application/json"}, {"image_id": "img_123"}, 10),
        ("http://gateway.test/community/posts/comments", {"Accept": "application/json"}, {"post_id": "post_123"}, 10),
        (
            "http://gateway.test/community/posts",
            {"Accept": "application/json", "Authorization": "Bearer user-token"},
            {"image_id": "img_123"},
            10,
        ),
    ]
    assert post_calls == [
        (
            "http://gateway.test/community/posts/comments",
            {
                "post_id": "post_123",
                "user_id": "u_42",
                "user_name": "Roma Dev",
                "text": "Nice",
            },
            {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Authorization": "Bearer user-token",
            },
            10,
        )
    ]
    assert delete_calls == [
        (
            "http://gateway.test/community/posts/comments",
            {"Accept": "application/json", "Authorization": "Bearer user-token"},
            {"comment_id": "c_2"},
            10,
        )
    ]


def test_viewscan_create_comment_redirects_when_auth_middleware_revalidation_fails(main_client_module, monkeypatch):
    main_client_module.gateway.fetch_me = Mock(return_value=(None, 401))
    backend_post = Mock(side_effect=AssertionError("community must not be called"))
    monkeypatch.setattr(main_client_module.requests, "post", backend_post)

    client = main_client_module.app.test_client()
    client.set_cookie("access_token", "expired-token")
    with client.session_transaction() as sess:
        sess["current_user"] = {"name": "incomplete-user"}
        sess["extra"] = "remove-me"

    resp = client.post(
        "/viewscan/img_123/comments",
        json={"text": "Will fail"},
        headers={"X-Forwarded-Proto": "https"},
    )
    clear_cookie_header = "\n".join(resp.headers.getlist("Set-Cookie"))

    assert resp.status_code == 302
    assert resp.headers["Location"].endswith("/login")
    assert "access_token=" in clear_cookie_header
    assert "Expires=Thu, 01 Jan 1970" in clear_cookie_header
    assert "Secure" in clear_cookie_header
    backend_post.assert_not_called()

    with client.session_transaction() as sess:
        assert dict(sess) == {}


def test_public_html_routes_are_sent_with_no_store_cache_policy(main_client_module):
    client = main_client_module.app.test_client()

    resp = client.get("/")

    assert resp.status_code == 200
    assert resp.headers["Cache-Control"] == "no-store, max-age=0, must-revalidate"
    assert resp.headers["Pragma"] == "no-cache"


def test_public_html_routes_include_hardened_security_headers(main_client_module):
    client = main_client_module.app.test_client()

    resp = client.get("/")

    csp = resp.headers["Content-Security-Policy"]
    directives = {
        segment.strip().split(" ", 1)[0]: segment.strip()
        for segment in csp.split(";")
        if segment.strip()
    }

    assert resp.headers["X-Content-Type-Options"] == "nosniff"
    assert resp.headers["X-Frame-Options"] == "DENY"
    assert directives["script-src"] == "script-src 'self'"
    assert directives["script-src-elem"] == "script-src-elem 'self'"
    assert directives["script-src-attr"] == "script-src-attr 'none'"
    assert directives["object-src"] == "object-src 'none'"
    assert directives["form-action"] == "form-action 'self'"
    assert directives["style-src-elem"] == "style-src-elem 'self'"
    assert directives["style-src-attr"] == "style-src-attr 'unsafe-inline'"
    assert directives["img-src"] == "img-src 'self' data: blob: https: http:"


def test_versioned_static_assets_are_cacheable_and_immutable(main_client_module):
    client = main_client_module.app.test_client()

    resp = client.get("/static/js/core/app.js?v=test-version")

    assert resp.status_code == 200
    assert resp.headers["Cache-Control"] == "public, max-age=31536000, immutable"


def test_images_api_is_sent_with_no_store_cache_policy(main_client_module, monkeypatch):
    proxy_call = Mock(return_value=({"items": [{"image_id": "img_123"}]}, 200))
    monkeypatch.setattr(main_client_module.route_library, "proxy_gateway_json_request", proxy_call)

    client = main_client_module.app.test_client()
    client.set_cookie("access_token", "img-token")

    resp = client.get("/images")

    assert resp.status_code == 200
    assert resp.get_json() == {"items": [{"image_id": "img_123"}]}
    assert resp.headers["Cache-Control"] == "no-store, max-age=0, must-revalidate"
    assert resp.headers["Pragma"] == "no-cache"
