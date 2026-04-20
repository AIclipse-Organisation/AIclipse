from __future__ import annotations

from flask import Blueprint, jsonify, render_template

from routes.common import (
    RouteDeps,
    call_gateway_json_or_error,
    get_required_token,
    parse_json_body_or_400,
)


def _parse_plan_id(raw_plan_id) -> int | None:
    try:
        plan_id = int(raw_plan_id)
    except Exception:
        return None

    return plan_id if plan_id in (1, 2) else None


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

        payload, body_error = parse_json_body_or_400()
        if body_error:
            return body_error

        plan_id = _parse_plan_id(payload.get("plan_id"))
        if plan_id is None:
            return jsonify({"detail": "Invalid plan_id"}), 400

        response, gateway_error = call_gateway_json_or_error(
            deps=deps,
            method="POST",
            path="/billing/create-checkout-session",
            token=token,
            json_data={"plan_id": plan_id},
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

        response, gateway_error = call_gateway_json_or_error(
            deps=deps,
            method="GET",
            path="/billing/subscription/status",
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

        payload, body_error = parse_json_body_or_400()
        if body_error:
            return body_error

        reason = payload.get("reason")
        if not isinstance(reason, str) or not reason.strip():
            return jsonify({"detail": "Cancellation reason is required"}), 400

        response, gateway_error = call_gateway_json_or_error(
            deps=deps,
            method="POST",
            path="/billing/subscription/cancel-at-period-end",
            token=token,
            json_data={"reason": reason.strip()},
        )
        if gateway_error:
            return gateway_error

        data, status = response
        return jsonify(data), status

    return bp
