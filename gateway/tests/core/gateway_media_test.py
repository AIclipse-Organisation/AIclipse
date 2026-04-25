import httpx
import pytest

try:
    from tests.conftest import make_auth_token
except (ModuleNotFoundError, ImportError):
    from gateway.tests.conftest import make_auth_token


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
async def test_images_forward_external_proto_to_media(client, patch_upstreams, auth_keypair):
    token = make_auth_token(
        keypair=auth_keypair,
        user_id="u_imgs",
        email="u_imgs@example.com",
        is_admin=False,
        plan=0,
    )

    def media_images_handler(req: httpx.Request) -> httpx.Response:
        assert req.url.params.get("user_id") == "u_imgs"
        assert req.headers.get("x-external-proto") == "https"
        return httpx.Response(
            status_code=200,
            json={"items": [{"image_id": "img_https", "url": "https://storage.aiclipse.local/images/img_https.png"}]},
        )

    patch_upstreams.add(host="media", method="GET", path="/images", handler=media_images_handler)

    r = await client.get(
        "/images",
        headers={"Authorization": f"Bearer {token}", "X-Forwarded-Proto": "https"},
    )
    assert r.status_code == 200
    assert r.json() == {
        "items": [{"image_id": "img_https", "url": "https://storage.aiclipse.local/images/img_https.png"}]
    }


@pytest.mark.asyncio
async def test_images_returns_503_when_media_returns_service_unavailable(client, patch_upstreams, auth_keypair):
    token = make_auth_token(
        keypair=auth_keypair,
        user_id="u_imgs",
        email="u_imgs@example.com",
        is_admin=False,
        plan=0,
    )

    def media_images_handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code=503, json={"detail": "Image metadata store unavailable"})

    patch_upstreams.add(host="media", method="GET", path="/images", handler=media_images_handler)

    r = await client.get("/images", headers={"Authorization": f"Bearer {token}"})

    assert r.status_code == 503
    assert r.json()["detail"] == "Media service error: 503"


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
async def test_get_image_forwards_external_proto_to_media(client, patch_upstreams, auth_keypair):
    token = make_auth_token(
        keypair=auth_keypair,
        user_id="u_img",
        email="u_img@example.com",
        is_admin=False,
        plan=0,
    )

    def media_get_image_handler(req: httpx.Request) -> httpx.Response:
        assert req.headers.get("x-external-proto") == "https"
        return httpx.Response(
            status_code=200,
            json={"image_id": "img_https", "url": "https://storage.aiclipse.local/img_https.png"},
        )

    patch_upstreams.add(host="media", method="GET", path="/image/img_https", handler=media_get_image_handler)

    r = await client.get(
        "/image/img_https",
        headers={"Authorization": f"Bearer {token}", "X-Forwarded-Proto": "https"},
    )
    assert r.status_code == 200
    assert r.json()["url"] == "https://storage.aiclipse.local/img_https.png"


@pytest.mark.asyncio
async def test_patch_image_accepts_internal_forwarded_user(client, patch_upstreams):
    def media_patch_handler(req: httpx.Request) -> httpx.Response:
        assert req.url.params.get("user_id") == "u_comm"
        assert req.url.params.get("is_public") == "true"
        assert req.headers.get("x-user-is-admin") == "true"
        return httpx.Response(status_code=200, json={"ok": True})

    patch_upstreams.add(host="media", method="PATCH", path="/image/img_internal", handler=media_patch_handler)

    r = await client.patch(
        "/image/img_internal",
        headers={
            "X-Internal-Token": "test-internal-token",
            "X-User-Id": "u_comm",
            "X-User-Is-Admin": "true",
            "X-User-Email": "u_comm@example.com",
        },
        json={"is_public": True},
    )
    assert r.status_code == 200
    assert r.json() == {"ok": True}


@pytest.mark.asyncio
async def test_patch_image_rejects_invalid_internal_admin_header(client):
    r = await client.patch(
        "/image/img_internal",
        headers={
            "X-Internal-Token": "test-internal-token",
            "X-User-Id": "u_comm",
            "X-User-Is-Admin": "yes",
            "X-User-Email": "u_comm@example.com",
        },
        json={"is_public": True},
    )

    assert r.status_code == 422
    assert r.json()["detail"][0]["loc"] == ["header", "X-User-Is-Admin"]


@pytest.mark.asyncio
async def test_internal_images_lookup_requires_internal_token_and_proxies_media(client, patch_upstreams):
    def media_lookup_handler(req: httpx.Request) -> httpx.Response:
        assert req.headers.get("x-internal-token") is None
        assert req.headers.get("x-external-proto") == "https"
        assert req.read() == b'{"image_ids":["img_1","img_2"]}'
        return httpx.Response(
            status_code=200,
            json={"items": [{"image_id": "img_1", "url": "https://cdn.test/img_1.png"}]},
        )

    patch_upstreams.add(host="media", method="POST", path="/images/lookup", handler=media_lookup_handler)

    r = await client.post(
        "/internal/images/lookup",
        headers={"X-Internal-Token": "test-internal-token", "X-External-Proto": "https"},
        json={"image_ids": ["img_1", "img_2"]},
    )

    assert r.status_code == 200
    assert r.json() == {"items": [{"image_id": "img_1", "url": "https://cdn.test/img_1.png"}]}


@pytest.mark.asyncio
async def test_legacy_community_images_route_is_not_exposed(client):
    r = await client.get("/community/images")

    assert r.status_code == 404
