from __future__ import annotations

from flask import Blueprint, make_response, redirect, render_template, request, session

from auth.cookies import clear_access_cookie, get_access_token
from config import cfg
from routes.common import RouteDeps
from services.auth.session import store_authenticated_user


def build_public_blueprint(*, deps: RouteDeps):
    bp = Blueprint("public", __name__)

    @bp.get("/healthz")
    def healthz():
        return "OK", 200

    @bp.get("/")
    def landing():
        return render_template("pages/public/landing.html")

    @bp.get("/login")
    def login():
        token = get_access_token(request)
        toggles = cfg.get_client_config()
        show_signup = toggles.get("sign-up", True)

        if token:
            me, status = deps.gateway.fetch_me(token)
            if status == 200 and isinstance(me, dict):
                store_authenticated_user(me)
                return redirect("/upload")

            if status == 401:
                session.clear()
                resp = make_response(render_template("pages/public/login.html", show_signup=show_signup))
                clear_access_cookie(resp, request)
                return resp

        return render_template("pages/public/login.html", show_signup=show_signup)

    return bp
