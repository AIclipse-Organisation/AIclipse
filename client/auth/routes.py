from __future__ import annotations

import time
from typing import Callable

from flask import Blueprint, jsonify, make_response, redirect, request, session

from .core import clear_access_cookie, get_access_token, set_access_cookie
from .gateway import GatewayClient


def _is_valid_email_address(value: str) -> bool:
    if not value or any(char.isspace() for char in value):
        return False

    local_part, separator, domain = value.partition("@")
    if separator != "@" or not local_part or not domain:
        return False

    if "@" in domain or domain.startswith(".") or domain.endswith("."):
        return False

    labels = domain.split(".")
    return len(labels) >= 2 and all(label for label in labels)


def _extract_payload() -> dict:
    # Read JSON first, then fill missing keys from form data.
    # Example: if JSON has email only, form can still provide password.
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        payload = {}

    if request.form:
        for key, value in request.form.items():
            if key not in payload:
                payload[key] = value

    return payload


def build_auth_blueprint(gateway: GatewayClient, *, is_signup_enabled: Callable[[], bool]) -> Blueprint:
    bp = Blueprint("auth", __name__)

    @bp.post("/auth/signup")
    def auth_signup():
        if not is_signup_enabled():
            return jsonify({"detail": "Public registration is currently disabled"}), 403

        payload = _extract_payload()
        user_name = (payload.get("user_name") or "").strip()
        email = (payload.get("email") or "").strip()
        date_of_birth_raw = payload.get("date_of_birth")
        password = payload.get("password") or ""
        how_did_you_find_us = (payload.get("how_did_you_find_us") or "").strip()
        how_did_you_find_us_detail = (payload.get("how_did_you_find_us_detail") or "").strip()

        if not user_name or not email or not password or date_of_birth_raw is None or not how_did_you_find_us:
            return jsonify({"detail": "Please fill username, email, date of birth, password and how you found us."}), 400

        if how_did_you_find_us == "other" and not how_did_you_find_us_detail:
            return jsonify({"detail": "Please elaborate on how you found us."}), 400

        try:
            from datetime import datetime
            dob = datetime.strptime(date_of_birth_raw, "%d-%m-%Y").date()
            today = datetime.now().date()
            age = (today.year - dob.year) - ((today.month, today.day) < (dob.month, dob.day))
            if age < 18:
                return jsonify({"detail": "You must be at least 18 years old to sign up."}), 400
            if age > 150:
                return jsonify({"detail": "Please provide a valid date of birth."}), 400
        except ValueError:
            return jsonify({"detail": "Date of birth must be in DD-MM-YYYY format."}), 400

        if not _is_valid_email_address(email):
            return jsonify({"detail": "Please enter a valid email address."}), 400

        data, status = gateway.signup(
            user_name,
            email,
            date_of_birth_raw,
            password,
            how_did_you_find_us,
            how_did_you_find_us_detail or None,
        )
        if data is None:
            data = {"detail": "Signup failed"}
        return jsonify(data), status

    @bp.post("/auth/login")
    def auth_login():
        payload = _extract_payload()
        email = (payload.get("email") or "").strip()
        password = payload.get("password") or ""

        if not email or not password:
            return jsonify({"detail": "Please fill email and password."}), 400

        data, status = gateway.login(email, password)
        if status != 200 or not isinstance(data, dict):
            if not isinstance(data, dict):
                data = {"detail": "Login failed"}
            return jsonify(data), status

        token = data.get("token")
        user = data.get("user")

        if not isinstance(user, dict) or not token:
            return jsonify({"detail": "Gateway login response missing token or user"}), 502

        if isinstance(token, str) and token.lower().startswith("bearer "):
            token = token.split(" ", 1)[1].strip()

        if not isinstance(token, str) or not token:
            return jsonify({"detail": "Invalid token from gateway"}), 502

        session["current_user"] = user
        session["is_admin"] = bool(user.get("is_admin"))
        session["auth_checked_at"] = int(time.time())

        resp = make_response(jsonify({"user": user}), 200)
        set_access_cookie(resp, request, token)
        return resp

    @bp.post("/logout")
    def logout():
        session.clear()
        resp = make_response(jsonify({"detail": "Logged out"}), 200)
        clear_access_cookie(resp, request)
        return resp

    @bp.get("/auth/me")
    def auth_me_get():
        token = get_access_token(request)
        if not token:
            return jsonify({"detail": "Not authenticated"}), 401

        user, status = gateway.fetch_me(token)
        if status == 200 and isinstance(user, dict):
            session["current_user"] = user
            session["is_admin"] = bool(user.get("is_admin"))
            session["auth_checked_at"] = int(time.time())
            return jsonify(user), 200

        if status == 401:
            session.clear()
            resp = make_response(jsonify({"detail": "Unauthorized"}), 401)
            clear_access_cookie(resp, request)
            return resp

        return jsonify({"detail": "Service Temporarily Unavailable"}), 502

    @bp.patch("/auth/me")
    def auth_me_patch():
        token = get_access_token(request)
        if not token:
            return jsonify({"detail": "Not authenticated"}), 401

        payload = _extract_payload()
        data, status = gateway.call_json("PATCH", "/auth/me", token=token, json_data=payload)
        if status == 200 and isinstance(data, dict):
            session["current_user"] = data
            session["is_admin"] = bool(data.get("is_admin"))
            session["auth_checked_at"] = int(time.time())
        if data is None:
            data = {"detail": "Invalid JSON from gateway"}
        return jsonify(data), status

    @bp.delete("/auth/me")
    def auth_me_delete():
        token = get_access_token(request)
        if not token:
            return jsonify({"detail": "Not authenticated"}), 401

        data, status = gateway.call_json("DELETE", "/auth/me", token=token)
        if data is None:
            data = {"detail": "Invalid JSON from gateway on delete"}

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

    @bp.get("/auth/api-key")
    def auth_api_key_get():
        token = get_access_token(request)
        if not token:
            return jsonify({"detail": "Not authenticated"}), 401
        data, status = gateway.call_json("GET", "/auth/api-key", token=token)
        if data is None:
            data = {"detail": "Invalid JSON from gateway"}
        return jsonify(data), status

    @bp.post("/auth/api-key")
    def auth_api_key_rotate():
        token = get_access_token(request)
        if not token:
            return jsonify({"detail": "Not authenticated"}), 401
        data, status = gateway.call_json("POST", "/auth/api-key", token=token)
        if data is None:
            data = {"detail": "Invalid JSON from gateway"}
        return jsonify(data), status

    @bp.delete("/auth/api-key")
    def auth_api_key_delete():
        token = get_access_token(request)
        if not token:
            return jsonify({"detail": "Not authenticated"}), 401
        data, status = gateway.call_json("DELETE", "/auth/api-key", token=token)
        if data is None:
            data = {"detail": "Invalid JSON from gateway"}
        return jsonify(data), status

    @bp.get("/admin")
    def admin_route():
        token = get_access_token(request)
        if not token:
            return redirect("/")

        user = session.get("current_user")
        if not isinstance(user, dict):
            user, status = gateway.fetch_me(token)
            if status != 200 or not isinstance(user, dict):
                session.clear()
                resp = make_response(redirect("/"))
                clear_access_cookie(resp, request)
                return resp
            session["current_user"] = user
            session["is_admin"] = bool(user.get("is_admin"))
            session["auth_checked_at"] = int(time.time())

        if not bool(session.get("is_admin")):
            return "Forbidden: Admin access required", 403

        return redirect("/community/admin")

    return bp
