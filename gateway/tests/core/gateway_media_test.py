import httpx
import pytest

from tests.conftest import make_auth_token


@pytest.mark.asyncio
async def test_images_proxies_media_list(client, patch_upstreams, auth_keypair):
    token = make_auth_token(
        keypair=auth_keypair,
        user_id="u_imgs",
        email="u_imgs@example.com",
        is_admin=False,
        plan=0,
    )

    def media_images_handler(req: httpx.Request) -> httpx.Response:
        assert req.url.params.get("user_id") == "u_imgs"
        return httpx.Response(status_code=200, json={"items": []})

    patch_upstreams.add(host="media", method="GET", path="/images", handler=media_images_handler)

    r = await client.get("/images", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json() == {"items": []}


@pytest.mark.asyncio
async def test_get_image_404_proxies_from_media(client, patch_upstreams, auth_keypair):
    token = make_auth_token(
        keypair=auth_keypair,
        user_id="u_img",
        email="u_img@example.com",
        is_admin=False,
        plan=0,
    )

    def media_get_image_handler(req: httpx.Request) -> httpx.Response:
        assert req.url.params.get("user_id") == "u_img"
        return httpx.Response(status_code=404, json={"detail": "Image not found"})

    patch_upstreams.add(host="media", method="GET", path="/image/any", handler=media_get_image_handler)

    r = await client.get("/image/any", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 404
    assert r.json()["detail"] == "Image not found"


@pytest.mark.asyncio
async def test_community_images_proxies_media(client, patch_upstreams):
    def media_public_images_handler(req: httpx.Request) -> httpx.Response:
        assert req.url.params.get("is_public") == "true"
        return httpx.Response(status_code=200, json={"items": [{"image_id": "img1"}]})

    patch_upstreams.add(host="media", method="GET", path="/images", handler=media_public_images_handler)

    r = await client.get("/community/images")
    assert r.status_code == 200
    assert r.json()["items"][0]["image_id"] == "img1"
