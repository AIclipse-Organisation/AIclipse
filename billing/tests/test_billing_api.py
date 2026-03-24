def test_healthz_ok(client, state):
    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_config_returns_publishable_key(client, state):
    response = client.get("/config")

    assert response.status_code == 200
    assert response.json() == {"publishable_key": "pk_test"}


def test_subscription_status_returns_default_when_no_billing_doc(client, state):
    state["users_coll"].find_one.return_value = {"plan": 1, "stripe_customer_id": "cus_123"}
    state["billing_coll"].find_one.return_value = None

    response = client.get("/subscription/status", params={"user_id": "user_1"})

    assert response.status_code == 200
    assert response.json() == {
        "user_id": "user_1",
        "plan": 1,
        "status": "none",
        "cancel_at_period_end": False,
        "billing_period_end": None,
        "stripe_subscription_id": None,
        "stripe_customer_id": "cus_123",
        "cancellation_reason": None,
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
    monkeypatch.setattr(billing_module, "users_coll", None, raising=False)

    payload = {"user_id": "user_1", "plan_id": 1, "email": "alice@example.com"}
    response = client.post("/create-checkout-session", json=payload)

    assert response.status_code == 503
    assert response.json()["detail"] == "Database not available"


def test_cancel_subscription_schedules_period_end_and_records_reason(client, state):
    state["users_coll"].find_one.return_value = {"plan": 2}
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


def test_webhook_missing_secret_returns_500(client, state, monkeypatch, billing_module):
    monkeypatch.setattr(billing_module, "STRIPE_WEBHOOK_SECRET", None, raising=False)

    response = client.post("/webhook", data="{}", headers={"stripe-signature": "sig"})

    assert response.status_code == 500
    assert response.json()["detail"] == "Webhook secret not configured"


def test_webhook_db_unavailable_returns_status(client, state, monkeypatch, billing_module):
    monkeypatch.setattr(billing_module, "users_coll", None, raising=False)
    state["webhook_construct"].return_value = {"id": "evt_1", "type": "checkout.session.completed", "data": {"object": {}}}

    response = client.post("/webhook", data="{}", headers={"stripe-signature": "sig"})

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
    state["webhook_construct"].return_value = event

    response = client.post("/webhook", data="{}", headers={"stripe-signature": "sig"})

    assert response.status_code == 200
    assert response.json() == {"status": "success"}
    state["users_coll"].update_one.assert_called_once()
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
    state["webhook_construct"].return_value = event

    response = client.post("/webhook", data="{}", headers={"stripe-signature": "sig"})

    assert response.status_code == 200
    assert response.json() == {"status": "ignored", "reason": "missing_user_id"}


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
    state["webhook_construct"].return_value = event

    response = client.post("/webhook", data="{}", headers={"stripe-signature": "sig"})

    assert response.status_code == 200
    assert response.json() == {"status": "success"}
    state["users_coll"].update_one.assert_called()
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
    state["webhook_construct"].return_value = event

    response = client.post("/webhook", data="{}", headers={"stripe-signature": "sig"})

    assert response.status_code == 200
    assert response.json() == {"status": "success"}
    state["billing_coll"].update_many.assert_called_once()


