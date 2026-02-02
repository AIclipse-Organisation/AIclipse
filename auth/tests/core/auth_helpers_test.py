from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi import HTTPException

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from app.core.cpu_pool import CpuPool
from app.core.keys import KEY_ID, build_keys
from app.routers.public import _parse_bearer_token, decode_jwt_local
from app.services.passwords import PasswordService
from app.services.tokens import TokenService


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _gen_pem() -> str:
    pk = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = pk.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return pem.decode("utf-8")


class _FakeApp:
    def __init__(self, keys):
        class _State: ...
        self.state = _State()
        self.state.keys = keys


class _FakeRequest:
    def __init__(self, app):
        self.app = app


@pytest.mark.asyncio
async def test_password_service_hash_and_verify():
    cpu = CpuPool.from_max_concurrency(4)
    pwd = PasswordService(cpu)

    pw = "secret123"
    hashed = await pwd.hash_password(pw)
    assert isinstance(hashed, str)
    assert hashed != pw

    assert await pwd.verify_password(pw, hashed) is True
    assert await pwd.verify_password("wrong", hashed) is False


@pytest.mark.asyncio
async def test_issue_and_decode_jwt_ok():
    pem = _gen_pem()
    keys = build_keys(pem)
    cpu = CpuPool.from_max_concurrency(2)
    tokens = TokenService(cpu, keys)

    doc = {"user_id": "u_test", "email": "t@example.com", "user_name": "Test", "is_admin": True, "plan": 2}
    token = await tokens.issue_user_token(doc)

    req = _FakeRequest(_FakeApp(keys))
    tu = decode_jwt_local(req, token)
    assert tu.user_id == "u_test"
    assert tu.email == "t@example.com"
    assert tu.is_admin is True
    assert tu.plan == 2


def test_parse_bearer_token_missing():
    with pytest.raises(HTTPException) as e:
        _parse_bearer_token(None)
    assert e.value.status_code == 401
    assert "Missing Authorization" in str(e.value.detail)


def test_parse_bearer_token_invalid_format():
    with pytest.raises(HTTPException) as e:
        _parse_bearer_token("Token abc")
    assert e.value.status_code == 401
    assert "Invalid Authorization" in str(e.value.detail)


def test_parse_bearer_token_ok():
    assert _parse_bearer_token("Bearer abc.def") == "abc.def"


def test_decode_jwt_expired():
    pem = _gen_pem()
    keys = build_keys(pem)

    now = _now_utc()
    token = jwt.encode(
        {"sub": "u1", "exp": now - timedelta(seconds=1), "iat": now - timedelta(hours=1)},
        keys.private_key,
        algorithm="RS256",
        headers={"kid": KEY_ID},
    )

    req = _FakeRequest(_FakeApp(keys))
    with pytest.raises(HTTPException) as e:
        decode_jwt_local(req, token)
    assert e.value.status_code == 401
    assert e.value.detail == "Token expired"


def test_decode_jwt_invalid():
    pem = _gen_pem()
    keys = build_keys(pem)
    req = _FakeRequest(_FakeApp(keys))

    with pytest.raises(HTTPException) as e:
        decode_jwt_local(req, "not-a-jwt")
    assert e.value.status_code == 401
    assert e.value.detail == "Invalid token"


def test_decode_jwt_missing_sub():
    pem = _gen_pem()
    keys = build_keys(pem)
    now = _now_utc()

    token = jwt.encode(
        {"email": "x@example.com", "exp": now + timedelta(minutes=5), "iat": now},
        keys.private_key,
        algorithm="RS256",
        headers={"kid": KEY_ID},
    )

    req = _FakeRequest(_FakeApp(keys))
    with pytest.raises(HTTPException) as e:
        decode_jwt_local(req, token)
    assert e.value.status_code == 401
    assert e.value.detail == "Token missing sub"
