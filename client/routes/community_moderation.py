from __future__ import annotations

from flask import Blueprint, jsonify, request

from routes.common import RouteDeps
from services.integrations.gateway import proxy_gateway_json_request


def build_community_moderation_blueprint(*, deps: RouteDeps):
    bp = Blueprint("community_moderation", __name__)

    @bp.post("/community/posts/moderation-status")
    def community_moderation_status():
        try:
            moderation_data = request.get_json(force=True)
        except Exception:
            return jsonify({"error": "Invalid JSON"}), 400

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
