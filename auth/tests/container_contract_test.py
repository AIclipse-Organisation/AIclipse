from pathlib import Path


AUTH_ROOT = Path(__file__).resolve().parents[1]


def test_prod_dockerfile_provisions_writable_home_for_appuser():
    dockerfile = (AUTH_ROOT / "Dockerfile").read_text(encoding="utf-8")

    assert "useradd --system --uid 1000 --create-home --home-dir /home/appuser appuser" in dockerfile
    assert "HOME=/home/appuser" in dockerfile
    assert "--no-create-home" not in dockerfile
