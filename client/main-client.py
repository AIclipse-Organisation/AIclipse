import logging
import os
import re
from config import cfg
import sys

import requests
from flask import (
    Flask,
    request,
    jsonify,
    make_response,
    render_template,
    redirect,
    session
)
from werkzeug.serving import WSGIRequestHandler

# Client service.
# - Returns UI (index.html)
# - Is a BFF for the browser: accepts requests from the front, goes to the Gateway via GATEWAY_URI
# - Stores JWT exclusively in HttpOnly cookie, the front does not see it


app = Flask(__name__)

app.secret_key = os.getenv("FLASK_SECRET_KEY", "a-very-secret-phrase")

current_env = os.getenv("APP_ENV", "dev")

print(f"[*] Starting Client Service in {current_env} mode")

GATEWAY_URI = os.getenv("GATEWAY_URI")


@app.get("/healthz")
def healthz():
    return "OK", 200


@app.get("/")
def index():
    if _get_token_from_cookie():
        return redirect("/community")
    toggles = cfg.get_client_config()
    show_signup = toggles.get("sign-up", True)
    return render_template("login.html", show_signup=show_signup)
 


@app.get("/imgProcessing")
def img_processing():
    return render_template( "imgProcessing.html")


@app.get("/scans")
def scans():
    return render_template( "scans.html")


@app.get("/home")
def upload():
    return render_template("home.html")


@app.get("/notification")
def notification():
    return render_template("notification.html")


@app.get("/plan")
def plan():
    return render_template("plan.html")


@app.get("/profile")
def profile():
    return render_template( "profile.html")

@app.get("/results")
def results():
    return render_template( "results.html")

@app.get("/viewscan")
def viewscan():
    return render_template( "viewscan.html")


@app.get("/dev")
def dev():
    return render_template( "dev.html")


@app.get("/docs")
def docs():
    return render_template( "docs.html")


def _get_token_from_cookie() -> str | None:
    return request.cookies.get("access_token")


def _is_request_secure() -> bool:
    proto = request.headers.get("X-Forwarded-Proto", request.scheme)
    return proto.lower() == "https"


def _call_gateway_json(
    method: str,
    path: str,
    *,
    json_data: dict | None = None,
    require_auth: bool = False,
):
    headers = {"Accept": "application/json"}

    if require_auth:
        token = _get_token_from_cookie()
        if not token:
            return jsonify({"detail": "Not authenticated"}), 401
        headers["Authorization"] = f"Bearer {token}"

    url = f"{GATEWAY_URI}{path}"

    try:
        resp = requests.request(
            method=method,
            url=url,
            json=json_data,
            headers=headers,
            timeout=10,
        )
    except requests.RequestException:
        logging.exception("Gateway request failed")
        return jsonify({"detail": "Gateway unreachable"}), 502

    content_type = resp.headers.get("content-type", "application/json")
    status_code = resp.status_code

    if "application/json" in content_type:
        try:
            data = resp.json()
        except ValueError:
            return jsonify({"detail": "Invalid JSON from gateway"}), 502
        return jsonify(data), status_code

    return resp.content, status_code, {"Content-Type": content_type}


# ----------- Admin Proxy ---------

@app.get("/admin")
def admin_route():
    """
    Checks user role via Gateway. 
    If admin, redirects to the Community Service's admin dashboard.
    """
    token = _get_token_from_cookie()
    if not token:
        return redirect("/")

    url = f"{GATEWAY_URI}/auth/me"
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
    }

    try:
        resp = requests.get(url, headers=headers, timeout=5)
        if resp.status_code != 200:
            return redirect("/")

        if not session["is_admin"]:
            return "Forbidden: Admin access required", 403

    except Exception:
        logging.exception("Gateway auth check failed for admin route")
        return "Service Temporarily Unavailable", 502
    
    return redirect(f"/community/admin")

@app.context_processor
def inject_admin_status():
    """
    Makes 'is_admin' available to all templates (including partials)
    without passing it manually in every render_template() call.
    """
    sys.stderr.write(f"\n>>> CRITICAL DEBUG: is admin {session.get('is_admin')}\n")
    return dict(is_admin=session.get("is_admin", False))


# ---------- AUTH (BROWSER -> CLIENT -> GATEWAY) ----------

