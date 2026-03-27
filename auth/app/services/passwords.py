from __future__ import annotations

import bcrypt
import re
from typing import Dict, List, Optional

from app.core.cpu_pool import CpuPool


PASSWORD_POLICY_MESSAGE = (
    "Password must be at least 8 characters long and include an uppercase letter, "
    "a lowercase letter, a number, and a symbol. Spaces are not allowed."
)

PASSWORD_POLICY_RULES = [
    {"id": "min_length", "text": "At least 8 characters"},
    {"id": "max_length", "text": "At most 72 characters"},
    {"id": "no_spaces", "text": "No spaces"},
    {"id": "has_lowercase", "text": "At least one lowercase letter (a-z)"},
    {"id": "has_uppercase", "text": "At least one uppercase letter (A-Z)"},
    {"id": "has_number", "text": "At least one number (0-9)"},
    {"id": "has_symbol", "text": "At least one symbol (for example !@#$)"},
]


class PasswordValidationError(ValueError):
    def __init__(self, message: str, checks: Dict[str, bool], failed: List[str]):
        super().__init__(message)
        self.checks = checks
        self.failed = failed


def check_password_strength(password: Optional[str]) -> Dict[str, bool]:
    if password is None:
        return {r["id"]: False for r in PASSWORD_POLICY_RULES}

    b = password.encode("utf-8")
    checks = {
        "min_length": len(b) >= 8,
        "max_length": len(b) <= 72,
        "no_spaces": not any(ch.isspace() for ch in password),
        "has_lowercase": re.search(r"[a-z]", password) is not None,
        "has_uppercase": re.search(r"[A-Z]", password) is not None,
        "has_number": re.search(r"\d", password) is not None,
        "has_symbol": re.search(r"[^A-Za-z0-9]", password) is not None,
    }
    return checks


def validate_password_strength(password: str) -> None:
    checks = check_password_strength(password)

    if not all(checks.values()):
        failed = [k for k, v in checks.items() if not v]
        raise PasswordValidationError(PASSWORD_POLICY_MESSAGE, checks=checks, failed=failed)


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
        validate_password_strength(password)
        return await self._cpu.run(_hash_password_sync, password)

    async def verify_password(self, password: str, hashed: str) -> bool:
        return await self._cpu.run(_verify_password_sync, password, hashed)
