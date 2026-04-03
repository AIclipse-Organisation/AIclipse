from __future__ import annotations

from typing import Any

from flask import session

from auth.gateway import GatewayClient


def store_authenticated_user(user: dict[str, Any]) -> None:
    session["current_user"] = user
    session["is_admin"] = bool(user.get("is_admin"))

def clear_authenticated_user() -> None:
    session.pop("current_user", None)
    session.pop("is_admin", None)


def resolve_current_user(gateway: GatewayClient, token: str) -> tuple[dict[str, Any] | None, int]:
    me, status = gateway.fetch_me(token)
    if status == 200 and isinstance(me, dict):
        store_authenticated_user(me)
        return me, 200

    clear_authenticated_user()
    return None, status
