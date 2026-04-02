from __future__ import annotations

from flask import Blueprint, render_template
from routes.common import get_required_token
from services.integrations.gateway import proxy_gateway_json_request

from routes.common import RouteDeps


def build_profile_blueprint(*, deps: RouteDeps):
    bp = Blueprint("profile", __name__)

    @bp.get("/profile")
    def profile():
        token, auth_error = get_required_token()
        if auth_error:
            return auth_error

        scans_items = None
        if token:
            data, status = proxy_gateway_json_request(
                method="GET",
                base_url=deps.gateway_uri,
                path="/images",
                token=token,
                invalid_json_detail="Invalid JSON from gateway on /images",
            )
            if status == 200 and isinstance(data, dict):
                items = data.get("items")
                if isinstance(items, list):
                    scans_items = items

        return render_template("pages/profile/profile.html", initial_scans_items=scans_items)

    return bp
