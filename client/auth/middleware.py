from __future__ import annotations

import time

from flask import Flask, make_response, redirect, request, session

from .core import clear_access_cookie, get_access_token, is_api_request
from .gateway import GatewayClient


def register_auth_middleware(app: Flask, gateway: GatewayClient, *, cache_ttl_seconds: int = 30) -> None:
    def is_public_path(path: str) -> bool:
        return (
            path == "/"
            or path == "/login"
            or path == "/healthz"
            or path.startswith("/static/")
            or path.startswith("/static")
            or path.startswith("/favicon.ico")
        )

    def redirect_to_login(*, clear_cookie: bool):
        resp = make_response(redirect("/login"))
        if clear_cookie:
            clear_access_cookie(resp, request)
        resp.headers["Cache-Control"] = "no-store, max-age=0, must-revalidate"
        resp.headers["Pragma"] = "no-cache"
        return resp

    @app.before_request
    def _enforce_auth():
        if request.method == "OPTIONS":
            return None

        if is_api_request(request):
            return None

        path = request.path or ""
        if is_public_path(path):
            return None

        token = get_access_token(request)
        if not token:
            session.clear()
            return redirect_to_login(clear_cookie=False)

        now = int(time.time())
        checked_at = int(session.get("auth_checked_at") or 0)

        if session.get("current_user") and (now - checked_at) < cache_ttl_seconds:
            return None

        user, status = gateway.fetch_me(token)
        if status == 200 and isinstance(user, dict):
            session["current_user"] = user
            session["is_admin"] = bool(user.get("is_admin"))
            session["auth_checked_at"] = now
            return None

        session.clear()
        return redirect_to_login(clear_cookie=True)
