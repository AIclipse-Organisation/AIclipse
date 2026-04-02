from __future__ import annotations

from flask import Blueprint, jsonify, request

from services.auth.api_keys import proxy_api_key_request

from .cookies import get_access_token
from .gateway import GatewayClient


def register_api_key_routes(bp: Blueprint, *, gateway: GatewayClient) -> None:
    @bp.get("/auth/api-key")
    def auth_api_key_get():
        token = get_access_token(request)
        if not token:
            return jsonify({"detail": "Not authenticated"}), 401
        data, status = proxy_api_key_request(gateway, token=token, method="GET")
        return jsonify(data), status

    @bp.post("/auth/api-key")
    def auth_api_key_rotate():
        token = get_access_token(request)
        if not token:
            return jsonify({"detail": "Not authenticated"}), 401
        data, status = proxy_api_key_request(gateway, token=token, method="POST")
        return jsonify(data), status

    @bp.delete("/auth/api-key")
    def auth_api_key_delete():
        token = get_access_token(request)
        if not token:
            return jsonify({"detail": "Not authenticated"}), 401
        data, status = proxy_api_key_request(gateway, token=token, method="DELETE")
        return jsonify(data), status
