import hashlib
import time
from typing import Any, Dict

import jwt
from fastapi import HTTPException, Request, status

from app.core.settings import require_setting
from app.models import UserContext


def _sha256_bytes_sync(data: bytes) -> str:
    h = hashlib.sha256()
    h.update(data)
    return h.hexdigest()


async def sha256_bytes(request: Request, data: bytes) -> str:
    return await request.app.state.cpu.run(_sha256_bytes_sync, data)


async def create_detection_token(
    request: Request,
    user: UserContext,
    image_bytes: bytes,
    verdict: str,
    label: str,
    confidence: float,
    model_version: str,
) -> str:
    s = request.app.state.settings
    secret = require_setting("DETECTION_TOKEN_SECRET", s.detection_token_secret)

    sha256_hex = await sha256_bytes(request, image_bytes)
    now = int(time.time())
    payload = {
        "sub": user.user_id,
        "sha256": sha256_hex,
        "verdict": verdict,
        "label": label,
        "confidence": confidence,
        "model_version": model_version,
        "iat": now,
        "exp": now + 600,
    }

    def _encode() -> str:
        return jwt.encode(payload, secret, algorithm="HS256")

    return await request.app.state.cpu.run(_encode)


async def validate_detection_token(
    request: Request,
    token: str,
    user: UserContext,
    image_bytes: bytes,
) -> Dict[str, Any]:
    s = request.app.state.settings
    secret = require_setting("DETECTION_TOKEN_SECRET", s.detection_token_secret)

    def _decode() -> Dict[str, Any]:
        return jwt.decode(token, secret, algorithms=["HS256"])

    try:
        payload = await request.app.state.cpu.run(_decode)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="detection_token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid detection_token")

    if payload.get("sub") != user.user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="detection_token does not belong to this user",
        )

    expected_sha = payload.get("sha256")
    actual_sha = await sha256_bytes(request, image_bytes)

    if not expected_sha or expected_sha != actual_sha:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="detection_token does not match uploaded image",
        )

    return payload
