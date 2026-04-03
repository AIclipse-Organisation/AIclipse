from __future__ import annotations

from services.community.posts import fetch_post_for_image, require_post_id
from services.integrations.gateway import proxy_gateway_json_request


def list_viewscan_comments(
    *,
    image_id: str,
    gateway_base_url: str,
    timeout_seconds: int = 10,
) -> tuple[dict, int]:
    post_lookup = fetch_post_for_image(
        image_id=image_id,
        gateway_base_url=gateway_base_url,
        timeout_seconds=timeout_seconds,
    )
    if post_lookup.is_missing:
        return {"items": []}, 200
    post_id, post_error, post_status = require_post_id(
        post_lookup,
        missing_detail="Post not found for image",
        invalid_detail="Community post is missing post_id",
        lookup_detail="Failed to resolve community post for image",
    )
    if post_error:
        return post_error, post_status

    return proxy_gateway_json_request(
        method="GET",
        base_url=gateway_base_url,
        path="/community/posts/comments",
        token="",
        params={"post_id": post_id},
        timeout_seconds=timeout_seconds,
        invalid_json_detail="Invalid JSON from gateway on /community/posts/comments",
    )


def create_viewscan_comment(
    *,
    token: str,
    image_id: str,
    text: str,
    viewer_user_id: str,
    viewer_name: str,
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

    return proxy_gateway_json_request(
        method="POST",
        base_url=gateway_base_url,
        path="/community/posts/comments",
        token=token,
        json_body={
            "post_id": post_id,
            "user_id": viewer_user_id,
            "user_name": viewer_name,
            "text": text,
        },
        timeout_seconds=timeout_seconds,
        invalid_json_detail="Invalid JSON from gateway on /community/posts/comments",
    )


def delete_viewscan_comment(
    *,
    token: str,
    comment_id: str,
    gateway_base_url: str,
    timeout_seconds: int = 10,
) -> tuple[dict, int]:
    return proxy_gateway_json_request(
        method="DELETE",
        base_url=gateway_base_url,
        path="/community/posts/comments",
        token=token,
        params={"comment_id": comment_id},
        timeout_seconds=timeout_seconds,
        invalid_json_detail="Invalid JSON from gateway on /community/posts/comments",
    )
