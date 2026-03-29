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


@pytest.mark.asyncio
async def test_api_billing_webhook_forwards_raw_bytes_and_stripe_signature(client, patch_upstreams):
    """Stripe webhook events must arrive at the billing service with the original
    raw bytes and the Stripe-Signature header intact so HMAC verification passes.
    HMAC (Hash-based Message Authentication Code) is a way to verify both the integrity
    and authenticity of a message using a shared secret key combined with a hash function"""
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
        "/api/billing/webhook",
        content=raw_payload,
        headers={
            "stripe-signature": sig_header,
            "content-type": "application/json",
            "Authorization": "Bearer should-not-be-forwarded",
        },
    )
    assert r.status_code == 200
    assert r.json() == {"received": True}


@pytest.mark.asyncio
async def test_api_billing_webhook_no_authorization_header_forwarded(client, patch_upstreams):
    """Auth header must not be sent to the billing webhook — Stripe calls have no Bearer token."""

    def webhook_handler(req: httpx.Request) -> httpx.Response:
        assert req.headers.get("authorization") is None
        return httpx.Response(status_code=200, json={"received": True})

    patch_upstreams.add(
        host="billing-srv",
        method="POST",
        path="/webhook",
        handler=webhook_handler,
    )

    r = await client.post(
        "/api/billing/webhook",
        content=b'{"type":"customer.subscription.deleted"}',
        headers={"stripe-signature": "t=1,v1=xyz", "content-type": "application/json"},
    )
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_billing_webhook_alias_route_works_for_ingress_rewrite(client, patch_upstreams):
    """Ingress rewrites /api/billing/webhook to /billing/webhook, so both must work."""

    raw_payload = b'{"type":"checkout.session.completed","data":{"object":{}}}'
    sig_header = "t=1234,v1=abcdef"

    def webhook_handler(req: httpx.Request) -> httpx.Response:
        assert req.url.path == "/webhook"
        assert req.content == raw_payload
        assert req.headers.get("stripe-signature") == sig_header
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
        },
    )
    assert r.status_code == 200
    assert r.json() == {"received": True}
