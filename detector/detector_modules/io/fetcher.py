import httpx

def fetch_image_bytes(url: str) -> bytes:
    resp = httpx.get(url, timeout=5)
    resp.raise_for_status()
    return resp.content
