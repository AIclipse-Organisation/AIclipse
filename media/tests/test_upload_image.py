import io
import importlib.util
import os
from pathlib import Path
from types import SimpleNamespace

import pytest
from bson import ObjectId
from fastapi.testclient import TestClient


MEDIA_MAIN = Path(__file__).resolve().parents[1] / "main-media.py"
os.environ.setdefault("AWS_EC2_METADATA_DISABLED", "true")
os.environ.setdefault("AWS_ACCESS_KEY_ID", "test")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "test")
spec = importlib.util.spec_from_file_location("main_media", MEDIA_MAIN)
main_media = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(main_media)


@pytest.fixture()
def client(monkeypatch):
    async def _fake_model_version():
        return "v-test"

    monkeypatch.setattr(main_media, "ensure_bucket", lambda: None)
    monkeypatch.setattr(main_media, "fetch_current_model_version", _fake_model_version)
    monkeypatch.setattr(main_media, "presigned_get_url_for_key", lambda key, is_public: f"https://cdn.test/{key}")
    return TestClient(main_media.app)


def test_upload_image_success(client, monkeypatch):
    put_calls = []

    def _fake_put_object(**kwargs):
        put_calls.append(kwargs)
        return {"ETag": '"fake-etag"'}

    class _ImagesCollection:
        def insert_one(self, doc):
            return SimpleNamespace(inserted_id=ObjectId())

    monkeypatch.setattr(main_media.s3_internal, "put_object", _fake_put_object)
    monkeypatch.setattr(main_media, "get_images_collection", lambda: _ImagesCollection())

    fake_image = io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100)
    response = client.post(
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

    assert response.status_code == 201, response.text
    body = response.json()

    assert len(put_calls) == 1
    assert "_id" in body
    assert body["image_id"].startswith("img_")
    assert body["user_id"] == "test_user"
    assert body["s3_key"].endswith(".png")
    assert body["url"].startswith("https://cdn.test/")


def test_upload_image_rolls_back_when_metadata_store_unavailable(client, monkeypatch):
    put_calls = []
    delete_calls = []

    def _fake_put_object(**kwargs):
        put_calls.append(kwargs)
        return {"ETag": '"fake-etag"'}

    def _fake_delete_object(**kwargs):
        delete_calls.append(kwargs)
        return {}

    monkeypatch.setattr(main_media.s3_internal, "put_object", _fake_put_object)
    monkeypatch.setattr(main_media.s3_internal, "delete_object", _fake_delete_object)
    monkeypatch.setattr(main_media, "get_images_collection", lambda: None)

    fake_image = io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100)
    response = client.post(
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

    assert response.status_code == 503, response.text
    assert response.json()["detail"] == "Image metadata store unavailable"
    assert len(put_calls) == 1
    assert len(delete_calls) == 1
    assert delete_calls[0]["Bucket"] == main_media.S3_BUCKET
    assert delete_calls[0]["Key"].endswith(".png")
