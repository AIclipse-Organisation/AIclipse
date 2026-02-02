import json

import httpx
import pytest

from tests.conftest import make_auth_token


@pytest.mark.asyncio
async def test_auth_signup_proxies_json(client, patch_upstreams):
    def signup_handler(req: httpx.Request) -> httpx.Response:
        body = json.loads(req.content.decode("utf-8"))
        assert body["email"] == "x@example.com"
        return httpx.Response(status_code=201, json={"ok": True, "email": body["email"]})

    patch_upstreams.add(host="auth", method="POST", path="/signup", handler=signup_handler)

    r = await client.post("/auth/signup", json={"email": "x@example.com"})
    assert r.status_code == 201
    assert r.json() == {"ok": True, "email": "x@example.com"}


@pytest.mark.asyncio
async def test_auth_login_proxies_json(client, patch_upstreams):
    def login_handler(req: httpx.Request) -> httpx.Response:
        body = json.loads(req.content.decode("utf-8"))
        assert body["email"] == "x@example.com"
        assert body["password"] == "secret"
        return httpx.Response(status_code=200, json={"token": "t", "user": {"email": body["email"]}})

    patch_upstreams.add(host="auth", method="POST", path="/login", handler=login_handler)

    r = await client.post("/auth/login", json={"email": "x@example.com", "password": "secret"})
    assert r.status_code == 200
    assert r.json()["token"] == "t"
    assert r.json()["user"]["email"] == "x@example.com"


@pytest.mark.asyncio
async def test_auth_me_requires_auth(client):
    r = await client.get("/auth/me")
    assert r.status_code == 401
    assert r.json()["detail"] == "Missing Authorization header"


@pytest.mark.asyncio
async def test_auth_me_ok(client, patch_upstreams, auth_keypair):
    token = make_auth_token(
        keypair=auth_keypair,
        user_id="u_me",
        email="me@example.com",
        is_admin=False,
        plan=1,
        ttl_seconds=10**9,
    )

    def me_handler(req: httpx.Request) -> httpx.Response:
        assert req.headers.get("authorization", "").startswith("Bearer ")
        return httpx.Response(status_code=200, json={"user_id": "u_me", "email": "me@example.com"})

    patch_upstreams.add(host="auth", method="GET", path="/me", handler=me_handler)

    r = await client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["user_id"] == "u_me"
    assert r.json()["email"] == "me@example.com"
