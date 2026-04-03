from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from services.integrations.gateway import proxy_gateway_json_request


@dataclass(frozen=True)
class PostLookupResult:
    post: dict[str, Any] | None
    status: int
    detail: str | None = None

    @property
    def is_found(self) -> bool:
        return self.status == 200 and isinstance(self.post, dict)

    @property
    def is_missing(self) -> bool:
        return self.status == 404 and self.post is None

    @property
    def is_error(self) -> bool:
        return not self.is_found and not self.is_missing


@dataclass(frozen=True)
class ModerationLookupResult:
    items: dict[str, dict[str, Any]]
    status: int
    detail: str | None = None

    @property
    def is_error(self) -> bool:
        return self.status != 200


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


def read_lookup_error_detail(payload: dict[str, Any] | None, *, default: str) -> str:
    if not isinstance(payload, dict):
        return default

    for field in ("detail", "error", "message"):
        value = payload.get(field)
        if value is not None:
            text = str(value).strip()
            if text:
                return text

    return default


def require_post_id(
    lookup: PostLookupResult,
    *,
    missing_detail: str,
    invalid_detail: str,
    lookup_detail: str,
) -> tuple[str | None, dict[str, Any] | None, int]:
    if lookup.is_missing:
        return None, {"detail": missing_detail}, 404

    if lookup.is_error:
        return None, {"detail": lookup.detail or lookup_detail}, lookup.status

    post_id = extract_post_id(lookup.post)
    if not post_id:
        return None, {"detail": invalid_detail}, 502

    return post_id, None, 200


def fetch_post_for_image(
    *,
    image_id: str,
    gateway_base_url: str,
    timeout_seconds: int,
    token: str | None = None,
) -> PostLookupResult:
    payload, status = proxy_gateway_json_request(
        method="GET",
        base_url=gateway_base_url,
        path="/community/posts",
        token=token or "",
        params={"image_id": image_id},
        timeout_seconds=timeout_seconds,
        invalid_json_detail="Invalid JSON from gateway on /community/posts",
    )
    if status != 200:
        return PostLookupResult(
            post=None,
            status=status,
            detail=read_lookup_error_detail(payload, default="Community post lookup failed"),
        )

    post = find_post_for_image(payload, image_id=image_id)
    if not post:
        return PostLookupResult(post=None, status=404, detail="Post not found for image")

    return PostLookupResult(post=post, status=200)


def fetch_moderation_statuses(
    *,
    image_ids: list[str],
    gateway_base_url: str,
    timeout_seconds: int,
) -> ModerationLookupResult:
    requested_ids = [str(image_id).strip() for image_id in image_ids if str(image_id or "").strip()]
    if not requested_ids:
        return ModerationLookupResult(items={}, status=200)

    payload, status = proxy_gateway_json_request(
        method="POST",
        base_url=gateway_base_url,
        path="/community/posts/moderation-status",
        token="",
        json_body={"image_ids": requested_ids},
        timeout_seconds=timeout_seconds,
        invalid_json_detail="Invalid JSON from gateway on /community/posts/moderation-status",
    )
    if status != 200:
        return ModerationLookupResult(
            items={},
            status=status,
            detail=read_lookup_error_detail(payload, default="Moderation lookup failed"),
        )

    items = payload.get("items") if isinstance(payload, dict) else None
    if not isinstance(items, list):
        return ModerationLookupResult(
            items={},
            status=502,
            detail="Invalid moderation payload from gateway",
        )

    moderation_by_image_id: dict[str, dict[str, Any]] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        item_image_id = str(item.get("image_id") or "").strip()
        if item_image_id:
            moderation_by_image_id[item_image_id] = item

    return ModerationLookupResult(items=moderation_by_image_id, status=200)


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
