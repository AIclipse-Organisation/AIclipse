from __future__ import annotations

from typing import Any

import requests


def parse_json_response(resp: requests.Response, *, detail: str) -> tuple[dict[str, Any], int]:
    try:
        payload = resp.json()
    except ValueError:
        return {"detail": detail}, 502

    if isinstance(payload, dict):
        return payload, resp.status_code

    return {"detail": detail}, 502


def extract_post_id(payload: dict[str, Any] | None) -> str | None:
    if not isinstance(payload, dict):
        return None

    candidates: list[dict[str, Any]] = []
    if isinstance(payload.get("item"), dict):
        candidates.append(payload["item"])
    if isinstance(payload.get("items"), list):
        candidates.extend(item for item in payload["items"] if isinstance(item, dict))
    if payload.get("post_id") or payload.get("id"):
        candidates.append(payload)

    for candidate in candidates:
        post_id = candidate.get("post_id") or candidate.get("postId") or candidate.get("id")
        if post_id:
            return str(post_id).strip()

    return None
