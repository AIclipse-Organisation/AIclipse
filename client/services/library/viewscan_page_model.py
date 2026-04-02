from __future__ import annotations

from typing import Any

import requests

from services.integrations.community import community_headers, community_url


def _community_posts_url(*, base_url: str) -> str:
    return community_url(base_url=base_url, path="/community/posts")


def _extract_item(payload: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None

    item = payload.get("item")
    if isinstance(item, dict):
        return item

    if payload.get("image_id"):
        return payload

    return None


def _find_matching_post(payload: dict[str, Any] | None, *, image_id: str) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None

    candidates: list[dict[str, Any]] = []
    if isinstance(payload.get("item"), dict):
        candidates.append(payload["item"])
    if isinstance(payload.get("items"), list):
        candidates.extend(item for item in payload["items"] if isinstance(item, dict))
    if payload.get("post_id") or payload.get("image_id"):
        candidates.append(payload)

    requested = str(image_id).strip()
    for candidate in candidates:
        candidate_image_id = (
            candidate.get("image_id")
            or candidate.get("imageId")
            or (candidate.get("image") or {}).get("image_id")
            or (candidate.get("image") or {}).get("id")
        )
        if candidate_image_id and str(candidate_image_id).strip() == requested:
            return candidate

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

    if not merged.get("description") and post.get("description"):
        merged["description"] = post.get("description")

    for field in ("up_vote_count", "down_vote_count", "comment_count", "updated_at"):
        if post.get(field) is not None:
            merged[field] = post.get(field)

    return merged


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


def _fetch_public_post_for_image(
    *,
    image_id: str,
    community_base_url: str,
    timeout_seconds: int,
) -> dict[str, Any] | None:
    try:
        resp = requests.get(
            _community_posts_url(base_url=community_base_url),
            headers=community_headers(),
            params={"image_id": image_id},
            timeout=timeout_seconds,
        )
    except requests.RequestException:
        return None

    if resp.status_code != 200:
        return None

    try:
        payload = resp.json()
    except ValueError:
        return None

    return _find_matching_post(payload, image_id=image_id)


def build_viewscan_page_model(
    *,
    image_id: str,
    token: str,
    gateway_base_url: str,
    community_base_url: str,
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

    page_model: dict[str, Any] = {"image": image, "title": "View Scan"}
    if not image.get("is_public"):
        return page_model, 200

    post = _fetch_public_post_for_image(
        image_id=image_id,
        community_base_url=community_base_url,
        timeout_seconds=timeout_seconds,
    )
    if not post:
        return page_model, 200

    page_model["image"] = _merge_post_fields(image, post)
    page_model["post"] = post
    return page_model, 200
