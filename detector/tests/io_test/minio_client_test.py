import sys
import shutil
from pathlib import Path
from uuid import uuid4

DETECTOR_ROOT = Path(__file__).resolve().parents[2]
if str(DETECTOR_ROOT) not in sys.path:
    sys.path.insert(0, str(DETECTOR_ROOT))

from detector_modules.io import minio_client


def test_download_model_weights_preserves_object_extension(monkeypatch):
    recorded = {}

    class StubClient:
        def download_file(self, bucket_name, object_key, destination):
            recorded["bucket"] = bucket_name
            recorded["object_key"] = object_key
            recorded["destination"] = destination
            Path(destination).write_bytes(b"weights")

    fake_root = DETECTOR_ROOT / "tests" / ".tmp" / f"minio-client-{uuid4().hex}"
    fake_module_dir = fake_root / "detector_modules" / "io"

    try:
        fake_module_dir.mkdir(parents=True)
        fake_file = fake_module_dir / "minio_client.py"
        fake_file.write_text("# test module marker", encoding="utf-8")

        monkeypatch.setattr(minio_client, "__file__", str(fake_file))
        monkeypatch.setattr(minio_client, "_get_s3_client_and_bucket", lambda: (StubClient(), "model-cycle-storage"))

        local_path = minio_client.download_model_weights(
            "models/uploads/abc/v2.0.1.safetensors",
            "v2.0.1",
        )

        assert recorded["bucket"] == "model-cycle-storage"
        assert recorded["object_key"] == "models/uploads/abc/v2.0.1.safetensors"
        assert local_path.endswith("v2.0.1.safetensors")
        assert Path(local_path).read_bytes() == b"weights"
    finally:
        shutil.rmtree(fake_root, ignore_errors=True)


def test_reload_route_contract_allows_supported_model_extensions():
    source = (DETECTOR_ROOT / "main-detector.py").read_text(encoding="utf-8")

    assert r"\.(pt|bin|safetensors)$" in source


def test_fetch_latest_model_ignores_staged_upload_objects(monkeypatch):
    class StubClient:
        def list_objects_v2(self, Bucket, Prefix):
            return {
                "Contents": [
                    {"Key": "models/uploads/abc/v9.9.9.pt", "LastModified": 20},
                    {"Key": "models/v2.0.1.safetensors", "LastModified": 10},
                ]
            }

    monkeypatch.setattr(minio_client, "_get_s3_client_and_bucket", lambda: (StubClient(), "model-cycle-storage"))
    monkeypatch.setattr(minio_client, "download_model_weights", lambda object_key, version: f"{object_key}|{version}")

    result = minio_client.fetch_latest_model_from_minio()

    assert result == "models/v2.0.1.safetensors|v2.0.1"
