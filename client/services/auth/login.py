from __future__ import annotations

from typing import Any

from auth.gateway import GatewayClient


def authenticate_login(
    gateway: GatewayClient,
    *,
    payload: dict[str, Any],
) -> tuple[dict[str, Any], str | None, dict[str, Any] | None, int]:
    email = str(payload.get("email") or "").strip()
    password = payload.get("password") or ""

    if not email or not password:
        return {"detail": "Please fill email and password."}, None, None, 400

    data, status = gateway.login(email, password)
    if status != 200 or not isinstance(data, dict):
        if not isinstance(data, dict):
            data = {"detail": "Login failed"}
        return data, None, None, status

    token = data.get("token")
    user = data.get("user")

    if not isinstance(user, dict) or not token:
        return {"detail": "Gateway login response missing token or user"}, None, None, 502

    if isinstance(token, str) and token.lower().startswith("bearer "):
        token = token.split(" ", 1)[1].strip()

    if not isinstance(token, str) or not token:
        return {"detail": "Invalid token from gateway"}, None, None, 502

    return {"user": user}, token, user, 200
