from __future__ import annotations

from flask import Blueprint, jsonify, render_template, request

from routes.common import (
    RouteDeps,
    get_required_token,
    parse_json_body_or_400,
    validate_resource_id,
)
from services.integrations.gateway import proxy_gateway_json_request


def build_library_blueprint(*, deps: RouteDeps):
    bp = Blueprint("library", __name__)

    @bp.get("/scans")
    def scans():
        return render_template("pages/library/scans.html")

    @bp.get("/images")
    def get_my_images():
        token, auth_error = get_required_token()
        if auth_error:
            return auth_error

        params = {}
        is_public = request.args.get("is_public")
        if is_public is not None:
            params["is_public"] = is_public

        data, status = proxy_gateway_json_request(
            method="GET",
            base_url=deps.gateway_uri,
            path="/images",
            token=token,
            params=params,
            invalid_json_detail="Invalid JSON from gateway on /images",
        )
        return jsonify(data), status

    @bp.get("/image/<string:image_id>")
    def get_image(image_id: str):
        id_error = validate_resource_id(image_id, name="image_id")
        if id_error:
            return id_error

        token, auth_error = get_required_token()
        if auth_error:
            return auth_error

        data, status = proxy_gateway_json_request(
            method="GET",
            base_url=deps.gateway_uri,
            path=f"/image/{image_id}",
            token=token,
            invalid_json_detail="Invalid JSON from gateway on /image",
        )
        return jsonify(data), status

    @bp.patch("/image/<string:image_id>")
    def update_image(image_id: str):
        id_error = validate_resource_id(image_id, name="image_id")
        if id_error:
            return id_error

        token, auth_error = get_required_token()
        if auth_error:
            return auth_error

        body, body_error = parse_json_body_or_400()
        if body_error:
            return body_error

        data, status = proxy_gateway_json_request(
            method="PATCH",
            base_url=deps.gateway_uri,
            path=f"/image/{image_id}",
            token=token,
            json_body=body,
            invalid_json_detail="Invalid JSON from gateway on PATCH /image",
        )
        return jsonify(data), status

    @bp.delete("/image/<string:image_id>")
    def delete_image(image_id: str):
        id_error = validate_resource_id(image_id, name="image_id")
        if id_error:
            return id_error

        token, auth_error = get_required_token()
        if auth_error:
            return auth_error

        data, status = proxy_gateway_json_request(
            method="DELETE",
            base_url=deps.gateway_uri,
            path=f"/image/{image_id}",
            token=token,
            invalid_json_detail="Invalid JSON from gateway on DELETE /image",
        )
        return jsonify(data), status

    return bp
