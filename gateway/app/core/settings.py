import os
from dataclasses import dataclass
from typing import Optional

from fastapi import HTTPException, status


def _get_int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    try:
        v = int(raw)
    except ValueError:
        return default
    return v


@dataclass(frozen=True)
class Settings:
    auth_uri: Optional[str]
    billing_uri: Optional[str]
    community_uri: Optional[str]
    media_uri: Optional[str]
    detector_uri: Optional[str]
    model_cycle_uri: Optional[str]

    detection_token_secret: Optional[str]
    internal_auth_token: Optional[str]

    # Image safety limits
    max_file_size: int
    max_width: int
    max_height: int
    max_pixels: int

    http_timeout_s: float

    # CPU pool
    cpu_pool_workers: int

    # CORS
    allowed_origins: list

    @staticmethod
    def from_env() -> "Settings":
        raw_origins = os.getenv("ALLOWED_ORIGINS", "")
        allowed_origins = [o.strip() for o in raw_origins.split(",") if o.strip()] if raw_origins else []

        return Settings(
            auth_uri=os.getenv("AUTH_URI"),
            billing_uri=os.getenv("BILLING_URI"),
            community_uri=os.getenv("COMMUNITY_URI"),
            media_uri=os.getenv("MEDIA_URI"),
            detector_uri=os.getenv("DETECTOR_URI"),
            detection_token_secret=os.getenv("DETECTION_TOKEN_SECRET"),
            internal_auth_token=os.getenv("INTERNAL_AUTH_TOKEN"),
            model_cycle_uri=os.getenv("MODEL_CYCLE_URI"),
            max_file_size=20 * 1024 * 1024,
            max_width=12000,
            max_height=12000,
            max_pixels=40_000_000,
            http_timeout_s=10.0,
            cpu_pool_workers=_get_int_env("CPU_POOL_WORKERS", 4),
            allowed_origins=allowed_origins,
        )


def require_setting(name: str, value: Optional[str]) -> str:
    if value:
        return value
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail=f"Missing required setting: {name}",
    )
