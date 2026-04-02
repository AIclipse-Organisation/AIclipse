import uuid
from typing import Optional

import httpx
from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Path, Query, Request, UploadFile, status
from fastapi.responses import JSONResponse, Response

from app.core.image_safety import sniff_and_validate_image
from app.core.media_url import build_media_image_url
from app.core.tokens import validate_detection_token
from app.deps import get_current_user, get_current_user_or_internal
from app.models import UpdateImageRequest, UserContext

router = APIRouter()


def _media_admin_headers(user: UserContext) -> dict[str, str]:
    return {
        "X-Is-Admin": "true" if user.is_admin else "false",
    }


@router.post("/upload/image")
async def gateway_upload_image(
    request: Request,
    file: UploadFile = File(...),
    detection_token: str = Form(...),
    is_public: Optional[bool] = Form(False),
    user: UserContext = Depends(get_current_user),
):
    s = request.app.state.settings

    data = await file.read()
    normalized_ct, ext = await sniff_and_validate_image(request, data)

    payload = await validate_detection_token(
        request=request,
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

    if s.media_uri:
        url = s.media_uri.rstrip("/") + "/upload/image"
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

        client: httpx.AsyncClient = request.app.state.http
        try:
            resp = await client.post(url, files=files, headers=headers, timeout=20.0)
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


@router.get("/images")
async def gateway_get_my_images(
    request: Request,
    is_public: Optional[bool] = Query(None),
    user: UserContext = Depends(get_current_user),
):
    s = request.app.state.settings

    if s.media_uri:
        params = {"user_id": user.user_id}
        if is_public is not None:
            params["is_public"] = "true" if is_public else "false"

        url = s.media_uri.rstrip("/") + "/images"
        client: httpx.AsyncClient = request.app.state.http

        try:
            resp = await client.get(url, params=params, timeout=10.0)
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


@router.get("/image/{image_id}")
async def gateway_get_image(
    request: Request,
    image_id: str = Path(...),
    user: UserContext = Depends(get_current_user),
):
    s = request.app.state.settings

    if not s.media_uri:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    url = build_media_image_url(request, image_id)
    params = {"user_id": user.user_id}

    client: httpx.AsyncClient = request.app.state.http
    try:
        resp = await client.get(url, params=params, timeout=10.0)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    if resp.status_code == 200:
        return Response(
            content=resp.content,
            status_code=resp.status_code,
            media_type=resp.headers.get("content-type", "application/json"),
        )
    if resp.status_code == 404:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    raise HTTPException(status_code=resp.status_code, detail=f"Media service error: {resp.status_code}")


@router.patch("/image/{image_id}")
async def gateway_update_image(
    request: Request,
    image_id: str = Path(...),
    body: UpdateImageRequest = Body(...),
    user: UserContext = Depends(get_current_user_or_internal),
):
    s = request.app.state.settings

    if not s.media_uri:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    url = build_media_image_url(request, image_id)
    params = {"user_id": user.user_id}

    if body.is_public is not None:
        params["is_public"] = "true" if body.is_public else "false"

    headers = {
        "X-Request-Id": str(uuid.uuid4()),
        **_media_admin_headers(user),
    }

    client: httpx.AsyncClient = request.app.state.http
    try:
        resp = await client.patch(url, params=params, headers=headers, timeout=10.0)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Media service unreachable")

    if resp.status_code == 200:
        return Response(
            content=resp.content,
            status_code=resp.status_code,
            media_type=resp.headers.get("content-type", "application/json"),
        )
    if resp.status_code == 404:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    if resp.status_code == 403:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: You can only update your own images unless you are an admin",
        )

    raise HTTPException(status_code=resp.status_code, detail=f"Media service error: {resp.status_code}")


@router.get("/community/images")
async def gateway_get_community_images(request: Request):
    s = request.app.state.settings

    if s.media_uri:
        url = s.media_uri.rstrip("/") + "/images"
        params = {"is_public": "true"}

        client: httpx.AsyncClient = request.app.state.http
        try:
            resp = await client.get(url, params=params, timeout=10.0)
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


@router.delete("/image/{image_id}")
async def gateway_delete_image(
    request: Request,
    image_id: str = Path(...),
    user: UserContext = Depends(get_current_user_or_internal),
):
    s = request.app.state.settings

    if not s.media_uri:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    url = build_media_image_url(request, image_id)
    params = {"user_id": user.user_id}
    headers = {
        "X-Request-Id": str(uuid.uuid4()),
        **_media_admin_headers(user),
    }

    client: httpx.AsyncClient = request.app.state.http
    try:
        resp = await client.delete(url, params=params, headers=headers, timeout=10.0)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    if resp.status_code == 200:
        return Response(
            content=resp.content,
            status_code=resp.status_code,
            media_type=resp.headers.get("content-type", "application/json"),
        )
    if resp.status_code == 404:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    if resp.status_code == 403:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only delete your own images unless you are an admin",
        )

    raise HTTPException(status_code=resp.status_code, detail=f"Media service error: {resp.status_code}")
