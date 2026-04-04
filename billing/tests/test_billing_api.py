import json
from datetime import datetime, timezone

import pytest
from pymongo.errors import DuplicateKeyError


def _post_webhook(client, event):
    """Post a Stripe event as raw JSON; webhook handler parses it with json.loads."""
    return client.post(
        "/webhook",
        data=json.dumps(event),
        headers={"stripe-signature": "sig", "content-type": "application/json"},
    )


def test_healthz_ok(client, state):
    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_config_returns_publishable_key(client, state):
    response = client.get("/config")

    assert response.status_code == 200
    assert response.json() == {"publishable_key": "pk_test"}


def test_subscription_status_returns_default_when_no_billing_doc(client, state):
    state["auth_read"].return_value = {"user_id": "user_1", "plan": 1, "stripe_customer_id": "cus_123"}
    state["billing_coll"].find_one.return_value = None

    response = client.get("/subscription/status", params={"user_id": "user_1"})

    assert response.status_code == 200
    assert response.json() == {
        "user_id": "user_1",
        "plan": 1,
        "status": "none",
        "cancel_at_period_end": False,
        "billing_period_end": None,
    }


def test_subscription_status_returns_active_with_period_end(client, state):
    period_end = datetime(2026, 5, 24, 10, 0, tzinfo=timezone.utc)
    state["auth_read"].return_value = {"user_id": "user_1", "plan": 1, "stripe_customer_id": "cus_123"}
    state["billing_coll"].find_one.return_value = {
        "status": "active",
        "cancel_at_period_end": False,
        "billing_period_end": period_end,
        "stripe_subscription_id": "sub_123",
        "stripe_customer_id": "cus_123",
        "cancellation_reason": None,
    }

    response = client.get("/subscription/status", params={"user_id": "user_1"})

    assert response.status_code == 200
    assert response.json() == {
        "user_id": "user_1",
        "plan": 1,
        "status": "active",
        "cancel_at_period_end": False,
        "billing_period_end": period_end.isoformat(),
    }


def test_create_checkout_session_success(client, state):
    payload = {"user_id": "user_1", "plan_id": 1, "email": "alice@example.com"}

    response = client.post("/create-checkout-session", json=payload)

    assert response.status_code == 200
    assert response.json()["session_id"] == "cs_123"
    assert response.json()["checkout_url"] == "https://stripe.test/checkout"

    state["customer_create"].assert_called_once()
    state["checkout_create"].assert_called_once()


def test_create_checkout_session_invalid_plan(client, state):
    payload = {"user_id": "user_1", "plan_id": 99, "email": "alice@example.com"}

    response = client.post("/create-checkout-session", json=payload)

    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid plan ID"


def test_create_checkout_session_reuses_existing_customer(client, state):
    state["plan_coll"].find_one.return_value = {"stripe_customer_id": "cus_existing"}

    payload = {"user_id": "user_1", "plan_id": 2, "email": "alice@example.com"}
    response = client.post("/create-checkout-session", json=payload)

    assert response.status_code == 200
    state["customer_modify"].assert_called_once()
    state["customer_create"].assert_not_called()


def test_create_checkout_session_stripe_not_configured(client, state, monkeypatch, billing_module):
    monkeypatch.setattr(billing_module, "STRIPE_SECRET_KEY", None, raising=False)

    payload = {"user_id": "user_1", "plan_id": 1, "email": "alice@example.com"}
    response = client.post("/create-checkout-session", json=payload)

    assert response.status_code == 503
    assert response.json()["detail"] == "Stripe not configured"


def test_create_checkout_session_db_unavailable(client, state, monkeypatch, billing_module):
    monkeypatch.setattr(billing_module, "plan_coll", None, raising=False)

    payload = {"user_id": "user_1", "plan_id": 1, "email": "alice@example.com"}
    response = client.post("/create-checkout-session", json=payload)

    assert response.status_code == 503
    assert response.json()["detail"] == "Database not available"


def test_cancel_subscription_schedules_period_end_and_records_reason(client, state):
    state["auth_read"].return_value = {"user_id": "user_1", "plan": 2}
    state["billing_coll"].find_one.return_value = {
        "user_id": "user_1",
        "plan": 2,
        "status": "active",
        "stripe_subscription_id": "sub_123",
        "stripe_customer_id": "cus_123",
        "billing_period_start": None,
        "billing_period_end": None,
        "amount_paid": "19.99",
    }

    response = client.post(
        "/subscription/cancel-at-period-end",
        json={"user_id": "user_1", "reason": "Too expensive"},
    )

    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert response.json()["status"] == "cancel_scheduled"
    assert response.json()["plan_active_until"] is not None
    state["subscription_modify"].assert_called_once()
    state["billing_coll"].update_many.assert_called_once()
    state["plan_coll"].insert_one.assert_called()
    state["billing_coll"].insert_one.assert_called()


