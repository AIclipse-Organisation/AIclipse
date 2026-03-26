from fastapi import APIRouter, Body, Query, Request

from app.core.http_proxy import proxy_json, proxy_raw
from app.core.settings import require_setting

router = APIRouter()


def _billing_base_url(request: Request) -> str:
    s = request.app.state.settings
    return require_setting("BILLING_URI", s.billing_uri)


def _timeout(request: Request) -> float:
    return float(request.app.state.settings.http_timeout_s)


def _forward_billing_headers(request: Request) -> dict:
    headers: dict = {}
    auth = request.headers.get("authorization")
    if auth:
        headers["Authorization"] = auth
    return headers


@router.post("/billing/create-checkout-session")
async def billing_create_checkout_session(request: Request, payload: dict = Body(...)):
    billing_uri = _billing_base_url(request)
    return await proxy_json(
        request,
        "POST",
        billing_uri,
        "/create-checkout-session",
        json_body=payload,
        headers=_forward_billing_headers(request),
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
        headers=_forward_billing_headers(request),
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


@router.get("/api/billing/subscription/status")
async def api_billing_subscription_status(
    request: Request,
    user_id: str = Query(...),
):
    billing_uri = _billing_base_url(request)
    return await proxy_json(
        request,
        "GET",
        billing_uri,
        "/subscription/status",
        params={"user_id": user_id},
        headers=_forward_billing_headers(request),
        timeout_s=_timeout(request),
    )


@router.post("/api/billing/subscription/cancel-at-period-end")
async def api_billing_cancel_at_period_end(request: Request, payload: dict = Body(...)):
    billing_uri = _billing_base_url(request)
    return await proxy_json(
        request,
        "POST",
        billing_uri,
        "/subscription/cancel-at-period-end",
        json_body=payload,
        headers=_forward_billing_headers(request),
        timeout_s=_timeout(request),
    )


@router.post("/api/billing/webhook")
async def api_billing_stripe_webhook(request: Request):
    """Forward Stripe webhook events to the billing service with raw bytes intact.

    The Stripe-Signature header must be preserved so the billing service can
    verify the payload signature.  Using proxy_raw (not proxy_json) ensures
    the body is never re-serialised, which would invalidate the HMAC.
    """
    billing_uri = _billing_base_url(request)
    return await proxy_raw(
        request,
        "POST",
        billing_uri,
        "/webhook",
        forward_headers=["stripe-signature", "content-type"],
        timeout_s=_timeout(request),
    )

