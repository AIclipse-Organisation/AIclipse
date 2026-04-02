from __future__ import annotations

from typing import Any

import requests


def _gateway_url(*, base_url: str, path: str) -> str:
    return base_url.rstrip("/") + path


def _gateway_headers(*, token: str, json_body: bool = False) -> dict[str, str]:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if json_body:
        headers["Content-Type"] = "application/json"
    return headers


def _parse_gateway_json_response(
    resp: requests.Response,
    *,
    detail: str,
) -> tuple[dict[str, Any], int]:
    try:
        payload = resp.json()
    except ValueError:
        return {"detail": detail}, 502

    if isinstance(payload, dict):
        return payload, resp.status_code

    return {"detail": detail}, 502


def proxy_gateway_json_request(
    *,
    method: str,
    base_url: str,
    path: str,
    token: str,
    params: dict[str, Any] | None = None,
    json_body: dict[str, Any] | None = None,
    timeout_seconds: int = 10,
    invalid_json_detail: str = "Invalid JSON from gateway",
) -> tuple[dict[str, Any], int]:
    try:
        resp = requests.request(
            method=method,
            url=_gateway_url(base_url=base_url, path=path),
            headers=_gateway_headers(token=token, json_body=json_body is not None),
            params=params,
            json=json_body,
            timeout=timeout_seconds,
        )
    except requests.RequestException:
        return {"detail": "Gateway unreachable"}, 502

    return _parse_gateway_json_response(resp, detail=invalid_json_detail)


def proxy_gateway_multipart_request(
    *,
    method: str,
    base_url: str,
    path: str,
    token: str,
    files: dict[str, Any],
    form_data: dict[str, Any] | None = None,
    timeout_seconds: int = 60,
    invalid_json_detail: str = "Invalid JSON from gateway",
) -> tuple[dict[str, Any], int]:
    try:
        resp = requests.request(
            method=method,
            url=_gateway_url(base_url=base_url, path=path),
            headers=_gateway_headers(token=token),
            data=form_data,
            files=files,
            timeout=timeout_seconds,
        )
    except requests.RequestException:
        return {"detail": "Gateway unreachable"}, 502

    return _parse_gateway_json_response(resp, detail=invalid_json_detail)
