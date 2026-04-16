import httpx
import pytest

try:
    from tests.conftest import make_auth_token
except ModuleNotFoundError:
    from gateway.tests.conftest import make_auth_token


@pytest.mark.asyncio
async def test_admin_users_requires_admin_flag(client, patch_upstreams, auth_keypair):
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
async def test_admin_users_ok_proxies(client, patch_upstreams, auth_keypair):
    token = make_auth_token(
        keypair=auth_keypair,
        user_id="u_admin",
        email="admin@example.com",
        is_admin=True,
        plan=0,
    )

    def admin_users_handler(req: httpx.Request) -> httpx.Response:
        assert req.headers.get("authorization", "").startswith("Bearer ")
        assert req.url.params.get("user_name") == "ali"
        return httpx.Response(status_code=200, json={"items": [{"user_id": "u_a"}]})

    patch_upstreams.add(host="auth", method="GET", path="/admin/users", handler=admin_users_handler)

    r = await client.get("/auth/admin/users?user_name=ali", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["items"][0]["user_id"] == "u_a"


@pytest.mark.asyncio
async def test_admin_model_upload_session_proxies_json_payload(client, patch_upstreams, auth_keypair):
    token = make_auth_token(
        keypair=auth_keypair,
        user_id="u_admin",
        email="admin@example.com",
        is_admin=True,
        plan=0,
    )

    def create_session_handler(req: httpx.Request) -> httpx.Response:
        assert req.headers["content-type"].startswith("application/json")
        assert req.content == b'{"version":"v2.0.1","fileName":"model.pt","fileSize":123}'
        return httpx.Response(
            status_code=200,
            json={"uploadId": "upload-token", "uploadUrl": "https://storage.test/model.pt"},
        )

    patch_upstreams.add(host="model-cycle", method="POST", path="/api/models/uploads", handler=create_session_handler)

    r = await client.post(
        "/admin/models/uploads",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        content=b'{"version":"v2.0.1","fileName":"model.pt","fileSize":123}',
    )

    assert r.status_code == 200
    assert r.json()["uploadId"] == "upload-token"


@pytest.mark.asyncio
async def test_admin_model_upload_finalize_proxies_json_payload(client, patch_upstreams, auth_keypair):
    token = make_auth_token(
        keypair=auth_keypair,
        user_id="u_admin",
        email="admin@example.com",
        is_admin=True,
        plan=0,
    )

    def finalize_handler(req: httpx.Request) -> httpx.Response:
        assert req.headers["content-type"].startswith("application/json")
        assert req.content == b'{"uploadId":"upload-token","version":"v2.0.1"}'
        return httpx.Response(status_code=200, json={"version": "v2.0.1", "imagesLinked": 0})

    patch_upstreams.add(host="model-cycle", method="POST", path="/api/models/uploads/finalize", handler=finalize_handler)

    r = await client.post(
        "/admin/models/uploads/finalize",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        content=b'{"uploadId":"upload-token","version":"v2.0.1"}',
    )

    assert r.status_code == 200
    assert r.json()["version"] == "v2.0.1"


@pytest.mark.asyncio
async def test_admin_model_upload_session_returns_502_when_model_cycle_is_unreachable(client, patch_upstreams, auth_keypair, gateway_mod, monkeypatch):
    token = make_auth_token(
        keypair=auth_keypair,
        user_id="u_admin",
        email="admin@example.com",
        is_admin=True,
        plan=0,
    )

    async def fail_post(*args, **kwargs):
        raise httpx.RequestError(
            "boom",
            request=httpx.Request("POST", "http://model-cycle/api/models/uploads"),
        )

    monkeypatch.setattr(gateway_mod.app.state.http, "post", fail_post)

    r = await client.post(
        "/admin/models/uploads",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        content=b'{"version":"v2.0.1","fileName":"model.pt","fileSize":123}',
    )

    assert r.status_code == 502
    assert r.json()["detail"] == "Model Cycle unreachable"
