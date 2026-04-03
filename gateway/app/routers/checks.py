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


def _detail_from_detector(resp: httpx.Response) -> str:
    try:
        j = resp.json()
        if isinstance(j, dict) and "detail" in j:
            return str(j["detail"])
    except (ValueError, TypeError, httpx.HTTPError):
        # Best-effort detail extraction only; fall back to raw response text on parse errors.
        pass
    return resp.text or ""


def _requires_usage_enforcement(user: UserContext) -> bool:
    return int(user.plan or 0) == 0


async def _require_scan_quota(
    *,
    request: Request,
    client: httpx.AsyncClient,
    auth_uri: str,
    user: UserContext,
) -> None:
    if not _requires_usage_enforcement(user):
        return

    try:
        usage_check_resp = await client.post(
            auth_uri.rstrip("/") + "/usage/check",
            headers={"Authorization": f"Bearer {user.token}"},
            timeout=10.0,
        )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Usage service unavailable: {exc}",
        )

    if usage_check_resp.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Usage service unavailable",
        )

    try:
        usage_data = usage_check_resp.json()
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Usage service returned invalid JSON",
        )

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


async def _record_scan_usage(
    *,
    client: httpx.AsyncClient,
    auth_uri: str,
    user: UserContext,
) -> None:
    if not _requires_usage_enforcement(user):
        return

    try:
        increment_resp = await client.post(
            auth_uri.rstrip("/") + "/usage/increment",
            headers={"Authorization": f"Bearer {user.token}"},
            timeout=10.0,
        )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Usage service unavailable: {exc}",
        )

    if increment_resp.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Usage service unavailable",
        )


async def _checks_impl(request: Request, file: UploadFile, user: UserContext) -> JSONResponse:
    s = request.app.state.settings
    detector_uri = require_setting("DETECTOR_URI", s.detector_uri)
    auth_uri = require_setting("AUTH_URI", s.auth_uri)

    client: httpx.AsyncClient = request.app.state.http

    await _require_scan_quota(
        request=request,
        client=client,
        auth_uri=auth_uri,
        user=user,
    )

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
    except httpx.TimeoutException:
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail="timeout")
    except httpx.RequestError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Detector unreachable: {exc}")

    if resp.status_code in (503, 504):
        # Forward busy/timeout as-is to client (client shows generic message)
        raise HTTPException(status_code=resp.status_code, detail=_detail_from_detector(resp))

    if 400 <= resp.status_code < 500:
        raise HTTPException(status_code=resp.status_code, detail=_detail_from_detector(resp))

    if resp.status_code >= 500:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Detector service error")

    try:
        detector_payload = resp.json()
    except ValueError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Detector returned invalid JSON")

    verdict = detector_payload.get("verdict")
    label = detector_payload.get("label")
    confidence = detector_payload.get("confidence")
    model_version = detector_payload.get("model_version")

    if verdict is None or label is None or confidence is None or model_version is None:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Detector response missing required fields")

    detection_token = await create_detection_token(
        request=request,
        user=user,
        image_bytes=data,
        verdict=str(verdict),
        label=str(label),
        confidence=float(confidence),
        model_version=str(model_version),
    )

    response_body = {
        "verdict": verdict,
        "label": label,
        "confidence": confidence,
        "model_version": model_version,
        "detection_token": detection_token,
    }

    await _record_scan_usage(
        client=client,
        auth_uri=auth_uri,
        user=user,
    )

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
