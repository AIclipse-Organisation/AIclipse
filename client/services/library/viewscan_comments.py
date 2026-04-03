from __future__ import annotations

import requests

from services.community.posts import fetch_post_id_for_image, parse_community_json_response


def _community_comments_url(*, base_url: str) -> str:
    return base_url.rstrip("/") + "/community/posts/comments"


def list_viewscan_comments(
    *,
    image_id: str,
    gateway_base_url: str,
    timeout_seconds: int = 10,
) -> tuple[dict, int]:
    post_id = fetch_post_id_for_image(
        image_id=image_id,
        gateway_base_url=gateway_base_url,
        timeout_seconds=timeout_seconds,
    )
    if not post_id:
        return {"items": []}, 200

    try:
        resp = requests.get(
            _community_comments_url(base_url=gateway_base_url),
            headers={"Accept": "application/json"},
            params={"post_id": post_id},
            timeout=timeout_seconds,
        )
    except requests.RequestException:
        return {"detail": "Community service unreachable"}, 502

    return parse_community_json_response(resp, detail="Non-JSON response from community service")


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
    post_id = fetch_post_id_for_image(
        image_id=image_id,
        gateway_base_url=gateway_base_url,
        timeout_seconds=timeout_seconds,
        token=token,
    )
    if not post_id:
        return {"detail": "Post not found for image"}, 404

    try:
        resp = requests.post(
            _community_comments_url(base_url=gateway_base_url),
            json={
                "post_id": post_id,
                "user_id": viewer_user_id,
                "user_name": viewer_name,
                "text": text,
            },
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
                "Authorization": f"Bearer {token}",
            },
            timeout=timeout_seconds,
        )
    except requests.RequestException:
        return {"detail": "Community service unreachable"}, 502

    return parse_community_json_response(resp, detail="Non-JSON response from community service")


def delete_viewscan_comment(
    *,
    token: str,
    comment_id: str,
    gateway_base_url: str,
    timeout_seconds: int = 10,
) -> tuple[dict, int]:
    try:
        resp = requests.delete(
            _community_comments_url(base_url=gateway_base_url),
            headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {token}",
            },
            params={"comment_id": comment_id},
            timeout=timeout_seconds,
        )
    except requests.RequestException:
        return {"detail": "Community service unreachable"}, 502

    return parse_community_json_response(resp, detail="Non-JSON response from community service")