def test_cancel_subscription_requires_reason(client, state):
    response = client.post(
        "/subscription/cancel-at-period-end",
        json={"user_id": "user_1", "reason": "   "},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Cancellation reason is required"


def test_cancel_subscription_requires_paid_plan(client, state):
    state["auth_read"].return_value = {"user_id": "user_1", "plan": 0}

    response = client.post(
        "/subscription/cancel-at-period-end",
        json={"user_id": "user_1", "reason": "Too expensive"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "No active paid subscription"


def test_cancel_subscription_returns_404_when_no_active_subscription_record(client, state):
    state["auth_read"].return_value = {"user_id": "user_1", "plan": 2}
    state["billing_coll"].find_one.return_value = None

    response = client.post(
        "/subscription/cancel-at-period-end",
        json={"user_id": "user_1", "reason": "Too expensive"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "No active subscription found"


def test_cancel_subscription_returns_404_when_subscription_id_missing(client, state):
    state["auth_read"].return_value = {"user_id": "user_1", "plan": 2}
    state["billing_coll"].find_one.return_value = {
        "user_id": "user_1",
        "plan": 2,
        "status": "active",
        "stripe_customer_id": "cus_123",
        "stripe_subscription_id": None,
    }

    response = client.post(
        "/subscription/cancel-at-period-end",
        json={"user_id": "user_1", "reason": "Too expensive"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "No active subscription found"


def test_cancel_subscription_uses_existing_period_end_when_stripe_period_missing(client, state):
    existing_period_end = datetime(2026, 6, 10, 12, 0, tzinfo=timezone.utc)
    state["auth_read"].return_value = {"user_id": "user_1", "plan": 2}
    state["billing_coll"].find_one.return_value = {
        "user_id": "user_1",
        "plan": 2,
        "status": "active",
        "stripe_subscription_id": "sub_123",
        "stripe_customer_id": "cus_123",
        "billing_period_start": datetime(2026, 5, 10, 12, 0, tzinfo=timezone.utc),
        "billing_period_end": existing_period_end,
        "amount_paid": "19.99",
    }
    state["subscription_modify"].return_value = type("Obj", (), {"id": "sub_123", "current_period_end": None})()

    response = client.post(
        "/subscription/cancel-at-period-end",
        json={"user_id": "user_1", "reason": "Other"},
    )

    assert response.status_code == 200
    assert response.json()["plan_active_until"] == existing_period_end.isoformat()


def test_cancel_subscription_is_idempotent_when_already_scheduled(client, state):
    existing_period_end = datetime(2026, 6, 10, 12, 0, tzinfo=timezone.utc)
    state["auth_read"].return_value = {"user_id": "user_1", "plan": 2}
    state["billing_coll"].find_one.return_value = {
        "user_id": "user_1",
        "plan": 2,
        "status": "cancel_scheduled",
        "cancel_at_period_end": True,
        "stripe_subscription_id": "sub_123",
        "stripe_customer_id": "cus_123",
        "billing_period_end": existing_period_end,
    }

    response = client.post(
        "/subscription/cancel-at-period-end",
        json={"user_id": "user_1", "reason": "Too expensive"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "status": "cancel_scheduled",
        "message": "Subscription cancellation already scheduled",
        "plan_active_until": existing_period_end.isoformat(),
    }
    state["subscription_modify"].assert_not_called()
    state["billing_coll"].update_many.assert_not_called()
    state["plan_coll"].insert_one.assert_not_called()
    state["billing_coll"].insert_one.assert_not_called()


def test_webhook_missing_secret_returns_500(client, state, monkeypatch, billing_module):
    monkeypatch.setattr(billing_module, "STRIPE_WEBHOOK_SECRET", None, raising=False)

    response = client.post("/webhook", data="{}", headers={"stripe-signature": "sig"})

    assert response.status_code == 500
    assert response.json()["detail"] == "Webhook secret not configured"


def test_webhook_db_unavailable_returns_status(client, state, monkeypatch, billing_module):
    monkeypatch.setattr(billing_module, "plan_coll", None, raising=False)

    response = _post_webhook(client, {
        "id": "evt_1",
        "type": "checkout.session.completed",
        "data": {"object": {}},
    })

    assert response.status_code == 200
    assert response.json() == {"status": "db unavailable"}


def test_webhook_checkout_completed_success(client, state):
    event = {
        "id": "evt_checkout_1",
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "id": "cs_123",
                "customer": "cus_123",
                "metadata": {
                    "user_id": "user_1",
                    "plan_id": "2",
                    "amount_paid": "19.99",
                    "stripe_customer_id": "cus_123",
                },
            }
        },
    }

    response = _post_webhook(client, event)

    assert response.status_code == 200
    assert response.json() == {"status": "success"}
    state["auth_update"].assert_called_once()
    state["plan_coll"].insert_one.assert_called_once()
    state["billing_coll"].insert_one.assert_called_once()


def test_webhook_checkout_completed_missing_user_id_ignored(client, state):
    event = {
        "id": "evt_checkout_1",
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "id": "cs_123",
                "customer": "cus_123",
                "metadata": {
                    "plan_id": "2",
                    "amount_paid": "19.99",
                },
            }
        },
    }

    response = _post_webhook(client, event)

    assert response.status_code == 200
    assert response.json() == {"status": "ignored", "reason": "missing_user_id"}
    state["auth_update"].assert_not_called()


def test_webhook_subscription_deleted_cancels_plan(client, state):
    state["billing_coll"].find_one.return_value = {
        "user_id": "user_1",
        "plan": 2,
        "status": "cancel_scheduled",
        "stripe_subscription_id": "sub_123",
        "stripe_customer_id": "cus_123",
    }

    event = {
        "id": "evt_sub_deleted_1",
        "type": "customer.subscription.deleted",
        "data": {"object": {"id": "sub_123", "customer": "cus_123", "current_period_end": 1_900_000_000}},
    }

    response = _post_webhook(client, event)

    assert response.status_code == 200
    assert response.json() == {"status": "success"}
    state["auth_update"].assert_called()
    state["billing_coll"].update_many.assert_called()
    state["billing_coll"].insert_one.assert_called()


def test_webhook_subscription_updated_marks_cancel_scheduled(client, state):
    event = {
        "id": "evt_sub_updated_1",
        "type": "customer.subscription.updated",
        "data": {
            "object": {
                "id": "sub_123",
                "customer": "cus_123",
                "cancel_at_period_end": True,
                "current_period_end": 1_900_000_000,
            }
        },
    }

    response = _post_webhook(client, event)

    assert response.status_code == 200
    assert response.json() == {"status": "success"}
    state["billing_coll"].update_many.assert_called_once()


def test_webhook_subscription_updated_reactivates_subscription(client, state):
    event = {
        "id": "evt_sub_updated_2",
        "type": "customer.subscription.updated",
        "data": {
            "object": {
                "id": "sub_123",
                "customer": "cus_123",
                "cancel_at_period_end": False,
                "current_period_end": 1_900_000_000,
            }
        },
    }

    response = _post_webhook(client, event)

    assert response.status_code == 200
    assert response.json() == {"status": "success"}
    state["billing_coll"].update_many.assert_called_once()
    update_doc = state["billing_coll"].update_many.call_args[0][1]
    assert update_doc["$set"]["status"] == "active"


def test_webhook_subscription_deleted_falls_back_to_plan_record(client, state):
    state["billing_coll"].find_one.return_value = None
    state["plan_coll"].find_one.return_value = {"user_id": "user_2"}
    state["auth_read"].return_value = {"user_id": "user_2", "plan": 1}

    event = {
        "id": "evt_sub_deleted_2",
        "type": "customer.subscription.deleted",
        "data": {"object": {"id": "sub_abc", "customer": "cus_abc", "current_period_end": 1_900_000_000}},
    }

    response = _post_webhook(client, event)

    assert response.status_code == 200
    assert response.json() == {"status": "success"}
    state["auth_update"].assert_called()
    state["plan_coll"].insert_one.assert_called()
    state["billing_coll"].insert_one.assert_called()


# -------------------------
# Webhook atomicity / idempotency regression tests
#
# Stripe retries webhook delivery on failure. The handler must be safe to
# replay — the same event_id must not create duplicate audit rows, and
# forward progress must happen on each retry even when an earlier attempt
# crashed mid-flow.
# -------------------------


def test_webhook_checkout_duplicate_event_skipped_via_unique_index(client, state):
    """Retry of same event_id: plan_coll insert raises DuplicateKeyError;
    auth and billing steps still run (idempotent) and return success."""
    state["plan_coll"].insert_one.side_effect = DuplicateKeyError("stripe_event_id dup")

    event = {
        "id": "evt_dup_checkout",
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "id": "cs_123",
                "customer": "cus_123",
                "metadata": {
                    "user_id": "user_1",
                    "plan_id": "2",
                    "amount_paid": "19.99",
                    "stripe_customer_id": "cus_123",
                },
            }
        },
    }

    response = _post_webhook(client, event)

    assert response.status_code == 200
    assert response.json() == {"status": "success"}
    state["plan_coll"].insert_one.assert_called_once()
    # Auth update is idempotent and must still be called on retry.
    state["auth_update"].assert_called_once()
    # Billing audit insert still runs (not a duplicate on its own).
    state["billing_coll"].insert_one.assert_called_once()


def test_webhook_checkout_billing_duplicate_skipped(client, state):
    """Retry after billing_coll insert previously succeeded: second insert
    raises DuplicateKeyError but webhook still returns success."""
    state["billing_coll"].insert_one.side_effect = DuplicateKeyError("stripe_event_id dup")

    event = {
        "id": "evt_dup_bill",
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "id": "cs_123",
                "customer": "cus_123",
                "metadata": {
                    "user_id": "user_1",
                    "plan_id": "2",
                    "amount_paid": "19.99",
                    "stripe_customer_id": "cus_123",
                },
            }
        },
    }

    response = _post_webhook(client, event)

    assert response.status_code == 200
    assert response.json() == {"status": "success"}
    state["billing_coll"].insert_one.assert_called_once()


