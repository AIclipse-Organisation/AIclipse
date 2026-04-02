from __future__ import annotations

from flask import Blueprint, jsonify, render_template, request

from routes.common import RouteDeps, get_required_token, parse_json_body_or_400
from services.integrations.gateway import proxy_gateway_json_request


def build_notifications_blueprint(*, deps: RouteDeps):
    bp = Blueprint("notifications", __name__)

    @bp.get("/notification")
    def notification():
        return render_template("pages/notifications/notification.html")

    @bp.get("/community/notifications")
    def community_notifications():
        token, auth_error = get_required_token(community_shape=True)
        if auth_error:
            return auth_error

        params = {}
        unread_only = request.args.get("unread_only")
        if unread_only is not None:
            params["unread_only"] = unread_only

        data, status = proxy_gateway_json_request(
            method="GET",
            base_url=deps.gateway_uri,
            path="/community/notifications",
            token=token,
            params=params,
            invalid_json_detail="Invalid JSON from gateway on /community/notifications",
        )
        return jsonify(data), status

    @bp.get("/community/notifications/unread-count")
    def community_notifications_unread_count():
        token, auth_error = get_required_token(community_shape=True)
        if auth_error:
            return auth_error

        data, status = proxy_gateway_json_request(
            method="GET",
            base_url=deps.gateway_uri,
            path="/community/notifications/unread-count",
            token=token,
            invalid_json_detail="Invalid JSON from gateway on /community/notifications/unread-count",
        )
        return jsonify(data), status

    @bp.post("/community/notifications/read")
    def community_notifications_read():
        token, auth_error = get_required_token(community_shape=True)
        if auth_error:
            return auth_error

        body, body_error = parse_json_body_or_400()
        if body_error:
            return jsonify({"error": "Invalid JSON"}), 400

        data, status = proxy_gateway_json_request(
            method="POST",
            base_url=deps.gateway_uri,
            path="/community/notifications/read",
            token=token,
            json_body=body,
            invalid_json_detail="Invalid JSON from gateway on /community/notifications/read",
        )
        return jsonify(data), status

    return bp
