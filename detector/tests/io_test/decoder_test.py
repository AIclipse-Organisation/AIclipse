import pytest
from PIL import Image
import io
from detector_modules.io.decoder import decode_image

def create_test_image_bytes():
    # Create an image
    img = Image.new("RGB", (10, 10), color="red")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()

def test_decode_image():
    img_bytes = create_test_image_bytes()
    img = decode_image(img_bytes)
    assert isinstance(img, Image.Image)
    assert img.mode == "RGB"
    assert img.size == (10, 10)

def test_decode_image_invalid_bytes():
    # Test with invalid image bytes
    with pytest.raises(OSError):
        decode_image(b'not an image')