@app.before_request
def enforce_auth():
    public_paths = ["/", "/healthz", "/auth/login", "/auth/signup"]
    
    if request.path.startswith("/static") or request.path in public_paths:
        return None

    token = _get_token_from_cookie()
    
    if not token:
        host = request.headers.get("X-Forwarded-Host") or request.headers.get("Host", "aiclipse.local")
        if "10.1." in host:
            host = "aiclipse.local"
            
        return redirect("/")
    
    return None


@app.post("/auth/signup")
def auth_signup():
    toggles = cfg.get_client_config()
    if not toggles.get("sign-up", True):
        return jsonify({"detail": "Public registration is currently disabled"}), 403
    payload = request.get_json(force=True, silent=True) or {}
    return _call_gateway_json(
        "POST",
        "/auth/signup",
        json_data=payload,
        require_auth=False,
    )


@app.post("/auth/login")
def auth_login():
    payload = request.get_json(force=True, silent=True) or {}

    url = f"{GATEWAY_URI}/auth/login"
    try:
        resp = requests.post(url, json=payload, timeout=10)
    except requests.RequestException:
        logging.exception("Gateway /auth/login request failed")
        return jsonify({"detail": "Gateway unreachable"}), 502

    if resp.status_code != 200:
        try:
            data = resp.json()
        except ValueError:
            data = {"detail": "Login failed"}
        return jsonify(data), resp.status_code

    try:
        data = resp.json()
    except ValueError:
        return jsonify({"detail": "Invalid JSON from gateway on login"}), 502

    token = data.get("token")
    user = data.get("user")
    session["is_admin"] = user.get("is_admin") 
    

    if not token or not user:
        return jsonify({"detail": "Gateway login response missing token or user"}), 502

    if isinstance(token, str) and token.lower().startswith("bearer "):
        token = token.split(" ", 1)[1].strip()

    response = make_response(jsonify({"user": user}), 200)
    response.set_cookie(
        "access_token",
        token,
        httponly=True,
        secure=_is_request_secure(),
        samesite="Lax",
        max_age=60 * 60 * 24 * 7,
    )

    return response


@app.post("/logout")
def logout():
    session.clear()
    response = make_response(jsonify({"detail": "Logged out"}), 200)
    response.set_cookie(
        "access_token",
        "",
        expires=0,
        httponly=True,
        secure=_is_request_secure(),
        samesite="Lax",
    )
    return response


@app.get("/auth/me")
def auth_me_get():
    token = _get_token_from_cookie()
    if not token:
        return jsonify({"detail": "Not authenticated"}), 401

    url = f"{GATEWAY_URI}/auth/me"
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
    }
    try:
        resp = requests.get(url, headers=headers, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            session["is_admin"] = data.get("is_admin")
            return jsonify(data), 200
    except requests.RequestException:
        logging.exception("Gateway /auth/me request failed")
        return jsonify({"detail": "Gateway unreachable"}), 502

    if resp.status_code == 401:
        response = make_response(jsonify({"detail": "Unauthorized"}), 401)
        response.set_cookie(
            "access_token",
            "",
            expires=0,
            httponly=True,
            secure=_is_request_secure(),
            samesite="Lax",
        )
        return response

    try:
        data = resp.json()
    except ValueError:
        return jsonify({"detail": "Invalid JSON from gateway on /auth/me"}), 502

    return jsonify(data), resp.status_code


@app.patch("/auth/me")
def auth_me_patch():
    payload = request.get_json(force=True, silent=True) or {}
    return _call_gateway_json(
        "PATCH",
        "/auth/me",
        json_data=payload,
        require_auth=True,
    )


@app.delete("/auth/me")
def auth_me_delete():
    token = _get_token_from_cookie()
    if not token:
        return jsonify({"detail": "Not authenticated"}), 401

    url = f"{GATEWAY_URI}/auth/me"
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
    }

    try:
        resp = requests.delete(url, headers=headers, timeout=10)
    except requests.RequestException:
        logging.exception("Gateway /auth/me DELETE request failed")
        return jsonify({"detail": "Gateway unreachable"}), 502

    try:
        data = resp.json()
    except ValueError:
        data = {"detail": "Invalid JSON from gateway on delete"}

    response = make_response(jsonify(data), resp.status_code)
    response.set_cookie(
        "access_token",
        "",
        expires=0,
        httponly=True,
        secure=_is_request_secure(),
        samesite="Lax",
    )
    return response


# ---------- DETECTION / IMAGES (BROWSER -> CLIENT -> GATEWAY) ----------


