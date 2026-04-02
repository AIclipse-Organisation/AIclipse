from __future__ import annotations

import time
from typing import Any

from flask import session

from auth.gateway import GatewayClient


def store_authenticated_user(user: dict[str, Any]) -> None:
    session["current_user"] = user
    session["is_admin"] = bool(user.get("is_admin"))
    session["auth_checked_at"] = int(time.time())


def get_session_user() -> dict[str, Any] | None:
    user = session.get("current_user")
    return user if isinstance(user, dict) else None


def resolve_current_user(gateway: GatewayClient, token: str) -> tuple[dict[str, Any] | None, int]:
    user = get_session_user()
    if user and user.get("user_id"):
        return user, 200

    me, status = gateway.fetch_me(token)
    if status == 200 and isinstance(me, dict):
        store_authenticated_user(me)
        return me, 200

    return None, status
