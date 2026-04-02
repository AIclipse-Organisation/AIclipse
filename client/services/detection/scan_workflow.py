from __future__ import annotations

from typing import Any

import requests

from services.integrations.gateway import proxy_gateway_multipart_request


def _json_or_error(resp: requests.Response | Any, *, detail: str) -> tuple[dict[str, Any], int] | None:
    try:
        payload = resp.json()
    except ValueError:
        return {"detail": detail}, 502

    if isinstance(payload, dict):
        return payload, resp.status_code

    return {"detail": detail}, 502


def _resolve_image_id(payload: dict[str, Any]) -> str | None:
    image_id = (
        payload.get("image_id")
        or (payload.get("image") or {}).get("image_id")
        or (payload.get("body") or {}).get("image_id")
        or ((payload.get("body") or {}).get("image") or {}).get("image_id")
    )
    return str(image_id).strip() if image_id else None


def _resolve_post_id(payload: dict[str, Any]) -> str | None:
    post_id = (
        payload.get("post_id")
        or (payload.get("item") or {}).get("post_id")
        or (payload.get("post") or {}).get("post_id")
    )
    return str(post_id).strip() if post_id else None


def perform_results_save(
    *,
    token: str,
    file_name: str,
    file_bytes: bytes,
    mime_type: str,
    detection_token: str,
    is_public: bool,
    description: str,
    user_id: str | None,
    gateway_base_url: str,
    community_base_url: str,
    timeout_seconds: int = 30,
) -> tuple[dict[str, Any], int]:
    upload_payload, upload_status = proxy_gateway_multipart_request(
        method="POST",
        base_url=gateway_base_url,
        path="/upload/image",
        token=token,
        files={"file": (file_name, file_bytes, mime_type or "application/octet-stream")},
        form_data={
            "detection_token": detection_token,
            "is_public": "true" if is_public else "false",
        },
        timeout_seconds=timeout_seconds,
        invalid_json_detail="Invalid JSON from gateway on /upload/image",
    )

    if upload_status not in (200, 201):
        return upload_payload, upload_status

    image_id = _resolve_image_id(upload_payload)
    result: dict[str, Any] = {
        "image_id": image_id,
        "published": False,
        "upload": upload_payload,
    }

    if not is_public:
        return result, 200

    if not user_id:
        return {"detail": "Missing authenticated user context for publish"}, 502

    if not image_id:
        return {"detail": "Saved image, but could not read image_id from server response."}, 502

    try:
        post_resp = requests.post(
            community_base_url.rstrip("/") + "/community/posts",
            json={
                "user_id": user_id,
                "image_id": image_id,
                "description": description,
                "result": {
                    "verdict": (upload_payload.get("body") or {}).get("verdict") or upload_payload.get("verdict"),
                    "label": (upload_payload.get("body") or {}).get("label") or upload_payload.get("label"),
                    "confidence": (upload_payload.get("body") or {}).get("confidence") or upload_payload.get("confidence"),
                },
            },
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Authorization": f"Bearer {token}",
            },
            timeout=10,
        )
    except requests.RequestException:
        return {"detail": "Community service unreachable", "image_id": image_id}, 502

    parsed_post = _json_or_error(post_resp, detail="Non-JSON response from community service")
    if parsed_post is None:
        return {"detail": "Non-JSON response from community service", "image_id": image_id}, 502

    post_payload, post_status = parsed_post
    if post_status != 200:
        if "image_id" not in post_payload:
            post_payload["image_id"] = image_id
        return post_payload, post_status

    result["published"] = True
    result["post_id"] = _resolve_post_id(post_payload)
    result["post"] = post_payload
    return result, 200
