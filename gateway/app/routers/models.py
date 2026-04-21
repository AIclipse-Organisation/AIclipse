from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.core.model_cycle_proxy import proxy_cycle_request
from app.deps import get_current_admin
from app.models import UserContext

router = APIRouter()

# ---------------------------------------------------------
# 1. TRIGGER TRAINING
# ---------------------------------------------------------
@router.post("/models/train")
async def gateway_trigger_training(
    request: Request,
    user: UserContext = Depends(get_current_admin), 
):
    return await proxy_cycle_request(
        request,
        method="POST",
        path="/api/models/train",
        timeout=10.0,
        user=user,
    )

# ---------------------------------------------------------
# 2. GET CURRENT MODEL
# ---------------------------------------------------------
@router.get("/models/current")
async def gateway_get_current_model(
    request: Request,
    user: UserContext = Depends(get_current_admin),
):
    resp = await proxy_cycle_request(
        request,
        method="GET",
        path="/api/models/current",
        timeout=5.0,
        user=user,
    )

    if resp.status_code == 404:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No active model found")

    return resp

# ---------------------------------------------------------
# 3. GET TRAINING IMAGES
# ---------------------------------------------------------
@router.get("/models/training-images")
async def gateway_get_training_images(
    request: Request,
    user: UserContext = Depends(get_current_admin),
):
    return await proxy_cycle_request(
        request,
        method="GET",
        path="/images",
        timeout=10.0,
        user=user,
    )

# ---------------------------------------------------------
# 4. CREATE MODEL UPLOAD SESSION
# ---------------------------------------------------------
@router.post("/models/uploads")
async def gateway_create_model_upload(
    request: Request,
    user: UserContext = Depends(get_current_admin),
):
    return await proxy_cycle_request(
        request,
        method="POST",
        path="/api/models/uploads",
        include_body=True,
        user=user,
    )


# ---------------------------------------------------------
# 5. FINALIZE MODEL UPLOAD
# ---------------------------------------------------------
@router.post("/models/uploads/finalize")
async def gateway_finalize_model_upload(
    request: Request,
    user: UserContext = Depends(get_current_admin),
):
    return await proxy_cycle_request(
        request,
        method="POST",
        path="/api/models/uploads/finalize",
        include_body=True,
        user=user,
    )

# ---------------------------------------------------------
# 6. LIST ALL MODELS
# ---------------------------------------------------------
@router.get("/models")
async def gateway_list_models(
    request: Request,
    user: UserContext = Depends(get_current_admin),
):
    return await proxy_cycle_request(
        request,
        method="GET",
        path="/api/models",
        timeout=5.0,
        user=user,
    )

# ---------------------------------------------------------
# 7. DELETE MODEL
# ---------------------------------------------------------
@router.delete("/models/{version}")
async def gateway_delete_model(
    request: Request,
    version: str,
    user: UserContext = Depends(get_current_admin),
):
    return await proxy_cycle_request(
        request,
        method="DELETE",
        path=f"/api/models/{version}",
        timeout=10.0,
        user=user,
    )

