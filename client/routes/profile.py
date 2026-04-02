from __future__ import annotations

from flask import Blueprint, render_template

from routes.common import RouteDeps


def build_profile_blueprint(*, deps: RouteDeps):
    bp = Blueprint("profile", __name__)

    @bp.get("/profile")
    def profile():
        return render_template("pages/profile/profile.html")

    return bp
