from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
import pytest

from app.core.keys import KEY_ID


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _bcrypt_hash(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _make_token(auth_mod, user_id: str, email: str, is_admin: bool, plan: int = 0) -> str:
    now = _now_utc()
    payload = {
        "sub": user_id,
        "email": email,
        "user_name": "X",
        "is_admin": bool(is_admin),
        "plan": int(plan),
        "iat": now,
        "exp": now + timedelta(hours=1),
    }
    return jwt.encode(payload, auth_mod._test_keys.private_key, algorithm="RS256", headers={"kid": KEY_ID})


@pytest.mark.asyncio
async def test_admin_requires_admin_flag(client, auth_mod):
    token = _make_token(auth_mod, "u1", "u1@example.com", is_admin=False)
    r = await client.get("/admin/users", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403
    assert r.json()["detail"] == "Admin privileges required"


@pytest.mark.asyncio
async def test_admin_list_users_filters_by_user_name(client, users_coll, auth_mod):
    await users_coll.insert_one(
        {
            "user_id": "u_a",
            "user_name": "Alice",
            "email": "alice@example.com",
            "password": _bcrypt_hash("x"),
            "is_admin": False,
            "plan": 0,
            "created_at": _now_utc(),
            "age": None,
            "total_guesses": 0,
            "total_correct": 0,
            "acc_guessing_ai": 0,
            "acc_guessing_real": 0,
        }
    )
    await users_coll.insert_one(
        {
            "user_id": "u_b",
            "user_name": "Bob",
            "email": "bob@example.com",
            "password": _bcrypt_hash("x"),
            "is_admin": False,
            "plan": 0,
            "created_at": _now_utc(),
            "age": None,
            "total_guesses": 0,
            "total_correct": 0,
            "acc_guessing_ai": 0,
            "acc_guessing_real": 0,
        }
    )

    admin_token = _make_token(auth_mod, "u_admin", "admin@example.com", is_admin=True)
    r = await client.get("/admin/users?search=ali", headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    data = r.json()
    assert "items" in data
    assert len(data["items"]) == 1
    assert data["items"][0]["user_id"] == "u_a"


@pytest.mark.asyncio
async def test_admin_get_user_not_found(client, auth_mod):
    admin_token = _make_token(auth_mod, "u_admin", "admin@example.com", is_admin=True)
    r = await client.get("/admin/user/u_missing", headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 404
    assert r.json()["detail"] == "User not found"


@pytest.mark.asyncio
async def test_admin_get_user_ok(client, users_coll, auth_mod):
    await users_coll.insert_one(
        {
            "user_id": "u_x",
            "user_name": "X",
            "email": "x@example.com",
            "password": _bcrypt_hash("x"),
            "is_admin": False,
            "plan": 0,
            "created_at": _now_utc(),
            "age": 30,
            "total_guesses": 0,
            "total_correct": 0,
            "acc_guessing_ai": 0,
            "acc_guessing_real": 0,
        }
    )
    admin_token = _make_token(auth_mod, "u_admin", "admin@example.com", is_admin=True)
    r = await client.get("/admin/user/u_x", headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    assert r.json()["email"] == "x@example.com"
    assert r.json()["age"] == 30


@pytest.mark.asyncio
async def test_admin_update_user_ok(client, users_coll, auth_mod):
    await users_coll.insert_one(
        {
            "user_id": "u_upd",
            "user_name": "Old",
            "email": "old@example.com",
            "password": _bcrypt_hash("oldpass"),
            "is_admin": False,
            "plan": 0,
            "created_at": _now_utc(),
            "age": None,
            "total_guesses": 0,
            "total_correct": 0,
            "acc_guessing_ai": 0,
            "acc_guessing_real": 0,
        }
    )
    admin_token = _make_token(auth_mod, "u_admin", "admin@example.com", is_admin=True)

    r = await client.patch(
        "/admin/user/u_upd",
        json={"user_name": "  New  ", "email": "  NEW@Example.com ", "age": 22, "is_admin": True},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["user_name"] == "New"
    assert body["email"] == "new@example.com"
    assert body["age"] == 22
    assert body["is_admin"] is True


@pytest.mark.asyncio
async def test_admin_delete_user_ok(client, users_coll, auth_mod, event_redis):
    await users_coll.insert_one(
        {
            "user_id": "u_del2",
            "user_name": "Del",
            "email": "del2@example.com",
            "password": _bcrypt_hash("x"),
            "is_admin": False,
            "plan": 0,
            "created_at": _now_utc(),
            "age": None,
            "total_guesses": 0,
            "total_correct": 0,
            "acc_guessing_ai": 0,
            "acc_guessing_real": 0,
        }
    )
    admin_token = _make_token(auth_mod, "u_admin", "admin@example.com", is_admin=True)

    # Delete request must include reason fields.
    r = await client.request(
        "DELETE",
        "/admin/user/u_del2",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"reason_code": "user_request", "reason_detail": "Requested account removal"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["deleted"] is True
    assert data["user"]["user_id"] == "u_del2"
    assert data["user"]["email"] == "del2@example.com"

    doc = await users_coll.find_one({"user_id": "u_del2"})
    assert doc is None

    # Check event was published for email-worker.
    assert len(event_redis.calls) == 1
    call = event_redis.calls[0]
    assert call["stream"] == "auth-events"
    assert call["payload"]["type"] == "auth.user.deleted.admin"


@pytest.mark.asyncio
async def test_admin_delete_user_requires_reason_payload(client, users_coll, auth_mod):
    await users_coll.insert_one(
        {
            "user_id": "u_del3",
            "user_name": "Del",
            "email": "del3@example.com",
            "password": _bcrypt_hash("x"),
            "is_admin": False,
            "plan": 0,
            "created_at": _now_utc(),
            "age": None,
            "total_guesses": 0,
            "total_correct": 0,
            "acc_guessing_ai": 0,
            "acc_guessing_real": 0,
        }
    )
    admin_token = _make_token(auth_mod, "u_admin", "admin@example.com", is_admin=True)

    # No body -> FastAPI schema error.
    r = await client.delete("/admin/user/u_del3", headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 422
