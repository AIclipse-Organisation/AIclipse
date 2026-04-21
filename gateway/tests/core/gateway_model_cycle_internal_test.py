import httpx
import pytest


@pytest.mark.asyncio
async def test_internal_model_cycle_evaluate_requires_internal_token(client):
    response = await client.post("/internal/model-cycle/imageconfidence/evaluate", json={"postId": "post_1"})

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid internal auth token"


@pytest.mark.asyncio
async def test_internal_model_cycle_evaluate_proxies_canonical_internal_contract(client, patch_upstreams):
    def evaluate_handler(req: httpx.Request) -> httpx.Response:
        assert req.headers.get("x-internal-token") == "test-internal-token"
        assert req.headers.get("x-user-id") is None
        assert req.headers.get("x-user-is-admin") is None
        assert req.headers.get("content-type", "").startswith("application/json")
        assert req.content == b'{"postId":"post_1","mediaImageId":"img_1"}'
        return httpx.Response(status_code=200, json={"label": "real", "isReady": False})

    patch_upstreams.add(
        host="model-cycle",
        method="POST",
        path="/api/imageconfidence/evaluate",
        handler=evaluate_handler,
    )

    response = await client.post(
        "/internal/model-cycle/imageconfidence/evaluate",
        headers={"X-Internal-Token": "test-internal-token"},
        json={"postId": "post_1", "mediaImageId": "img_1"},
    )

    assert response.status_code == 200
    assert response.json() == {"label": "real", "isReady": False}
