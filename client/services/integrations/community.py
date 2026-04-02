from __future__ import annotations

from typing import Any

import requests


def parse_proxy_json_response(
    resp: requests.Response,
    *,
    detail: str = "Non-JSON response from community service",
) -> dict[str, Any]:
    try:
        data = resp.json()
    except ValueError:
        return {"detail": detail}

    return data if isinstance(data, dict) else {"detail": detail}


def community_headers(*, token: str | None = None, json_body: bool = False) -> dict[str, str]:
    headers: dict[str, str] = {"Accept": "application/json"}
    if json_body:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def community_url(*, base_url: str, path: str) -> str:
    return base_url.rstrip("/") + path


def proxy_community_request(
    *,
    method: str,
    base_url: str,
    path: str,
    timeout_seconds: int = 10,
    token: str | None = None,
    json_body: dict[str, Any] | None = None,
    params: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], int]:
    try:
        resp = requests.request(
            method=method,
            url=community_url(base_url=base_url, path=path),
            headers=community_headers(token=token, json_body=json_body is not None),
            json=json_body,
            params=params,
            timeout=timeout_seconds,
        )
    except requests.RequestException:
        return {"detail": "Community service unreachable"}, 502

    return parse_proxy_json_response(resp), resp.status_code
