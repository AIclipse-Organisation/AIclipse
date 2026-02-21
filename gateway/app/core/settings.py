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

    @staticmethod
    def from_env() -> "Settings":
        return Settings(
            auth_uri=os.getenv("AUTH_URI"),
            billing_uri=os.getenv("BILLING_URI", "http://billing-srv:3001"),
            media_uri=os.getenv("MEDIA_URI"),
            detector_uri=os.getenv("DETECTOR_URI"),
            detection_token_secret=os.getenv("DETECTION_TOKEN_SECRET"),
            internal_auth_token=os.getenv("INTERNAL_AUTH_TOKEN"),
            model_cycle_uri = os.getenv("MOEDEL_CYCLE_URI"),
            max_file_size=5 * 1024 * 1024,
            max_width=12000,
            max_height=12000,
            max_pixels=40_000_000,
            http_timeout_s=10.0,
            cpu_pool_workers=_get_int_env("CPU_POOL_WORKERS", 4),
        )


def require_setting(name: str, value: Optional[str]) -> str:
    if value:
        return value
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail=f"Missing required setting: {name}",
    )
