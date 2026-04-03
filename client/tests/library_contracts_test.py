from __future__ import annotations

from unittest.mock import Mock

from tests.conftest import ResponseStub


def test_fetch_post_for_image_uses_one_canonical_image_lookup(monkeypatch):
    from services.community import posts

    def fake_get(url, headers=None, params=None, timeout=None):
        assert url == "http://gateway.test/community/posts"
        assert params == {"image_id": "img_123"}
        assert headers == {"Accept": "application/json"}
        assert timeout == 10
        return ResponseStub(
            200,
            {
                "items": [
                    {"post_id": "post_other", "image_id": "img_other"},
                    {"post_id": "post_123", "image_id": "img_123", "description": "hello"},
                ]
            },
        )

    monkeypatch.setattr(posts.requests, "get", fake_get)

    post = posts.fetch_post_for_image(
        image_id="img_123",
        gateway_base_url="http://gateway.test",
        timeout_seconds=10,
    )

    assert post == {"post_id": "post_123", "image_id": "img_123", "description": "hello"}


def test_list_images_page_merges_moderation_server_side(monkeypatch):
    from services.library import images

    proxy_call = Mock(
        return_value=(
            {
                "items": [
                    {"image_id": "img_1", "is_public": False},
                    {"image_id": "img_2", "is_public": True},
                ]
            },
            200,
        )
    )
    moderation_call = Mock(
        return_value={
            "img_2": {
                "image_id": "img_2",
                "moderation_status": "removed",
                "moderation_reason": "Policy violation",
            }
        }
    )

    monkeypatch.setattr(images, "proxy_gateway_json_request", proxy_call)
    monkeypatch.setattr(images, "fetch_moderation_statuses", moderation_call)

    payload, status = images.list_images_page(
        token="user-token",
        gateway_base_url="http://gateway.test",
        params={},
    )

    assert status == 200
    assert payload == {
        "items": [
            {"image_id": "img_1", "is_public": False},
            {
                "image_id": "img_2",
                "is_public": True,
                "moderation_status": "removed",
                "moderation_reason": "Policy violation",
            },
        ]
    }
    proxy_call.assert_called_once_with(
        method="GET",
        base_url="http://gateway.test",
        path="/images",
        token="user-token",
        params={},
        timeout_seconds=10,
        invalid_json_detail="Invalid JSON from gateway on /images",
    )
    moderation_call.assert_called_once_with(
        image_ids=["img_1", "img_2"],
        gateway_base_url="http://gateway.test",
        timeout_seconds=10,
    )
