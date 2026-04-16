import json

import httpx
import pytest

try:
    from tests.conftest import make_auth_token
except ModuleNotFoundError:
    from gateway.tests.conftest import make_auth_token


def _auth_headers(auth_keypair, *, user_id="u_123", email="x@example.com", is_admin=False, plan=1):
    token = make_auth_token(
        keypair=auth_keypair,
        user_id=user_id,
        email=email,
        is_admin=is_admin,
        plan=plan,
        ttl_seconds=10**9,
    )
    return {"Authorization": f"Bearer {token}", "Cookie": "sessionid=abc123"}


@pytest.mark.asyncio
async def test_billing_checkout_requires_auth(client):
    r = await client.post("/billing/create-checkout-session", json={"plan_id": 2})
    assert r.status_code == 401
    assert r.json()["detail"] == "Missing auth token (Authorization Bearer or auth cookie)"


@pytest.mark.asyncio
async def test_billing_checkout_proxies_internal_user_context_without_cookie_forwarding(client, patch_upstreams, auth_keypair):
    def checkout_handler(req: httpx.Request) -> httpx.Response:
        body = json.loads(req.content.decode("utf-8"))
        assert body == {"plan_id": 2}
        assert req.headers.get("authorization") is None
        assert req.headers.get("cookie") is None
        assert req.headers.get("x-internal-token") == "test-internal-token"
        assert req.headers.get("x-user-id") == "u_123"
        assert req.headers.get("x-user-email") == "x@example.com"
        assert req.headers.get("x-user-is-admin") == "false"
        return httpx.Response(status_code=200, json={"checkout_url": "https://stripe.test/checkout"})

    patch_upstreams.add(
        host="billing-srv",
        method="POST",
        path="/create-checkout-session",
        handler=checkout_handler,
    )

    r = await client.post(
        "/billing/create-checkout-session",
        headers=_auth_headers(auth_keypair),
        json={"plan_id": 2, "user_id": "ignore-me", "email": "ignore@example.com"},
    )
    assert r.status_code == 200
    assert r.json()["checkout_url"] == "https://stripe.test/checkout"


@pytest.mark.asyncio
async def test_billing_subscription_status_requires_auth(client):
    r = await client.get("/billing/subscription/status")
    assert r.status_code == 401
    assert r.json()["detail"] == "Missing auth token (Authorization Bearer or auth cookie)"


@pytest.mark.asyncio
async def test_billing_subscription_status_proxies_internal_user_context_without_query_user_id(client, patch_upstreams, auth_keypair):
    def status_handler(req: httpx.Request) -> httpx.Response:
        assert req.url.path == "/subscription/status"
        assert "user_id" not in req.url.params
        assert req.headers.get("authorization") is None
        assert req.headers.get("cookie") is None
        assert req.headers.get("x-internal-token") == "test-internal-token"
        assert req.headers.get("x-user-id") == "u_123"
        assert req.headers.get("x-user-email") == "x@example.com"
        return httpx.Response(status_code=200, json={"status": "active", "cancel_at_period_end": False})

    patch_upstreams.add(
        host="billing-srv",
        method="GET",
        path="/subscription/status",
        handler=status_handler,
    )

    r = await client.get("/billing/subscription/status", headers=_auth_headers(auth_keypair))
    assert r.status_code == 200
    assert r.json() == {"status": "active", "cancel_at_period_end": False}


@pytest.mark.asyncio
async def test_billing_cancel_at_period_end_requires_auth(client):
    r = await client.post("/billing/subscription/cancel-at-period-end", json={"reason": "Too expensive"})
    assert r.status_code == 401
    assert r.json()["detail"] == "Missing auth token (Authorization Bearer or auth cookie)"


@pytest.mark.asyncio
async def test_billing_cancel_at_period_end_proxies_internal_user_context_without_body_user_id(client, patch_upstreams, auth_keypair):
    def cancel_handler(req: httpx.Request) -> httpx.Response:
        assert req.url.path == "/subscription/cancel-at-period-end"
        body = json.loads(req.content.decode("utf-8"))
        assert body == {"reason": "Too expensive"}
        assert req.headers.get("authorization") is None
        assert req.headers.get("x-internal-token") == "test-internal-token"
        assert req.headers.get("x-user-id") == "u_123"
        assert req.headers.get("x-user-email") == "x@example.com"
        return httpx.Response(status_code=200, json={"ok": True, "status": "cancel_scheduled"})

    patch_upstreams.add(
        host="billing-srv",
        method="POST",
        path="/subscription/cancel-at-period-end",
        handler=cancel_handler,
    )

    r = await client.post(
        "/billing/subscription/cancel-at-period-end",
        headers=_auth_headers(auth_keypair),
        json={"reason": "Too expensive", "user_id": "ignore-me"},
    )
    assert r.status_code == 200
    assert r.json() == {"ok": True, "status": "cancel_scheduled"}


@pytest.mark.asyncio
async def test_billing_config_route_remains_public(client, patch_upstreams):
    patch_upstreams.add(
        host="billing-srv",
        method="GET",
        path="/config",
        handler=lambda _req: httpx.Response(status_code=200, json={"publishable_key": "pk_test"}),
    )

    r = await client.get("/billing/config")
    assert r.status_code == 200
    assert r.json() == {"publishable_key": "pk_test"}


@pytest.mark.asyncio
async def test_api_billing_paths_are_not_registered_on_gateway_service(client, auth_keypair):
    headers = _auth_headers(auth_keypair)

    checkout = await client.post("/api/billing/create-checkout-session", headers=headers, json={"plan_id": 2})
    status = await client.get("/api/billing/subscription/status", headers=headers)
    cancel = await client.post("/api/billing/subscription/cancel-at-period-end", headers=headers, json={"reason": "Too expensive"})
    webhook = await client.post("/api/billing/webhook", content=b"{}", headers={"stripe-signature": "sig"})

    assert checkout.status_code == 404
    assert status.status_code == 404
    assert cancel.status_code == 404
    assert webhook.status_code == 404


@pytest.mark.asyncio
async def test_billing_webhook_forwards_raw_bytes_and_stripe_signature(client, patch_upstreams):
    raw_payload = b'{"type":"checkout.session.completed","data":{"object":{}}}'
    sig_header = "t=1234,v1=abcdef"

    def webhook_handler(req: httpx.Request) -> httpx.Response:
        assert req.url.path == "/webhook"
        assert req.content == raw_payload
        assert req.headers.get("stripe-signature") == sig_header
        assert req.headers.get("authorization") is None
        return httpx.Response(status_code=200, json={"received": True})

    patch_upstreams.add(
        host="billing-srv",
        method="POST",
        path="/webhook",
        handler=webhook_handler,
    )

    r = await client.post(
        "/billing/webhook",
        content=raw_payload,
        headers={
            "stripe-signature": sig_header,
            "content-type": "application/json",
            "Authorization": "Bearer should-not-be-forwarded",
        },
    )
    assert r.status_code == 200
    assert r.json() == {"received": True}
