import httpx
import logging
import anyio
from fastapi import APIRouter, Depends, HTTPException, Request, status, Response

from app.core.settings import require_setting
from app.deps import get_current_admin 
from app.models import UserContext

router = APIRouter()

def get_cycle_url(request: Request) -> str:
    s = request.app.state.settings
    return require_setting("MODEL_CYCLE_URI", s.model_cycle_uri)

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
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=f"Model Cycle unreachable: {exc}")

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
# 4. UPLOAD NEW MODEL
# ---------------------------------------------------------
async def async_file_generator(file_obj, chunk_size=65536):
    while True:
        # We wrap the synchronous read in a thread to keep the event loop free
        chunk = await anyio.to_thread.run_sync(file_obj.read, chunk_size)
        if not chunk:
            break
        yield chunk

@router.post("/models/upload")
async def gateway_upload_model(
    request: Request,
    user: UserContext = Depends(get_current_admin),
):
    """
    Acts as a pure proxy stream. We don't parse the form here (which avoids the 
    RuntimeError); we just forward the raw bytes to the Model Cycle service.
    """
    base_url = get_cycle_url(request)
    url = f"{base_url}/api/models/upload"
    
    # 1. Grab the headers from the incoming request to preserve the boundary
    headers = {
        "Content-Type": request.headers.get("Content-Type"),
        "Authorization": request.headers.get("Authorization"),
    }
    
    # 2. Use a stream to pipe the request body directly
    client: httpx.AsyncClient = request.app.state.http
    
    try:
        # We pass request.stream() directly as the content
        # This is the most efficient 'Zero-RAM' way to proxy in FastAPI/httpx
        resp = await client.post(
            url,
            content=request.stream(),
            headers=headers,
            timeout=600.0
        )
        resp.raise_for_status()

    except httpx.HTTPStatusError as exc:
        logging.error(f"Downstream Error: {exc.response.text}")
        return Response(
            content=exc.response.content,
            status_code=exc.response.status_code,
            media_type="application/json"
        )
    except Exception as exc:
        logging.error(f"🔥 Gateway Proxy Failure: {str(exc)}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, 
            detail=f"Downstream pipe failed: {str(exc)}"
        )

    return Response(
        content=resp.content,
        status_code=resp.status_code,
        media_type=resp.headers.get("content-type", "application/json"),
    )

# ---------------------------------------------------------
# 5. LIST ALL MODELS
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
# 6. DELETE MODEL
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

# ---------------------------------------------------------
# 7. GET MODEL IMAGES
# ---------------------------------------------------------
@router.get("/models/images")
async def gateway_get_model_images(
    request: Request,
    version: str,
    user: UserContext = Depends(get_current_admin),
):
    base_url = get_cycle_url(request)
    url = f"{base_url}/api/models/images"
    
    client: httpx.AsyncClient = request.app.state.http
    try:
        resp = await client.get(url, timeout=10.0)
    except httpx.RequestError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail="Model Cycle unreachable")

    return Response(content=resp.content, status_code=resp.status_code, media_type="application/json")