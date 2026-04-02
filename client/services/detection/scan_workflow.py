from __future__ import annotations

from typing import Any

from services.integrations.gateway import proxy_gateway_json_request, proxy_gateway_multipart_request


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
            "is_public": "false",
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
        post_payload, post_status = proxy_gateway_json_request(
            method="POST",
            base_url=gateway_base_url,
            path="/community/posts",
            token=token,
            json_body={
                "image_id": image_id,
                "description": description,
                "result": {
                    "verdict": (upload_payload.get("body") or {}).get("verdict") or upload_payload.get("verdict"),
                    "label": (upload_payload.get("body") or {}).get("label") or upload_payload.get("label"),
                    "confidence": (upload_payload.get("body") or {}).get("confidence") or upload_payload.get("confidence"),
                },
            },
            timeout_seconds=10,
            invalid_json_detail="Invalid JSON from gateway on /community/posts",
        )
    except Exception:
        return {"detail": "Community service unreachable", "image_id": image_id}, 502

    if post_status != 200:
        if "image_id" not in post_payload:
            post_payload["image_id"] = image_id
        return post_payload, post_status

    result["published"] = True
    result["post_id"] = _resolve_post_id(post_payload)
    result["post"] = post_payload
    return result, 200
