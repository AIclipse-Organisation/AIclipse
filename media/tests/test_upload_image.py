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
    monkeypatch.setattr(main_media, "ensure_bucket", lambda: None)
    monkeypatch.setattr(
        main_media,
        "presigned_get_url_for_key",
        lambda key, is_public, external_proto=None: f"https://cdn.test/{key}",
    )
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
            "verdict": "ok",
            "label": "real",
            "confidence": "0.85",
            "model_version": "v-test",
            "is_public": "true",
        },
        headers={"X-User-Id": "test_user"},
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
            "verdict": "ok",
            "label": "real",
            "confidence": "0.85",
            "model_version": "v-test",
            "is_public": "true",
        },
        headers={"X-User-Id": "test_user"},
    )

    assert response.status_code == 503, response.text
    assert response.json()["detail"] == "Image metadata store unavailable"
    assert len(put_calls) == 1
    assert len(delete_calls) == 1
    assert delete_calls[0]["Bucket"] == main_media.S3_BUCKET
    assert delete_calls[0]["Key"].endswith(".png")


def test_list_images_returns_503_when_metadata_store_is_unavailable(client, monkeypatch):
    monkeypatch.setattr(main_media, "get_images_collection", lambda: None)

    response = client.get("/images", params={"user_id": "test_user"})

    assert response.status_code == 503
    assert response.json()["detail"] == "Image metadata store unavailable"


def test_upload_image_requires_model_version(client):
    fake_image = io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100)
    response = client.post(
        "/upload/image",
        files={"file": ("test.png", fake_image, "image/png")},
        data={
            "verdict": "ok",
            "label": "real",
            "confidence": "0.85",
            "is_public": "true",
        },
        headers={"X-User-Id": "test_user"},
    )

    assert response.status_code == 422


def test_lookup_images_returns_public_items_with_presigned_urls(client, monkeypatch):
    class _Cursor:
        def __init__(self, items):
            self._items = items

        def __iter__(self):
            return iter(self._items)

    class _ImagesCollection:
        def __init__(self, items):
            self._items = items

        def find(self, query, projection):
            assert query == {
                "image_id": {"$in": ["img_a", "img_b"]},
                "is_public": True,
            }
            assert projection == {"_id": 0}
            return _Cursor(self._items)

    monkeypatch.setattr(
        main_media,
        "get_images_collection",
        lambda: _ImagesCollection(
            [
                {
                    "image_id": "img_b",
                    "user_id": "u_1",
                    "s3_key": "img_b.png",
                    "verdict": "ok",
                    "label": "real",
                    "confidence": 0.9,
                    "is_public": True,
                    "uploaded_at": "2026-04-03T00:00:00Z",
                    "is_reported": False,
                },
                {
                    "image_id": "img_a",
                    "user_id": "u_1",
                    "s3_key": "img_a.png",
                    "verdict": "ok",
                    "label": "real",
                    "confidence": 0.8,
                    "is_public": True,
                    "uploaded_at": "2026-04-03T00:00:00Z",
                    "is_reported": False,
                },
            ]
        ),
    )

    response = client.post("/images/lookup", json={"image_ids": ["img_a", "img_b", "img_a"]})

    assert response.status_code == 200, response.text
    assert response.json() == {
        "items": [
            {
                "image_id": "img_a",
                "user_id": "u_1",
                "s3_key": "img_a.png",
                "verdict": "ok",
                "label": "real",
                "confidence": 0.8,
                "is_public": True,
                "uploaded_at": "2026-04-03T00:00:00Z",
                "is_reported": False,
                "url": "https://cdn.test/img_a.png",
            },
            {
                "image_id": "img_b",
                "user_id": "u_1",
                "s3_key": "img_b.png",
                "verdict": "ok",
                "label": "real",
                "confidence": 0.9,
                "is_public": True,
                "uploaded_at": "2026-04-03T00:00:00Z",
                "is_reported": False,
                "url": "https://cdn.test/img_b.png",
            },
        ]
    }


def test_presigned_get_url_for_key_rewrites_scheme_from_forwarded_proto(monkeypatch):
    monkeypatch.setattr(
        main_media.s3_public,
        "generate_presigned_url",
        lambda **_kwargs: "http://storage.aiclipse.local/images/img_a.png?sig=abc",
    )

    url = main_media.presigned_get_url_for_key(
        "img_a.png",
        is_public=True,
        external_proto="https",
    )

    assert url == "https://storage.aiclipse.local/images/img_a.png?sig=abc"


def test_get_images_collection_throttles_repeated_mongo_outage_logs(monkeypatch):
    warning_messages = []

    class _BrokenAdmin:
        def command(self, *_args, **_kwargs):
            raise RuntimeError("mongo down")

    class _BrokenClient:
        def __init__(self):
            self.admin = _BrokenAdmin()

        def close(self):
            return None

    monkeypatch.setattr(main_media, "MONGO_URI", "mongodb://mongo.test")
    monkeypatch.setattr(main_media, "MONGO_DB", "aiclipse")
    monkeypatch.setattr(main_media, "mc", None)
    monkeypatch.setattr(main_media, "_build_mongo_client", lambda: _BrokenClient())
    monkeypatch.setattr(main_media.time, "monotonic", lambda: 100.0)
    monkeypatch.setattr(main_media.logging, "warning", lambda message, *args: warning_messages.append(message % args))
    main_media._mongo_connection_state.update(
        {
            "available": None,
            "last_error_at": 0.0,
            "last_error_message": None,
        }
    )

    assert main_media.get_images_collection() is None
    assert main_media.get_images_collection() is None
    assert warning_messages == ["mongo connection unavailable: mongo down"]


def test_update_image_rejects_invalid_admin_header(client):
    response = client.patch(
        "/image/img_123",
        params={"user_id": "u_1", "is_public": "true"},
        headers={"X-User-Is-Admin": "yes"},
    )

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["header", "X-User-Is-Admin"]
