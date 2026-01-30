import bcrypt
from app.core.cpu_pool import CpuPool


def _hash_password_sync(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _verify_password_sync(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


class PasswordService:
    def __init__(self, cpu: CpuPool):
        self._cpu = cpu

    async def hash_password(self, password: str) -> str:
        return await self._cpu.run(_hash_password_sync, password)

    async def verify_password(self, password: str, hashed: str) -> bool:
        return await self._cpu.run(_verify_password_sync, password, hashed)