@app.post("/checks")
def checks():
    token = _get_token_from_cookie()
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
    token = _get_token_from_cookie()
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
    token = _get_token_from_cookie()
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
    token = _get_token_from_cookie()
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
    """
    Update an image's properties (e.g., is_public).
    Proxy to Gateway PATCH /image/{image_id}.
    """
    token = _get_token_from_cookie()
    if not token:
        return jsonify({"detail": "Not authenticated"}), 401

    # Get JSON body with is_public
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
    """
    Delete an image.
    Proxy to Gateway DELETE /image/{image_id}.
    """
    token = _get_token_from_cookie()
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

    token = request.cookies.get("access_token")
    if not token:
        return jsonify({"error": "Unauthorized", "detail": "Missing auth token"}), 401

    # Get the JSON body from the request
    try:
        post_data = request.get_json(force=True)
    except Exception:
        return jsonify({"error": "Invalid JSON"}), 400

    community_url = os.getenv("COMMUNITY_URI", "http://community-srv:3000")
    url = f"{community_url}/community/posts"

    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": f"Bearer {token}"
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
    """
    Proxy for getting all community posts.
    No auth required for reading posts.
    """
    community_url = os.getenv("COMMUNITY_URI", "http://community-srv:3000")
    url = f"{community_url}/community/posts"

    headers = {
        "Accept": "application/json"
    }

    try:
        resp = requests.get(url, headers=headers, timeout=10)
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
    """
    Proxy for voting on community posts.
    Extracts JWT from cookie and forwards to community service.
    """
    token = request.cookies.get("access_token")
    if not token:
        return jsonify({"error": "Unauthorized", "detail": "Missing auth token"}), 401

    try:
        vote_data = request.get_json(force=True)
    except Exception:
        return jsonify({"error": "Invalid JSON"}), 400

    community_url = os.getenv("COMMUNITY_URI", "http://community-srv:3000")
    url = f"{community_url}/community/posts/vote"

    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": f"Bearer {token}"
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
    """
    Proxy for getting comments on community posts.
    No auth required for reading comments.
    """
    post_id = request.args.get("post_id")
    if not post_id:
        return jsonify({"error": "Missing post_id parameter"}), 400

    # Validate post_id to prevent SSRF via path/query manipulation
    if not re.fullmatch(r"[A-Za-z0-9_-]+", post_id):
        return jsonify({"error": "Invalid post_id parameter"}), 400

    community_url = os.getenv("COMMUNITY_URI", "http://community-srv:3000")
    url = f"{community_url}/community/posts/comments"

    headers = {
        "Accept": "application/json"
    }

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
    """
    Proxy for posting comments on community posts.
    Extracts JWT from cookie and forwards to community service.
    """
    token = request.cookies.get("access_token")
    if not token:
        return jsonify({"error": "Unauthorized", "detail": "Missing auth token"}), 401

    try:
        comment_data = request.get_json(force=True)
    except Exception:
        return jsonify({"error": "Invalid JSON"}), 400

    community_url = os.getenv("COMMUNITY_URI", "http://community-srv:3000")
    url = f"{community_url}/community/posts/comments"

    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": f"Bearer {token}"
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
    """
    Proxy for tracking post clicks.
    """
    try:
        click_data = request.get_json(force=True)
    except Exception:
        return jsonify({"error": "Invalid JSON"}), 400

    community_url = os.getenv("COMMUNITY_URI", "http://community-srv:3000")
    url = f"{community_url}/community/posts/click"

    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json"
    }

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
    """
    Proxy for reporting posts.
    """
    try:
        report_data = request.get_json(force=True)
    except Exception:
        return jsonify({"error": "Invalid JSON"}), 400

    community_url = os.getenv("COMMUNITY_URI", "http://community-srv:3000")
    url = f"{community_url}/community/posts/report"

    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json"
    }

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


@app.get("/auth/api-key")
def auth_api_key_get():
    return _call_gateway_json("GET", "/auth/api-key", require_auth=True)


@app.post("/auth/api-key")
def auth_api_key_rotate():
    return _call_gateway_json("POST", "/auth/api-key", require_auth=True)


@app.delete("/auth/api-key")
def auth_api_key_delete():
    return _call_gateway_json("DELETE", "/auth/api-key", require_auth=True)


class Quiet(WSGIRequestHandler):
    # Suppress access logs for /healthz
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
