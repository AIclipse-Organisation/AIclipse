import logging
import os
import re
import sys
import time

import requests
from flask import Flask, jsonify, make_response, redirect, render_template, request, session
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.serving import WSGIRequestHandler

from config import cfg
from auth.core import clear_access_cookie, get_access_token
from auth.gateway import GatewayClient
from auth.middleware import register_auth_middleware
from auth.routes import build_auth_blueprint


app = Flask(__name__, template_folder="templates", static_folder="static")

app.secret_key = os.getenv("FLASK_SECRET_KEY")

current_env = os.getenv("APP_ENV", "dev")
is_prod = current_env == "prod"

# Reload templates on every request in dev; cache them in prod
app.config["TEMPLATES_AUTO_RELOAD"] = current_env not in ("prod", "production")

print(f"[*] Starting Client Service in {current_env} mode")

GATEWAY_URI = os.getenv("GATEWAY_URI")
COMMUNITY_URI = os.getenv("COMMUNITY_URI")


if is_prod:
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = is_prod

gateway = GatewayClient(GATEWAY_URI or "")


def is_signup_enabled() -> bool:
    toggles = cfg.get_client_config()
    return bool(toggles.get("sign-up", True))


app.register_blueprint(build_auth_blueprint(gateway, is_signup_enabled=is_signup_enabled))
register_auth_middleware(app, gateway, cache_ttl_seconds=30)


@app.context_processor
def inject_common_context():
    return dict(
        is_admin=bool(session.get("is_admin", False)),
        current_user=session.get("current_user"),
    )


@app.get("/healthz")
def healthz():
    return "OK", 200


@app.get("/")
def index():
    toggles = cfg.get_client_config()
    show_signup = toggles.get("sign-up", True)

    token = get_access_token(request)
    if token:
        me, status = gateway.fetch_me(token)
        if status == 200 and isinstance(me, dict):
            session["current_user"] = me
            session["is_admin"] = bool(me.get("is_admin"))
            session["auth_checked_at"] = int(time.time())
            return redirect("/upload")

        if status == 401:
            session.clear()
            resp = make_response(render_template("login.html", show_signup=show_signup))
            clear_access_cookie(resp, request)
            return resp

    return render_template("login.html", show_signup=show_signup)


@app.get("/upload")
def upload():
    return render_template("upload.html")


@app.get("/scans")
def scans():
    return render_template("scans.html")


@app.get("/notification")
def notification():
    return render_template("notification.html")


@app.get("/plan")
def plan():
    return render_template("plan.html")


@app.get("/profile")
def profile():
    return render_template("profile.html")


@app.get("/results")
def results():
    return render_template("results.html")


@app.get("/viewscan")
def viewscan():
    return render_template("viewscan.html")


@app.get("/dev")
def dev():
    return render_template("dev.html")


@app.get("/docs")
def docs():
    return render_template("docs.html")


@app.get("/contact")
def contact():
    return render_template("contact.html")


@app.get("/tutorials")
def tutorials():
    return render_template("tutorials.html")


@app.post("/usage/check")
def usage_check():
    token = get_access_token(request)
    if not token:
        return jsonify({"detail": "Not authenticated"}), 401

    data, status = gateway.call_json("POST", "/usage/check", token=token)
    if data is None:
        data = {"detail": "Invalid JSON from gateway"}

    if status == 401:
        session.clear()
        resp = make_response(jsonify(data), 401)
        clear_access_cookie(resp, request)
        return resp

    return jsonify(data), status


@app.post("/billing/create-checkout-session")
def billing_create_checkout_session():
    token = get_access_token(request)
    if not token:
        return jsonify({"detail": "Not authenticated"}), 401

    payload = request.get_json(force=True, silent=True) or {}
    plan_id_raw = payload.get("plan_id")

    try:
        plan_id = int(plan_id_raw)
    except Exception:
        return jsonify({"detail": "Invalid plan_id"}), 400

    if plan_id not in (1, 2):
        return jsonify({"detail": "Invalid plan_id"}), 400

    user = session.get("current_user")
    if not isinstance(user, dict) or not user.get("user_id") or not user.get("email"):
        me, me_status = gateway.fetch_me(token)
        if me_status == 200 and isinstance(me, dict):
            user = me
            session["current_user"] = me
            session["is_admin"] = bool(me.get("is_admin"))
            session["auth_checked_at"] = int(time.time())
        elif me_status == 401:
            session.clear()
            resp = make_response(jsonify({"detail": "Unauthorized"}), 401)
            clear_access_cookie(resp, request)
            return resp
        else:
            return jsonify({"detail": "Service Temporarily Unavailable"}), 502

    user_id = user.get("user_id")
    email = user.get("email")

    if not user_id or not email:
        return jsonify({"detail": "Missing user info for billing"}), 502

    checkout_payload = {"user_id": user_id, "plan_id": plan_id, "email": email}

    data, status = gateway.call_json(
        "POST",
        "/billing/create-checkout-session",
        token=token,
        json_data=checkout_payload,
    )
    if data is None:
        data = {"detail": "Invalid JSON from gateway"}

    if status == 401:
        session.clear()
        resp = make_response(jsonify(data), 401)
        clear_access_cookie(resp, request)
        return resp

    return jsonify(data), status


