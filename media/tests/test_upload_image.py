import io
import importlib.util
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

# Load FastAPI app from media/main-media.py 
MEDIA_MAIN = Path(__file__).resolve().parents[1] / "main-media.py"
spec = importlib.util.spec_from_file_location("main_media", MEDIA_MAIN)
main_media = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(main_media)

@pytest.fixture()
def client(monkeypatch):
    # Mock S3 put_object so no real network/credentials are needed
    def _fake_put_object(**kwargs):
        return {"ETag": '"fake-etag"'}

    monkeypatch.setattr(main_media.s3, "put_object", _fake_put_object)

    # stop bucket checks from running if they cause issues
    monkeypatch.setattr(main_media, "ensure_bucket", lambda: None)

    return TestClient(main_media.app)

def test_upload_image_success(client):
    fake_image = io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100)

    r = client.post(
        "/upload/image",
        files={"file": ("test.png", fake_image, "image/png")},
        data={
            "user_id": "test_user",
            "verdict": "ok",
            "label": "real",
            "confidence": "0.85",
            "is_public": "true",
        },
    )

    assert r.status_code == 201, r.text
    body = r.json()

    assert body["image_id"].startswith("img_")
    assert body["user_id"] == "test_user"
    assert body["s3_key"].endswith(".png")
    assert "url" in body  