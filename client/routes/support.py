from __future__ import annotations

from flask import Blueprint, render_template

from routes.common import RouteDeps


def build_support_blueprint(*, deps: RouteDeps):
    del deps
    bp = Blueprint("support", __name__)

    @bp.get("/dev")
    def dev():
        return render_template("pages/support/dev.html")

    @bp.get("/docs")
    def docs():
        return render_template("pages/support/docs.html")

    @bp.get("/contact")
    def contact():
        return render_template("pages/support/contact.html")

    @bp.get("/tutorials")
    def tutorials():
        return render_template("pages/support/tutorials.html")

    return bp
