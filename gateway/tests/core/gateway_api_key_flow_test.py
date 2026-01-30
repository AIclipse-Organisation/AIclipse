import base64
import json
import time

import httpx
import jwt
import pytest


PNG_1X1_BLACK = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC"
)


@pytest.mark.asyncio
async def test_v1_checks_with_api_key_ok(client, patch_upstreams, auth_keypair):
    api_key = "ak_test.sk_test"
    user_id = "u_api_key"
    now = int(time.time())
    exp = now + 300

    def auth_exchange_handler(req: httpx.Request) -> httpx.Response:
        assert req.headers.get("x-internal-token") == "test-internal-token"
        body = json.loads(req.content.decode("utf-8"))
        assert body["api_key"] == api_key

        token = jwt.encode(
            {
                "sub": user_id,
                "email": "u_api_key@example.com",
                "is_admin": False,
                "plan": 0,
                "iat": now,
                "exp": exp,
            },
            auth_keypair.private_key,
            algorithm="RS256",
            headers={"kid": auth_keypair.kid},
        )
        return httpx.Response(200, json={"token": token, "exp": exp})

    def detector_handler(req: httpx.Request) -> httpx.Response:
        assert req.headers.get("x-user-id") == user_id
        assert req.headers.get("content-type") == "application/octet-stream"
        assert req.headers.get("x-request-id")
        assert req.content == PNG_1X1_BLACK
        return httpx.Response(200, json={"verdict": "FAKE", "label": "Most likely AI", "confidence": 0.77})

    patch_upstreams.add(host="auth", method="POST", path="/internal/api-key/exchange", handler=auth_exchange_handler)
    patch_upstreams.add(host="detector", method="POST", path="/v1.0.1/checks", handler=detector_handler)

    r = await client.post(
        "/v1/checks",
        headers={"X-Api-Key": api_key},
        files={"file": ("image.png", PNG_1X1_BLACK, "image/png")},
    )

    assert r.status_code == 200
    data = r.json()
    assert data["verdict"] == "FAKE"
    assert isinstance(data["confidence"], (int, float))
    assert "detection_token" in data


@pytest.mark.asyncio
async def test_v1_checks_with_api_key_invalid_key(client, patch_upstreams):
    def auth_exchange_handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"detail": "Invalid API key"})

    patch_upstreams.add(host="auth", method="POST", path="/internal/api-key/exchange", handler=auth_exchange_handler)

    r = await client.post(
        "/v1/checks",
        headers={"X-Api-Key": "ak_bad.sk_bad"},
        files={"file": ("image.png", PNG_1X1_BLACK, "image/png")},
    )

    assert r.status_code == 401
    assert r.json()["detail"] == "Invalid API key"


@pytest.mark.asyncio
async def test_v1_checks_with_api_key_exchange_forbidden(client, patch_upstreams):
    def auth_exchange_handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"detail": "Forbidden"})

    patch_upstreams.add(host="auth", method="POST", path="/internal/api-key/exchange", handler=auth_exchange_handler)

    r = await client.post(
        "/v1/checks",
        headers={"X-Api-Key": "ak_forbidden.sk_forbidden"},
        files={"file": ("image.png", PNG_1X1_BLACK, "image/png")},
    )

    assert r.status_code == 403
    assert r.json()["detail"] == "API key exchange forbidden"


@pytest.mark.asyncio
async def test_v1_checks_with_api_key_exchange_returns_bad_json(client, patch_upstreams):
    def auth_exchange_handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"not-json", headers={"content-type": "application/json"})

    patch_upstreams.add(host="auth", method="POST", path="/internal/api-key/exchange", handler=auth_exchange_handler)

    r = await client.post(
        "/v1/checks",
        headers={"X-Api-Key": "ak_ok.sk_ok"},
        files={"file": ("image.png", PNG_1X1_BLACK, "image/png")},
    )

    assert r.status_code == 502
    assert r.json()["detail"] == "Auth exchange returned invalid JSON"
