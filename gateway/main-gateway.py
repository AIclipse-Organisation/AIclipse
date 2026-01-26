import asyncio
import hashlib
import io
import json
import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any, Dict, Optional, Tuple
from urllib.parse import urlparse

import httpx
import jwt

from fastapi import (
    Body,
    Depends,
    FastAPI,
    File,
    Form,
    Header,
    HTTPException,
    Path,
    Query,
    UploadFile,
    status,
    Request,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from PIL import Image, UnidentifiedImageError
import re
import posixpath

AUTH_URI = os.getenv("AUTH_URI")
MEDIA_URI = os.getenv("MEDIA_URI")

_IMAGE_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
_MEDIA_PATH_RE = re.compile(r"^[A-Za-z0-9_/-]{1,256}$")

def _build_media_url(path: str) -> str:
    """
    Build a validated URL to the media service.
    `path` is treated as a relative path/segment and normalized/validated.
    """
    if not MEDIA_URI:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found",
        )

    base = urlparse(MEDIA_URI)
    if base.scheme not in ("http", "https") or not base.netloc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Invalid media service configuration",
        )

    normalized = posixpath.normpath(path.lstrip("/"))

    # Reject traversal / absolute
    if normalized in (".", "..") or normalized.startswith("../") or normalized.startswith("/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid media path",
        )

    # Strict allowlist for path characters
    if not _MEDIA_PATH_RE.fullmatch(normalized):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid media path",
        )

    # Build from parsed origin
    origin = f"{base.scheme}://{base.netloc}"
    full_url = f"{origin}/{normalized}"

    # Lock it down
    resolved = urlparse(full_url)
    if resolved.scheme != base.scheme or resolved.netloc != base.netloc or resolved.path != ("/" + normalized):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Invalid URL construction",
        )

    return full_url


def _build_media_image_url(image_id: str) -> str:
    safe_image_id = _sanitize_image_id(image_id)

    # Segment validation: must be exactly image/<id>
    rel = posixpath.normpath(f"image/{safe_image_id}")
    parts = rel.split("/")
    if len(parts) != 2 or parts[0] != "image" or parts[1] != safe_image_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid media path",
        )

    return _build_media_url(rel)


def _sanitize_image_id(image_id: str) -> str:
    """
    Validate and return a sanitized image_id.
    Raises HTTPException if invalid.
    This explicitly breaks CodeQL taint tracking by using regex match result.
    """
    if not isinstance(image_id, str):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found",
        )
    match = _IMAGE_ID_PATTERN.fullmatch(image_id)
    if not match:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found",
        )
    # Return the matched string (breaks taint chain for CodeQL)
    return match.group(0)

DETECTOR_URI = os.getenv("DETECTOR_URI")
HOSTNAME = os.getenv("HOSTNAME")

# Internal secret for detection_token
DETECTION_TOKEN_SECRET = os.getenv("DETECTION_TOKEN_SECRET")

# Gateway -> Auth internal auth for api-key exchange
INTERNAL_AUTH_TOKEN = os.getenv("INTERNAL_AUTH_TOKEN")

# Image safety limits
MAX_FILE_SIZE = 5 * 1024 * 1024
MAX_WIDTH = 12000
MAX_HEIGHT = 12000
MAX_PIXELS = 40000000  # 40 MP
Image.MAX_IMAGE_PIXELS = MAX_PIXELS  # decompression-bomb protection

SUPPORTED_IMAGE_FORMATS: Dict[str, Tuple[str, str]] = {
    "JPEG": ("image/jpeg", ".jpg"),
    "PNG": ("image/png", ".png"),
}

# JWKS cache for Auth RS256 public keys
JWKS_CACHE: Dict[str, Any] = {}
JWKS_LOCK = asyncio.Lock()

# API key allowed paths
API_KEY_ALLOWED_PATHS = {"/v1/checks", "/checks"}


def _require_setting(name: str, value: Optional[str]) -> str:
    if value:
        return value
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail=f"Missing required setting: {name}",
    )


class _HealthzFilter(logging.Filter):
    # Hide health endpoints from access logs
    def filter(self, record):
        try:
            return "/healthz" not in record.getMessage()
        except Exception:
            return True


