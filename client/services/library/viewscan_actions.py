from __future__ import annotations

from services.community.posts import extract_post_id, fetch_post_for_image, require_post_id
from services.integrations.gateway import proxy_gateway_json_request


def _extract_image_item(payload: dict | None) -> dict | None:
    if not isinstance(payload, dict):
        return None

    item = payload.get("item")
    if isinstance(item, dict):
        return item

    if payload.get("image_id") or "is_public" in payload:
        return payload

    return None


def _fetch_image_public_state(
    *,
    token: str,
    image_id: str,
    gateway_base_url: str,
    timeout_seconds: int,
) -> tuple[bool | None, dict, int]:
    payload, status = proxy_gateway_json_request(
        method="GET",
        base_url=gateway_base_url,
        path=f"/image/{image_id}",
        token=token,
        timeout_seconds=timeout_seconds,
        invalid_json_detail="Invalid JSON from gateway on /image",
    )
    if status != 200:
        return None, payload, status

    item = _extract_image_item(payload)
    is_public = item.get("is_public") if isinstance(item, dict) else None
    if not isinstance(is_public, bool):
        return None, {"detail": "Image metadata is missing is_public"}, 502

    return is_public, payload, 200


def _return_publish_error(
    *,
    restored_visibility: bool,
    token: str,
    image_id: str,
    gateway_base_url: str,
    timeout_seconds: int,
    error_payload: dict,
    error_status: int,
) -> tuple[dict, int]:
    if not restored_visibility:
        return error_payload, error_status

    rollback_payload, rollback_status = _set_image_visibility(
        token=token,
        image_id=image_id,
        is_public=False,
        gateway_base_url=gateway_base_url,
        timeout_seconds=timeout_seconds,
    )
    if rollback_status != 200:
        return rollback_payload, rollback_status

    return error_payload, error_status


def _patch_post_description(
    *,
    token: str,
    post_id: str,
    description: str,
    gateway_base_url: str,
    timeout_seconds: int,
) -> tuple[dict, int]:
    return proxy_gateway_json_request(
        method="PATCH",
        base_url=gateway_base_url,
        path="/community/posts",
        token=token,
        params={"post_id": post_id},
        json_body={"description": description},
        timeout_seconds=timeout_seconds,
        invalid_json_detail="Invalid JSON from gateway on /community/posts",
    )


def _create_post_for_image(
    *,
    token: str,
    image_id: str,
    description: str,
    image_result: dict,
    gateway_base_url: str,
    timeout_seconds: int,
) -> tuple[dict, int]:
    return proxy_gateway_json_request(
        method="POST",
        base_url=gateway_base_url,
        path="/community/posts",
        token=token,
        json_body={
            "image_id": image_id,
            "description": description,
            "result": {
                "verdict": image_result.get("verdict"),
                "label": image_result.get("label"),
                "confidence": image_result.get("confidence"),
            },
        },
        timeout_seconds=timeout_seconds,
        invalid_json_detail="Invalid JSON from gateway on /community/posts",
    )


def _set_image_visibility(
    *,
    token: str,
    image_id: str,
    is_public: bool,
    gateway_base_url: str,
    timeout_seconds: int,
) -> tuple[dict, int]:
    return proxy_gateway_json_request(
        method="PATCH",
        base_url=gateway_base_url,
        path=f"/image/{image_id}",
        token=token,
        json_body={"is_public": is_public},
        timeout_seconds=timeout_seconds,
        invalid_json_detail="Invalid JSON from gateway on PATCH /image",
    )


