from __future__ import annotations

from typing import Any

import requests


def build_gateway_url(*, base_url: str, path: str) -> str:
    return base_url.rstrip("/") + path


def build_gateway_headers(*, token: str | None = None, json_body: bool = False) -> dict[str, str]:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if json_body:
        headers["Content-Type"] = "application/json"
    return headers


def request_gateway_response(
    *,
    method: str,
    base_url: str,
    path: str,
    token: str | None = None,
    params: dict[str, Any] | None = None,
    json_body: dict[str, Any] | None = None,
    form_data: dict[str, Any] | None = None,
    files: dict[str, Any] | None = None,
    timeout_seconds: int = 10,
) -> tuple[requests.Response | None, int]:
    try:
        url = build_gateway_url(base_url=base_url, path=path)
        headers = build_gateway_headers(token=token, json_body=json_body is not None)
        normalized_method = method.upper()
        if normalized_method == "GET" and json_body is None and form_data is None and files is None:
            request_kwargs = {
                "headers": headers,
                "timeout": timeout_seconds,
            }
            if params is not None:
                request_kwargs["params"] = params
            resp = requests.get(url, **request_kwargs)
        elif normalized_method == "POST" and form_data is None and files is None:
            request_kwargs = {
                "headers": headers,
                "timeout": timeout_seconds,
            }
            if params is not None:
                request_kwargs["params"] = params
            if json_body is not None:
                request_kwargs["json"] = json_body
            resp = requests.post(url, **request_kwargs)
        elif normalized_method == "PATCH" and form_data is None and files is None:
            request_kwargs = {
                "headers": headers,
                "timeout": timeout_seconds,
            }
            if params is not None:
                request_kwargs["params"] = params
            if json_body is not None:
                request_kwargs["json"] = json_body
            resp = requests.patch(url, **request_kwargs)
        elif normalized_method == "DELETE" and form_data is None and files is None:
            request_kwargs = {
                "headers": headers,
                "timeout": timeout_seconds,
            }
            if params is not None:
                request_kwargs["params"] = params
            resp = requests.delete(url, **request_kwargs)
        else:
            resp = requests.request(
                method=normalized_method,
                url=url,
                headers=headers,
                params=params,
                json=json_body,
                data=form_data,
                files=files,
                timeout=timeout_seconds,
            )
    except requests.RequestException:
        return None, 502

    return resp, resp.status_code


def parse_gateway_json_response(
    resp: requests.Response,
    *,
    invalid_json_detail: str | None,
) -> tuple[dict[str, Any] | None, int]:
    try:
        payload = resp.json()
    except ValueError:
        if invalid_json_detail is None:
            return None, resp.status_code
        return {"detail": invalid_json_detail}, resp.status_code

    if isinstance(payload, dict):
        return payload, resp.status_code

    if invalid_json_detail is None:
        return None, resp.status_code
    return {"detail": invalid_json_detail}, resp.status_code


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
    resp, status = request_gateway_response(
        method=method,
        base_url=base_url,
        path=path,
        token=token,
        params=params,
        json_body=json_body,
        timeout_seconds=timeout_seconds,
    )
    if resp is None:
        return {"detail": "Gateway unreachable"}, 502

    payload, payload_status = parse_gateway_json_response(
        resp,
        invalid_json_detail=invalid_json_detail,
    )
    if payload is None:
        return {"detail": invalid_json_detail}, payload_status
    return payload, payload_status


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
    resp, status = request_gateway_response(
        method=method,
        base_url=base_url,
        path=path,
        token=token,
        form_data=form_data,
        files=files,
        timeout_seconds=timeout_seconds,
    )
    if resp is None:
        return {"detail": "Gateway unreachable"}, 502

    payload, payload_status = parse_gateway_json_response(
        resp,
        invalid_json_detail=invalid_json_detail,
    )
    if payload is None:
        return {"detail": invalid_json_detail}, payload_status
    return payload, payload_status
