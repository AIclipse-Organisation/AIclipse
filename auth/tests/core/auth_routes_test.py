from datetime import datetime, timezone

import pytest


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


@pytest.mark.asyncio
async def test_healthz(client):
    r = await client.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_jwks(client):
    r = await client.get("/.well-known/jwks.json")
    assert r.status_code == 200
    data = r.json()
    assert "keys" in data
    assert isinstance(data["keys"], list)
    assert data["keys"][0]["kid"]


@pytest.mark.asyncio
async def test_signup_success(client, auth_mod, users_coll):
    payload = {"user_name": " Alice  ", "email": "  Alice@Example.com ", "password": "secret123"}
    r = await client.post("/signup", json=payload)
    assert r.status_code == 201

    body = r.json()
    assert body["email"] == "alice@example.com"
    assert body["user_name"] == "Alice"
    assert body["is_admin"] is False
    assert body["plan"] == 0
    assert "password" not in body
    assert "created_at" in body

    assert len(users_coll.inserted) == 1
    stored = users_coll.inserted[0]
    assert stored["email"] == "alice@example.com"
    assert stored["user_name"] == "Alice"
    assert stored["password"] != payload["password"]
    assert auth_mod.verify_password(payload["password"], stored["password"]) is True


@pytest.mark.asyncio
async def test_signup_conflict(client, users_coll, auth_mod):
    await users_coll.insert_one(
        {
            "user_id": "u1",
            "user_name": "X",
            "email": "x@example.com",
            "password": auth_mod.hash_password("secret123"),
            "is_admin": False,
            "plan": 0,
            "created_at": _now_utc(),
            "age": None,
            "total_guesses": 0,
            "total_correct": 0,
        }
    )

    r = await client.post(
        "/signup",
        json={"user_name": "Y", "email": "X@EXAMPLE.COM", "password": "secret123"},
    )
    assert r.status_code == 409
    assert r.json()["detail"] == "Email already registered"


@pytest.mark.asyncio
async def test_login_success(client, users_coll, auth_mod):
    await users_coll.insert_one(
        {
            "user_id": "u_login",
            "user_name": "Bob",
            "email": "bob@example.com",
            "password": auth_mod.hash_password("secret123"),
            "is_admin": False,
            "plan": 1,
            "created_at": _now_utc(),
            "age": None,
            "total_guesses": 0,
            "total_correct": 0,
        }
    )

    r = await client.post("/login", json={"email": " bob@example.com ", "password": "secret123"})
    assert r.status_code == 200
    data = r.json()
    assert "token" in data
    assert data["user"]["email"] == "bob@example.com"
    assert data["user"]["plan"] == 1

    tu = auth_mod.decode_jwt_local(data["token"])
    assert tu.user_id == "u_login"
    assert tu.plan == 1
    assert tu.is_admin is False


@pytest.mark.asyncio
async def test_login_invalid_user(client):
    r = await client.post("/login", json={"email": "nope@example.com", "password": "secret123"})
    assert r.status_code == 401
    assert r.json()["detail"] == "Invalid credentials"


@pytest.mark.asyncio
async def test_login_invalid_password(client, users_coll, auth_mod):
    await users_coll.insert_one(
        {
            "user_id": "u_login2",
            "user_name": "Bob",
            "email": "bob2@example.com",
            "password": auth_mod.hash_password("secret123"),
            "is_admin": False,
            "plan": 0,
            "created_at": _now_utc(),
            "age": None,
            "total_guesses": 0,
            "total_correct": 0,
        }
    )
    r = await client.post("/login", json={"email": "bob2@example.com", "password": "wrong"})
    assert r.status_code == 401
    assert r.json()["detail"] == "Invalid credentials"


@pytest.mark.asyncio
async def test_me_requires_auth(client):
    r = await client.get("/me")
    assert r.status_code == 401
    assert r.json()["detail"] == "Missing Authorization header"


