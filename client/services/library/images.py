from __future__ import annotations

from typing import Any

from services.community.posts import fetch_moderation_statuses, merge_moderation_fields_for_items
from services.integrations.gateway import proxy_gateway_json_request


def list_images_page(
    *,
    token: str,
    gateway_base_url: str,
    params: dict[str, Any] | None = None,
    timeout_seconds: int = 10,
) -> tuple[dict[str, Any], int]:
    payload, status = proxy_gateway_json_request(
        method="GET",
        base_url=gateway_base_url,
        path="/images",
        token=token,
        params=params,
        timeout_seconds=timeout_seconds,
        invalid_json_detail="Invalid JSON from gateway on /images",
    )
    if status != 200:
        return payload, status

    items = payload.get("items")
    if not isinstance(items, list):
        return payload, status

    scan_items = [item for item in items if isinstance(item, dict)]
    moderation_by_image_id = fetch_moderation_statuses(
        image_ids=[str(item.get("image_id") or "").strip() for item in scan_items],
        gateway_base_url=gateway_base_url,
        timeout_seconds=timeout_seconds,
    )

    return {
        **payload,
        "items": merge_moderation_fields_for_items(scan_items, moderation_by_image_id),
    }, status
