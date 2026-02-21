from fastapi import APIRouter, Body, Query, Request

from app.core.http_proxy import proxy_json
from app.core.settings import require_setting

router = APIRouter()


def _billing_base_url(request: Request) -> str:
    s = request.app.state.settings
    return require_setting("BILLING_URI", s.billing_uri)


def _timeout(request: Request) -> float:
    return float(request.app.state.settings.http_timeout_s)


@router.post("/billing/create-checkout-session")
async def billing_create_checkout_session(request: Request, payload: dict = Body(...)):
    billing_uri = _billing_base_url(request)
    return await proxy_json(
        request,
        "POST",
        billing_uri,
        "/create-checkout-session",
        json_body=payload,
        timeout_s=_timeout(request),
    )


@router.post("/api/billing/create-checkout-session")
async def api_billing_create_checkout_session(request: Request, payload: dict = Body(...)):
    billing_uri = _billing_base_url(request)
    return await proxy_json(
        request,
        "POST",
        billing_uri,
        "/create-checkout-session",
        json_body=payload,
        timeout_s=_timeout(request),
    )


@router.get("/api/billing/config")
async def api_billing_config(request: Request):
    billing_uri = _billing_base_url(request)
    return await proxy_json(
        request,
        "GET",
        billing_uri,
        "/config",
        timeout_s=_timeout(request),
    )


@router.post("/api/billing/admin/upgrade-plan")
async def api_billing_admin_upgrade_plan(
    request: Request,
    user_id: str = Query(...),
    plan_id: int = Query(...),
):
    billing_uri = _billing_base_url(request)
    return await proxy_json(
        request,
        "POST",
        billing_uri,
        f"/admin/upgrade-plan?user_id={user_id}&plan_id={plan_id}",
        timeout_s=_timeout(request),
    )
