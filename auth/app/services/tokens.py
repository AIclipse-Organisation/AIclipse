from datetime import datetime, timedelta, timezone
import jwt

from app.core.cpu_pool import CpuPool
from app.core.keys import KEY_ID, KeyMaterial


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _issue_jwt_sync(user_doc: dict, private_key) -> str:
    now = _now_utc()
    payload = {
        "sub": user_doc["user_id"],
        "email": user_doc["email"],
        "user_name": user_doc.get("user_name"),
        "is_admin": bool(user_doc.get("is_admin", False)),
        "plan": int(user_doc.get("plan", 0)),
        "iat": now,
        "exp": now + timedelta(hours=1),
    }
    return jwt.encode(payload, private_key, algorithm="RS256", headers={"kid": KEY_ID})


def _issue_jwt_api_key_sync(user_doc: dict, private_key, api_key_id: str) -> tuple[str, int]:
    now = _now_utc()
    exp_dt = now + timedelta(minutes=5)
    payload = {
        "sub": user_doc["user_id"],
        "email": user_doc["email"],
        "user_name": user_doc.get("user_name"),
        "is_admin": bool(user_doc.get("is_admin", False)),
        "plan": int(user_doc.get("plan", 0)),
        "token_type": "api_key",
        "api_key_id": api_key_id,
        "iat": now,
        "exp": exp_dt,
    }
    token = jwt.encode(payload, private_key, algorithm="RS256", headers={"kid": KEY_ID})
    return token, int(exp_dt.timestamp())


class TokenService:
    def __init__(self, cpu: CpuPool, keys: KeyMaterial):
        self._cpu = cpu
        self._keys = keys

    async def issue_user_token(self, user_doc: dict) -> str:
        return await self._cpu.run(_issue_jwt_sync, user_doc, self._keys.private_key)

    async def issue_api_key_token(self, user_doc: dict, api_key_id: str) -> tuple[str, int]:
        return await self._cpu.run(_issue_jwt_api_key_sync, user_doc, self._keys.private_key, api_key_id)