def test_webhook_checkout_audit_captures_original_plan_before_auth_update(client, state):
    """Original plan must be read before auth is mutated — otherwise a retry
    after auth update would record original_plan == new_plan."""
    state["auth_read"].return_value = {"user_id": "user_1", "plan": 0, "stripe_customer_id": "cus_123"}

    event = {
        "id": "evt_order_1",
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "id": "cs_123",
                "customer": "cus_123",
                "metadata": {
                    "user_id": "user_1",
                    "plan_id": "2",
                    "amount_paid": "19.99",
                    "stripe_customer_id": "cus_123",
                },
            }
        },
    }

    response = _post_webhook(client, event)

    assert response.status_code == 200
    audit_doc = state["plan_coll"].insert_one.call_args[0][0]
    assert audit_doc["original_plan"] == 0
    assert audit_doc["new_plan"] == 2
    assert audit_doc["stripe_event_id"] == "evt_order_1"


def test_webhook_checkout_auth_failure_bubbles_so_stripe_retries(client, state):
    """If auth update fails, webhook must raise (Starlette → 500) so Stripe
    retries. Silencing the error would leave the system inconsistent: user
    appears successful but plan is not updated."""
    state["auth_update"].side_effect = RuntimeError("auth service down")

    event = {
        "id": "evt_auth_fail",
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "id": "cs_123",
                "customer": "cus_123",
                "metadata": {
                    "user_id": "user_1",
                    "plan_id": "2",
                    "amount_paid": "19.99",
                    "stripe_customer_id": "cus_123",
                },
            }
        },
    }

    with pytest.raises(RuntimeError, match="auth service down"):
        _post_webhook(client, event)

    # Audit was attempted before auth update.
    state["plan_coll"].insert_one.assert_called_once()
    # Billing audit never ran (auth failure short-circuited the flow).
    state["billing_coll"].insert_one.assert_not_called()


