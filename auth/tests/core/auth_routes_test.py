from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
import pytest

from app.core.keys import KEY_ID


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _bcrypt_hash(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _make_user_jwt(auth_mod, user_id: str, email: str, *, is_admin: bool = False, plan: int = 0, user_name: str = "X") -> str:
    now = _now_utc()
    payload = {
        "sub": user_id,
        "email": email,
        "user_name": user_name,
        "is_admin": bool(is_admin),
        "plan": int(plan),
        "iat": now,
        "exp": now + timedelta(hours=1),
    }
    return jwt.encode(
        payload,
        auth_mod._test_keys.private_key,
        algorithm="RS256",
        headers={"kid": KEY_ID},
    )


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
async def test_signup_success(client, users_coll):
    payload = {
        "user_name": " Alice  ",
        "email": "  Alice@Example.com ",
        "date_of_birth": "15-01-2000",
        "password": "Secret123!",
        "how_did_you_find_us": "linkedin",
    }
    r = await client.post("/signup", json=payload)
    assert r.status_code == 202

    body = r.json()
    assert body == {
        "pending": True,
        "message": "Thank you for your interest! An admin will review your request and get back to you shortly.",
    }

    assert len(users_coll.inserted) == 1
    stored = users_coll.inserted[0]
    assert stored["email"] == "alice@example.com"
    assert stored["user_name"] == "Alice"
    assert stored["access_status"] == "pending"
    assert stored["how_did_you_find_us"] == "linkedin"
    assert stored["how_did_you_find_us_detail"] is None
    assert stored["password"] != payload["password"]
    assert bcrypt.checkpw(payload["password"].encode("utf-8"), stored["password"].encode("utf-8")) is True


@pytest.mark.asyncio
async def test_signup_conflict(client, users_coll):
    await users_coll.insert_one(
        {
            "user_id": "u1",
            "user_name": "X",
            "email": "x@example.com",
            "password": _bcrypt_hash("Secret123!"),
            "is_admin": False,
            "plan": 0,
            "created_at": _now_utc(),
            "date_of_birth": None,
            "total_guesses": 0,
            "total_correct": 0,
            "acc_guessing_ai": 0,
            "acc_guessing_real": 0,
        }
    )

    r = await client.post(
        "/signup",
        json={
            "user_name": "Y",
            "email": "X@EXAMPLE.COM",
            "date_of_birth": "15-01-2000",
            "password": "Secret123!",
            "how_did_you_find_us": "linkedin",
        },
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
            "password": _bcrypt_hash("Secret123!"),
            "is_admin": False,
            "plan": 1,
            "created_at": _now_utc(),
            "date_of_birth": None,
            "total_guesses": 0,
            "total_correct": 0,
            "acc_guessing_ai": 0,
            "acc_guessing_real": 0,
        }
    )

    r = await client.post("/login", json={"email": " bob@example.com ", "password": "Secret123!"})
    assert r.status_code == 200
    data = r.json()
    assert "token" in data
    assert data["user"]["email"] == "bob@example.com"
    assert data["user"]["plan"] == 1

    payload = jwt.decode(data["token"], key=auth_mod._test_keys.public_key, algorithms=["RS256"])
    assert payload["sub"] == "u_login"
    assert payload["plan"] == 1
    assert payload["is_admin"] is False


@pytest.mark.asyncio
async def test_login_invalid_user(client):
    r = await client.post("/login", json={"email": "nope@example.com", "password": "Secret123!"})
    assert r.status_code == 401
    assert r.json()["detail"] == "Invalid credentials"


