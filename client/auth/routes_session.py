from __future__ import annotations

from typing import Callable

from flask import Blueprint, jsonify, make_response, request, session

from services.auth.login import authenticate_login
from services.auth.session import store_authenticated_user
from services.auth.signup import submit_signup_request

from .cookies import clear_access_cookie, set_access_cookie
from .gateway import GatewayClient
from .request_data import extract_payload


def register_session_routes(
    bp: Blueprint,
    *,
    gateway: GatewayClient,
    is_signup_enabled: Callable[[], bool],
) -> None:
    @bp.post("/auth/signup")
    def auth_signup():
        if not is_signup_enabled():
            return jsonify({"detail": "Public registration is currently disabled"}), 403

        data, status = submit_signup_request(gateway, extract_payload())
        return jsonify(data), status

    @bp.post("/auth/login")
    def auth_login():
        data, token, user, status = authenticate_login(gateway, payload=extract_payload())
        if status != 200 or not token or not isinstance(user, dict):
            return jsonify(data), status

        store_authenticated_user(user)

        resp = make_response(jsonify({"user": user}), 200)
        set_access_cookie(resp, request, token)
        return resp

    @bp.post("/logout")
    def logout():
        session.clear()
        resp = make_response(jsonify({"detail": "Logged out"}), 200)
        clear_access_cookie(resp, request)
        return resp
