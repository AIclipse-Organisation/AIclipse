from fastapi import APIRouter, Body, Depends, Request

from app.core.external_request import build_external_proto_headers
from app.core.http_proxy import proxy_json, proxy_raw
from app.core.settings import require_setting
from app.deps import get_current_user
from app.models import UserContext

router = APIRouter()


def _billing_base_url(request: Request) -> str:
    s = request.app.state.settings
    return require_setting("BILLING_URI", s.billing_uri)


def _timeout(request: Request) -> float:
    return float(request.app.state.settings.http_timeout_s)


def _billing_internal_headers(request: Request, user: UserContext) -> dict[str, str]:
    internal_token = require_setting(
        "INTERNAL_AUTH_TOKEN",
        request.app.state.settings.internal_auth_token,
    )
    headers = {
        "X-Internal-Token": internal_token,
        "X-User-Id": user.user_id,
        "X-User-Is-Admin": "true" if user.is_admin else "false",
        **build_external_proto_headers(request),
    }
    if user.email:
        headers["X-User-Email"] = user.email
    if user.user_name:
        headers["X-User-Name"] = user.user_name
    return headers


@router.post("/billing/create-checkout-session")
async def billing_create_checkout_session(
    request: Request,
    payload: dict = Body(...),
    user: UserContext = Depends(get_current_user),
):
    billing_uri = _billing_base_url(request)
    return await proxy_json(
        request,
        "POST",
        billing_uri,
        "/create-checkout-session",
        json_body={"plan_id": payload.get("plan_id")},
        headers=_billing_internal_headers(request, user),
        timeout_s=_timeout(request),
    )


@router.get("/billing/config")
async def api_billing_config(request: Request):
    billing_uri = _billing_base_url(request)
    return await proxy_json(
        request,
        "GET",
        billing_uri,
        "/config",
        timeout_s=_timeout(request),
    )


@router.get("/billing/subscription/status")
async def api_billing_subscription_status(
    request: Request,
    user: UserContext = Depends(get_current_user),
):
    billing_uri = _billing_base_url(request)
    return await proxy_json(
        request,
        "GET",
        billing_uri,
        "/subscription/status",
        headers=_billing_internal_headers(request, user),
        timeout_s=_timeout(request),
    )


@router.post("/billing/subscription/cancel-at-period-end")
async def api_billing_cancel_at_period_end(
    request: Request,
    payload: dict = Body(...),
    user: UserContext = Depends(get_current_user),
):
    billing_uri = _billing_base_url(request)
    return await proxy_json(
        request,
        "POST",
        billing_uri,
        "/subscription/cancel-at-period-end",
        json_body={"reason": payload.get("reason")},
        headers=_billing_internal_headers(request, user),
        timeout_s=_timeout(request),
    )


@router.post("/billing/webhook")
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

