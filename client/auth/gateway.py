from __future__ import annotations

import logging
from typing import Any

import requests


class GatewayClient:
    def __init__(self, base_url: str, *, timeout_seconds: int = 10):
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds

    def fetch_me(self, token: str) -> tuple[dict[str, Any] | None, int]:
        resp, status = self._request_response(
            method="GET",
            path="/auth/me",
            token=token,
            timeout_seconds=5,
            failure_log="Gateway /auth/me request failed",
        )
        if resp is None:
            return None, status

        if resp.status_code == 200:
            return self._decode_required_json(resp, invalid_json_status=502)

        if resp.status_code == 401:
            return None, 401

        return None, resp.status_code

    def login(self, email: str, password: str) -> tuple[dict[str, Any] | None, int]:
        return self._request_json(
            method="POST",
            path="/auth/login",
            json_data={"email": email, "password": password},
            failure_log="Gateway /auth/login request failed",
            invalid_json_detail=None,
        )

    def signup(
        self,
        user_name: str,
        email: str,
        date_of_birth: str,
        password: str,
        how_did_you_find_us: str,
        how_did_you_find_us_detail: str | None = None,
    ) -> tuple[dict[str, Any] | None, int]:
        return self._request_json(
            method="POST",
            path="/auth/signup",
            json_data={
                "user_name": user_name,
                "email": email,
                "date_of_birth": date_of_birth,
                "password": password,
                "how_did_you_find_us": how_did_you_find_us,
                "how_did_you_find_us_detail": how_did_you_find_us_detail,
            },
            failure_log="Gateway /auth/signup request failed",
            invalid_json_detail=None,
        )

    def call_json(
        self,
        method: str,
        path: str,
        *,
        token: str | None = None,
        json_data: dict | None = None,
    ) -> tuple[dict[str, Any] | None, int]:
        return self._request_json(
            method=method,
            path=path,
            token=token,
            json_data=json_data,
            failure_log="Gateway request failed",
            invalid_json_detail="Invalid JSON from gateway",
        )

    def _request_json(
        self,
        *,
        method: str,
        path: str,
        token: str | None = None,
        json_data: dict[str, Any] | None = None,
        failure_log: str,
        invalid_json_detail: str | None,
        timeout_seconds: int | None = None,
    ) -> tuple[dict[str, Any] | None, int]:
        resp, status = self._request_response(
            method=method,
            path=path,
            token=token,
            json_data=json_data,
            timeout_seconds=timeout_seconds,
            failure_log=failure_log,
        )
        if resp is None:
            if invalid_json_detail == "Invalid JSON from gateway":
                return {"detail": "Gateway unreachable"}, status
            return None, status

        return self._decode_optional_json(resp, invalid_json_detail=invalid_json_detail)

    def _request_response(
        self,
        *,
        method: str,
        path: str,
        token: str | None = None,
        json_data: dict[str, Any] | None = None,
        timeout_seconds: int | None = None,
        failure_log: str,
    ) -> tuple[requests.Response | None, int]:
        request_kwargs: dict[str, Any] = {
            "method": method,
            "url": self._url(path),
            "headers": self._headers(token),
            "timeout": self.timeout_seconds if timeout_seconds is None else timeout_seconds,
        }
        if json_data is not None:
            request_kwargs["json"] = json_data

        try:
            if method.upper() == "GET":
                return requests.get(
                    request_kwargs["url"],
                    headers=request_kwargs["headers"],
                    timeout=request_kwargs["timeout"],
                ), 200
            return requests.request(**request_kwargs), 200
        except requests.RequestException:
            logging.exception(failure_log)
            return None, 502

    def _url(self, path: str) -> str:
        return f"{self.base_url}{path}"

    def _headers(self, token: str | None = None) -> dict[str, str]:
        headers: dict[str, str] = {"Accept": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return headers

    def _decode_required_json(
        self,
        resp: requests.Response,
        *,
        invalid_json_status: int,
    ) -> tuple[dict[str, Any] | None, int]:
        try:
            return resp.json(), resp.status_code
        except ValueError:
            return None, invalid_json_status

    def _decode_optional_json(
        self,
        resp: requests.Response,
        *,
        invalid_json_detail: str | None,
    ) -> tuple[dict[str, Any] | None, int]:
        try:
            return resp.json(), resp.status_code
        except ValueError:
            if invalid_json_detail is None:
                return None, resp.status_code
            return {"detail": invalid_json_detail}, resp.status_code