def publish_viewscan(
    *,
    token: str,
    image_id: str,
    description: str,
    image_result: dict,
    gateway_base_url: str,
    timeout_seconds: int = 10,
) -> tuple[dict, int]:
    image_is_public, image_payload, image_status = _fetch_image_public_state(
        token=token,
        image_id=image_id,
        gateway_base_url=gateway_base_url,
        timeout_seconds=timeout_seconds,
    )
    if image_status != 200:
        return image_payload, image_status

    restored_visibility = False
    if not image_is_public:
        image_payload, image_status = _set_image_visibility(
            token=token,
            image_id=image_id,
            is_public=True,
            gateway_base_url=gateway_base_url,
            timeout_seconds=timeout_seconds,
        )
        if image_status != 200:
            return image_payload, image_status
        restored_visibility = True

    post_lookup = fetch_post_for_image(
        image_id=image_id,
        gateway_base_url=gateway_base_url,
        timeout_seconds=timeout_seconds,
        token=token,
    )
    if post_lookup.is_error:
        return _return_publish_error(
            restored_visibility=restored_visibility,
            token=token,
            image_id=image_id,
            gateway_base_url=gateway_base_url,
            timeout_seconds=timeout_seconds,
            error_payload={"detail": post_lookup.detail or "Failed to resolve community post for image"},
            error_status=post_lookup.status,
        )

    if post_lookup.is_found:
        post_id, post_error, post_status = require_post_id(
            post_lookup,
            missing_detail="Post not found for image",
            invalid_detail="Community post is missing post_id",
            lookup_detail="Failed to resolve community post for image",
        )
        if post_error:
            return _return_publish_error(
                restored_visibility=restored_visibility,
                token=token,
                image_id=image_id,
                gateway_base_url=gateway_base_url,
                timeout_seconds=timeout_seconds,
                error_payload=post_error,
                error_status=post_status,
            )

        patch_payload, patch_status = _patch_post_description(
            token=token,
            post_id=post_id or "",
            description=description,
            gateway_base_url=gateway_base_url,
            timeout_seconds=timeout_seconds,
        )
        if patch_status not in (200, 201):
            return _return_publish_error(
                restored_visibility=restored_visibility,
                token=token,
                image_id=image_id,
                gateway_base_url=gateway_base_url,
                timeout_seconds=timeout_seconds,
                error_payload=patch_payload,
                error_status=patch_status,
            )
    else:
        create_payload, create_status = _create_post_for_image(
            token=token,
            image_id=image_id,
            description=description,
            image_result=image_result,
            gateway_base_url=gateway_base_url,
            timeout_seconds=timeout_seconds,
        )
        if create_status not in (200, 201):
            return _return_publish_error(
                restored_visibility=restored_visibility,
                token=token,
                image_id=image_id,
                gateway_base_url=gateway_base_url,
                timeout_seconds=timeout_seconds,
                error_payload=create_payload,
                error_status=create_status,
            )
        post_id = extract_post_id(create_payload)

    return {"image_id": image_id, "post_id": post_id, "is_public": True}, 200


def make_viewscan_private(
    *,
    token: str,
    image_id: str,
    gateway_base_url: str,
    timeout_seconds: int = 10,
) -> tuple[dict, int]:
    payload, status = _set_image_visibility(
        token=token,
        image_id=image_id,
        is_public=False,
        gateway_base_url=gateway_base_url,
        timeout_seconds=timeout_seconds,
    )
    if status != 200:
        return payload, status

    return {"image_id": image_id, "is_public": False}, 200


def update_viewscan_description(
    *,
    token: str,
    image_id: str,
    description: str,
    gateway_base_url: str,
    timeout_seconds: int = 10,
) -> tuple[dict, int]:
    post_lookup = fetch_post_for_image(
        image_id=image_id,
        gateway_base_url=gateway_base_url,
        timeout_seconds=timeout_seconds,
        token=token,
    )
    post_id, post_error, post_status = require_post_id(
        post_lookup,
        missing_detail="Post not found for image",
        invalid_detail="Community post is missing post_id",
        lookup_detail="Failed to resolve community post for image",
    )
    if post_error:
        return post_error, post_status

    payload, status = _patch_post_description(
        token=token,
        post_id=post_id or "",
        description=description,
        gateway_base_url=gateway_base_url,
        timeout_seconds=timeout_seconds,
    )
    if status not in (200, 201):
        return payload, status

    return {"image_id": image_id, "post_id": post_id, "description": description}, 200


def delete_viewscan(
    *,
    token: str,
    image_id: str,
    gateway_base_url: str,
    timeout_seconds: int = 10,
) -> tuple[dict, int]:
    payload, status = proxy_gateway_json_request(
        method="DELETE",
        base_url=gateway_base_url,
        path=f"/image/{image_id}",
        token=token,
        timeout_seconds=timeout_seconds,
        invalid_json_detail="Invalid JSON from gateway on DELETE /image",
    )
    if status != 200:
        return payload, status

    return {"image_id": image_id, "deleted": True}, 200
