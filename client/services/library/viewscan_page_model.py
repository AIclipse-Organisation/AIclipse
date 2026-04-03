from __future__ import annotations

from typing import Any

import requests

from services.community.posts import fetch_moderation_statuses, fetch_post_for_image, merge_moderation_fields


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
    try:
        resp = requests.get(
            gateway_base_url.rstrip("/") + f"/image/{image_id}",
            headers={"Accept": "application/json", "Authorization": f"Bearer {token}"},
            timeout=timeout_seconds,
        )
    except requests.RequestException:
        return None, {"detail": "Gateway unreachable"}, 502

    try:
        payload = resp.json()
    except ValueError:
        return None, {"detail": "Invalid JSON from gateway on /image"}, 502

    if resp.status_code != 200:
        return None, payload if isinstance(payload, dict) else {"detail": "Image lookup failed"}, resp.status_code

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

    moderation_by_image_id = fetch_moderation_statuses(
        image_ids=[image_id],
        gateway_base_url=gateway_base_url,
        timeout_seconds=timeout_seconds,
    )
    image = merge_moderation_fields(image, moderation_by_image_id.get(str(image_id).strip()))

    page_model: dict[str, Any] = {"image": image, "title": "View Scan"}
    if not image.get("is_public"):
        if viewer:
            page_model["viewer"] = viewer
        page_model["actions"] = _build_viewscan_actions(image=page_model["image"], viewer=viewer)
        return page_model, 200

    post = fetch_post_for_image(
        image_id=image_id,
        gateway_base_url=gateway_base_url,
        timeout_seconds=timeout_seconds,
    )
    if not post:
        if viewer:
            page_model["viewer"] = viewer
        page_model["actions"] = _build_viewscan_actions(image=page_model["image"], viewer=viewer)
        return page_model, 200

    page_model["image"] = _merge_post_fields(image, post)
    page_model["post"] = post
    if viewer:
        page_model["viewer"] = viewer
    page_model["actions"] = _build_viewscan_actions(image=page_model["image"], viewer=viewer)
    return page_model, 200
