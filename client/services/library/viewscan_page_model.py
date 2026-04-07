from __future__ import annotations

from typing import Any

from services.community.posts import fetch_moderation_statuses, fetch_post_for_image, merge_moderation_fields
from services.integrations.gateway import proxy_gateway_json_request


def _extract_item(payload: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None

    item = payload.get("item")
    if isinstance(item, dict):
        return item

    if payload.get("image_id"):
        return payload

    return None


def _merge_post_fields(image: dict[str, Any], post: dict[str, Any]) -> dict[str, Any]:
    merged = dict(image)
    merged["post_id"] = (
        image.get("post_id")
        or image.get("postId")
        or image.get("community_post_id")
        or post.get("post_id")
        or post.get("postId")
        or post.get("id")
    )

    if not merged.get("user_id") and post.get("user_id"):
        merged["user_id"] = post.get("user_id")

    if not merged.get("user_name") and post.get("user_name"):
        merged["user_name"] = post.get("user_name")

    if not merged.get("description") and post.get("description"):
        merged["description"] = post.get("description")

    for field in ("up_vote_count", "down_vote_count", "comment_count", "updated_at"):
        if post.get(field) is not None:
            merged[field] = post.get(field)

    return merged


def _build_viewscan_actions(*, image: dict[str, Any] | None, viewer: dict[str, Any] | None) -> dict[str, bool]:
    viewer_user_id = str((viewer or {}).get("user_id") or "").strip()
    image_owner_id = str((image or {}).get("user_id") or "").strip()
    is_owner = bool(viewer_user_id and image_owner_id and viewer_user_id == image_owner_id)
    is_public = bool((image or {}).get("is_public") is True)
    is_moderated = str((image or {}).get("moderation_status") or "").strip().lower() == "removed"

    return {
        "show_delete_scan": is_owner,
        "show_publish": is_owner and not is_public and not is_moderated,
        "show_make_private": is_owner and is_public,
        "show_edit_description": is_owner and is_public and not is_moderated,
        "show_comments": is_public,
    }


def _fetch_image_item(
    *,
    image_id: str,
    token: str,
    gateway_base_url: str,
    timeout_seconds: int,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None, int]:
    payload, status = proxy_gateway_json_request(
        method="GET",
        base_url=gateway_base_url,
        path=f"/image/{image_id}",
        token=token,
        timeout_seconds=timeout_seconds,
        invalid_json_detail="Invalid JSON from gateway on /image",
    )
    if status != 200:
        return None, payload if isinstance(payload, dict) else {"detail": "Image lookup failed"}, status

    image = _extract_item(payload)
    if not image:
        return None, {"detail": "Image not found"}, 404

    return image, None, 200


def build_viewscan_page_model(
    *,
    image_id: str,
    token: str,
    gateway_base_url: str,
    viewer: dict[str, Any] | None = None,
    timeout_seconds: int = 10,
) -> tuple[dict[str, Any], int]:
    image, image_error, image_status = _fetch_image_item(
        image_id=image_id,
        token=token,
        gateway_base_url=gateway_base_url,
        timeout_seconds=timeout_seconds,
    )
    if image_error:
        return image_error, image_status

    moderation_lookup = fetch_moderation_statuses(
        image_ids=[image_id],
        gateway_base_url=gateway_base_url,
        timeout_seconds=timeout_seconds,
    )
    if moderation_lookup.is_error:
        return {"detail": moderation_lookup.detail or "Failed to load moderation state"}, moderation_lookup.status

    image = merge_moderation_fields(image, moderation_lookup.items.get(str(image_id).strip()))

    page_model: dict[str, Any] = {"image": image, "title": "View Scan"}
    if not image.get("is_public"):
        if viewer:
            page_model["viewer"] = viewer
        page_model["actions"] = _build_viewscan_actions(image=page_model["image"], viewer=viewer)
        return page_model, 200

    post_lookup = fetch_post_for_image(
        image_id=image_id,
        gateway_base_url=gateway_base_url,
        timeout_seconds=timeout_seconds,
    )
    if post_lookup.is_error:
        return {"detail": post_lookup.detail or "Failed to load community post"}, post_lookup.status
    if post_lookup.is_missing:
        return {"detail": "Public image is missing community post"}, 502

    page_model["image"] = _merge_post_fields(image, post_lookup.post or {})
    page_model["post"] = post_lookup.post
    if viewer:
        page_model["viewer"] = viewer
    page_model["actions"] = _build_viewscan_actions(image=page_model["image"], viewer=viewer)
    return page_model, 200
