import httpx
import pytest

from tests.conftest import make_auth_token


@pytest.mark.asyncio
async def test_admin_users_requires_admin_flag(client, patch_upstreams, auth_keypair, register_auth_jwks):
    token = make_auth_token(
        keypair=auth_keypair,
        user_id="u1",
        email="u1@example.com",
        is_admin=False,
        plan=0,
    )

    r = await client.get("/auth/admin/users", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403
    assert r.json()["detail"] == "Admin privileges required"


@pytest.mark.asyncio
async def test_admin_users_ok_proxies(client, patch_upstreams, auth_keypair, register_auth_jwks):
    token = make_auth_token(
        keypair=auth_keypair,
        user_id="u_admin",
        email="admin@example.com",
        is_admin=True,
        plan=0,
    )

    def admin_users_handler(req: httpx.Request) -> httpx.Response:
        assert req.headers.get("authorization", "").startswith("Bearer ")
        # query param user_name має пройти як є
        assert req.url.params.get("user_name") == "ali"
        return httpx.Response(status_code=200, json={"items": [{"user_id": "u_a"}]})

    patch_upstreams.add(host="auth", method="GET", path="/admin/users", handler=admin_users_handler)

    r = await client.get("/auth/admin/users?user_name=ali", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["items"][0]["user_id"] == "u_a"
