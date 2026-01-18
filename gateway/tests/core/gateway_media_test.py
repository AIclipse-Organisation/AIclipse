import pytest

from tests.conftest import make_auth_token


@pytest.mark.asyncio
async def test_images_returns_empty_list_when_no_media(client, auth_keypair, register_auth_jwks):
    token = make_auth_token(
        keypair=auth_keypair,
        user_id="u_imgs",
        email="u_imgs@example.com",
        is_admin=False,
        plan=0,
    )

    r = await client.get("/images", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json() == {"items": []}


@pytest.mark.asyncio
async def test_get_image_404_when_no_media(client, auth_keypair, register_auth_jwks):
    token = make_auth_token(
        keypair=auth_keypair,
        user_id="u_img",
        email="u_img@example.com",
        is_admin=False,
        plan=0,
    )

    r = await client.get("/image/any", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 404
    assert r.json()["detail"] == "Image not found"


@pytest.mark.asyncio
async def test_community_images_returns_empty_list_when_no_media(client):
    r = await client.get("/community/images")
    assert r.status_code == 200
    assert r.json() == {"items": []}
