from __future__ import annotations

from unittest.mock import Mock

from services.community.posts import ModerationLookupResult


def test_fetch_post_for_image_returns_explicit_found_result(monkeypatch):
    from services.community import posts

    proxy_call = Mock(
        return_value=(
            {
                "items": [
                    {"post_id": "post_other", "image_id": "img_other"},
                    {"post_id": "post_123", "image_id": "img_123", "description": "hello"},
                ]
            },
            200,
        )
    )
    monkeypatch.setattr(posts, "proxy_gateway_json_request", proxy_call)

    lookup = posts.fetch_post_for_image(
        image_id="img_123",
        gateway_base_url="http://gateway.test",
        timeout_seconds=10,
    )

    assert lookup.is_found is True
    assert lookup.is_missing is False
    assert lookup.is_error is False
    assert lookup.post == {"post_id": "post_123", "image_id": "img_123", "description": "hello"}
    proxy_call.assert_called_once_with(
        method="GET",
        base_url="http://gateway.test",
        path="/community/posts",
        token="",
        params={"image_id": "img_123"},
        timeout_seconds=10,
        invalid_json_detail="Invalid JSON from gateway on /community/posts",
    )


def test_fetch_post_for_image_returns_explicit_error_result_on_gateway_failure(monkeypatch):
    from services.community import posts

    monkeypatch.setattr(
        posts,
        "proxy_gateway_json_request",
        Mock(return_value=({"detail": "Gateway unreachable"}, 502)),
    )

    lookup = posts.fetch_post_for_image(
        image_id="img_123",
        gateway_base_url="http://gateway.test",
        timeout_seconds=10,
    )

    assert lookup.is_found is False
    assert lookup.is_missing is False
    assert lookup.is_error is True
    assert lookup.status == 502
    assert lookup.detail == "Gateway unreachable"


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
        return_value=ModerationLookupResult(
            items={
                "img_2": {
                    "image_id": "img_2",
                    "moderation_status": "removed",
                    "moderation_reason": "Policy violation",
                }
            },
            status=200,
        )
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


def test_list_images_page_fails_closed_when_moderation_lookup_fails(monkeypatch):
    from services.library import images

    proxy_call = Mock(
        return_value=(
            {"items": [{"image_id": "img_1", "is_public": False}]},
            200,
        )
    )
    moderation_call = Mock(
        return_value=ModerationLookupResult(
            items={},
            status=502,
            detail="Moderation lookup failed",
        )
    )

    monkeypatch.setattr(images, "proxy_gateway_json_request", proxy_call)
    monkeypatch.setattr(images, "fetch_moderation_statuses", moderation_call)

    payload, status = images.list_images_page(
        token="user-token",
        gateway_base_url="http://gateway.test",
        params={},
    )

    assert status == 502
    assert payload == {"detail": "Moderation lookup failed"}
