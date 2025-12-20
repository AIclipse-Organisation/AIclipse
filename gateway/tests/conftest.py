import base64
import importlib.util
import json
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Tuple

import httpx
import jwt
import pytest
import pytest_asyncio
from cryptography.hazmat.primitives.asymmetric import rsa


def _gateway_root() -> Path:
    # gateway/tests/conftest.py -> gateway/
    return Path(__file__).resolve().parents[1]


def _entrypoint_path() -> Path:
    p = _gateway_root() / "main-gateway.py"
    if not p.exists():
        raise RuntimeError(f"Expected gateway entrypoint at: {p}")
    return p


def _load_gateway_module():
    entry = _entrypoint_path()
    spec = importlib.util.spec_from_file_location("gateway_service", entry)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Failed to load module from {entry}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["gateway_service"] = mod
    spec.loader.exec_module(mod)
    return mod


class UpstreamRouter:

    def __init__(self):
        self._routes: Dict[Tuple[str, str, str], Callable[[httpx.Request], httpx.Response]] = {}

    def add(
        self,
        *,
        host: str,
        method: str,
        path: str,
        handler: Callable[[httpx.Request], httpx.Response],
    ) -> None:
        key = (host, method.upper(), path)
        self._routes[key] = handler

    def handler(self, request: httpx.Request) -> httpx.Response:
        host = request.url.host or ""
        key = (host, request.method.upper(), request.url.path)
        fn = self._routes.get(key)
        if fn is None:
            return httpx.Response(
                status_code=404,
                json={"detail": f"Upstream route not mocked: {key}"},
            )
        return fn(request)


@dataclass
class AuthKeypair:
    kid: str
    private_key: Any  # cryptography private key object
    jwk: Dict[str, Any]


def _b64url_uint(n: int) -> str:
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def make_rsa_jwk(kid: str) -> AuthKeypair:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_numbers = private_key.public_key().public_numbers()

    jwk = {
        "kty": "RSA",
        "alg": "RS256",
        "use": "sig",
        "kid": kid,
        "n": _b64url_uint(public_numbers.n),
        "e": _b64url_uint(public_numbers.e),
    }
    return AuthKeypair(kid=kid, private_key=private_key, jwk=jwk)


def make_auth_token(
    *,
    keypair: AuthKeypair,
    user_id: str,
    email: str = "u@example.com",
    is_admin: bool = False,
    plan: int = 0,
    ttl_seconds: int = 3600,
) -> str:
    now = int(time.time())
    payload = {
        "sub": user_id,
        "email": email,
        "is_admin": is_admin,
        "plan": plan,
        "iat": now,
        "exp": now + ttl_seconds,
    }
    return jwt.encode(
        payload,
        keypair.private_key,
        algorithm="RS256",
        headers={"kid": keypair.kid},
    )


@pytest.fixture(scope="session")
def gateway_mod():
    os.environ.setdefault("AUTH_URI", "http://auth")
    os.environ.setdefault("DETECTOR_URI", "http://detector")
    os.environ.setdefault("DETECTION_TOKEN_SECRET", "test-detection-secret")

    return _load_gateway_module()


@pytest.fixture()
def upstream_router() -> UpstreamRouter:
    return UpstreamRouter()


@pytest.fixture()
def patch_upstreams(gateway_mod, upstream_router, monkeypatch):
    transport = httpx.MockTransport(upstream_router.handler)
    orig_async_client = httpx.AsyncClient

    def _factory(*args, **kwargs):
        kwargs.setdefault("transport", transport)
        return orig_async_client(*args, **kwargs)

    monkeypatch.setattr(gateway_mod.httpx, "AsyncClient", _factory)

    gateway_mod.AUTH_URI = os.getenv("AUTH_URI")
    gateway_mod.DETECTOR_URI = os.getenv("DETECTOR_URI")
    gateway_mod.MEDIA_URI = os.getenv("MEDIA_URI")
    gateway_mod.DETECTION_TOKEN_SECRET = os.getenv("DETECTION_TOKEN_SECRET")

    return upstream_router


@pytest.fixture()
def auth_keypair() -> AuthKeypair:
    return make_rsa_jwk(kid="test-kid")


@pytest.fixture()
def register_auth_jwks(upstream_router, auth_keypair):
    def _handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code=200, json={"keys": [auth_keypair.jwk]})

    upstream_router.add(host="auth", method="GET", path="/.well-known/jwks.json", handler=_handler)
    return True


@pytest_asyncio.fixture()
async def client(gateway_mod, patch_upstreams):
    transport = httpx.ASGITransport(app=gateway_mod.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
