import json

import httpx
import pytest


@pytest.mark.asyncio
async def test_api_billing_checkout_proxies_body_auth_and_cookie(client, patch_upstreams):
    def checkout_handler(req: httpx.Request) -> httpx.Response:
        body = json.loads(req.content.decode("utf-8"))
        assert body["user_id"] == "u_123"
        assert body["plan_id"] == 2
        assert req.headers.get("authorization") == "Bearer token-123"
        assert "sessionid=abc123" in req.headers.get("cookie", "")
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
async def test_api_billing_admin_upgrade_plan_proxies_query_params(client, patch_upstreams):
    def upgrade_handler(req: httpx.Request) -> httpx.Response:
        assert req.url.path == "/admin/upgrade-plan"
        assert req.url.params.get("user_id") == "u_admin"
        assert req.url.params.get("plan_id") == "2"
        return httpx.Response(status_code=200, json={"ok": True})

    patch_upstreams.add(
        host="billing-srv",
        method="POST",
        path="/admin/upgrade-plan",
        handler=upgrade_handler,
    )

    r = await client.post("/api/billing/admin/upgrade-plan?user_id=u_admin&plan_id=2")
    assert r.status_code == 200
    assert r.json() == {"ok": True}