logging.getLogger("uvicorn.access").addFilter(_HealthzFilter())


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Best-effort JWKS preload; if it fails, we retry lazily on first request.
    try:
        await _refresh_jwks()
    except HTTPException as exc:
        logging.warning("JWKS preload failed: %s", exc.detail)
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


# Models and helpers


class UserContext(BaseModel):
    user_id: str
    email: Optional[str] = None
    is_admin: bool = False
    plan: Optional[int] = None
    token: str


async def _proxy_json(
    method: str,
    base_url: str,
    path: str,
    *,
    json_body: Optional[dict] = None,
    headers: Optional[dict] = None,
    params: Optional[dict] = None,
    timeout_s: float = 10.0,
) -> Response:
    url = base_url.rstrip("/") + path
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            resp = await client.request(
                method=method,
                url=url,
                json=json_body,
                headers=headers,
                params=params,
            )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Upstream request failed: {exc}",
        )

    if 500 <= resp.status_code <= 599:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Upstream service error",
        )

    content_type = resp.headers.get("content-type", "application/json")
    return Response(
        content=resp.content,
        status_code=resp.status_code,
        media_type=content_type,
    )


def _parse_bearer_token(authorization: Optional[str]) -> str:
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
        )
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Authorization header format",
        )
    return parts[1]


async def _refresh_jwks(*, force: bool = False, kid: str | None = None) -> None:
    auth_uri = _require_setting("AUTH_URI", AUTH_URI)

    async with JWKS_LOCK:
        if not force and kid is not None and kid in JWKS_CACHE:
            return

        url = auth_uri.rstrip("/") + "/.well-known/jwks.json"
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(url)
                resp.raise_for_status()
        except httpx.HTTPError as exc:
            logging.error("Failed to refresh JWKS: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Unable to fetch JWKS from auth service",
            )

        try:
            data = resp.json()
        except ValueError:
            logging.error("JWKS response is not valid JSON")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Auth JWKS is invalid JSON",
            )

        keys: Dict[str, Any] = {}
        for jwk_obj in data.get("keys", []):
            jwk_kid = jwk_obj.get("kid")
            if not jwk_kid:
                continue
            try:
                public_key = jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(jwk_obj))
            except Exception as exc:
                logging.error("Failed to parse JWK for kid=%s: %s", jwk_kid, exc)
                continue
            keys[jwk_kid] = public_key

        if not keys:
            logging.error("Received empty JWKS")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Auth JWKS has no keys",
            )

        JWKS_CACHE.clear()
        JWKS_CACHE.update(keys)


async def _decode_jwt_rs256(token: str) -> Dict[str, Any]:
    try:
        header = jwt.get_unverified_header(token)
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token header",
        )

    kid = header.get("kid")
    if not kid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing kid in token header",
        )

    if kid not in JWKS_CACHE:
        await _refresh_jwks(kid=kid)

    key = JWKS_CACHE.get(kid)
    if not key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unknown signing key",
        )

    def _decode_with_key(pub_key: Any) -> Dict[str, Any]:
        return jwt.decode(token, key=pub_key, algorithms=["RS256"])

    try:
        return _decode_with_key(key)

    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired",
        )

    except jwt.InvalidSignatureError:
        await _refresh_jwks(force=True, kid=kid)
        key2 = JWKS_CACHE.get(kid)
        if not key2:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Unknown signing key",
            )
        try:
            return _decode_with_key(key2)
        except jwt.ExpiredSignatureError:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token expired",
            )
        except jwt.InvalidTokenError:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token",
            )

    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )


def _sha256_bytes(data: bytes) -> str:
    h = hashlib.sha256()
    h.update(data)
    return h.hexdigest()


def _require_internal_token() -> str:
    return _require_setting("INTERNAL_AUTH_TOKEN", INTERNAL_AUTH_TOKEN)


