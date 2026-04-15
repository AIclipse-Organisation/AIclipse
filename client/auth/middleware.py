from __future__ import annotations

from urllib.parse import urlsplit

from flask import Flask, jsonify, make_response, redirect, request, session

from .cookies import clear_access_cookie, get_access_token
from .gateway import GatewayClient
from .request_policy import is_api_request
from services.auth.session import store_authenticated_user

MUTATING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def _normalize_origin(url: str | None) -> str | None:
    if not url:
        return None

    parts = urlsplit(url)
    if not parts.scheme or not parts.hostname:
        return None

    scheme = parts.scheme.lower()
    hostname = parts.hostname.lower()
    port = parts.port
    default_port = 443 if scheme == "https" else 80 if scheme == "http" else None
    if port and port != default_port:
        return f"{scheme}://{hostname}:{port}"
    return f"{scheme}://{hostname}"


def register_auth_middleware(app: Flask, gateway: GatewayClient) -> None:
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
    def _enforce_same_origin_mutations():
        if request.method not in MUTATING_METHODS:
            return None

        if not get_access_token(request):
            return None

        expected_origin = _normalize_origin(request.host_url)
        if not expected_origin:
            return None

        origin_header = (request.headers.get("Origin") or "").strip()
        if origin_header:
            actual_origin = _normalize_origin(origin_header)
            if actual_origin != expected_origin:
                return jsonify({"detail": "Cross-site request blocked"}), 403
            return None

        referer_header = (request.headers.get("Referer") or "").strip()
        if referer_header:
            actual_origin = _normalize_origin(referer_header)
            if actual_origin != expected_origin:
                return jsonify({"detail": "Cross-site request blocked"}), 403
            return None

        fetch_site = (request.headers.get("Sec-Fetch-Site") or "").strip().lower()
        if fetch_site and fetch_site not in ("same-origin", "none"):
            return jsonify({"detail": "Cross-site request blocked"}), 403

        return None

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

        user, status = gateway.fetch_me(token)
        if status == 200 and isinstance(user, dict):
            store_authenticated_user(user)
            return None

        session.clear()
        return redirect_to_login(clear_cookie=True)
