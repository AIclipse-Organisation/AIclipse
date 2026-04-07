from __future__ import annotations

from typing import Any

from flask import Request


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
