from __future__ import annotations

from flask import Blueprint, jsonify, render_template, request

from routes.common import (
    RouteDeps,
    call_gateway_json_or_error,
    get_required_token,
    resolve_billing_user_or_error,
)
from services.plan.subscription import (
    build_cancel_subscription_payload,
    build_checkout_payload,
    build_subscription_status_path,
    parse_plan_id,
)


def build_plan_blueprint(*, deps: RouteDeps):
    bp = Blueprint("plan", __name__)

    @bp.get("/plan")
    def plan():
        return render_template("pages/plan/plan.html")

    @bp.post("/usage/check")
    def usage_check():
        token, auth_error = get_required_token()
        if auth_error:
            return auth_error

        response, gateway_error = call_gateway_json_or_error(
            deps=deps,
            method="POST",
            path="/usage/check",
            token=token,
        )
        if gateway_error:
            return gateway_error

        data, status = response
        return jsonify(data), status

    @bp.post("/billing/create-checkout-session")
    def billing_create_checkout_session():
        token, auth_error = get_required_token()
        if auth_error:
            return auth_error

        payload = request.get_json(force=True, silent=True) or {}
        plan_id = parse_plan_id(payload.get("plan_id"))
        if plan_id is None:
            return jsonify({"detail": "Invalid plan_id"}), 400

        user, user_error = resolve_billing_user_or_error(deps=deps, token=token)
        if user_error:
            return user_error

        checkout_payload = build_checkout_payload(user=user, plan_id=plan_id)
        if not checkout_payload:
            return jsonify({"detail": "Missing user info for billing"}), 502

        response, gateway_error = call_gateway_json_or_error(
            deps=deps,
            method="POST",
            path="/billing/create-checkout-session",
            token=token,
            json_data=checkout_payload,
        )
        if gateway_error:
            return gateway_error

        data, status = response
        return jsonify(data), status

    @bp.get("/billing/subscription/status")
    def billing_subscription_status():
        token, auth_error = get_required_token()
        if auth_error:
            return auth_error

        user, user_error = resolve_billing_user_or_error(deps=deps, token=token)
        if user_error:
            return user_error

        user_id = user.get("user_id")
        if not user_id:
            return jsonify({"detail": "Missing user info for billing"}), 502

        response, gateway_error = call_gateway_json_or_error(
            deps=deps,
            method="GET",
            path=build_subscription_status_path(user_id=str(user_id)),
            token=token,
        )
        if gateway_error:
            return gateway_error

        data, status = response
        return jsonify(data), status

    @bp.post("/billing/subscription/cancel-at-period-end")
    def billing_cancel_subscription_at_period_end():
        token, auth_error = get_required_token()
        if auth_error:
            return auth_error

        payload = request.get_json(force=True, silent=True) or {}
        reason = payload.get("reason")
        if not isinstance(reason, str) or not reason.strip():
            return jsonify({"detail": "Cancellation reason is required"}), 400

        user, user_error = resolve_billing_user_or_error(deps=deps, token=token)
        if user_error:
            return user_error

        user_id = user.get("user_id")
        if not user_id:
            return jsonify({"detail": "Missing user info for billing"}), 502

        response, gateway_error = call_gateway_json_or_error(
            deps=deps,
            method="POST",
            path="/api/billing/subscription/cancel-at-period-end",
            token=token,
            json_data=build_cancel_subscription_payload(user_id=str(user_id), reason=reason),
        )
        if gateway_error:
            return gateway_error

        data, status = response
        return jsonify(data), status

    return bp
