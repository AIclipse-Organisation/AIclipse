from __future__ import annotations

from flask import Blueprint, jsonify, make_response, redirect, request, session

from services.auth.profile import (
    delete_authenticated_user,
    refresh_authenticated_user,
    update_authenticated_user,
)
from services.auth.session import resolve_current_user

from .cookies import clear_access_cookie, get_access_token
from .gateway import GatewayClient
from .request_data import extract_payload


def register_profile_routes(bp: Blueprint, *, gateway: GatewayClient) -> None:
    @bp.get("/auth/me")
    def auth_me_get():
        token = get_access_token(request)
        if not token:
            return jsonify({"detail": "Not authenticated"}), 401

        data, status = refresh_authenticated_user(gateway, token=token)
        if status == 200:
            return jsonify(data), 200

        if status == 401:
            session.clear()
            resp = make_response(jsonify({"detail": "Unauthorized"}), 401)
            clear_access_cookie(resp, request)
            return resp

        return jsonify(data), status

    @bp.patch("/auth/me")
    def auth_me_patch():
        token = get_access_token(request)
        if not token:
            return jsonify({"detail": "Not authenticated"}), 401

        data, status = update_authenticated_user(gateway, token=token, payload=extract_payload())
        return jsonify(data), status

    @bp.delete("/auth/me")
    def auth_me_delete():
        token = get_access_token(request)
        if not token:
            return jsonify({"detail": "Not authenticated"}), 401

        data, status = delete_authenticated_user(gateway, token=token)

        if status == 200:
            session.clear()
            resp = make_response(jsonify(data), 200)
            clear_access_cookie(resp, request)
            return resp

        if status == 401:
            session.clear()
            resp = make_response(jsonify(data), 401)
            clear_access_cookie(resp, request)
            return resp

        return jsonify(data), status

    @bp.get("/admin")
    def admin_route():
        token = get_access_token(request)
        if not token:
            return redirect("/")

        user, status = resolve_current_user(gateway, token)
        if status != 200 or not isinstance(user, dict):
            session.clear()
            resp = make_response(redirect("/"))
            clear_access_cookie(resp, request)
            return resp

        if not bool(user.get("is_admin")):
            return "Forbidden: Admin access required", 403

        return redirect("/community/admin")