@app.post("/checks")
def checks():
    token = get_access_token(request)
    if not token:
        return jsonify({"detail": "Not authenticated"}), 401

    if "file" not in request.files:
        return jsonify({"detail": "Missing file"}), 400

    file = request.files["file"]
    file_bytes = file.read()

    url = f"{GATEWAY_URI}/checks"
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
    }
    files = {
        "file": (file.filename, file_bytes, file.mimetype or "application/octet-stream"),
    }

    try:
        resp = requests.post(url, headers=headers, files=files, timeout=60)
    except requests.RequestException:
        logging.exception("Gateway /checks request failed")
        return jsonify({"detail": "Gateway unreachable"}), 502

    try:
        data = resp.json()
    except ValueError:
        return jsonify({"detail": "Invalid JSON from gateway on /checks"}), 502

    return jsonify(data), resp.status_code


@app.post("/upload/image")
def upload_image():
    token = get_access_token(request)
    if not token:
        return jsonify({"detail": "Not authenticated"}), 401

    if "file" not in request.files:
        return jsonify({"detail": "Missing file"}), 400

    detection_token = request.form.get("detection_token")
    if not detection_token:
        return jsonify({"detail": "Missing detection_token"}), 400

    is_public_raw = request.form.get("is_public")
    is_public = None
    if is_public_raw is not None:
        is_public = str(is_public_raw).lower() in ("true", "1", "yes", "on")

    file = request.files["file"]
    file_bytes = file.read()

    url = f"{GATEWAY_URI}/upload/image"
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
    }

    data = {
        "detection_token": detection_token,
    }
    if is_public is not None:
        data["is_public"] = "true" if is_public else "false"

    files = {
        "file": (file.filename, file_bytes, file.mimetype or "application/octet-stream"),
    }

    try:
        resp = requests.post(url, headers=headers, data=data, files=files, timeout=60)
    except requests.RequestException:
        logging.exception("Gateway /upload/image request failed")
        return jsonify({"detail": "Gateway unreachable"}), 502

    try:
        resp_data = resp.json()
    except ValueError:
        return jsonify({"detail": "Invalid JSON from gateway on /upload/image"}), 502

    return jsonify(resp_data), resp.status_code


@app.get("/images")
def get_my_images():
    token = get_access_token(request)
    if not token:
        return jsonify({"detail": "Not authenticated"}), 401

    url = f"{GATEWAY_URI}/images"
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
    }

    params = {}
    is_public = request.args.get("is_public")
    if is_public is not None:
        params["is_public"] = is_public

    try:
        resp = requests.get(url, headers=headers, params=params, timeout=10)
    except requests.RequestException:
        logging.exception("Gateway /images request failed")
        return jsonify({"detail": "Gateway unreachable"}), 502

    try:
        data = resp.json()
    except ValueError:
        return jsonify({"detail": "Invalid JSON from gateway on /images"}), 502

    return jsonify(data), resp.status_code


@app.get("/image/<string:image_id>")
def get_image(image_id: str):
    token = get_access_token(request)
    if not token:
        return jsonify({"detail": "Not authenticated"}), 401

    url = f"{GATEWAY_URI}/image/{image_id}"
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
    }

    try:
        resp = requests.get(url, headers=headers, timeout=10)
    except requests.RequestException:
        logging.exception("Gateway /image/{image_id} request failed")
        return jsonify({"detail": "Gateway unreachable"}), 502

    try:
        data = resp.json()
    except ValueError:
        return jsonify({"detail": "Invalid JSON from gateway on /image"}), 502

    return jsonify(data), resp.status_code


@app.patch("/image/<string:image_id>")
def update_image(image_id: str):
    token = get_access_token(request)
    if not token:
        return jsonify({"detail": "Not authenticated"}), 401

    try:
        body = request.get_json(force=True)
    except Exception:
        return jsonify({"detail": "Invalid JSON body"}), 400

    url = f"{GATEWAY_URI}/image/{image_id}"
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    }

    try:
        resp = requests.patch(url, headers=headers, json=body, timeout=10)
    except requests.RequestException:
        logging.exception("Gateway PATCH /image/{image_id} request failed")
        return jsonify({"detail": "Gateway unreachable"}), 502

    try:
        data = resp.json()
    except ValueError:
        return jsonify({"detail": "Invalid JSON from gateway on PATCH /image"}), 502

    return jsonify(data), resp.status_code


