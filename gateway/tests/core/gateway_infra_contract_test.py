from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]


def _read_repo_text(relative_path: str) -> str:
    return (REPO_ROOT / relative_path).read_text(encoding="utf-8")


def test_gateway_deployment_requires_allowed_origins_from_app_configmap():
    deployment = _read_repo_text("infra/k8s/gateway-depl.yaml")

    assert "- name: ALLOWED_ORIGINS" in deployment
    assert "configMapKeyRef" in deployment
    assert "name: app-configmap" in deployment
    assert "key: ALLOWED_ORIGINS" in deployment


def test_dev_app_configmap_defines_allowed_origins_for_gateway_cors():
    dev_config = _read_repo_text("infra/k8s-dev/dev-secrets.yaml")

    assert "kind: ConfigMap" in dev_config
    assert "name: app-configmap" in dev_config
    assert 'ALLOWED_ORIGINS: "http://aiclipse.local"' in dev_config
