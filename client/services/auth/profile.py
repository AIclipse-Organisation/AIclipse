from __future__ import annotations

from typing import Any

from auth.gateway import GatewayClient
from services.auth.session import store_authenticated_user


def refresh_authenticated_user(gateway: GatewayClient, *, token: str) -> tuple[dict[str, Any], int]:
    user, status = gateway.fetch_me(token)
    if status == 200 and isinstance(user, dict):
        store_authenticated_user(user)
        return user, 200

    if status == 401:
        return {"detail": "Unauthorized"}, 401

    return {"detail": "Service Temporarily Unavailable"}, 502


def update_authenticated_user(
    gateway: GatewayClient,
    *,
    token: str,
    payload: dict[str, Any],
) -> tuple[dict[str, Any], int]:
    data, status = gateway.call_json("PATCH", "/auth/me", token=token, json_data=payload)
    if status == 200 and isinstance(data, dict):
        store_authenticated_user(data)
        return data, 200

    if data is None:
        data = {"detail": "Invalid JSON from gateway"}
    return data, status


def delete_authenticated_user(gateway: GatewayClient, *, token: str) -> tuple[dict[str, Any], int]:
    data, status = gateway.call_json("DELETE", "/auth/me", token=token)
    if data is None:
        data = {"detail": "Invalid JSON from gateway on delete"}
    return data, status
