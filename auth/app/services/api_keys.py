import hashlib
import hmac
import secrets
from uuid import uuid4

import bcrypt
from fastapi import HTTPException

from app.core.cpu_pool import CpuPool

API_KEY_KDF_ITERS = 100000
_API_KEY_KDF_SALT = b"auth-api-key-kdf-v1"


def _api_key_kdf_sync(secret: str, pepper: str) -> bytes:
    password = (pepper + secret).encode("utf-8")
    return hashlib.pbkdf2_hmac("sha256", password, _API_KEY_KDF_SALT, API_KEY_KDF_ITERS, dklen=32)


def _hash_api_key_secret_sync(secret: str, pepper: str) -> str:
    data = _api_key_kdf_sync(secret, pepper)
    return bcrypt.hashpw(data, bcrypt.gensalt()).decode("utf-8")


def _verify_api_key_secret_sync(secret: str, stored_hash: str, pepper: str) -> bool:
    if not stored_hash:
        return False
    data = _api_key_kdf_sync(secret, pepper)
    try:
        return bcrypt.checkpw(data, stored_hash.encode("utf-8"))
    except Exception:
        return False


class ApiKeyService:
    def __init__(self, cpu: CpuPool, pepper: str):
        self._cpu = cpu
        self._pepper = pepper

    def generate(self) -> tuple[str, str, str]:
        key_id = f"ak_{uuid4()}"
        secret = "sk_" + secrets.token_urlsafe(32)
        return key_id, secret, f"{key_id}.{secret}"

    def parse_full_key(self, full_key: str) -> tuple[str, str]:
        if not full_key or "." not in full_key:
            raise HTTPException(status_code=401, detail="Invalid API key format")
        key_id, secret = full_key.split(".", 1)
        if not key_id.startswith("ak_") or not secret.startswith("sk_"):
            raise HTTPException(status_code=401, detail="Invalid API key format")
        return key_id, secret

    async def hash_secret(self, secret: str) -> str:
        return await self._cpu.run(_hash_api_key_secret_sync, secret, self._pepper)

    async def verify_secret(self, secret: str, stored_hash: str) -> bool:
        return await self._cpu.run(_verify_api_key_secret_sync, secret, stored_hash, self._pepper)

    @staticmethod
    def constant_time_equals(a: str, b: str) -> bool:
        return hmac.compare_digest(a, b)
