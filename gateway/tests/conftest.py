import asyncio
import base64
import importlib.util
import os
import sys
import time
from contextlib import asynccontextmanager
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
    p = _gateway_root() / "app" / "main_gateway.py"
    if not p.exists():
        raise RuntimeError(f"Expected gateway entrypoint at: {p}")
    return p


def _load_gateway_module():
    root = _gateway_root()

    root_str = str(root)
    if root_str not in sys.path:
        sys.path.insert(0, root_str)

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


def _patch_async_client_in_module(monkeypatch, mod, factory) -> None:
    if mod is None:
        return

    if hasattr(mod, "httpx"):
        monkeypatch.setattr(mod.httpx, "AsyncClient", factory, raising=False)

    monkeypatch.setattr(mod, "AsyncClient", factory, raising=False)


@asynccontextmanager
async def _run_asgi_lifespan(app, timeout_s: float = 10.0):
    scope = {"type": "lifespan", "asgi": {"spec_version": "2.0"}}

    recv_q: asyncio.Queue = asyncio.Queue()
    send_q: asyncio.Queue = asyncio.Queue()

    async def receive():
        return await recv_q.get()

    async def send(message):
        await send_q.put(message)

    task = asyncio.create_task(app(scope, receive, send))

    await recv_q.put({"type": "lifespan.startup"})
    msg = await asyncio.wait_for(send_q.get(), timeout=timeout_s)
    if msg["type"] == "lifespan.startup.failed":
        detail = msg.get("message") or msg.get("detail") or str(msg)
        task.cancel()
        raise RuntimeError(f"ASGI lifespan startup failed: {detail}")
    if msg["type"] != "lifespan.startup.complete":
        task.cancel()
        raise RuntimeError(f"Unexpected lifespan message during startup: {msg}")

    try:
        yield
    finally:
        await recv_q.put({"type": "lifespan.shutdown"})
        msg2 = await asyncio.wait_for(send_q.get(), timeout=timeout_s)
        if msg2["type"] == "lifespan.shutdown.failed":
            detail = msg2.get("message") or msg2.get("detail") or str(msg2)
            task.cancel()
            raise RuntimeError(f"ASGI lifespan shutdown failed: {detail}")
        if msg2["type"] != "lifespan.shutdown.complete":
            task.cancel()
            raise RuntimeError(f"Unexpected lifespan message during shutdown: {msg2}")

        await asyncio.wait_for(task, timeout=timeout_s)


@pytest.fixture(scope="session")
def gateway_mod():
    os.environ.setdefault("AUTH_URI", "http://auth")
    os.environ.setdefault("BILLING_URI", "http://billing-srv")
    os.environ.setdefault("COMMUNITY_URI", "http://community")
    os.environ.setdefault("DETECTOR_URI", "http://detector")
    os.environ.setdefault("MEDIA_URI", "http://media")
    os.environ.setdefault("DETECTION_TOKEN_SECRET", "test-detection-secret")
    os.environ.setdefault("INTERNAL_AUTH_TOKEN", "test-internal-token")
    os.environ.setdefault("CPU_POOL_WORKERS", "4")
    os.environ.setdefault("HTTP_TIMEOUT_S", "10")

    return _load_gateway_module()


@pytest.fixture()
def upstream_router() -> UpstreamRouter:
    return UpstreamRouter()


@pytest.fixture()
def auth_keypair() -> AuthKeypair:
    return make_rsa_jwk(kid="test-kid")


@pytest.fixture()
def register_auth_jwks(upstream_router, auth_keypair):
    def _handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code=200, json={"keys": [auth_keypair.jwk]})

    upstream_router.add(host="auth", method="GET", path="/.well-known/jwks.json", handler=_handler)
    return True


@pytest.fixture()
def patch_upstreams(gateway_mod, upstream_router, auth_keypair, monkeypatch) -> UpstreamRouter:
    transport = httpx.MockTransport(upstream_router.handler)
    orig_async_client = httpx.AsyncClient

    def _factory(*args, **kwargs):
        kwargs.setdefault("transport", transport)
        return orig_async_client(*args, **kwargs)

    _patch_async_client_in_module(monkeypatch, gateway_mod, _factory)

    for m in list(sys.modules.values()):
        name = getattr(m, "__name__", "")
        if name.startswith("app."):
            _patch_async_client_in_module(monkeypatch, m, _factory)

    def _jwks_handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code=200, json={"keys": [auth_keypair.jwk]})

    upstream_router.add(host="auth", method="GET", path="/.well-known/jwks.json", handler=_jwks_handler)

    def _usage_check_handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status_code=200,
            json={
                "allowed": True,
                "plan": 0,
                "unlimited": False,
                "monthly_usage": 0,
                "limit": 10,
                "remaining": 10,
            },
        )

    def _usage_increment_handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code=200, json={"incremented": True, "monthly_usage": 1})

    upstream_router.add(host="auth", method="POST", path="/usage/check", handler=_usage_check_handler)
    upstream_router.add(host="auth", method="POST", path="/usage/increment", handler=_usage_increment_handler)

    return upstream_router


@pytest_asyncio.fixture()
async def client(gateway_mod, patch_upstreams):
    async with _run_asgi_lifespan(gateway_mod.app):
        transport = httpx.ASGITransport(app=gateway_mod.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
            yield c
