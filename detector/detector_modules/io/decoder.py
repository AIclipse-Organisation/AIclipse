from PIL import Image
import io

def decode_image(img_bytes: bytes):
    return Image.open(io.BytesIO(img_bytes)).convert("RGB")
