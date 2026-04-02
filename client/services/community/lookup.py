from __future__ import annotations

import requests

from services.community.parsing import extract_post_id


def fetch_post_id_for_image(
    *,
    image_id: str,
    community_base_url: str,
    timeout_seconds: int,
) -> str | None:
    try:
        resp = requests.get(
            community_base_url.rstrip("/") + "/community/posts",
            headers={"Accept": "application/json"},
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

    return extract_post_id(payload)
