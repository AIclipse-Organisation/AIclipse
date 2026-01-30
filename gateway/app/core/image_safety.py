import io
from typing import Dict, Tuple

from fastapi import HTTPException, Request
from PIL import Image, UnidentifiedImageError

SUPPORTED_IMAGE_FORMATS: Dict[str, Tuple[str, str]] = {
    "JPEG": ("image/jpeg", ".jpg"),
    "PNG": ("image/png", ".png"),
}


def _sniff_and_validate_image_sync(
    data: bytes,
    *,
    max_file_size: int,
    max_width: int,
    max_height: int,
) -> Tuple[str, str]:

    if not data:
        raise HTTPException(status_code=400, detail="Empty file")

    if len(data) > max_file_size:
        raise HTTPException(status_code=413, detail="Payload Too Large")

    try:
        with Image.open(io.BytesIO(data)) as im:
            im.verify()

        with Image.open(io.BytesIO(data)) as im:
            fmt = (im.format or "").upper()
            w, h = im.size
            if w <= 0 or h <= 0 or w > max_width or h > max_height:
                raise HTTPException(status_code=415, detail="Invalid image dimensions")
            im.load()

    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise HTTPException(status_code=415, detail="Unsupported or invalid image")

    if fmt not in SUPPORTED_IMAGE_FORMATS:
        raise HTTPException(status_code=415, detail="Unsupported image format")

    return SUPPORTED_IMAGE_FORMATS[fmt]


async def sniff_and_validate_image(request: Request, data: bytes) -> Tuple[str, str]:
    s = request.app.state.settings
    return await request.app.state.cpu.run(
        _sniff_and_validate_image_sync,
        data,
        max_file_size=s.max_file_size,
        max_width=s.max_width,
        max_height=s.max_height,
    )
