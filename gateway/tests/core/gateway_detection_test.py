import base64
import hashlib

import httpx
import jwt
import pytest

from tests.conftest import make_auth_token


# Small, valid 1x1 PNGs so the gateway's image sniffing passes.
PNG_1X1_BLACK = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC"
)
PNG_1X1_WHITE = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC"
)


@pytest.mark.asyncio
async def test_checks_ok_returns_detection_token(client, patch_upstreams, auth_keypair, register_auth_jwks):
    token = make_auth_token(
        keypair=auth_keypair,
        user_id="u_det",
        email="u_det@example.com",
        is_admin=False,
        plan=0,
    )

    image_bytes = PNG_1X1_BLACK

    def detector_handler(req: httpx.Request) -> httpx.Response:
        assert req.headers.get("x-user-id") == "u_det"
        assert req.headers.get("content-type") == "application/octet-stream"
        assert req.content == image_bytes
        return httpx.Response(status_code=200, json={"verdict": "ok", "label": "clean", "confidence": 0.9})

    patch_upstreams.add(host="detector", method="POST", path="/v1.0.1/checks", handler=detector_handler)

    r = await client.post(
        "/checks",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("x.png", image_bytes, "image/png")},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["verdict"] == "ok"
    assert body["label"] == "clean"
    assert "detection_token" in body

    dt = body["detection_token"]
    payload = jwt.decode(dt, "test-detection-secret", algorithms=["HS256"])
    assert payload["sub"] == "u_det"
    assert payload["sha256"] == hashlib.sha256(image_bytes).hexdigest()
    assert payload["verdict"] == "ok"
    assert payload["label"] == "clean"
    assert float(payload["confidence"]) == 0.9


@pytest.mark.asyncio
async def test_checks_rejects_bad_content_type(client, auth_keypair, register_auth_jwks):
    token = make_auth_token(
        keypair=auth_keypair,
        user_id="u_det2",
        email="u_det2@example.com",
        is_admin=False,
        plan=0,
    )
    r = await client.post(
        "/checks",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("x.txt", b"hello", "text/plain")},
    )
    assert r.status_code == 415
    assert r.json()["detail"] == "Unsupported or invalid image"


@pytest.mark.asyncio
async def test_upload_image_validates_detection_token_and_returns_fallback(
    client, patch_upstreams, auth_keypair, register_auth_jwks
):
    token = make_auth_token(
        keypair=auth_keypair,
        user_id="u_up",
        email="u_up@example.com",
        is_admin=False,
        plan=0,
    )

    image_bytes = PNG_1X1_BLACK

    def detector_handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code=200, json={"verdict": "ok", "label": "clean", "confidence": 0.42})

    patch_upstreams.add(host="detector", method="POST", path="/v1.0.1/checks", handler=detector_handler)

    r1 = await client.post(
        "/checks",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("x.png", image_bytes, "image/png")},
    )
    assert r1.status_code == 200
    detection_token = r1.json()["detection_token"]

    r2 = await client.post(
        "/upload/image",
        headers={"Authorization": f"Bearer {token}"},
        data={"detection_token": detection_token, "is_public": "false"},
        files={"file": ("x.png", image_bytes, "image/png")},
    )
    assert r2.status_code == 201
    body = r2.json()
    assert body["verdict"] == "ok"
    assert body["label"] == "clean"
    assert "image" in body
    assert body["image"]["user_id"] == "u_up"
    assert body["image"]["url"].startswith("https://example.invalid/images/")


@pytest.mark.asyncio
async def test_upload_image_rejects_modified_bytes(client, patch_upstreams, auth_keypair, register_auth_jwks):
    token = make_auth_token(
        keypair=auth_keypair,
        user_id="u_mismatch",
        email="u_mismatch@example.com",
        is_admin=False,
        plan=0,
    )

    original_bytes = PNG_1X1_BLACK
    modified_bytes = PNG_1X1_WHITE

    def detector_handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code=200, json={"verdict": "ok", "label": "clean", "confidence": 0.1})

    patch_upstreams.add(host="detector", method="POST", path="/v1.0.1/checks", handler=detector_handler)

    r1 = await client.post(
        "/checks",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("x.png", original_bytes, "image/png")},
    )
    assert r1.status_code == 200
    detection_token = r1.json()["detection_token"]

    r2 = await client.post(
        "/upload/image",
        headers={"Authorization": f"Bearer {token}"},
        data={"detection_token": detection_token, "is_public": "false"},
        files={"file": ("x.png", modified_bytes, "image/png")},
    )
    assert r2.status_code == 400
    assert r2.json()["detail"] == "detection_token does not match uploaded image"
