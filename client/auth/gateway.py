from __future__ import annotations

import logging
from typing import Any

import requests


class GatewayClient:
    def __init__(self, base_url: str, *, timeout_seconds: int = 10):
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds

    def fetch_me(self, token: str) -> tuple[dict[str, Any] | None, int]:
        url = f"{self.base_url}/auth/me"
        headers = {"Accept": "application/json", "Authorization": f"Bearer {token}"}

        try:
            resp = requests.get(url, headers=headers, timeout=5)
        except requests.RequestException:
            logging.exception("Gateway /auth/me request failed")
            return None, 502

        if resp.status_code == 200:
            try:
                return resp.json(), 200
            except ValueError:
                return None, 502

        if resp.status_code == 401:
            return None, 401

        return None, resp.status_code

    def login(self, email: str, password: str) -> tuple[dict[str, Any] | None, int]:
        url = f"{self.base_url}/auth/login"
        try:
            resp = requests.post(url, json={"email": email, "password": password}, timeout=self.timeout_seconds)
        except requests.RequestException:
            logging.exception("Gateway /auth/login request failed")
            return None, 502

        try:
            data = resp.json()
        except ValueError:
            data = None

        return data, resp.status_code

    def signup(self, user_name: str, email: str, age: int, password: str) -> tuple[dict[str, Any] | None, int]:
        url = f"{self.base_url}/auth/signup"
        try:
            resp = requests.post(
                url,
                json={"user_name": user_name, "email": email, "age": age, "password": password},
                timeout=self.timeout_seconds,
            )
        except requests.RequestException:
            logging.exception("Gateway /auth/signup request failed")
            return None, 502

        try:
            data = resp.json()
        except ValueError:
            data = None

        return data, resp.status_code

    def call_json(
        self,
        method: str,
        path: str,
        *,
        token: str | None = None,
        json_data: dict | None = None,
    ) -> tuple[dict[str, Any] | None, int]:
        url = f"{self.base_url}{path}"
        headers: dict[str, str] = {"Accept": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        try:
            resp = requests.request(
                method=method,
                url=url,
                json=json_data,
                headers=headers,
                timeout=self.timeout_seconds,
            )
        except requests.RequestException:
            logging.exception("Gateway request failed")
            return {"detail": "Gateway unreachable"}, 502

        try:
            data = resp.json()
        except ValueError:
            data = {"detail": "Invalid JSON from gateway"}

        return data, resp.status_code
