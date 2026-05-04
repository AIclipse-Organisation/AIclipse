from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


def read_repo_text(relative_path: str) -> str:
    return (REPO_ROOT / relative_path).read_text(encoding="utf-8")


def assert_storage_routes_live_in_srv_ingress(relative_path: str, expected_host: str) -> None:
    manifest = read_repo_text(relative_path)

    assert "name: ingress-srv" in manifest
    assert f"- host: {expected_host}" in manifest
    assert manifest.count("pathType: Exact") >= 3
    assert "- path: /crossdomain.xml" in manifest
    assert "- path: /robots.txt" in manifest
    assert "- path: /sitemap.xml" in manifest
    assert "name: client-srv" in manifest
    assert "name: s3-srv" in manifest


def test_prod_srv_ingress_routes_storage_legacy_paths_without_a_separate_manifest() -> None:
    manifest = read_repo_text("infra/k8s-prod/ingress-srv.yaml")

    assert_storage_routes_live_in_srv_ingress(
        "infra/k8s-prod/ingress-srv.yaml",
        "storage.aiclipse.online",
    )
    assert 'nginx.ingress.kubernetes.io/force-ssl-redirect: "true"' in manifest


def test_dev_srv_ingress_routes_storage_legacy_paths_without_a_separate_manifest() -> None:
    manifest = read_repo_text("infra/k8s-dev/ingress-srv.yaml")

    assert_storage_routes_live_in_srv_ingress(
        "infra/k8s-dev/ingress-srv.yaml",
        "storage.aiclipse.local",
    )
    assert "force-ssl-redirect" not in manifest


def test_dev_kustomization_only_lists_the_canonical_ingress_manifests() -> None:
    kustomization = read_repo_text("infra/kustomization.yaml")

    assert "- k8s-dev/ingress-srv.yaml" in kustomization
    assert "- k8s-dev/ingress-srv-uploads.yaml" in kustomization
    assert "- k8s-dev/ingress-api.yaml" in kustomization
    assert "ingress-storage.yaml" not in kustomization


def test_storage_upload_ingresses_do_not_use_snippets() -> None:
    for relative_path in (
        "infra/k8s-prod/ingress-srv-uploads.yaml",
        "infra/k8s-dev/ingress-srv-uploads.yaml",
    ):
        manifest = read_repo_text(relative_path)
        assert "custom-headers" not in manifest
        assert "configuration-snippet" not in manifest
        assert "server-snippet" not in manifest


def test_dev_ingresses_do_not_force_https_redirects() -> None:
    for relative_path in (
        "infra/k8s-dev/ingress-srv.yaml",
        "infra/k8s-dev/ingress-api.yaml",
        "infra/k8s-dev/ingress-srv-uploads.yaml",
    ):
        manifest = read_repo_text(relative_path)
        assert "force-ssl-redirect" not in manifest


def test_prod_ingresses_still_force_https_redirects() -> None:
    for relative_path in (
        "infra/k8s-prod/ingress-srv.yaml",
        "infra/k8s-prod/ingress-api.yaml",
        "infra/k8s-prod/ingress-srv-uploads.yaml",
    ):
        manifest = read_repo_text(relative_path)
        assert 'nginx.ingress.kubernetes.io/force-ssl-redirect: "true"' in manifest
