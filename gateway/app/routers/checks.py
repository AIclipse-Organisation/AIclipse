import uuid

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.responses import JSONResponse

from app.core.image_safety import sniff_and_validate_image
from app.core.settings import require_setting
from app.core.tokens import create_detection_token
from app.deps import get_current_user_any
from app.models import UserContext

router = APIRouter()


async def _checks_impl(request: Request, file: UploadFile, user: UserContext) -> JSONResponse:
    s = request.app.state.settings
    detector_uri = require_setting("DETECTOR_URI", s.detector_uri)
    auth_uri = require_setting("AUTH_URI", s.auth_uri)

    client: httpx.AsyncClient = request.app.state.http

    # Best-effort usage check (fail open unless explicit free-tier block)
    try:
        usage_check_resp = await client.post(
            auth_uri.rstrip("/") + "/usage/check",
            headers={"Authorization": f"Bearer {user.token}"},
            timeout=10.0,
        )
        if usage_check_resp.status_code == 200:
            usage_data = usage_check_resp.json()
            if not usage_data.get("allowed", False):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail={
                        "error": "usage_limit_exceeded",
                        "message": "You've reached your free tier limit of 10 scans per month. Upgrade to premium for unlimited scans.",
                        "monthly_usage": usage_data.get("monthly_usage", 0),
                        "limit": usage_data.get("limit", 10),
                    },
                )
    except HTTPException:
        raise
    except Exception as exc:
        # Do not fail scans if usage service has transient issues.
        request.app.logger.warning("Usage check failed: %s", exc)

    data = await file.read()
    await sniff_and_validate_image(request, data)

    x_request_id = str(uuid.uuid4())
    url = detector_uri.rstrip("/") + "/v1.0.1/checks"
    headers = {
        "X-Request-Id": x_request_id,
        "X-User-Id": user.user_id,
        "Content-Type": "application/octet-stream",
    }

    try:
        resp = await client.post(url, content=data, headers=headers, timeout=60.0)
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

    detection_token = await create_detection_token(
        request=request,
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

    # Best-effort usage increment (do not fail successful scans)
    try:
        await client.post(
            auth_uri.rstrip("/") + "/usage/increment",
            headers={"Authorization": f"Bearer {user.token}"},
            timeout=10.0,
        )
    except Exception as exc:
        request.app.logger.warning("Usage increment failed: %s", exc)

    return JSONResponse(status_code=status.HTTP_200_OK, content=response_body)


@router.post("/v1/checks")
async def gateway_checks_v1(
    request: Request,
    file: UploadFile = File(...),
    user: UserContext = Depends(get_current_user_any),
):
    return await _checks_impl(request, file, user)


@router.post("/checks")
async def gateway_checks_legacy(
    request: Request,
    file: UploadFile = File(...),
    user: UserContext = Depends(get_current_user_any),
):
    return await _checks_impl(request, file, user)
