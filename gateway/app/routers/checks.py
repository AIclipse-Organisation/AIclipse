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
    except Exception:
        pass
    return resp.text or ""


async def _checks_impl(request: Request, file: UploadFile, user: UserContext) -> JSONResponse:
    s = request.app.state.settings
    detector_uri = require_setting("DETECTOR_URI", s.detector_uri)

    data = await file.read()
    await sniff_and_validate_image(request, data)

    x_request_id = str(uuid.uuid4())
    url = detector_uri.rstrip("/") + "/v1.0.1/checks"
    headers = {
        "X-Request-Id": x_request_id,
        "X-User-Id": user.user_id,
        "Content-Type": "application/octet-stream",
    }

    client: httpx.AsyncClient = request.app.state.http
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

    if verdict is None or label is None or confidence is None:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Detector response missing required fields")

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