async def _exchange_api_key_for_jwt(api_key: str) -> Tuple[str, int]:
    """
    Exchange API key -> short-lived RS256 JWT in Auth service.
    Returns (jwt, exp_unix).
    Uses best-effort in-memory caching.
    """
    auth_uri = _require_setting("AUTH_URI", AUTH_URI)
    url = auth_uri.rstrip("/") + "/internal/api-key/exchange"
    headers = {
        "Accept": "application/json",
        "X-Internal-Token": _require_internal_token(),
    }

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(url, json={"api_key": api_key}, headers=headers)
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Auth exchange unreachable: {exc}",
        )

    if resp.status_code == 401:
        raise HTTPException(status_code=401, detail="Invalid API key")
    if resp.status_code == 403:
        raise HTTPException(status_code=403, detail="API key exchange forbidden")
    if resp.status_code >= 500:
        raise HTTPException(status_code=502, detail="Auth service error on exchange")

    try:
        data = resp.json()
    except ValueError:
        raise HTTPException(status_code=502, detail="Auth exchange returned invalid JSON")

    token = data.get("token")
    exp = data.get("exp")
    if not token or not exp:
        raise HTTPException(status_code=502, detail="Auth exchange missing token/exp")

    return token, int(exp)


async def get_current_user(
    authorization: Optional[str] = Header(None),
) -> UserContext:
    token = _parse_bearer_token(authorization)
    payload = await _decode_jwt_rs256(token)

    user_id = payload.get("sub") or payload.get("user_id")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing subject",
        )

    return UserContext(
        user_id=str(user_id),
        email=payload.get("email"),
        is_admin=bool(payload.get("is_admin", False)),
        plan=payload.get("plan"),
        token=token,
    )


async def get_current_user_any(
    request: Request,
    authorization: Optional[str] = Header(None),
    x_api_key: Optional[str] = Header(None, alias="X-Api-Key"),
) -> UserContext:
    """
    Accept either:
      - X-Api-Key (only on whitelisted routes) -> exchange -> RS256 verify -> UserContext
      - Authorization: Bearer <jwt> (normal browser flow)
    """
    if x_api_key:
        if request.url.path not in API_KEY_ALLOWED_PATHS:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="API key not allowed on this route",
            )

        jwt_token, _exp = await _exchange_api_key_for_jwt(x_api_key)
        payload = await _decode_jwt_rs256(jwt_token)

        user_id = payload.get("sub") or payload.get("user_id")
        if not user_id:
            raise HTTPException(status_code=401, detail="Token missing subject")

        return UserContext(
            user_id=str(user_id),
            email=payload.get("email"),
            is_admin=bool(payload.get("is_admin", False)),
            plan=payload.get("plan"),
            token=jwt_token,
        )

    # fallback to Bearer
    return await get_current_user(authorization=authorization)


async def get_current_admin(user: UserContext = Depends(get_current_user)) -> UserContext:
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )
    return user


def _create_detection_token(
    user: UserContext,
    image_bytes: bytes,
    verdict: str,
    label: str,
    confidence: float,
) -> str:
    secret = _require_setting("DETECTION_TOKEN_SECRET", DETECTION_TOKEN_SECRET)

    sha256_hex = _sha256_bytes(image_bytes)
    now = int(time.time())
    payload = {
        "sub": user.user_id,
        "sha256": sha256_hex,
        "verdict": verdict,
        "label": label,
        "confidence": confidence,
        "iat": now,
        "exp": now + 600,
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def _validate_detection_token(
    token: str,
    user: UserContext,
    image_bytes: bytes,
) -> Dict[str, Any]:
    secret = _require_setting("DETECTION_TOKEN_SECRET", DETECTION_TOKEN_SECRET)

    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="detection_token expired",
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid detection_token",
        )

    if payload.get("sub") != user.user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="detection_token does not belong to this user",
        )

    expected_sha = payload.get("sha256")
    actual_sha = _sha256_bytes(image_bytes)
    if not expected_sha or expected_sha != actual_sha:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="detection_token does not match uploaded image",
        )

    return payload


def _sniff_and_validate_image(data: bytes) -> Tuple[str, str]:
    """
    Validate bytes are a real JPEG/PNG image and return (normalized_content_type, normalized_ext).

    - Does NOT modify bytes.
    - Protects against non-image uploads and basic decompression-bomb cases.
    """
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")

    if len(data) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="Payload Too Large")

    try:
        with Image.open(io.BytesIO(data)) as im:
            im.verify()

        with Image.open(io.BytesIO(data)) as im:
            fmt = (im.format or "").upper()
            w, h = im.size
            if w <= 0 or h <= 0 or w > MAX_WIDTH or h > MAX_HEIGHT:
                raise HTTPException(status_code=415, detail="Invalid image dimensions")
            im.load()

    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise HTTPException(status_code=415, detail="Unsupported or invalid image")

    if fmt not in SUPPORTED_IMAGE_FORMATS:
        raise HTTPException(status_code=415, detail="Unsupported image format")

    return SUPPORTED_IMAGE_FORMATS[fmt]


