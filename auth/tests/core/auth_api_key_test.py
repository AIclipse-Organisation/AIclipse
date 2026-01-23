from datetime import datetime, timezone

import jwt
import pytest
from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _make_token(auth_mod, user_id: str, email: str, is_admin: bool = False, plan: int = 0) -> str:
    return auth_mod.issue_jwt(
        {"user_id": user_id, "email": email, "user_name": "X", "is_admin": is_admin, "plan": plan}
    )


@pytest.fixture(autouse=True)
def _force_settings(auth_mod):
    auth_mod.API_KEY_PEPPER = "test-pepper"
    auth_mod.INTERNAL_AUTH_TOKEN = "test-internal-token"


# -----------------------
# Helper-level tests
# -----------------------

def test_hash_and_verify_api_key_secret_ok(auth_mod):
    secret = "sk_test_secret_123"
    pepper = "pepper"

    hashed = auth_mod._hash_api_key_secret(secret, pepper=pepper)
    assert isinstance(hashed, str)
    assert hashed != secret

    assert auth_mod._verify_api_key_secret(secret, hashed, pepper=pepper) is True
    assert auth_mod._verify_api_key_secret("sk_wrong", hashed, pepper=pepper) is False
    assert auth_mod._verify_api_key_secret(secret, hashed, pepper="wrong-pepper") is False


def test_parse_full_api_key_invalid(auth_mod):
    with pytest.raises(HTTPException) as e1:
        auth_mod._parse_full_api_key("")
    assert e1.value.status_code == 401

    with pytest.raises(HTTPException) as e2:
        auth_mod._parse_full_api_key("no-dot-here")
    assert e2.value.status_code == 401

    with pytest.raises(HTTPException) as e3:
        auth_mod._parse_full_api_key("badprefix.secret")
    assert e3.value.status_code == 401

    with pytest.raises(HTTPException) as e4:
        auth_mod._parse_full_api_key("ak_123.not_sk_prefix")
    assert e4.value.status_code == 401


def test_parse_full_api_key_ok(auth_mod):
    key_id, secret = auth_mod._parse_full_api_key("ak_123.sk_abc")
    assert key_id == "ak_123"
    assert secret == "sk_abc"


# -----------------------
# Route-level tests
# -----------------------

