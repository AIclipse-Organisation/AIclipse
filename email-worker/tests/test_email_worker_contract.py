import importlib.util
from pathlib import Path


EMAIL_WORKER_MAIN = Path(__file__).resolve().parents[1] / "main-email-worker.py"
spec = importlib.util.spec_from_file_location("main_email_worker", EMAIL_WORKER_MAIN)
email_worker = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(email_worker)


def test_healthz_returns_ok_status():
    assert email_worker.healthz() == {"status": "ok"}


def test_dedupe_key_normalizes_email_case():
    assert email_worker._dedupe_key("evt_1", "User@Example.COM") == "email_sent:evt_1:user@example.com"
