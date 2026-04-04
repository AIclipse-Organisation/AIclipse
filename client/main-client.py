import logging
import os
import requests
from pathlib import Path

from flask import Flask, request, session
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.serving import WSGIRequestHandler

from config import cfg
from asset_versioning import build_asset_url, get_static_asset_version
from auth.gateway import GatewayClient
from auth.middleware import register_auth_middleware
from auth.routes import build_auth_blueprint
from routes.common import RouteDeps
from routes.public import build_public_blueprint
from routes.detection import build_detection_blueprint
from routes.library import build_library_blueprint
from routes.profile import build_profile_blueprint
from routes.plan import build_plan_blueprint
from routes.notifications import build_notifications_blueprint
from routes.support import build_support_blueprint
from routes.community import build_community_blueprint
from routes.community_moderation import build_community_moderation_blueprint
from routes.library_viewscan import build_library_viewscan_blueprint


BASE_DIR = Path(__file__).resolve().parent
app = Flask(
    __name__,
    template_folder=str(BASE_DIR / "templates"),
    static_folder=str(BASE_DIR / "static"),
)

app.secret_key = os.getenv("FLASK_SECRET_KEY")

current_env = os.getenv("APP_ENV", "dev")
is_prod = current_env == "prod"

app.config["TEMPLATES_AUTO_RELOAD"] = current_env not in ("prod", "production")

print(f"[*] Starting Client Service in {current_env} mode")

GATEWAY_URI = os.getenv("GATEWAY_URI") or ""

if is_prod:
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = is_prod
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 31536000

gateway = GatewayClient(GATEWAY_URI)


def _build_img_src_directive() -> str:
    # Dev environments often serve presigned or internal media URLs over plain HTTP.
    # Keep production strict while allowing local development to render those images.
    schemes = ["'self'", "data:", "blob:", "https:"]
    if not is_prod:
        schemes.append("http:")
    return "img-src " + " ".join(schemes)


def is_signup_enabled() -> bool:
    toggles = cfg.get_client_config()
    return bool(toggles.get("sign-up", True))


deps = RouteDeps(
    gateway=gateway,
    gateway_uri=GATEWAY_URI,
)

app.register_blueprint(build_auth_blueprint(gateway, is_signup_enabled=is_signup_enabled))
register_auth_middleware(app, gateway)

app.register_blueprint(build_public_blueprint(deps=deps))
app.register_blueprint(build_detection_blueprint(deps=deps))
app.register_blueprint(build_library_blueprint(deps=deps))
app.register_blueprint(build_library_viewscan_blueprint(deps=deps))
app.register_blueprint(build_profile_blueprint(deps=deps))
app.register_blueprint(build_plan_blueprint(deps=deps))
app.register_blueprint(build_notifications_blueprint(deps=deps))
app.register_blueprint(build_support_blueprint(deps=deps))
app.register_blueprint(build_community_blueprint(deps=deps))
app.register_blueprint(build_community_moderation_blueprint(deps=deps))


@app.context_processor
def inject_common_context():
    static_root = BASE_DIR / "static"
    return dict(
        is_admin=bool(session.get("is_admin", False)),
        current_user=session.get("current_user"),
        static_asset_version=get_static_asset_version(static_root),
        asset_url=lambda path: build_asset_url(static_root, path),
    )


@app.after_request
def apply_security_and_cache_headers(resp):
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "base-uri 'self'; "
        "form-action 'self'; "
        "object-src 'none'; "
        "script-src 'self'; "
        "script-src-elem 'self'; "
        "script-src-attr 'none'; "
        "style-src 'self' 'unsafe-inline'; "
        "style-src-elem 'self'; "
        "style-src-attr 'unsafe-inline'; "
        f"{_build_img_src_directive()}; "
        "font-src 'self' data:; "
        "connect-src 'self'; "
        "frame-ancestors 'none'"
    )

    path = request.path or ""
    is_static = path.startswith("/static/")

    if is_static:
        if request.args.get("v"):
            resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        else:
            resp.headers["Cache-Control"] = "public, max-age=300"
        return resp

    existing_cache_control = resp.headers.get("Cache-Control")
    if existing_cache_control:
        return resp

    if resp.mimetype in ("text/html", "application/json"):
        resp.headers["Cache-Control"] = "no-store, max-age=0, must-revalidate"
        resp.headers["Pragma"] = "no-cache"

    return resp


class Quiet(WSGIRequestHandler):
    def log(self, type, message, *args):
        try:
            if getattr(self, "path", "").split("?", 1)[0] == "/healthz":
                return
        except Exception:
            pass
        super().log(type, message, *args)


if __name__ == "__main__":
    logging.getLogger("werkzeug").setLevel(logging.INFO)
    app.run(host="0.0.0.0", port=3000, request_handler=Quiet)
