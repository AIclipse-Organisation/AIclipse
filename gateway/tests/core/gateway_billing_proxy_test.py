import json

import httpx
import pytest


@pytest.mark.asyncio
async def test_api_billing_checkout_proxies_body_and_auth_without_cookie_forwarding(client, patch_upstreams):
    def checkout_handler(req: httpx.Request) -> httpx.Response:
        body = json.loads(req.content.decode("utf-8"))
        assert body["user_id"] == "u_123"
        assert body["plan_id"] == 2
        assert req.headers.get("authorization") == "Bearer token-123"
        assert req.headers.get("cookie") is None
        return httpx.Response(status_code=200, json={"checkout_url": "https://stripe.test/checkout"})

    patch_upstreams.add(
        host="billing-srv",
        method="POST",
        path="/create-checkout-session",
        handler=checkout_handler,
    )

    r = await client.post(
        "/api/billing/create-checkout-session",
        headers={"Authorization": "Bearer token-123", "Cookie": "sessionid=abc123"},
        json={"user_id": "u_123", "plan_id": 2, "email": "x@example.com"},
    )
    assert r.status_code == 200
    assert r.json()["checkout_url"] == "https://stripe.test/checkout"


@pytest.mark.asyncio
async def test_billing_checkout_alias_route_works(client, patch_upstreams):
    patch_upstreams.add(
        host="billing-srv",
        method="POST",
        path="/create-checkout-session",
        handler=lambda _req: httpx.Response(status_code=200, json={"ok": True}),
    )

    r = await client.post(
        "/billing/create-checkout-session",
        json={"user_id": "u_1", "plan_id": 1, "email": "a@example.com"},
    )
    assert r.status_code == 200
    assert r.json() == {"ok": True}


@pytest.mark.asyncio
async def test_api_billing_subscription_status_proxies_query_and_auth_without_cookie_forwarding(client, patch_upstreams):
    def status_handler(req: httpx.Request) -> httpx.Response:
        assert req.url.path == "/subscription/status"
        assert req.url.params.get("user_id") == "u_123"
        assert req.headers.get("authorization") == "Bearer token-123"
        assert req.headers.get("cookie") is None
        return httpx.Response(status_code=200, json={"status": "active"})

    patch_upstreams.add(
        host="billing-srv",
        method="GET",
        path="/subscription/status",
        handler=status_handler,
    )

    r = await client.get(
        "/api/billing/subscription/status?user_id=u_123",
        headers={"Authorization": "Bearer token-123", "Cookie": "sessionid=abc123"},
    )
    assert r.status_code == 200
    assert r.json() == {"status": "active"}


@pytest.mark.asyncio
async def test_api_billing_subscription_status_passes_through_cancellation_payload(client, patch_upstreams):
    patch_upstreams.add(
        host="billing-srv",
        method="GET",
        path="/subscription/status",
        handler=lambda _req: httpx.Response(
            status_code=200,
            json={
                "status": "cancel_scheduled",
                "cancel_at_period_end": True,
                "billing_period_end": "2026-06-01T00:00:00+00:00",
            },
        ),
    )

    r = await client.get("/api/billing/subscription/status?user_id=u_123")
    assert r.status_code == 200
    assert r.json()["status"] == "cancel_scheduled"
    assert r.json()["cancel_at_period_end"] is True


@pytest.mark.asyncio
async def test_api_billing_cancel_at_period_end_proxies_body_and_auth(client, patch_upstreams):
    def cancel_handler(req: httpx.Request) -> httpx.Response:
        assert req.url.path == "/subscription/cancel-at-period-end"
        body = json.loads(req.content.decode("utf-8"))
        assert body == {"user_id": "u_123", "reason": "Too expensive"}
        assert req.headers.get("authorization") == "Bearer token-123"
        return httpx.Response(status_code=200, json={"ok": True, "status": "cancel_scheduled"})

    patch_upstreams.add(
        host="billing-srv",
        method="POST",
        path="/subscription/cancel-at-period-end",
        handler=cancel_handler,
    )

    r = await client.post(
        "/api/billing/subscription/cancel-at-period-end",
        headers={"Authorization": "Bearer token-123"},
        json={"user_id": "u_123", "reason": "Too expensive"},
    )
    assert r.status_code == 200
    assert r.json() == {"ok": True, "status": "cancel_scheduled"}
