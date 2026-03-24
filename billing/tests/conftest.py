import importlib.util
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="session")
def billing_module():
    module_path = Path(__file__).resolve().parents[1] / "main-billing.py"
    spec = importlib.util.spec_from_file_location("billing_main", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


@pytest.fixture()
def client(billing_module):
    return TestClient(billing_module.app)


@pytest.fixture()
def state(monkeypatch, billing_module):
    monkeypatch.setattr(billing_module, "STRIPE_SECRET_KEY", "sk_test", raising=False)
    monkeypatch.setattr(billing_module, "STRIPE_WEBHOOK_SECRET", "whsec_test", raising=False)
    monkeypatch.setattr(billing_module, "STRIPE_PUBLISHABLE_KEY", "pk_test", raising=False)
    monkeypatch.setattr(billing_module, "CLIENT_URL", "http://localhost:5000", raising=False)

    users_coll = Mock(name="users_coll")
    plan_coll = Mock(name="plan_coll")
    billing_coll = Mock(name="billing_coll")

    users_coll.find_one.return_value = {"plan": 0}
    users_coll.update_one.return_value = SimpleNamespace(matched_count=1, modified_count=1)

    plan_coll.find_one.return_value = None
    plan_coll.insert_one.return_value = SimpleNamespace(inserted_id="plan_1")

    billing_coll.insert_one.return_value = SimpleNamespace(inserted_id="bill_1")

    monkeypatch.setattr(billing_module, "users_coll", users_coll, raising=False)
    monkeypatch.setattr(billing_module, "plan_coll", plan_coll, raising=False)
    monkeypatch.setattr(billing_module, "billing_coll", billing_coll, raising=False)

    customer_create = Mock(return_value=SimpleNamespace(id="cus_123"))
    customer_modify = Mock(return_value=None)
    subscription_modify = Mock(return_value=SimpleNamespace(id="sub_123", current_period_end=1_900_000_000))
    checkout_create = Mock(return_value=SimpleNamespace(id="cs_123", url="https://stripe.test/checkout"))
    webhook_construct = Mock(return_value={"id": "evt_default", "type": "unknown", "data": {"object": {}}})

    monkeypatch.setattr(
        billing_module.stripe,
        "Customer",
        SimpleNamespace(create=customer_create, modify=customer_modify),
        raising=False,
    )
    monkeypatch.setattr(
        billing_module.stripe,
        "Subscription",
        SimpleNamespace(modify=subscription_modify),
        raising=False,
    )
    monkeypatch.setattr(
        billing_module.stripe,
        "checkout",
        SimpleNamespace(Session=SimpleNamespace(create=checkout_create)),
        raising=False,
    )
    monkeypatch.setattr(
        billing_module.stripe,
        "Webhook",
        SimpleNamespace(construct_event=webhook_construct),
        raising=False,
    )

    return {
        "users_coll": users_coll,
        "plan_coll": plan_coll,
        "billing_coll": billing_coll,
        "customer_create": customer_create,
        "customer_modify": customer_modify,
        "subscription_modify": subscription_modify,
        "checkout_create": checkout_create,
        "webhook_construct": webhook_construct,
    }
