from datetime import datetime, timedelta, timezone

import pytest
import jwt
from fastapi import HTTPException


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def test_hash_and_verify_password(auth_mod):
    pw = "secret123"
    hashed = auth_mod.hash_password(pw)
    assert isinstance(hashed, str)
    assert hashed != pw
    assert auth_mod.verify_password(pw, hashed) is True
    assert auth_mod.verify_password("wrong", hashed) is False


def test_verify_password_handles_bad_hash(auth_mod):
    assert auth_mod.verify_password("x", "not-a-bcrypt-hash") is False


def test_parse_bearer_token_missing(auth_mod):
    with pytest.raises(HTTPException) as e:
        auth_mod._parse_bearer_token(None)
    assert e.value.status_code == 401
    assert "Missing Authorization" in str(e.value.detail)


def test_parse_bearer_token_invalid_format(auth_mod):
    with pytest.raises(HTTPException) as e:
        auth_mod._parse_bearer_token("Token abc")
    assert e.value.status_code == 401
    assert "Invalid Authorization" in str(e.value.detail)


def test_parse_bearer_token_ok(auth_mod):
    assert auth_mod._parse_bearer_token("Bearer abc.def") == "abc.def"


def test_issue_and_decode_jwt_ok(auth_mod):
    doc = {
        "user_id": "u_test",
        "email": "t@example.com",
        "user_name": "Test",
        "is_admin": True,
        "plan": 2,
    }
    token = auth_mod.issue_jwt(doc)
    tu = auth_mod.decode_jwt_local(token)
    assert tu.user_id == "u_test"
    assert tu.email == "t@example.com"
    assert tu.is_admin is True
    assert tu.plan == 2


def test_decode_jwt_expired(auth_mod):
    now = _now_utc()
    token = jwt.encode(
        {"sub": "u1", "exp": now - timedelta(seconds=1), "iat": now - timedelta(hours=1)},
        auth_mod.private_key,
        algorithm="RS256",
        headers={"kid": auth_mod.KEY_ID},
    )
    with pytest.raises(HTTPException) as e:
        auth_mod.decode_jwt_local(token)
    assert e.value.status_code == 401
    assert e.value.detail == "Token expired"


def test_decode_jwt_invalid(auth_mod):
    with pytest.raises(HTTPException) as e:
        auth_mod.decode_jwt_local("not-a-jwt")
    assert e.value.status_code == 401
    assert e.value.detail == "Invalid token"


def test_decode_jwt_missing_sub(auth_mod):
    now = _now_utc()
    token = jwt.encode(
        {"email": "x@example.com", "exp": now + timedelta(minutes=5), "iat": now},
        auth_mod.private_key,
        algorithm="RS256",
        headers={"kid": auth_mod.KEY_ID},
    )
    with pytest.raises(HTTPException) as e:
        auth_mod.decode_jwt_local(token)
    assert e.value.status_code == 401
    assert e.value.detail == "Token missing sub"
