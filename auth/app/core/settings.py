import os
from dataclasses import dataclass
from typing import Optional
from fastapi import HTTPException, status


def require_setting(name: str, value: Optional[str]) -> str:
    if value:
        return value
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail=f"Missing required setting: {name}",
    )


@dataclass(frozen=True)
class Settings:
    JWT_KEY: str
    MONGO_URI: str
    MONGO_DB: str
    API_KEY_PEPPER: str
    INTERNAL_AUTH_TOKEN: str
    CPU_POOL_CONCURRENCY: int = 8

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            JWT_KEY=require_setting("JWT_KEY", os.getenv("JWT_KEY")),
            MONGO_URI=require_setting("MONGO_URI", os.getenv("MONGO_URI")),
            MONGO_DB=require_setting("MONGO_DB", os.getenv("MONGO_DB")),
            API_KEY_PEPPER=require_setting("API_KEY_PEPPER", os.getenv("API_KEY_PEPPER")),
            INTERNAL_AUTH_TOKEN=require_setting("INTERNAL_AUTH_TOKEN", os.getenv("INTERNAL_AUTH_TOKEN")),
            CPU_POOL_CONCURRENCY=int(os.getenv("CPU_POOL_CONCURRENCY", "8")),
        )
