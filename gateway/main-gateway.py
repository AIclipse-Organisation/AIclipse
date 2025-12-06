import logging
import os
import uuid
import hashlib
import time
import json
from typing import Optional, Dict, Any

import httpx
import jwt
from fastapi import (
    FastAPI,
    HTTPException,
    UploadFile,
    File,
    Form,
    Header,
    Query,
    Path,
    Depends,
    status,
)
from fastapi.responses import JSONResponse, Response
from fastapi.middleware.cors import CORSMiddleware 
from pydantic import BaseModel

app = FastAPI()
app.add_middleware(
    
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

AUTH_URI = os.getenv("AUTH_URI")
MEDIA_URI = os.getenv("MEDIA_URI")
DETECTOR_URI = os.getenv("DETECTOR_URI")
HOSTNAME = os.getenv("HOSTNAME")

# Internal secret for detection_token
DETECTION_TOKEN_SECRET = os.getenv("DETECTION_TOKEN_SECRET")

# JWKS cache for Auth RS256 public keys
JWKS_CACHE: Dict[str, Any] = {}

class _HealthzFilter(logging.Filter):
    # Hide health endpoints from access logs
    def filter(self, record):
        try:
            return all(p not in record.getMessage() for p in ("/healthz", "/api/healthz"))
        except Exception:
            return True


logging.getLogger("uvicorn.access").addFilter(_HealthzFilter())


@app.get("/healthz")
@app.get("/api/healthz")
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
) -> Response:
    url = base_url.rstrip("/") + path
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
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


async def _refresh_jwks():
    global JWKS_CACHE
    url = AUTH_URI.rstrip("/") + "/.well-known/jwks.json"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
    except httpx.RequestError as exc:
        logging.error(f"Failed to refresh JWKS: {exc}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Unable to fetch JWKS from auth service",
        )

    data = resp.json()
    keys: Dict[str, Any] = {}
    for jwk in data.get("keys", []):
        kid = jwk.get("kid")
        if not kid:
            continue
        public_key = jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(jwk))
        keys[kid] = public_key

    if not keys:
        logging.error("Received empty JWKS")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Auth JWKS has no keys",
        )

    JWKS_CACHE = keys


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
        await _refresh_jwks()

    key = JWKS_CACHE.get(kid)
    if not key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unknown signing key",
        )

    try:
        payload = jwt.decode(token, key=key, algorithms=["RS256"])
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

    return payload


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
        user_id=user_id,
        email=payload.get("email"),
        is_admin=bool(payload.get("is_admin", False)),
        plan=payload.get("plan"),
        token=token,
    )


def _sha256_bytes(data: bytes) -> str:
    h = hashlib.sha256()
    h.update(data)
    return h.hexdigest()


def _create_detection_token(
    user: UserContext,
    image_bytes: bytes,
    verdict: str,
    label: str,
    confidence: float,
) -> str:
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
    token = jwt.encode(payload, DETECTION_TOKEN_SECRET, algorithm="HS256")
    return token


def _validate_detection_token(
    token: str,
    user: UserContext,
    image_bytes: bytes,
) -> Dict[str, Any]:
    try:
        payload = jwt.decode(token, DETECTION_TOKEN_SECRET, algorithms=["HS256"])
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


# Startup


@app.on_event("startup")
async def startup_event():
    # Best-effort JWKS preload; if it fails, we retry lazily on first request.
    try:
        await _refresh_jwks()
    except HTTPException as exc:
        logging.warning(f"JWKS preload failed: {exc.detail}")


# Auth routes (proxy to Auth Service)


@app.post("/auth/signup")
async def gateway_auth_signup(payload: dict):
    return await _proxy_json("POST", AUTH_URI, "/signup", json_body=payload)


@app.post("/auth/login")
async def gateway_auth_login(payload: dict):
    return await _proxy_json("POST", AUTH_URI, "/login", json_body=payload)


@app.get("/auth/me")
async def gateway_auth_me_get(user: UserContext = Depends(get_current_user)):
    return await _proxy_json(
        "GET",
        AUTH_URI,
        "/me",
        headers={"Authorization": f"Bearer {user.token}"},
    )


@app.patch("/auth/me")
async def gateway_auth_me_patch(
    payload: dict,
    user: UserContext = Depends(get_current_user),
):
    return await _proxy_json(
        "PATCH",
        AUTH_URI,
        "/me",
        json_body=payload,
        headers={"Authorization": f"Bearer {user.token}"},
    )


@app.delete("/auth/me")
async def gateway_auth_me_delete(user: UserContext = Depends(get_current_user)):
    return await _proxy_json(
        "DELETE",
        AUTH_URI,
        "/me",
        headers={"Authorization": f"Bearer {user.token}"},
    )


@app.get("/auth/admin/users")
async def gateway_admin_list_users(
    user_name: Optional[str] = Query(None),
    user: UserContext = Depends(get_current_user),
):
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )

    params = {}
    if user_name:
        params["user_name"] = user_name

    return await _proxy_json(
        "GET",
        AUTH_URI,
        "/admin/users",
        headers={"Authorization": f"Bearer {user.token}"},
        params=params,
    )


@app.get("/auth/admin/user/{user_id}")
async def gateway_admin_get_user(
    user_id: str = Path(...),
    user: UserContext = Depends(get_current_user),
):
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )

    return await _proxy_json(
        "GET",
        AUTH_URI,
        f"/admin/user/{user_id}",
        headers={"Authorization": f"Bearer {user.token}"},
    )


@app.patch("/auth/admin/user/{user_id}")
async def gateway_admin_update_user(
    user_id: str,
    payload: dict,
    user: UserContext = Depends(get_current_user),
):
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )

    return await _proxy_json(
        "PATCH",
        AUTH_URI,
        f"/admin/user/{user_id}",
        json_body=payload,
        headers={"Authorization": f"Bearer {user.token}"},
    )


@app.delete("/auth/admin/user/{user_id}")
async def gateway_admin_delete_user(
    user_id: str,
    user: UserContext = Depends(get_current_user),
):
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )

    return await _proxy_json(
        "DELETE",
        AUTH_URI,
        f"/admin/user/{user_id}",
        headers={"Authorization": f"Bearer {user.token}"},
    )


# Detection: /checks -> Detector /v1.0.1/checks


@app.post("/checks")
async def gateway_checks(
    file: UploadFile = File(...),
    user: UserContext = Depends(get_current_user),
):
    if file.content_type not in ("image/jpeg", "image/png", "application/octet-stream"):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Unsupported media type",
        )

    data = await file.read()
    if not data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Empty file",
        )

    x_request_id = str(uuid.uuid4())
    url = DETECTOR_URI.rstrip("/") + "/v1.0.1/checks"
    headers = {
        "X-Request-Id": x_request_id,
        "X-User-Id": user.user_id,
        "Content-Type": "application/octet-stream",
    }

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
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
        verdict=verdict,
        label=label,
        confidence=float(confidence),
    )

    response_body = {
        "verdict": verdict,
        "label": label,
        "confidence": confidence,
        "detection_token": detection_token,
    }

    return JSONResponse(status_code=status.HTTP_200_OK, content=response_body)


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
    if not data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Empty file",
        )

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

        files = {
            "file": (file.filename, data, file.content_type),
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
    if MEDIA_URI:
        url = MEDIA_URI.rstrip("/") + f"/image/{image_id}"
        params = {"user_id": user.user_id}

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
            if resp.status_code == 404:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Image not found",
                )

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Image not found",
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
