from __future__ import annotations

from services.community.posts import extract_post_id, fetch_post_for_image, require_post_id
from services.integrations.gateway import proxy_gateway_json_request


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
    post_lookup = fetch_post_for_image(
        image_id=image_id,
        gateway_base_url=gateway_base_url,
        timeout_seconds=timeout_seconds,
        token=token,
    )
    if post_lookup.is_error:
        return {"detail": post_lookup.detail or "Failed to resolve community post for image"}, post_lookup.status

    if post_lookup.is_found:
        post_id, post_error, post_status = require_post_id(
            post_lookup,
            missing_detail="Post not found for image",
            invalid_detail="Community post is missing post_id",
            lookup_detail="Failed to resolve community post for image",
        )
        if post_error:
            return post_error, post_status

        patch_payload, patch_status = _patch_post_description(
            token=token,
            post_id=post_id or "",
            description=description,
            gateway_base_url=gateway_base_url,
            timeout_seconds=timeout_seconds,
        )
        if patch_status not in (200, 201):
            return patch_payload, patch_status
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
            return create_payload, create_status
        post_id = extract_post_id(create_payload)
        return {"image_id": image_id, "post_id": post_id, "is_public": True}, 200

    image_payload, image_status = _set_image_visibility(
        token=token,
        image_id=image_id,
        is_public=True,
        gateway_base_url=gateway_base_url,
        timeout_seconds=timeout_seconds,
    )
    if image_status != 200:
        return image_payload, image_status

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
