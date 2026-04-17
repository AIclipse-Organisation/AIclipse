from datetime import datetime, timezone

import bcrypt
import pytest


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _bcrypt_hash(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


@pytest.mark.asyncio
async def test_internal_users_accuracy_requires_internal_token(client):
    r = await client.post("/internal/users/accuracy", json={"user_ids": ["u1"]})
    assert r.status_code == 403
    assert r.json()["detail"] == "Forbidden"


@pytest.mark.asyncio
async def test_internal_users_accuracy_returns_requested_accuracy_fields(client, users_coll, auth_mod):
    await users_coll.insert_one(
        {
            "user_id": "u_accuracy",
            "user_name": "Accuracy User",
            "email": "accuracy@example.com",
            "password": _bcrypt_hash("x"),
            "is_admin": True,
            "plan": 0,
            "created_at": _now_utc(),
            "date_of_birth": None,
            "admin_fake_correct": 2,
            "admin_fake_total": 3,
            "admin_real_correct": 4,
            "admin_real_total": 5,
        }
    )

    r = await client.post(
        "/internal/users/accuracy",
        json={"user_ids": ["u_accuracy"]},
        headers={"X-Internal-Token": auth_mod._test_settings.INTERNAL_AUTH_TOKEN},
    )

    assert r.status_code == 200
    assert r.json() == [
        {
            "user_id": "u_accuracy",
            "admin_fake_correct": 2,
            "admin_fake_total": 3,
            "admin_real_correct": 4,
            "admin_real_total": 5,
        }
    ]