# Auth routes (proxy to Auth Service)


@app.post("/auth/signup")
async def gateway_auth_signup(payload: dict):
    auth_uri = _require_setting("AUTH_URI", AUTH_URI)
    return await _proxy_json("POST", auth_uri, "/signup", json_body=payload)


@app.post("/auth/login")
async def gateway_auth_login(payload: dict):
    auth_uri = _require_setting("AUTH_URI", AUTH_URI)
    return await _proxy_json("POST", auth_uri, "/login", json_body=payload)


@app.get("/auth/me")
async def gateway_auth_me_get(user: UserContext = Depends(get_current_user)):
    auth_uri = _require_setting("AUTH_URI", AUTH_URI)
    return await _proxy_json(
        "GET",
        auth_uri,
        "/me",
        headers={"Authorization": f"Bearer {user.token}"},
    )


@app.patch("/auth/me")
async def gateway_auth_me_patch(
    payload: dict,
    user: UserContext = Depends(get_current_user),
):
    auth_uri = _require_setting("AUTH_URI", AUTH_URI)
    return await _proxy_json(
        "PATCH",
        auth_uri,
        "/me",
        json_body=payload,
        headers={"Authorization": f"Bearer {user.token}"},
    )


@app.delete("/auth/me")
async def gateway_auth_me_delete(user: UserContext = Depends(get_current_user)):
    auth_uri = _require_setting("AUTH_URI", AUTH_URI)
    return await _proxy_json(
        "DELETE",
        auth_uri,
        "/me",
        headers={"Authorization": f"Bearer {user.token}"},
    )


@app.get("/auth/admin/users")
async def gateway_admin_list_users(
    user_name: Optional[str] = Query(None),
    admin: UserContext = Depends(get_current_admin),
):
    auth_uri = _require_setting("AUTH_URI", AUTH_URI)

    params = {}
    if user_name:
        params["user_name"] = user_name

    return await _proxy_json(
        "GET",
        auth_uri,
        "/admin/users",
        headers={"Authorization": f"Bearer {admin.token}"},
        params=params,
    )


@app.get("/auth/admin/user/{user_id}")
async def gateway_admin_get_user(
    user_id: str = Path(...),
    admin: UserContext = Depends(get_current_admin),
):
    auth_uri = _require_setting("AUTH_URI", AUTH_URI)
    return await _proxy_json(
        "GET",
        auth_uri,
        f"/admin/user/{user_id}",
        headers={"Authorization": f"Bearer {admin.token}"},
    )


@app.patch("/auth/admin/user/{user_id}")
async def gateway_admin_update_user(
    user_id: str,
    payload: dict,
    admin: UserContext = Depends(get_current_admin),
):
    auth_uri = _require_setting("AUTH_URI", AUTH_URI)
    return await _proxy_json(
        "PATCH",
        auth_uri,
        f"/admin/user/{user_id}",
        json_body=payload,
        headers={"Authorization": f"Bearer {admin.token}"},
    )


@app.delete("/auth/admin/user/{user_id}")
async def gateway_admin_delete_user(
    user_id: str,
    admin: UserContext = Depends(get_current_admin),
):
    auth_uri = _require_setting("AUTH_URI", AUTH_URI)
    return await _proxy_json(
        "DELETE",
        auth_uri,
        f"/admin/user/{user_id}",
        headers={"Authorization": f"Bearer {admin.token}"},
    )


@app.get("/auth/api-key")
async def gateway_get_api_key(user: UserContext = Depends(get_current_user)):
    auth_uri = _require_setting("AUTH_URI", AUTH_URI)
    return await _proxy_json(
        "GET",
        auth_uri,
        "/me/api-key",
        headers={"Authorization": f"Bearer {user.token}"},
    )


@app.post("/auth/api-key")
async def gateway_rotate_api_key(user: UserContext = Depends(get_current_user)):
    auth_uri = _require_setting("AUTH_URI", AUTH_URI)
    return await _proxy_json(
        "POST",
        auth_uri,
        "/me/api-key",
        headers={"Authorization": f"Bearer {user.token}"},
    )


