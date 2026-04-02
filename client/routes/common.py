from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from flask import jsonify, make_response, redirect, request, session

from auth.cookies import clear_access_cookie, get_access_token
from auth.gateway import GatewayClient
from services.plan.subscription import resolve_billing_user
from services.auth.session import get_session_user, resolve_current_user


@dataclass(frozen=True)
class RouteDeps:
    gateway: GatewayClient
    gateway_uri: str
    community_uri: str


MAX_TEXT_FIELD_LENGTH = 1000


def json_missing_auth(*, community_shape: bool = False):
    if community_shape:
        return jsonify({"error": "Unauthorized", "detail": "Missing auth token"}), 401
    return jsonify({"detail": "Not authenticated"}), 401


def clear_session_and_return_unauthorized_json(payload: dict[str, Any] | None = None):
    session.clear()
    resp = make_response(jsonify(payload or {"detail": "Unauthorized"}), 401)
    clear_access_cookie(resp, request)
    return resp


def get_required_token(*, community_shape: bool = False) -> tuple[str | None, Any | None]:
    token = get_access_token(request)
    if token:
        return token, None
    return None, json_missing_auth(community_shape=community_shape)


def parse_json_body_or_400():
    try:
        return request.get_json(force=True), None
    except Exception:
        return None, (jsonify({"detail": "Invalid JSON body"}), 400)


def read_bounded_text(
    body: dict[str, Any] | None,
    *,
    field: str,
    empty_detail: str,
    too_long_detail: str,
    max_length: int = MAX_TEXT_FIELD_LENGTH,
):
    value = str((body or {}).get(field) or "").strip()
    if not value:
        return None, (jsonify({"detail": empty_detail}), 400)
    if len(value) > max_length:
        return None, (jsonify({"detail": too_long_detail.format(length=len(value), max=max_length)}), 400)
    return value, None


def resolve_viewer_or_error(*, deps: RouteDeps, token: str, missing_detail: str):
    viewer = get_session_user()
    if viewer and viewer.get("user_id"):
        return viewer, None

    viewer, viewer_status = resolve_current_user(deps.gateway, token)
    if viewer_status == 401:
        return None, clear_session_and_return_unauthorized_json()
    if not viewer or not viewer.get("user_id"):
        return None, (jsonify({"detail": missing_detail}), 502)
    return viewer, None


def resolve_viewer_for_page_or_redirect(*, deps: RouteDeps, token: str):
    viewer = get_session_user()
    if viewer and viewer.get("user_id"):
        return viewer, None

    viewer, viewer_status = resolve_current_user(deps.gateway, token)
    if viewer_status == 401:
        resp = make_response(redirect("/login"))
        session.clear()
        clear_access_cookie(resp, request)
        resp.headers["Cache-Control"] = "no-store, max-age=0, must-revalidate"
        resp.headers["Pragma"] = "no-cache"
        return None, resp
    return viewer, None


def call_gateway_json_or_error(
    *,
    deps: RouteDeps,
    method: str,
    path: str,
    token: str,
    json_data: dict[str, Any] | None = None,
):
    call_kwargs = {"token": token}
    if json_data is not None:
        call_kwargs["json_data"] = json_data
    data, status = deps.gateway.call_json(method, path, **call_kwargs)
    if data is None:
        data = {"detail": "Invalid JSON from gateway"}
    if status == 401:
        return None, clear_session_and_return_unauthorized_json(data)
    return (data, status), None


def resolve_billing_user_or_error(*, deps: RouteDeps, token: str):
    user, user_status = resolve_billing_user(
        gateway=deps.gateway,
        token=token,
        user=session.get("current_user") if isinstance(session.get("current_user"), dict) else None,
    )
    if user_status == 401:
        return None, clear_session_and_return_unauthorized_json()
    if not user:
        return None, (jsonify({"detail": "Service Temporarily Unavailable"}), 502)
    return user, None


def get_required_file_or_error(*, field: str = "file"):
    if field not in request.files:
        return None, (jsonify({"detail": f"Missing {field}"}), 400)
    return request.files[field], None
