import httpx
import pytest

try:
    from tests.conftest import make_auth_token
except (ModuleNotFoundError, ImportError):
    from gateway.tests.conftest import make_auth_token


@pytest.mark.asyncio
async def test_community_posts_get_proxies_without_auth(client, patch_upstreams):
    def community_posts_handler(req: httpx.Request) -> httpx.Response:
        assert req.headers.get("authorization") is None
        assert req.url.params.get("image_id") == "img_123"
        return httpx.Response(status_code=200, json={"items": [{"post_id": "post_1"}]})

    patch_upstreams.add(
        host="community",
        method="GET",
        path="/community/posts",
        handler=community_posts_handler,
    )

    response = await client.get("/community/posts", params={"image_id": "img_123"})
    assert response.status_code == 200
    assert response.json()["items"][0]["post_id"] == "post_1"


@pytest.mark.asyncio
async def test_community_posts_create_proxies_authenticated_user(client, patch_upstreams, auth_keypair):
    token = make_auth_token(
        keypair=auth_keypair,
        user_id="u_posts",
        email="u_posts@example.com",
        is_admin=False,
        plan=0,
    )

    def community_create_handler(req: httpx.Request) -> httpx.Response:
        assert req.headers.get("authorization") is None
        assert req.headers.get("x-internal-token")
        assert req.headers.get("x-user-id") == "u_posts"
        assert req.headers.get("x-user-email") == "u_posts@example.com"
        assert req.headers.get("x-user-is-admin") == "false"
        return httpx.Response(status_code=201, json={"post_id": "post_new"})

    patch_upstreams.add(
        host="community",
        method="POST",
        path="/community/posts",
        handler=community_create_handler,
    )

    response = await client.post(
        "/community/posts",
        headers={"Authorization": f"Bearer {token}"},
        json={"image_id": "img_123", "description": "hello"},
    )
    assert response.status_code == 201
    assert response.json()["post_id"] == "post_new"


@pytest.mark.asyncio
async def test_community_moderation_status_proxies_json_response(client, patch_upstreams):
    def moderation_handler(req: httpx.Request) -> httpx.Response:
        assert req.headers.get("authorization") is None
        assert req.headers.get("accept") == "application/json"
        assert req.headers.get("content-type", "").startswith("application/json")
        assert req.headers.get("x-internal-token") == "test-internal-token"
        assert req.read() == b'{"image_ids":["img_123"]}'
        return httpx.Response(
            status_code=200,
            json={
                "items": [
                    {
                        "image_id": "img_123",
                        "moderation_status": "removed",
                        "moderation_reason": "Content removed by moderation team",
                    }
                ]
            },
        )

    patch_upstreams.add(
        host="community",
        method="POST",
        path="/community/posts/moderation-status",
        handler=moderation_handler,
    )

    response = await client.post(
        "/community/posts/moderation-status",
        json={"image_ids": ["img_123"]},
    )

    assert response.status_code == 200
    assert response.json() == {
        "items": [
            {
                "image_id": "img_123",
                "moderation_status": "removed",
                "moderation_reason": "Content removed by moderation team",
            }
        ]
    }