@pytest.mark.asyncio
async def test_get_my_api_key_returns_none_when_missing(client, auth_mod):
    token = _make_token(auth_mod, "u_dev", "dev@example.com")
    r = await client.get("/me/api-key", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json() == {"key": None}


@pytest.mark.asyncio
async def test_rotate_api_key_requires_user_exists(client, auth_mod):
    token = _make_token(auth_mod, "u_missing", "missing@example.com")
    r = await client.post("/me/api-key", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 404
    assert r.json()["detail"] == "User not found"


@pytest.mark.asyncio
async def test_rotate_api_key_success_persists_and_returns_last4(client, users_coll, api_keys_coll, auth_mod):
    await users_coll.insert_one(
        {
            "user_id": "u_dev",
            "user_name": "Dev",
            "email": "dev@example.com",
            "password": auth_mod.hash_password("secret123"),
            "is_admin": False,
            "plan": 0,
            "created_at": _now_utc(),
            "age": None,
            "total_guesses": 0,
            "total_correct": 0,
        }
    )

    token = _make_token(auth_mod, "u_dev", "dev@example.com")

    r = await client.post("/me/api-key", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 201

    body = r.json()
    assert "api_key" in body
    assert "key" in body
    assert "secret_hash" not in body["key"]

    full_key = body["api_key"]
    key_pub = body["key"]

    assert "." in full_key
    key_id, secret = full_key.split(".", 1)
    assert key_id.startswith("ak_")
    assert secret.startswith("sk_")

    assert key_pub["key_id"] == key_id
    assert key_pub["last4"] == secret[-4:]
    assert key_pub["last_used_at"] is None

    doc = await api_keys_coll.find_one({"key_id": key_id})
    assert doc is not None
    assert doc["user_id"] == "u_dev"
    assert doc["last4"] == secret[-4:]
    assert auth_mod._verify_api_key_secret(secret, doc.get("secret_hash", ""), pepper=auth_mod.API_KEY_PEPPER) is True


@pytest.mark.asyncio
async def test_get_my_api_key_after_rotate_returns_public_only(client, users_coll, auth_mod):
    await users_coll.insert_one(
        {
            "user_id": "u_dev2",
            "user_name": "Dev2",
            "email": "dev2@example.com",
            "password": auth_mod.hash_password("secret123"),
            "is_admin": False,
            "plan": 0,
            "created_at": _now_utc(),
            "age": None,
            "total_guesses": 0,
            "total_correct": 0,
        }
    )

    token = _make_token(auth_mod, "u_dev2", "dev2@example.com")

    r1 = await client.post("/me/api-key", headers={"Authorization": f"Bearer {token}"})
    assert r1.status_code == 201
    created = r1.json()
    created_key_id = created["key"]["key_id"]

    r2 = await client.get("/me/api-key", headers={"Authorization": f"Bearer {token}"})
    assert r2.status_code == 200
    data = r2.json()
    assert "key" in data
    assert data["key"]["key_id"] == created_key_id
    assert "api_key" not in data


@pytest.mark.asyncio
async def test_delete_my_api_key_revokes(client, users_coll, auth_mod):
    await users_coll.insert_one(
        {
            "user_id": "u_dev3",
            "user_name": "Dev3",
            "email": "dev3@example.com",
            "password": auth_mod.hash_password("secret123"),
            "is_admin": False,
            "plan": 0,
            "created_at": _now_utc(),
            "age": None,
            "total_guesses": 0,
            "total_correct": 0,
        }
    )

    token = _make_token(auth_mod, "u_dev3", "dev3@example.com")

    r1 = await client.post("/me/api-key", headers={"Authorization": f"Bearer {token}"})
    assert r1.status_code == 201

    r2 = await client.delete("/me/api-key", headers={"Authorization": f"Bearer {token}"})
    assert r2.status_code == 200
    assert r2.json()["revoked"] is True

    r3 = await client.get("/me/api-key", headers={"Authorization": f"Bearer {token}"})
    assert r3.status_code == 200
    assert r3.json() == {"key": None}


@pytest.mark.asyncio
async def test_exchange_requires_internal_token(client, auth_mod):
    r = await client.post("/internal/api-key/exchange", json={"api_key": "ak_x.sk_y"})
    assert r.status_code == 403
    assert r.json()["detail"] == "Forbidden"

    r2 = await client.post(
        "/internal/api-key/exchange",
        json={"api_key": "ak_x.sk_y"},
        headers={"X-Internal-Token": "wrong"},
    )
    assert r2.status_code == 403
    assert r2.json()["detail"] == "Forbidden"


@pytest.mark.asyncio
async def test_exchange_invalid_format_returns_401(client, auth_mod):
    r = await client.post(
        "/internal/api-key/exchange",
        json={"api_key": "not-a-key"},
        headers={"X-Internal-Token": auth_mod.INTERNAL_AUTH_TOKEN},
    )
    assert r.status_code == 401
    assert r.json()["detail"] == "Invalid API key format"


@pytest.mark.asyncio
async def test_exchange_invalid_key_id_returns_401(client, auth_mod):
    r = await client.post(
        "/internal/api-key/exchange",
        json={"api_key": "ak_missing.sk_something"},
        headers={"X-Internal-Token": auth_mod.INTERNAL_AUTH_TOKEN},
    )
    assert r.status_code == 401
    assert r.json()["detail"] == "Invalid API key"


@pytest.mark.asyncio
async def test_exchange_success_returns_short_lived_jwt(client, users_coll, auth_mod):
    await users_coll.insert_one(
        {
            "user_id": "u_api",
            "user_name": "Api",
            "email": "api@example.com",
            "password": auth_mod.hash_password("secret123"),
            "is_admin": False,
            "plan": 1,
            "created_at": _now_utc(),
            "age": None,
            "total_guesses": 0,
            "total_correct": 0,
        }
    )

    # Rotate to create a real stored key
    token = _make_token(auth_mod, "u_api", "api@example.com", plan=1)
    r1 = await client.post("/me/api-key", headers={"Authorization": f"Bearer {token}"})
    assert r1.status_code == 201
    full_key = r1.json()["api_key"]
    key_id, secret = full_key.split(".", 1)

    # Wrong secret => 401
    wrong_last = "A" if secret[-1] != "A" else "B"
    wrong_key = f"{key_id}.{secret[:-1]}{wrong_last}"
    r_wrong = await client.post(
        "/internal/api-key/exchange",
        json={"api_key": wrong_key},
        headers={"X-Internal-Token": auth_mod.INTERNAL_AUTH_TOKEN},
    )
    assert r_wrong.status_code == 401
    assert r_wrong.json()["detail"] == "Invalid API key"

    # Correct => 200 + jwt
    r2 = await client.post(
        "/internal/api-key/exchange",
        json={"api_key": full_key},
        headers={"X-Internal-Token": auth_mod.INTERNAL_AUTH_TOKEN},
    )
    assert r2.status_code == 200
    data = r2.json()
    assert "token" in data
    assert "exp" in data

    payload = jwt.decode(data["token"], key=auth_mod.public_key, algorithms=["RS256"])
    assert payload["sub"] == "u_api"
    assert payload["email"] == "api@example.com"
    assert payload["plan"] == 1
    assert payload["token_type"] == "api_key"
    assert payload["api_key_id"] == key_id
    assert int(payload["exp"]) == int(data["exp"])


@pytest.mark.asyncio
async def test_exchange_succeeds_even_if_last_used_update_fails(client, users_coll, api_keys_coll, auth_mod, monkeypatch):
    await users_coll.insert_one(
        {
            "user_id": "u_meta",
            "user_name": "Meta",
            "email": "meta@example.com",
            "password": auth_mod.hash_password("secret123"),
            "is_admin": False,
            "plan": 0,
            "created_at": _now_utc(),
            "age": None,
            "total_guesses": 0,
            "total_correct": 0,
        }
    )

    token = _make_token(auth_mod, "u_meta", "meta@example.com")
    r1 = await client.post("/me/api-key", headers={"Authorization": f"Bearer {token}"})
    assert r1.status_code == 201
    full_key = r1.json()["api_key"]

    async def _boom(*_args, **_kwargs):
        raise RuntimeError("db down")

    monkeypatch.setattr(api_keys_coll, "update_one", _boom)

    r2 = await client.post(
        "/internal/api-key/exchange",
        json={"api_key": full_key},
        headers={"X-Internal-Token": auth_mod.INTERNAL_AUTH_TOKEN},
    )
    assert r2.status_code == 200
    assert "token" in r2.json()


@pytest.mark.asyncio
async def test_rotate_api_key_conflict_returns_409(client, users_coll, api_keys_coll, auth_mod, monkeypatch):
    await users_coll.insert_one(
        {
            "user_id": "u_conflict",
            "user_name": "C",
            "email": "c@example.com",
            "password": auth_mod.hash_password("secret123"),
            "is_admin": False,
            "plan": 0,
            "created_at": _now_utc(),
            "age": None,
            "total_guesses": 0,
            "total_correct": 0,
        }
    )

    async def _raise_dup(*_args, **_kwargs):
        raise DuplicateKeyError("dup")

    monkeypatch.setattr(api_keys_coll, "replace_one", _raise_dup)

    token = _make_token(auth_mod, "u_conflict", "c@example.com")
    r = await client.post("/me/api-key", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 409
    assert r.json()["detail"] == "API key rotation conflict; retry"