@pytest.mark.asyncio
async def test_get_me_ok(client, users_coll, auth_mod):
    await users_coll.insert_one(
        {
            "user_id": "u_me",
            "user_name": "Me",
            "email": "me@example.com",
            "password": auth_mod.hash_password("secret123"),
            "is_admin": False,
            "plan": 0,
            "created_at": _now_utc(),
            "age": 25,
            "total_guesses": 3,
            "total_correct": 2,
        }
    )

    token = auth_mod.issue_jwt(
        {"user_id": "u_me", "email": "me@example.com", "user_name": "Me", "is_admin": False, "plan": 0}
    )
    r = await client.get("/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    body = r.json()
    assert body["user_id"] == "u_me"
    assert body["email"] == "me@example.com"
    assert body["age"] == 25
    assert body["total_guesses"] == 3
    assert body["total_correct"] == 2


@pytest.mark.asyncio
async def test_update_me_no_changes_returns_current(client, users_coll, auth_mod):
    await users_coll.insert_one(
        {
            "user_id": "u_me2",
            "user_name": "Me2",
            "email": "me2@example.com",
            "password": auth_mod.hash_password("secret123"),
            "is_admin": False,
            "plan": 0,
            "created_at": _now_utc(),
            "age": None,
            "total_guesses": 0,
            "total_correct": 0,
        }
    )
    token = auth_mod.issue_jwt(
        {"user_id": "u_me2", "email": "me2@example.com", "user_name": "Me2", "is_admin": False, "plan": 0}
    )
    r = await client.patch("/me", json={}, headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["email"] == "me2@example.com"


@pytest.mark.asyncio
async def test_update_me_updates_fields(client, users_coll, auth_mod):
    await users_coll.insert_one(
        {
            "user_id": "u_me3",
            "user_name": "Old",
            "email": "old@example.com",
            "password": auth_mod.hash_password("secret123"),
            "is_admin": False,
            "plan": 0,
            "created_at": _now_utc(),
            "age": None,
            "total_guesses": 0,
            "total_correct": 0,
        }
    )
    token = auth_mod.issue_jwt(
        {"user_id": "u_me3", "email": "old@example.com", "user_name": "Old", "is_admin": False, "plan": 0}
    )

    r = await client.patch(
        "/me",
        json={"user_name": "  New Name  ", "email": "  NEW@Example.com "},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["user_name"] == "New Name"
    assert body["email"] == "new@example.com"


@pytest.mark.asyncio
async def test_update_me_password_changes_hash(client, users_coll, auth_mod):
    await users_coll.insert_one(
        {
            "user_id": "u_me4",
            "user_name": "X",
            "email": "x4@example.com",
            "password": auth_mod.hash_password("oldpass"),
            "is_admin": False,
            "plan": 0,
            "created_at": _now_utc(),
            "age": None,
            "total_guesses": 0,
            "total_correct": 0,
        }
    )
    token = auth_mod.issue_jwt(
        {"user_id": "u_me4", "email": "x4@example.com", "user_name": "X", "is_admin": False, "plan": 0}
    )

    r = await client.patch(
        "/me",
        json={"password": "newpass123"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200

    stored = await users_coll.find_one({"user_id": "u_me4"})
    assert stored is not None
    assert auth_mod.verify_password("newpass123", stored["password"]) is True
    assert auth_mod.verify_password("oldpass", stored["password"]) is False


@pytest.mark.asyncio
async def test_delete_me_ok(client, users_coll, auth_mod):
    await users_coll.insert_one(
        {
            "user_id": "u_del",
            "user_name": "Del",
            "email": "del@example.com",
            "password": auth_mod.hash_password("secret123"),
            "is_admin": False,
            "plan": 0,
            "created_at": _now_utc(),
            "age": None,
            "total_guesses": 0,
            "total_correct": 0,
        }
    )
    token = auth_mod.issue_jwt(
        {"user_id": "u_del", "email": "del@example.com", "user_name": "Del", "is_admin": False, "plan": 0}
    )
    r = await client.delete("/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    data = r.json()
    assert data["deleted"] is True
    assert data["user_id"] == "u_del"

    doc = await users_coll.find_one({"user_id": "u_del"})
    assert doc is None
