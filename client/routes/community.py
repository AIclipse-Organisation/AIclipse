from __future__ import annotations

import logging
import re

from flask import Blueprint, jsonify, request

from auth.cookies import get_access_token
from routes.common import RouteDeps, json_missing_auth, parse_json_body_or_400
from services.integrations.gateway import proxy_gateway_json_request


def build_community_blueprint(*, deps: RouteDeps):
    bp = Blueprint("community", __name__)

    @bp.post("/community/posts")
    def create_community_post():
        token = get_access_token(request)
        if not token:
            return json_missing_auth(community_shape=True)

        post_data, body_error = parse_json_body_or_400(invalid_detail="Invalid JSON", error_field="error")
        if body_error:
            return body_error

        data, status = proxy_gateway_json_request(
            method="POST",
            base_url=deps.gateway_uri,
            path="/community/posts",
            token=token,
            json_body=post_data,
            invalid_json_detail="Invalid JSON from gateway on /community/posts",
        )
        if status == 502:
            logging.error("Community /posts request failed: %s", data.get("detail") if isinstance(data, dict) else "Gateway unreachable")
            return jsonify(data), status

        return jsonify(data), status

    @bp.get("/community/posts")
    def get_community_posts():
        token = get_access_token(request)
        data, status = proxy_gateway_json_request(
            method="GET",
            base_url=deps.gateway_uri,
            path="/community/posts",
            token=token or "",
            params=dict(request.args),
            invalid_json_detail="Invalid JSON from gateway on /community/posts",
        )
        return jsonify(data), status

    @bp.post("/community/posts/vote")
    def community_vote():
        token = get_access_token(request)
        if not token:
            return json_missing_auth(community_shape=True)

        vote_data, body_error = parse_json_body_or_400(invalid_detail="Invalid JSON", error_field="error")
        if body_error:
            return body_error

        data, status = proxy_gateway_json_request(
            method="POST",
            base_url=deps.gateway_uri,
            path="/community/posts/vote",
            token=token,
            json_body=vote_data,
            invalid_json_detail="Invalid JSON from gateway on /community/posts/vote",
        )
        return jsonify(data), status

    @bp.get("/community/posts/comments")
    def get_community_comments():
        post_id = request.args.get("post_id")
        if not post_id:
            return jsonify({"error": "Missing post_id parameter"}), 400
        if not re.fullmatch(r"[A-Za-z0-9_-]+", post_id):
            return jsonify({"error": "Invalid post_id parameter"}), 400

        data, status = proxy_gateway_json_request(
            method="GET",
            base_url=deps.gateway_uri,
            path="/community/posts/comments",
            token="",
            params={"post_id": post_id},
            invalid_json_detail="Invalid JSON from gateway on /community/posts/comments",
        )
        return jsonify(data), status

    @bp.post("/community/posts/comments")
    def create_community_comment():
        token = get_access_token(request)
        if not token:
            return json_missing_auth(community_shape=True)

        comment_data, body_error = parse_json_body_or_400(invalid_detail="Invalid JSON", error_field="error")
        if body_error:
            return body_error

        data, status = proxy_gateway_json_request(
            method="POST",
            base_url=deps.gateway_uri,
            path="/community/posts/comments",
            token=token,
            json_body=comment_data,
            invalid_json_detail="Invalid JSON from gateway on /community/posts/comments",
        )
        return jsonify(data), status

    @bp.post("/community/posts/click")
    def community_click():
        token = get_access_token(request)
        if not token:
            return json_missing_auth(community_shape=True)

        click_data, body_error = parse_json_body_or_400(invalid_detail="Invalid JSON", error_field="error")
        if body_error:
            return body_error

        data, status = proxy_gateway_json_request(
            method="POST",
            base_url=deps.gateway_uri,
            path="/community/posts/click",
            token=token,
            json_body=click_data,
            invalid_json_detail="Invalid JSON from gateway on /community/posts/click",
        )
        return jsonify(data), status

    @bp.post("/community/posts/report")
    def community_report():
        token = get_access_token(request)
        if not token:
            return json_missing_auth(community_shape=True)

        report_data, body_error = parse_json_body_or_400(invalid_detail="Invalid JSON", error_field="error")
        if body_error:
            return body_error

        data, status = proxy_gateway_json_request(
            method="POST",
            base_url=deps.gateway_uri,
            path="/community/posts/report",
            token=token,
            json_body=report_data,
            invalid_json_detail="Invalid JSON from gateway on /community/posts/report",
        )
        return jsonify(data), status

    return bp