@pytest.mark.asyncio
async def test_login_invalid_password(client, users_coll):
    await users_coll.insert_one(
        {
            "user_id": "u_login2",
            "user_name": "Bob",
            "email": "bob2@example.com",
            "password": _bcrypt_hash("Secret123!"),
            "is_admin": False,
            "plan": 0,
            "created_at": _now_utc(),
            "date_of_birth": None,
            "total_guesses": 0,
            "total_correct": 0,
            "acc_guessing_ai": 0,
            "acc_guessing_real": 0,
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
            "password": _bcrypt_hash("Secret123!"),
            "is_admin": False,
            "plan": 0,
            "created_at": _now_utc(),
            "date_of_birth": "15-01-2000",
            "total_guesses": 3,
            "total_correct": 2,
            "acc_guessing_ai": 0,
            "acc_guessing_real": 0,
        }
    )

    token = _make_user_jwt(auth_mod, "u_me", "me@example.com", is_admin=False, plan=0, user_name="Me")
    r = await client.get("/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    body = r.json()
    assert body["user_id"] == "u_me"
    assert body["email"] == "me@example.com"
    assert body["date_of_birth"] == "15-01-2000"
    assert body["total_guesses"] == 3
    assert body["total_correct"] == 2
    assert body["do_not_show_disclaimer_again"] is False


@pytest.mark.asyncio
async def test_update_me_no_changes_returns_current(client, users_coll, auth_mod):
    await users_coll.insert_one(
        {
            "user_id": "u_me2",
            "user_name": "Me2",
            "email": "me2@example.com",
            "password": _bcrypt_hash("Secret123!"),
            "is_admin": False,
            "plan": 0,
            "created_at": _now_utc(),
            "date_of_birth": None,
            "total_guesses": 0,
            "total_correct": 0,
            "acc_guessing_ai": 0,
            "acc_guessing_real": 0,
        }
    )
    token = _make_user_jwt(auth_mod, "u_me2", "me2@example.com", is_admin=False, plan=0, user_name="Me2")
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
            "password": _bcrypt_hash("Secret123!"),
            "is_admin": False,
            "plan": 0,
            "created_at": _now_utc(),
            "date_of_birth": None,
            "total_guesses": 0,
            "total_correct": 0,
            "acc_guessing_ai": 0,
            "acc_guessing_real": 0,
        }
    )
    token = _make_user_jwt(auth_mod, "u_me3", "old@example.com", is_admin=False, plan=0, user_name="Old")

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
async def test_update_me_disclaimer_preference(client, users_coll, auth_mod):
    await users_coll.insert_one(
        {
            "user_id": "u_me_pref",
            "user_name": "Pref",
            "email": "pref@example.com",
            "password": _bcrypt_hash("Secret123!"),
            "is_admin": False,
            "plan": 0,
            "created_at": _now_utc(),
            "date_of_birth": None,
            "total_guesses": 0,
            "total_correct": 0,
            "acc_guessing_ai": 0,
            "acc_guessing_real": 0,
            "do_not_show_disclaimer_again": False,
        }
    )
    token = _make_user_jwt(auth_mod, "u_me_pref", "pref@example.com", is_admin=False, plan=0, user_name="Pref")

    r = await client.patch(
        "/me",
        json={"do_not_show_disclaimer_again": True},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    assert r.json()["do_not_show_disclaimer_again"] is True

    stored = await users_coll.find_one({"user_id": "u_me_pref"})
    assert stored is not None
    assert stored["do_not_show_disclaimer_again"] is True


@pytest.mark.asyncio
async def test_update_me_password_changes_hash(client, users_coll, auth_mod):
    await users_coll.insert_one(
        {
            "user_id": "u_me4",
            "user_name": "X",
            "email": "x4@example.com",
            "password": _bcrypt_hash("OldPass123!"),
            "is_admin": False,
            "plan": 0,
            "created_at": _now_utc(),
            "date_of_birth": None,
            "total_guesses": 0,
            "total_correct": 0,
            "acc_guessing_ai": 0,
            "acc_guessing_real": 0,
        }
    )
    token = _make_user_jwt(auth_mod, "u_me4", "x4@example.com", is_admin=False, plan=0, user_name="X")

    r = await client.patch(
        "/me",
        json={"password": "NewPass123!"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200

    stored = await users_coll.find_one({"user_id": "u_me4"})
    assert stored is not None
    assert bcrypt.checkpw("NewPass123!".encode("utf-8"), stored["password"].encode("utf-8")) is True
    assert bcrypt.checkpw("OldPass123!".encode("utf-8"), stored["password"].encode("utf-8")) is False


@pytest.mark.asyncio
async def test_delete_me_ok(client, users_coll, auth_mod):
    await users_coll.insert_one(
        {
            "user_id": "u_del",
            "user_name": "Del",
            "email": "del@example.com",
            "password": _bcrypt_hash("Secret123!"),
            "is_admin": False,
            "plan": 0,
            "created_at": _now_utc(),
            "date_of_birth": None,
            "total_guesses": 0,
            "total_correct": 0,
            "acc_guessing_ai": 0,
            "acc_guessing_real": 0,
        }
    )
    token = _make_user_jwt(auth_mod, "u_del", "del@example.com", is_admin=False, plan=0, user_name="Del")
    r = await client.delete("/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    data = r.json()
    assert data["deleted"] is True
    assert data["user_id"] == "u_del"

    doc = await users_coll.find_one({"user_id": "u_del"})
    assert doc is None
