from __future__ import annotations

from flask import Blueprint, jsonify, render_template, request

from routes.common import (
    RouteDeps,
    clear_session_and_return_unauthorized_json,
    get_required_file_or_error,
    get_required_token,
    resolve_viewer_or_error,
)
from services.auth.session import get_session_user
from services.integrations.gateway import proxy_gateway_multipart_request
from services.detection.scan_workflow import perform_results_save


def build_detection_blueprint(*, deps: RouteDeps):
    bp = Blueprint("detection", __name__)

    @bp.get("/upload")
    def upload():
        return render_template("pages/detection/upload.html")

    @bp.get("/results")
    def results():
        viewer = get_session_user() or {}
        return render_template("pages/detection/results.html", initial_results_viewer=viewer)

    @bp.post("/checks")
    def checks():
        token, auth_error = get_required_token()
        if auth_error:
            return auth_error

        file, file_error = get_required_file_or_error()
        if file_error:
            return file_error

        files = {
            "file": (file.filename, file.read(), file.mimetype or "application/octet-stream"),
        }
        data, status = proxy_gateway_multipart_request(
            method="POST",
            base_url=deps.gateway_uri,
            path="/checks",
            token=token,
            files=files,
            invalid_json_detail="Invalid JSON from gateway on /checks",
        )
        return jsonify(data), status

    @bp.post("/upload/image")
    def upload_image():
        token, auth_error = get_required_token()
        if auth_error:
            return auth_error

        file, file_error = get_required_file_or_error()
        if file_error:
            return file_error

        detection_token = request.form.get("detection_token")
        if not detection_token:
            return jsonify({"detail": "Missing detection_token"}), 400

        is_public_raw = request.form.get("is_public")
        is_public = None
        if is_public_raw is not None:
            is_public = str(is_public_raw).lower() in ("true", "1", "yes", "on")

        data = {"detection_token": detection_token}
        if is_public is not None:
            data["is_public"] = "true" if is_public else "false"

        files = {
            "file": (file.filename, file.read(), file.mimetype or "application/octet-stream"),
        }
        resp_data, status = proxy_gateway_multipart_request(
            method="POST",
            base_url=deps.gateway_uri,
            path="/upload/image",
            token=token,
            files=files,
            form_data=data,
            invalid_json_detail="Invalid JSON from gateway on /upload/image",
        )
        return jsonify(resp_data), status

    @bp.post("/results/save")
    def results_save():
        token, auth_error = get_required_token()
        if auth_error:
            return auth_error

        file, file_error = get_required_file_or_error()
        if file_error:
            return file_error

        detection_token = str(request.form.get("detection_token") or "").strip()
        if not detection_token:
            return jsonify({"detail": "Missing detection_token"}), 400

        is_public = str(request.form.get("is_public") or "").lower() in ("true", "1", "yes", "on")
        description = str(request.form.get("description") or "").strip()

        if is_public and not description:
            return jsonify({"detail": "Description is required when publishing."}), 400
        if len(description) > 1000:
            return jsonify({"detail": f"Description too long ({len(description)}/1000 characters)."}), 400

        viewer = None
        if is_public:
            viewer, viewer_error = resolve_viewer_or_error(
                deps=deps,
                token=token,
                missing_detail="Missing authenticated user context for publish",
            )
            if viewer_error:
                return viewer_error

        data, status = perform_results_save(
            token=token,
            file_name=file.filename or "upload.jpg",
            file_bytes=file.read(),
            mime_type=file.mimetype or "application/octet-stream",
            detection_token=detection_token,
            is_public=is_public,
            description=description,
            user_id=str(viewer.get("user_id")) if viewer and viewer.get("user_id") else None,
            gateway_base_url=deps.gateway_uri,
        )

        if status == 401:
            return clear_session_and_return_unauthorized_json(data)

        return jsonify(data), status

    return bp
