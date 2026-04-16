import httpx
import logging
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from app.core.settings import require_setting
from app.deps import get_current_admin 
from app.models import UserContext

router = APIRouter()

def get_cycle_url(request: Request) -> str:
    s = request.app.state.settings
    return require_setting("MODEL_CYCLE_URI", s.model_cycle_uri)


async def proxy_cycle_json_post(
    request: Request,
    *,
    path: str,
    timeout: float = 30.0,
) -> Response:
    base_url = get_cycle_url(request)
    url = f"{base_url}{path}"
    client: httpx.AsyncClient = request.app.state.http
    body = await request.body()
    headers = {
        "Content-Type": request.headers.get("Content-Type", "application/json"),
    }

    try:
        resp = await client.post(url, content=body, headers=headers, timeout=timeout)
    except httpx.RequestError as exc:
        logging.error("Model Cycle connection failed: %s", exc)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail="Model Cycle unreachable")

    return Response(
        content=resp.content,
        status_code=resp.status_code,
        media_type=resp.headers.get("content-type", "application/json"),
    )

# ---------------------------------------------------------
# 1. TRIGGER TRAINING
# ---------------------------------------------------------
@router.post("/models/train")
async def gateway_trigger_training(
    request: Request,
    user: UserContext = Depends(get_current_admin), 
):
    base_url = get_cycle_url(request)
    url = f"{base_url}/api/models/train"
    
    client: httpx.AsyncClient = request.app.state.http
    
    try:
        resp = await client.post(url, timeout=10.0)
    except httpx.RequestError as exc:
        logging.error("Model Cycle connection failed: %s", exc)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail="Model Cycle unreachable")

    return Response(
        content=resp.content,
        status_code=resp.status_code,
        media_type=resp.headers.get("content-type", "application/json"),
    )

# ---------------------------------------------------------
# 2. GET CURRENT MODEL
# ---------------------------------------------------------
@router.get("/models/current")
async def gateway_get_current_model(
    request: Request,
    user: UserContext = Depends(get_current_admin),
):
    base_url = get_cycle_url(request)
    url = f"{base_url}/api/models/current"
    
    client: httpx.AsyncClient = request.app.state.http
    
    try:
        resp = await client.get(url, timeout=5.0)
    except httpx.RequestError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail="Model Cycle unreachable")

    if resp.status_code == 404:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No active model found")

    return Response(content=resp.content, status_code=resp.status_code, media_type="application/json")

# ---------------------------------------------------------
# 3. GET TRAINING IMAGES
# ---------------------------------------------------------
@router.get("/models/training-images")
async def gateway_get_training_images(
    request: Request,
    user: UserContext = Depends(get_current_admin),
):
    base_url = get_cycle_url(request)
    url = f"{base_url}/images" 
    
    client: httpx.AsyncClient = request.app.state.http
    try:
        resp = await client.get(url, timeout=10.0)
    except httpx.RequestError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail="Model Cycle unreachable")

    return Response(content=resp.content, status_code=resp.status_code, media_type="application/json")

# ---------------------------------------------------------
# 4. CREATE MODEL UPLOAD SESSION
# ---------------------------------------------------------
@router.post("/models/uploads")
async def gateway_create_model_upload(
    request: Request,
    user: UserContext = Depends(get_current_admin),
):
    return await proxy_cycle_json_post(request, path="/api/models/uploads")


# ---------------------------------------------------------
# 5. FINALIZE MODEL UPLOAD
# ---------------------------------------------------------
@router.post("/models/uploads/finalize")
async def gateway_finalize_model_upload(
    request: Request,
    user: UserContext = Depends(get_current_admin),
):
    return await proxy_cycle_json_post(request, path="/api/models/uploads/finalize")

# ---------------------------------------------------------
# 6. LIST ALL MODELS
# ---------------------------------------------------------
@router.get("/models")
async def gateway_list_models(
    request: Request,
    user: UserContext = Depends(get_current_admin),
):
    base_url = get_cycle_url(request)
    url = f"{base_url}/api/models"
    
    client: httpx.AsyncClient = request.app.state.http
    try:
        resp = await client.get(url, timeout=5.0)
    except httpx.RequestError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail="Model Cycle unreachable")

    return Response(content=resp.content, status_code=resp.status_code, media_type="application/json")

# ---------------------------------------------------------
# 7. DELETE MODEL
# ---------------------------------------------------------
@router.delete("/models/{version}")
async def gateway_delete_model(
    request: Request,
    version: str,
    user: UserContext = Depends(get_current_admin),
):
    base_url = get_cycle_url(request)
    url = f"{base_url}/api/models/{version}"
    
    client: httpx.AsyncClient = request.app.state.http
    try:
        resp = await client.delete(url, timeout=10.0)
    except httpx.RequestError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail="Model Cycle unreachable")

    return Response(content=resp.content, status_code=resp.status_code, media_type="application/json")

