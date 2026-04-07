from __future__ import annotations

import time
from pathlib import Path


_CACHE_TTL_SECONDS = 1.0
_cached_version = ""
_cached_until = 0.0


def get_static_asset_version(static_root: Path) -> str:
    global _cached_until, _cached_version

    now = time.monotonic()
    if now < _cached_until and _cached_version:
        return _cached_version

    latest_mtime_ns = 0
    try:
        for path in static_root.rglob("*"):
            if not path.is_file():
                continue
            latest_mtime_ns = max(latest_mtime_ns, path.stat().st_mtime_ns)
    except OSError:
        latest_mtime_ns = 0

    _cached_version = format(latest_mtime_ns, "x") if latest_mtime_ns else "0"
    _cached_until = now + _CACHE_TTL_SECONDS
    return _cached_version


def build_asset_url(static_root: Path, relative_path: str) -> str:
    clean_path = str(relative_path or "").replace("\\", "/").lstrip("/")
    return f"/static/{clean_path}?v={get_static_asset_version(static_root)}"