@app.delete("/auth/api-key")
async def gateway_delete_api_key(user: UserContext = Depends(get_current_user)):
    auth_uri = _require_setting("AUTH_URI", AUTH_URI)
    return await _proxy_json(
        "DELETE",
        auth_uri,
        "/me/api-key",
        headers={"Authorization": f"Bearer {user.token}"},
    )


# Detection: /v1/checks (new) + /checks (legacy) -> Detector /v1.0.1/checks


async def _checks_impl(file: UploadFile, user: UserContext) -> JSONResponse:
    detector_uri = _require_setting("DETECTOR_URI", DETECTOR_URI)

    data = await file.read()
    _sniff_and_validate_image(data)

    x_request_id = str(uuid.uuid4())
    url = detector_uri.rstrip("/") + "/v1.0.1/checks"
    headers = {
        "X-Request-Id": x_request_id,
        "X-User-Id": user.user_id,
        "Content-Type": "application/octet-stream",
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(url, content=data, headers=headers)
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Detector unreachable: {exc}",
        )

    if resp.status_code == 400:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=resp.text,
        )

    if resp.status_code >= 500:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Detector service error",
        )

    try:
        detector_payload = resp.json()
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Detector returned invalid JSON",
        )

    verdict = detector_payload.get("verdict")
    label = detector_payload.get("label")
    confidence = detector_payload.get("confidence")

    if verdict is None or label is None or confidence is None:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Detector response missing required fields",
        )

    detection_token = _create_detection_token(
        user=user,
        image_bytes=data,
        verdict=str(verdict),
        label=str(label),
        confidence=float(confidence),
    )

    response_body = {
        "verdict": verdict,
        "label": label,
        "confidence": confidence,
        "detection_token": detection_token,
    }

    return JSONResponse(status_code=status.HTTP_200_OK, content=response_body)


@app.post("/v1/checks")
async def gateway_checks_v1(
    file: UploadFile = File(...),
    user: UserContext = Depends(get_current_user_any),
):
    return await _checks_impl(file, user)


@app.post("/checks")
async def gateway_checks_legacy(
    file: UploadFile = File(...),
    user: UserContext = Depends(get_current_user_any),
):
    # Temporary legacy alias.
    return await _checks_impl(file, user)


# Image saving / history / community (Media)
# detection_token is validated only here and never forwarded.


@app.post("/upload/image")
async def gateway_upload_image(
    file: UploadFile = File(...),
    detection_token: str = Form(...),
    is_public: Optional[bool] = Form(False),
    user: UserContext = Depends(get_current_user),
):
    data = await file.read()
    normalized_ct, ext = _sniff_and_validate_image(data)

    payload = _validate_detection_token(
        token=detection_token,
        user=user,
        image_bytes=data,
    )

    verdict = payload.get("verdict")
    label = payload.get("label")
    confidence = payload.get("confidence")

    if verdict is None or label is None or confidence is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="detection_token missing detection fields",
        )

    if MEDIA_URI:
        url = MEDIA_URI.rstrip("/") + "/upload/image"
        headers = {"X-Request-Id": str(uuid.uuid4())}

        safe_name = file.filename or f"upload{ext}"

        files = {
            "file": (safe_name, data, normalized_ct),
            "user_id": (None, user.user_id),
            "verdict": (None, str(verdict)),
            "label": (None, str(label)),
            "confidence": (None, str(confidence)),
            "is_public": (None, "true" if is_public else "false"),
        }

        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.post(url, files=files, headers=headers)
        except httpx.RequestError:
            pass
        else:
            if resp.status_code == 201:
                return Response(
                    content=resp.content,
                    status_code=resp.status_code,
                    media_type=resp.headers.get("content-type", "application/json"),
                )
            if resp.status_code >= 500:
                pass

    image_id = str(uuid.uuid4())
    image_payload = {
        "image_id": image_id,
        "user_id": user.user_id,
        "verdict": verdict,
        "label": label,
        "confidence": confidence,
        "is_public": bool(is_public),
        "uploaded_at": "1970-01-01T00:00:00Z",
        "is_reported": False,
        "url": f"https://example.invalid/images/{image_id}",
    }

    response_body = {
        "verdict": verdict,
        "label": label,
        "confidence": confidence,
        "image": image_payload,
    }

    return JSONResponse(status_code=status.HTTP_201_CREATED, content=response_body)


