from fastapi import APIRouter, Body, Depends, Request

from app.core.model_cycle_proxy import proxy_cycle_request
from app.deps import require_internal_request

router = APIRouter()


@router.post("/internal/model-cycle/imageconfidence/evaluate")
async def gateway_internal_model_cycle_evaluate(
    request: Request,
    payload: dict = Body(...),
    _trusted: bool = Depends(require_internal_request),
):
    del payload, _trusted
    return await proxy_cycle_request(
        request,
        method="POST",
        path="/api/imageconfidence/evaluate",
        include_body=True,
        timeout=10.0,
    )
