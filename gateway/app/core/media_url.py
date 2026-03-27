import posixpath
import re
from urllib.parse import urlparse

from fastapi import HTTPException, Request, status

_IMAGE_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
_MEDIA_PATH_RE = re.compile(r"^[A-Za-z0-9_/-]{1,256}$")


def _sanitize_image_id(image_id: str) -> str:
    if not isinstance(image_id, str):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    match = _IMAGE_ID_PATTERN.fullmatch(image_id)
    if not match:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    return match.group(0)


def _build_media_url(request: Request, path: str) -> str:
    s = request.app.state.settings

    if not s.media_uri:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found",
        )

    base = urlparse(s.media_uri)
    if base.scheme not in ("http", "https") or not base.netloc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Invalid media service configuration",
        )

    normalized = posixpath.normpath(path.lstrip("/"))

    if normalized in (".", "..") or normalized.startswith("../") or normalized.startswith("/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid media path",
        )

    if not _MEDIA_PATH_RE.fullmatch(normalized):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid media path",
        )

    origin = f"{base.scheme}://{base.netloc}"
    full_url = f"{origin}/{normalized}"

    resolved = urlparse(full_url)
    if resolved.scheme != base.scheme or resolved.netloc != base.netloc or resolved.path != ("/" + normalized):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Invalid URL construction",
        )

    return full_url


def build_media_image_url(request: Request, image_id: str) -> str:
    safe_image_id = _sanitize_image_id(image_id)

    rel = posixpath.normpath(f"image/{safe_image_id}")
    parts = rel.split("/")
    if len(parts) != 2 or parts[0] != "image" or parts[1] != safe_image_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid media path",
        )

    return _build_media_url(request, rel)