def test_webhook_subscription_deleted_includes_event_id_for_idempotency(client, state):
    """subscription.deleted's billing insert must carry stripe_event_id so
    the unique index protects against duplicate inserts on retry."""
    state["billing_coll"].find_one.return_value = {
        "user_id": "user_1",
        "plan": 2,
        "status": "cancel_scheduled",
        "stripe_subscription_id": "sub_123",
        "stripe_customer_id": "cus_123",
    }

    event = {
        "id": "evt_deleted_id",
        "type": "customer.subscription.deleted",
        "data": {"object": {"id": "sub_123", "customer": "cus_123", "current_period_end": 1_900_000_000}},
    }

    response = _post_webhook(client, event)

    assert response.status_code == 200
    billing_doc = state["billing_coll"].insert_one.call_args[0][0]
    assert billing_doc["stripe_event_id"] == "evt_deleted_id"


def test_webhook_subscription_deleted_duplicate_plan_insert_skipped(client, state):
    """Retry of subscription.deleted: plan_coll insert raises DuplicateKeyError
    but downstream cancellation still completes."""
    state["billing_coll"].find_one.return_value = {
        "user_id": "user_1",
        "plan": 2,
        "status": "cancel_scheduled",
        "stripe_subscription_id": "sub_123",
        "stripe_customer_id": "cus_123",
    }
    state["plan_coll"].insert_one.side_effect = DuplicateKeyError("stripe_event_id dup")

    event = {
        "id": "evt_dup_deleted",
        "type": "customer.subscription.deleted",
        "data": {"object": {"id": "sub_123", "customer": "cus_123", "current_period_end": 1_900_000_000}},
    }

    response = _post_webhook(client, event)

    assert response.status_code == 200
    assert response.json() == {"status": "success"}
    state["auth_update"].assert_called_once()
    state["billing_coll"].update_many.assert_called_once()
    state["billing_coll"].insert_one.assert_called_once()
