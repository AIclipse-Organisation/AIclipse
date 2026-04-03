import base64
import hashlib

import httpx
import jwt
import pytest

try:
    from tests.conftest import make_auth_token
except ModuleNotFoundError:
    from gateway.tests.conftest import make_auth_token


# Small, valid 1x1 PNGs so the gateway's image sniffing passes.
PNG_1X1_BLACK = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC"
)
PNG_1X1_WHITE = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC"
)


@pytest.mark.asyncio
async def test_checks_ok_returns_detection_token(client, patch_upstreams, auth_keypair):
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
        return httpx.Response(
            status_code=200,
            json={
                "verdict": "ok",
                "label": "clean",
                "confidence": 0.9,
                "model_version": "v-det-1",
            },
        )

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
    assert payload["model_version"] == "v-det-1"
    assert body["model_version"] == "v-det-1"


@pytest.mark.asyncio
async def test_checks_rejects_bad_content_type(client, auth_keypair):
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
async def test_upload_image_validates_detection_token_and_proxies_to_media(client, patch_upstreams, auth_keypair):
    token = make_auth_token(
        keypair=auth_keypair,
        user_id="u_up",
        email="u_up@example.com",
        is_admin=False,
        plan=0,
    )

    image_bytes = PNG_1X1_BLACK

    def detector_handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status_code=200,
            json={
                "verdict": "ok",
                "label": "clean",
                "confidence": 0.42,
                "model_version": "v-det-2",
            },
        )

    patch_upstreams.add(host="detector", method="POST", path="/v1.0.1/checks", handler=detector_handler)

    def media_upload_handler(req: httpx.Request) -> httpx.Response:
        assert req.headers.get("content-type", "").startswith("multipart/form-data")
        assert b'name="model_version"' in req.content
        assert b"v-det-2" in req.content
        return httpx.Response(
            status_code=201,
            json={
                "verdict": "ok",
                "label": "clean",
                "confidence": 0.42,
                "image": {"user_id": "u_up", "url": "https://cdn.example/images/abc"},
            },
        )

    patch_upstreams.add(host="media", method="POST", path="/upload/image", handler=media_upload_handler)

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
    assert body["confidence"] == 0.42
    assert body["image"]["user_id"] == "u_up"
    assert body["image"]["url"].startswith("https://cdn.example/images/")


@pytest.mark.asyncio
async def test_upload_image_returns_503_when_media_is_unreachable(client, patch_upstreams, auth_keypair):
    token = make_auth_token(
        keypair=auth_keypair,
        user_id="u_up",
        email="u_up@example.com",
        is_admin=False,
        plan=0,
    )

    image_bytes = PNG_1X1_BLACK

    def detector_handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status_code=200,
            json={
                "verdict": "ok",
                "label": "clean",
                "confidence": 0.42,
                "model_version": "v-det-3",
            },
        )

    def media_upload_handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code=503, json={"detail": "Image metadata store unavailable"})

    patch_upstreams.add(host="detector", method="POST", path="/v1.0.1/checks", handler=detector_handler)
    patch_upstreams.add(host="media", method="POST", path="/upload/image", handler=media_upload_handler)

    r1 = await client.post(
        "/checks",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("x.png", image_bytes, "image/png")},
    )
    detection_token = r1.json()["detection_token"]

    r2 = await client.post(
        "/upload/image",
        headers={"Authorization": f"Bearer {token}"},
        data={"detection_token": detection_token, "is_public": "false"},
        files={"file": ("x.png", image_bytes, "image/png")},
    )

    assert r2.status_code == 503
    assert r2.json()["detail"] == "Media service error: 503"


@pytest.mark.asyncio
async def test_upload_image_rejects_modified_bytes(client, patch_upstreams, auth_keypair):
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
        return httpx.Response(
            status_code=200,
            json={
                "verdict": "ok",
                "label": "clean",
                "confidence": 0.1,
                "model_version": "v-det-4",
            },
        )

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


@pytest.mark.asyncio
async def test_checks_returns_503_when_usage_check_is_unreachable(client, patch_upstreams, auth_keypair):
    token = make_auth_token(
        keypair=auth_keypair,
        user_id="u_quota",
        email="u_quota@example.com",
        is_admin=False,
        plan=0,
    )

    patch_upstreams.add(
        host="auth",
        method="POST",
        path="/usage/check",
        handler=lambda _req: httpx.Response(status_code=503, json={"detail": "usage unavailable"}),
    )

    r = await client.post(
        "/checks",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("x.png", PNG_1X1_BLACK, "image/png")},
    )

    assert r.status_code == 503
    assert r.json()["detail"] == "Usage service unavailable"


@pytest.mark.asyncio
async def test_checks_returns_503_when_usage_increment_fails_after_detection(client, patch_upstreams, auth_keypair):
    token = make_auth_token(
        keypair=auth_keypair,
        user_id="u_quota_inc",
        email="u_quota_inc@example.com",
        is_admin=False,
        plan=0,
    )

    patch_upstreams.add(
        host="detector",
        method="POST",
        path="/v1.0.1/checks",
        handler=lambda _req: httpx.Response(
            status_code=200,
            json={
                "verdict": "ok",
                "label": "clean",
                "confidence": 0.2,
                "model_version": "v-det-5",
            },
        ),
    )
    patch_upstreams.add(
        host="auth",
        method="POST",
        path="/usage/increment",
        handler=lambda _req: httpx.Response(status_code=503, json={"detail": "usage unavailable"}),
    )

    r = await client.post(
        "/checks",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("x.png", PNG_1X1_BLACK, "image/png")},
    )

    assert r.status_code == 503
    assert r.json()["detail"] == "Usage service unavailable"