@app.delete("/image/<string:image_id>")
def delete_image(image_id: str):
    token = get_access_token(request)
    if not token:
        return jsonify({"detail": "Not authenticated"}), 401

    url = f"{GATEWAY_URI}/image/{image_id}"
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
    }

    try:
        resp = requests.delete(url, headers=headers, timeout=10)
    except requests.RequestException:
        logging.exception("Gateway DELETE /image/{image_id} request failed")
        return jsonify({"detail": "Gateway unreachable"}), 502

    try:
        data = resp.json()
    except ValueError:
        return jsonify({"detail": "Invalid JSON from gateway on DELETE /image"}), 502

    return jsonify(data), resp.status_code


@app.post("/community/posts")
def create_community_post():
    token = get_access_token(request)
    if not token:
        return jsonify({"error": "Unauthorized", "detail": "Missing auth token"}), 401

    try:
        post_data = request.get_json(force=True)
    except Exception:
        return jsonify({"error": "Invalid JSON"}), 400

    community_url = os.getenv("COMMUNITY_URI")
    url = f"{community_url}/community/posts"

    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
    }

    try:
        resp = requests.post(url, json=post_data, headers=headers, timeout=10)
    except requests.RequestException as e:
        logging.error("Community /posts request failed: %s", e)
        return jsonify({"detail": "Community service unreachable"}), 502

    try:
        data = resp.json()
    except ValueError:
        data = {"detail": "Non-JSON response from community service"}

    return jsonify(data), resp.status_code


@app.get("/community/posts")
def get_community_posts():
    url = f"{COMMUNITY_URI}/community/posts"

    headers = {"Accept": "application/json"}
    params = dict(request.args)  # forward all query params (post_id, image_id, etc.)

    try:
        resp = requests.get(url, headers=headers, params=params, timeout=10)
    except requests.RequestException:
        logging.exception("Community posts request failed")
        return jsonify({"detail": "Community service unreachable"}), 502

    try:
        data = resp.json()
    except ValueError:
        data = {"detail": "Non-JSON response from community service"}

    return jsonify(data), resp.status_code


@app.post("/community/posts/vote")
def community_vote():
    token = get_access_token(request)
    if not token:
        return jsonify({"error": "Unauthorized", "detail": "Missing auth token"}), 401

    try:
        vote_data = request.get_json(force=True)
    except Exception:
        return jsonify({"error": "Invalid JSON"}), 400

    url = f"{COMMUNITY_URI}/community/posts/vote"

    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
    }

    try:
        resp = requests.post(url, json=vote_data, headers=headers, timeout=10)
    except requests.RequestException:
        logging.exception("Community vote request failed")
        return jsonify({"detail": "Community service unreachable"}), 502

    try:
        data = resp.json()
    except ValueError:
        data = {"detail": "Non-JSON response from community service"}

    return jsonify(data), resp.status_code


@app.get("/community/posts/comments")
def get_community_comments():
    post_id = request.args.get("post_id")
    if not post_id:
        return jsonify({"error": "Missing post_id parameter"}), 400

    if not re.fullmatch(r"[A-Za-z0-9_-]+", post_id):
        return jsonify({"error": "Invalid post_id parameter"}), 400

    url = f"{COMMUNITY_URI}/community/posts/comments"

    headers = {"Accept": "application/json"}

    try:
        resp = requests.get(url, headers=headers, params={"post_id": post_id}, timeout=10)
    except requests.RequestException:
        logging.exception("Community comments request failed")
        return jsonify({"detail": "Community service unreachable"}), 502

    try:
        data = resp.json()
    except ValueError:
        data = {"detail": "Non-JSON response from community service"}

    return jsonify(data), resp.status_code


@app.post("/community/posts/comments")
def create_community_comment():
    token = get_access_token(request)
    if not token:
        return jsonify({"error": "Unauthorized", "detail": "Missing auth token"}), 401

    try:
        comment_data = request.get_json(force=True)
    except Exception:
        return jsonify({"error": "Invalid JSON"}), 400

    url = f"{COMMUNITY_URI}/community/posts/comments"

    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
    }

    try:
        resp = requests.post(url, json=comment_data, headers=headers, timeout=10)
    except requests.RequestException:
        logging.exception("Community comment request failed")
        return jsonify({"detail": "Community service unreachable"}), 502

    try:
        data = resp.json()
    except ValueError:
        data = {"detail": "Non-JSON response from community service"}

    return jsonify(data), resp.status_code


