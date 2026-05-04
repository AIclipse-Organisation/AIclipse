from __future__ import annotations

from flask import Blueprint, Response, render_template, request

from config import cfg


PUBLIC_SITEMAP_PATHS = (
    "/",
    "/login",
    "/community",
    "/contact",
    "/docs",
    "/tutorials",
)


def _public_text_response(body: str, *, mimetype: str) -> Response:
    response = Response(body, mimetype=mimetype)
    response.headers["Cache-Control"] = "public, max-age=300"
    return response


def _request_hostname() -> str:
    return request.host.split(":", 1)[0].strip().lower()


def _is_storage_host() -> bool:
    return _request_hostname().startswith("storage.")


def _build_public_sitemap_xml() -> str:
    base_url = request.url_root.rstrip("/")
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ]
    lines.extend(f"  <url><loc>{base_url}{path}</loc></url>" for path in PUBLIC_SITEMAP_PATHS)
    lines.append("</urlset>")
    return "\n".join(lines) + "\n"


def _build_storage_sitemap_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n'
    )


def build_public_blueprint():
    bp = Blueprint("public", __name__)

    @bp.get("/healthz")
    def healthz():
        return "OK", 200

    @bp.get("/")
    def landing():
        return render_template("pages/public/landing.html")

    @bp.get("/robots.txt")
    def robots():
        body = (
            "User-agent: *\nDisallow: /\n"
            if _is_storage_host()
            else "User-agent: *\nAllow: /\nDisallow: /api/\n"
        )
        return _public_text_response(body, mimetype="text/plain")

    @bp.get("/sitemap.xml")
    def sitemap():
        body = _build_storage_sitemap_xml() if _is_storage_host() else _build_public_sitemap_xml()
        return _public_text_response(body, mimetype="application/xml")

    @bp.get("/crossdomain.xml")
    def crossdomain():
        response = _public_text_response("Not Found\n", mimetype="text/plain")
        response.status_code = 404
        return response

    @bp.get("/login")
    def login():
        toggles = cfg.get_client_config()
        show_signup = toggles.get("sign-up", True)

        return render_template("pages/public/login.html", show_signup=show_signup)

    return bp