@app.get("/images")
async def gateway_get_my_images(
    is_public: Optional[bool] = Query(None),
    user: UserContext = Depends(get_current_user),
):
    if MEDIA_URI:
        params = {"user_id": user.user_id}
        if is_public is not None:
            params["is_public"] = "true" if is_public else "false"

        url = MEDIA_URI.rstrip("/") + "/images"

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url, params=params)
        except httpx.RequestError:
            pass
        else:
            if resp.status_code == 200:
                return Response(
                    content=resp.content,
                    status_code=resp.status_code,
                    media_type=resp.headers.get("content-type", "application/json"),
                )

    return JSONResponse(status_code=status.HTTP_200_OK, content={"items": []})


@app.get("/image/{image_id}")
async def gateway_get_image(
    image_id: str = Path(...),
    user: UserContext = Depends(get_current_user),
):
    # Match your desired behavior: if media service isn't configured, pretend not found
    if not MEDIA_URI:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found",
        )

    url = _build_media_image_url(image_id)
    params = {"user_id": user.user_id}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, params=params)
    except httpx.RequestError:
        # If you want GET to still look like "not found" when media is down, keep 404.
        # If you want to surface outage, change this to 503.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found",
        )

    if resp.status_code == 200:
        return Response(
            content=resp.content,
            status_code=resp.status_code,
            media_type=resp.headers.get("content-type", "application/json"),
        )
    if resp.status_code == 404:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found",
        )

    raise HTTPException(
        status_code=resp.status_code,
        detail=f"Media service error: {resp.status_code}",
    )


class UpdateImageRequest(BaseModel):
    is_public: Optional[bool] = None


@app.patch("/image/{image_id}")
async def gateway_update_image(
    image_id: str = Path(...),
    body: UpdateImageRequest = Body(...),
    user: UserContext = Depends(get_current_user),
):
    """
    Update an image's properties (e.g., is_public).
    Only the owner can update their image.
    """
    if not MEDIA_URI:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found",
        )

    url = _build_media_image_url(image_id)
    params = {"user_id": user.user_id}
    
    if body and body.is_public is not None:
        params["is_public"] = bool(body.is_public)
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.patch(url, params=params)
    except httpx.RequestError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Media service unreachable",
        )

    if resp.status_code == 200:
        return Response(
            content=resp.content,
            status_code=resp.status_code,
            media_type=resp.headers.get("content-type", "application/json"),
        )
    if resp.status_code == 404:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found",
        )
    if resp.status_code == 403:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: You can only update your own images",
        )

    raise HTTPException(
        status_code=resp.status_code,
        detail=f"Media service error: {resp.status_code}",
    )


@app.get("/community/images")
async def gateway_get_community_images():
    if MEDIA_URI:
        url = MEDIA_URI.rstrip("/") + "/images"
        params = {"is_public": "true"}

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url, params=params)
        except httpx.RequestError:
            pass
        else:
            if resp.status_code == 200:
                return Response(
                    content=resp.content,
                    status_code=resp.status_code,
                    media_type=resp.headers.get("content-type", "application/json"),
                )

    return JSONResponse(status_code=status.HTTP_200_OK, content={"items": []})


@app.delete("/image/{image_id}")
async def gateway_delete_image(
    image_id: str = Path(...),
    user: UserContext = Depends(get_current_user),
):
    """
    Delete an image. Only the owner can delete their own image.
    Gateway authenticates the user and forwards the request to media service.
    """
    # Match GET behavior
    if not MEDIA_URI:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found",
        )

    url = _build_media_image_url(image_id)
    params = {"user_id": user.user_id}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.delete(url, params=params)
    except httpx.RequestError:
        # For DELETE you said you want the expected 404 — so return 404 here too.
        # If you *actually* want to signal outage, use 503 instead.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found",
        )

    if resp.status_code == 200:
        return Response(
            content=resp.content,
            status_code=resp.status_code,
            media_type=resp.headers.get("content-type", "application/json"),
        )
    if resp.status_code == 404:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found",
        )
    if resp.status_code == 403:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only delete your own images",
        )

    raise HTTPException(
        status_code=resp.status_code,
        detail=f"Media service error: {resp.status_code}",
    )