@app.post("/community/posts/click")
def community_click():
    try:
        click_data = request.get_json(force=True)
    except Exception:
        return jsonify({"error": "Invalid JSON"}), 400

    url = f"{COMMUNITY_URI}/community/posts/click"

    headers = {"Content-Type": "application/json", "Accept": "application/json"}

    try:
        resp = requests.post(url, json=click_data, headers=headers, timeout=10)
    except requests.RequestException:
        logging.exception("Community click request failed")
        return jsonify({"detail": "Community service unreachable"}), 502

    try:
        data = resp.json()
    except ValueError:
        data = {"detail": "Non-JSON response from community service"}

    return jsonify(data), resp.status_code


@app.post("/community/posts/report")
def community_report():
    try:
        report_data = request.get_json(force=True)
    except Exception:
        return jsonify({"error": "Invalid JSON"}), 400

    url = f"{COMMUNITY_URI}/community/posts/report"

    headers = {"Content-Type": "application/json", "Accept": "application/json"}

    try:
        resp = requests.post(url, json=report_data, headers=headers, timeout=10)
    except requests.RequestException:
        logging.exception("Community report request failed")
        return jsonify({"detail": "Community service unreachable"}), 502

    try:
        data = resp.json()
    except ValueError:
        data = {"detail": "Non-JSON response from community service"}

    return jsonify(data), resp.status_code


@app.post("/community/posts/moderation-status")
def community_moderation_status():
    """Get moderation status for a list of image IDs"""
    try:
        moderation_data = request.get_json(force=True)
    except Exception:
        return jsonify({"error": "Invalid JSON"}), 400

    url = f"{COMMUNITY_URI}/community/posts/moderation-status"

    headers = {"Content-Type": "application/json", "Accept": "application/json"}

    try:
        resp = requests.post(url, json=moderation_data, headers=headers, timeout=10)
    except requests.RequestException:
        logging.exception("Community moderation status request failed")
        return jsonify({"detail": "Community service unreachable"}), 502

    try:
        data = resp.json()
    except ValueError:
        data = {"detail": "Non-JSON response from community service"}

    return jsonify(data), resp.status_code


@app.get("/community/notifications")
def community_notifications():
    "Retrieve notifications for the authenticated user with unread filter."
    token = get_access_token(request)
    if not token:
        return jsonify({"error": "Unauthorized", "detail": "Missing auth token"}), 401

    url = f"{COMMUNITY_URI}/community/notifications"

    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
    }

    params = {}
    unread_only = request.args.get("unread_only")
    if unread_only is not None:
        params["unread_only"] = unread_only

    try:
        resp = requests.get(url, headers=headers, params=params, timeout=10)
    except requests.RequestException:
        logging.exception("Community notifications request failed")
        return jsonify({"detail": "Community service unreachable"}), 502

    try:
        data = resp.json()
    except ValueError:
        data = {"detail": "Non-JSON response from community service"}

    return jsonify(data), resp.status_code


@app.get("/community/notifications/unread-count")
def community_notifications_unread_count():
    "Return unread notification count for the authenticated user."
    token = get_access_token(request)
    if not token:
        return jsonify({"error": "Unauthorized", "detail": "Missing auth token"}), 401

    url = f"{COMMUNITY_URI}/community/notifications/unread-count"

    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
    }

    try:
        resp = requests.get(url, headers=headers, timeout=10)
    except requests.RequestException:
        logging.exception("Community notifications unread-count request failed")
        return jsonify({"detail": "Community service unreachable"}), 502

    try:
        data = resp.json()
    except ValueError:
        data = {"detail": "Non-JSON response from community service"}

    return jsonify(data), resp.status_code


@app.post("/community/notifications/read")
def community_notifications_read():
    "Mark one or more notifications as read for the authenticated user."
    token = get_access_token(request)
    if not token:
        return jsonify({"error": "Unauthorized", "detail": "Missing auth token"}), 401

    try:
        read_data = request.get_json(force=True)
    except Exception:
        return jsonify({"error": "Invalid JSON"}), 400

    url = f"{COMMUNITY_URI}/community/notifications/read"

    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
    }

    try:
        resp = requests.post(url, json=read_data, headers=headers, timeout=10)
    except requests.RequestException:
        logging.exception("Community notifications read request failed")
        return jsonify({"detail": "Community service unreachable"}), 502

    try:
        data = resp.json()
    except ValueError:
        data = {"detail": "Non-JSON response from community service"}

    return jsonify(data), resp.status_code


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