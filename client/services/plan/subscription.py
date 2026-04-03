from __future__ import annotations

from typing import Any

from auth.gateway import GatewayClient
from services.auth.session import resolve_current_user


def parse_plan_id(raw_plan_id: Any) -> int | None:
    try:
        plan_id = int(raw_plan_id)
    except Exception:
        return None

    return plan_id if plan_id in (1, 2) else None


def resolve_billing_user(
    *,
    gateway: GatewayClient,
    token: str,
) -> tuple[dict[str, Any] | None, int]:
    return resolve_current_user(gateway, token)


def build_checkout_payload(*, user: dict[str, Any], plan_id: int) -> dict[str, Any] | None:
    user_id = user.get("user_id")
    email = user.get("email")
    if not user_id or not email:
        return None

    return {"user_id": user_id, "plan_id": plan_id, "email": email}


def build_subscription_status_path(*, user_id: str) -> str:
    return f"/api/billing/subscription/status?user_id={user_id}"


def build_cancel_subscription_payload(*, user_id: str, reason: str) -> dict[str, Any]:
    return {"user_id": user_id, "reason": reason.strip()}
