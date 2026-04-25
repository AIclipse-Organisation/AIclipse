from __future__ import annotations

from flask import Blueprint, render_template

from config import cfg


def build_public_blueprint():
    bp = Blueprint("public", __name__)

    @bp.get("/healthz")
    def healthz():
        return "OK", 200

    @bp.get("/")
    def landing():
        return render_template("pages/public/landing.html")

    @bp.get("/login")
    def login():
        toggles = cfg.get_client_config()
        show_signup = toggles.get("sign-up", True)

        return render_template("pages/public/login.html", show_signup=show_signup)

    return bp
