from __future__ import annotations

from flask import Blueprint, jsonify

from routes.common import RouteDeps, parse_json_body_or_400
from services.integrations.gateway import proxy_gateway_json_request


def build_community_moderation_blueprint(*, deps: RouteDeps):
    bp = Blueprint("community_moderation", __name__)

    @bp.post("/community/posts/moderation-status")
    def community_moderation_status():
        moderation_data, body_error = parse_json_body_or_400(
            invalid_detail="Invalid JSON",
            error_field="error",
        )
        if body_error:
            return body_error

        data, status = proxy_gateway_json_request(
            method="POST",
            base_url=deps.gateway_uri,
            path="/community/posts/moderation-status",
            token="",
            json_body=moderation_data,
            invalid_json_detail="Invalid JSON from gateway on /community/posts/moderation-status",
        )
        return jsonify(data), status

    return bp
