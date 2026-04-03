from __future__ import annotations

from flask import Blueprint, jsonify, redirect, render_template

from routes.common import (
    RouteDeps,
    clear_session_and_return_unauthorized_json,
    get_required_token,
    parse_json_body_or_400,
    read_bounded_text,
    resolve_viewer_for_page_or_redirect,
    resolve_viewer_or_error,
    validate_resource_id,
)
from services.library.viewscan import (
    build_viewscan_page_model,
    create_viewscan_comment,
    delete_viewscan,
    delete_viewscan_comment,
    list_viewscan_comments,
    make_viewscan_private,
    publish_viewscan,
    update_viewscan_description,
)


def build_library_viewscan_blueprint(*, deps: RouteDeps):
    bp = Blueprint("library_viewscan", __name__)

    @bp.get("/viewscan")
    def viewscan():
        return redirect("/scans")

    @bp.get("/viewscan/<string:image_id>")
    def viewscan_by_image(image_id: str):
        id_error = validate_resource_id(image_id, name="image_id")
        if id_error:
            return id_error

        token, _ = get_required_token()
        initial_page_model = None

        if token:
            viewer, viewer_redirect = resolve_viewer_for_page_or_redirect(deps=deps, token=token)
            if viewer_redirect:
                return viewer_redirect

            data, status = build_viewscan_page_model(
                image_id=image_id,
                token=token,
                gateway_base_url=deps.gateway_uri,
                viewer=viewer if isinstance(viewer, dict) else None,
            )
            if isinstance(data, dict):
                if status == 200:
                    initial_page_model = data
                else:
                    initial_page_model = {
                        "title": "View Scan",
                        "viewer": viewer if isinstance(viewer, dict) else None,
                        "error": data,
                    }

        response_status = 200
        if isinstance(initial_page_model, dict) and initial_page_model.get("error"):
            response_status = status

        return render_template(
            "pages/library/viewscan.html",
            initial_image_id=image_id,
            initial_viewscan_page_model=initial_page_model,
        ), response_status

    @bp.patch("/viewscan/<string:image_id>/description")
    def viewscan_update_description(image_id: str):
        id_error = validate_resource_id(image_id, name="image_id")
        if id_error:
            return id_error

        token, auth_error = get_required_token()
        if auth_error:
            return auth_error

        body, body_error = parse_json_body_or_400()
        if body_error:
            return body_error

        description, text_error = read_bounded_text(
            body,
            field="description",
            empty_detail="Description cannot be empty",
            too_long_detail="Description too long ({length}/{max}).",
        )
        if text_error:
            return text_error

        data, status = update_viewscan_description(
            token=token,
            image_id=image_id,
            description=description,
            gateway_base_url=deps.gateway_uri,
        )
        return jsonify(data), status

    @bp.post("/viewscan/<string:image_id>/publish")
    def viewscan_publish_route(image_id: str):
        id_error = validate_resource_id(image_id, name="image_id")
        if id_error:
            return id_error

        token, auth_error = get_required_token()
        if auth_error:
            return auth_error

        body, body_error = parse_json_body_or_400()
        if body_error:
            return body_error

        description, text_error = read_bounded_text(
            body,
            field="description",
            empty_detail="Description is required when publishing.",
            too_long_detail="Description too long ({length}/{max}).",
        )
        if text_error:
            return text_error

        image_result = {
            "verdict": (body or {}).get("verdict"),
            "label": (body or {}).get("label"),
            "confidence": (body or {}).get("confidence"),
        }

        data, status = publish_viewscan(
            token=token,
            image_id=image_id,
            description=description,
            image_result=image_result,
            gateway_base_url=deps.gateway_uri,
        )
        return jsonify(data), status

    @bp.post("/viewscan/<string:image_id>/make-private")
    def viewscan_make_private_route(image_id: str):
        id_error = validate_resource_id(image_id, name="image_id")
        if id_error:
            return id_error

        token, auth_error = get_required_token()
        if auth_error:
            return auth_error

        data, status = make_viewscan_private(
            token=token,
            image_id=image_id,
            gateway_base_url=deps.gateway_uri,
        )
        return jsonify(data), status

    @bp.delete("/viewscan/<string:image_id>")
    def viewscan_delete_route(image_id: str):
        id_error = validate_resource_id(image_id, name="image_id")
        if id_error:
            return id_error

        token, auth_error = get_required_token()
        if auth_error:
            return auth_error

        data, status = delete_viewscan(
            token=token,
            image_id=image_id,
            gateway_base_url=deps.gateway_uri,
        )
        return jsonify(data), status

    @bp.get("/viewscan/<string:image_id>/comments")
    def viewscan_comments_route(image_id: str):
        id_error = validate_resource_id(image_id, name="image_id")
        if id_error:
            return id_error

        data, status = list_viewscan_comments(
            image_id=image_id,
            gateway_base_url=deps.gateway_uri,
        )
        return jsonify(data), status

    @bp.post("/viewscan/<string:image_id>/comments")
    def viewscan_create_comment_route(image_id: str):
        id_error = validate_resource_id(image_id, name="image_id")
        if id_error:
            return id_error

        token, auth_error = get_required_token()
        if auth_error:
            return auth_error

        body, body_error = parse_json_body_or_400()
        if body_error:
            return body_error

        text, text_error = read_bounded_text(
            body,
            field="text",
            empty_detail="Comment cannot be empty.",
            too_long_detail="Comment too long ({length}/{max}).",
        )
        if text_error:
            return text_error

        viewer, viewer_error = resolve_viewer_or_error(
            deps=deps,
            token=token,
            missing_detail="Missing authenticated user context for comment",
        )
        if viewer_error:
            return viewer_error

        viewer_name = str(viewer.get("user_name") or viewer.get("name") or viewer.get("user_id") or "").strip()
        data, status = create_viewscan_comment(
            token=token,
            image_id=image_id,
            text=text,
            viewer_user_id=str(viewer["user_id"]).strip(),
            viewer_name=viewer_name,
            gateway_base_url=deps.gateway_uri,
        )

        if status == 401:
            return clear_session_and_return_unauthorized_json(data)

        return jsonify(data), status

    @bp.delete("/viewscan/<string:image_id>/comments/<string:comment_id>")
    def viewscan_delete_comment_route(image_id: str, comment_id: str):
        del image_id

        id_error = validate_resource_id(comment_id, name="comment_id")
        if id_error:
            return id_error

        token, auth_error = get_required_token()
        if auth_error:
            return auth_error

        data, status = delete_viewscan_comment(
            token=token,
            comment_id=comment_id,
            gateway_base_url=deps.gateway_uri,
        )

        if status == 401:
            return clear_session_and_return_unauthorized_json(data)

        return jsonify(data), status

    return bp
