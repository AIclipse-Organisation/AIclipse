from __future__ import annotations

from typing import Any

import requests


def parse_community_json_response(
    resp: requests.Response,
    *,
    detail: str,
) -> tuple[dict[str, Any], int]:
    try:
        payload = resp.json()
    except ValueError:
        return {"detail": detail}, 502

    if isinstance(payload, dict):
        return payload, resp.status_code

    return {"detail": detail}, 502


def extract_post_id(payload: dict[str, Any] | None) -> str | None:
    post = extract_post(payload)
    if not post:
        return None

    post_id = post.get("post_id") or post.get("postId") or post.get("id")
    if not post_id:
        return None

    return str(post_id).strip() or None


def extract_post(payload: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None

    candidates = list(iter_post_candidates(payload))
    for candidate in candidates:
        if candidate.get("post_id") or candidate.get("postId") or candidate.get("id"):
            return candidate

    return None


def iter_post_candidates(payload: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        return []

    candidates: list[dict[str, Any]] = []
    item = payload.get("item")
    if isinstance(item, dict):
        candidates.append(item)

    items = payload.get("items")
    if isinstance(items, list):
        candidates.extend(item for item in items if isinstance(item, dict))

    if payload.get("post_id") or payload.get("postId") or payload.get("id") or payload.get("image_id"):
        candidates.append(payload)

    return candidates


def find_post_for_image(payload: dict[str, Any] | None, *, image_id: str) -> dict[str, Any] | None:
    requested_image_id = str(image_id or "").strip()
    if not requested_image_id:
        return None

    for candidate in iter_post_candidates(payload):
        candidate_image_id = (
            candidate.get("image_id")
            or candidate.get("imageId")
            or (candidate.get("image") or {}).get("image_id")
            or (candidate.get("image") or {}).get("id")
        )
        if candidate_image_id and str(candidate_image_id).strip() == requested_image_id:
            return candidate

    return None


def fetch_post_for_image(
    *,
    image_id: str,
    gateway_base_url: str,
    timeout_seconds: int,
    token: str | None = None,
) -> dict[str, Any] | None:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    try:
        resp = requests.get(
            gateway_base_url.rstrip("/") + "/community/posts",
            headers=headers,
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

    return find_post_for_image(payload, image_id=image_id)


def fetch_post_id_for_image(
    *,
    image_id: str,
    gateway_base_url: str,
    timeout_seconds: int,
    token: str | None = None,
) -> str | None:
    post = fetch_post_for_image(
        image_id=image_id,
        gateway_base_url=gateway_base_url,
        timeout_seconds=timeout_seconds,
        token=token,
    )
    return extract_post_id(post)


def fetch_moderation_statuses(
    *,
    image_ids: list[str],
    gateway_base_url: str,
    timeout_seconds: int,
) -> dict[str, dict[str, Any]]:
    requested_ids = [str(image_id).strip() for image_id in image_ids if str(image_id or "").strip()]
    if not requested_ids:
        return {}

    try:
        resp = requests.post(
            gateway_base_url.rstrip("/") + "/community/posts/moderation-status",
            headers={"Accept": "application/json", "Content-Type": "application/json"},
            json={"image_ids": requested_ids},
            timeout=timeout_seconds,
        )
    except requests.RequestException:
        return {}

    if resp.status_code != 200:
        return {}

    try:
        payload = resp.json()
    except ValueError:
        return {}

    items = payload.get("items") if isinstance(payload, dict) else None
    if not isinstance(items, list):
        return {}

    moderation_by_image_id: dict[str, dict[str, Any]] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        item_image_id = str(item.get("image_id") or "").strip()
        if item_image_id:
            moderation_by_image_id[item_image_id] = item

    return moderation_by_image_id


def merge_moderation_fields(
    item: dict[str, Any],
    moderation: dict[str, Any] | None,
) -> dict[str, Any]:
    if not moderation:
        return dict(item)

    merged = dict(item)
    if moderation.get("moderation_status") is not None:
        merged["moderation_status"] = moderation.get("moderation_status")
    if moderation.get("moderation_reason") is not None:
        merged["moderation_reason"] = moderation.get("moderation_reason")
    return merged


def merge_moderation_fields_for_items(
    items: list[dict[str, Any]],
    moderation_by_image_id: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    merged_items: list[dict[str, Any]] = []
    for item in items:
        image_id = str(item.get("image_id") or "").strip()
        merged_items.append(merge_moderation_fields(item, moderation_by_image_id.get(image_id)))
    return merged_items
