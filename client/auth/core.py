from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from flask import Request


def get_access_token(req: Request) -> str | None:
    return req.cookies.get("access_token")


def is_request_secure(req: Request) -> bool:
    proto = req.headers.get("X-Forwarded-Proto", req.scheme or "http")
    return proto.split(",", 1)[0].strip().lower() == "https"


def set_access_cookie(resp, req: Request, token: str, *, max_age_seconds: int = 60 * 60 * 24 * 7) -> None:
    resp.set_cookie(
        "access_token",
        token,
        httponly=True,
        secure=is_request_secure(req),
        samesite="Lax",
        max_age=max_age_seconds,
        path="/",
    )


def clear_access_cookie(resp, req: Request) -> None:
    resp.set_cookie(
        "access_token",
        "",
        expires=datetime(1970, 1, 1, tzinfo=timezone.utc),
        httponly=True,
        secure=is_request_secure(req),
        samesite="Lax",
        path="/",
    )


def is_api_request(req: Request) -> bool:
    if req.method == "OPTIONS":
        return True

    p = req.path or ""
    api_prefixes = (
        "/auth/",
        "/checks",
        "/upload/",
        "/images",
        "/image/",
        "/community/",
        "/logout",
        "/usage/",
        "/billing/",
    )
    if p.startswith(api_prefixes):
        return True

    accept = (req.headers.get("Accept") or "").lower()
    if "application/json" in accept:
        return True

    xrw = (req.headers.get("X-Requested-With") or "").lower()
    return xrw == "xmlhttprequest"


def json_error(detail: str, *, status: int) -> tuple[dict[str, Any], int]:
    return {"detail": detail}, status