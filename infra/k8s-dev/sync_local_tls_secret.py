from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


SECRET_NAME = "aiclipse-local-tls"
DEFAULT_NAMESPACE = "default"
DEFAULT_CERT_DIR = Path("infra") / "k8s-dev" / "certs"
DEFAULT_CERT_FILE = "aiclipse.local+1.pem"
DEFAULT_KEY_FILE = "aiclipse.local+1-key.pem"


def _workspace_root() -> Path:
    env_root = os.environ.get("SKAFFOLD_WORK_DIR")
    if env_root:
        return Path(env_root).resolve()
    return Path(__file__).resolve().parents[2]


def _resolve_path(raw_value: str | None, default_path: Path) -> Path:
    if raw_value:
        path = Path(raw_value)
        if not path.is_absolute():
            path = _workspace_root() / path
        return path.resolve()
    return (_workspace_root() / default_path).resolve()


def _kubectl_env() -> dict[str, str]:
    env = os.environ.copy()
    env.pop("HTTP_PROXY", None)
    env.pop("HTTPS_PROXY", None)
    env.pop("http_proxy", None)
    env.pop("https_proxy", None)

    no_proxy_values = [
        value.strip()
        for value in env.get("NO_PROXY", "").split(",")
        if value.strip()
    ]
    for host in (
        "localhost",
        "127.0.0.1",
        "::1",
        "kubernetes.docker.internal",
        "aiclipse.local",
        "storage.aiclipse.local",
    ):
        if host not in no_proxy_values:
            no_proxy_values.append(host)
    env["NO_PROXY"] = ",".join(no_proxy_values)
    env["no_proxy"] = env["NO_PROXY"]
    return env


def _run_kubectl(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["kubectl", *args],
        check=True,
        text=True,
        capture_output=True,
        env=_kubectl_env(),
    )


def main() -> int:
    cert_path = _resolve_path(
        os.environ.get("AICLIPSE_LOCAL_TLS_CERT_FILE"),
        DEFAULT_CERT_DIR / DEFAULT_CERT_FILE,
    )
    key_path = _resolve_path(
        os.environ.get("AICLIPSE_LOCAL_TLS_KEY_FILE"),
        DEFAULT_CERT_DIR / DEFAULT_KEY_FILE,
    )
    namespace = os.environ.get("AICLIPSE_LOCAL_TLS_NAMESPACE", DEFAULT_NAMESPACE)

    cert_exists = cert_path.is_file()
    key_exists = key_path.is_file()

    if not cert_exists and not key_exists:
        print(
            f"[skaffold tls] skipping {SECRET_NAME}: "
            f"no cert files found at {cert_path} and {key_path}",
        )
        return 0

    if not cert_exists or not key_exists:
        print(
            f"[skaffold tls] skipping {SECRET_NAME}: "
            f"expected both cert and key, got cert={cert_exists} key={key_exists}",
            file=sys.stderr,
        )
        return 0

    create_cmd = [
        "create",
        "secret",
        "tls",
        SECRET_NAME,
        f"--cert={cert_path}",
        f"--key={key_path}",
        "--dry-run=client",
        "-o",
        "yaml",
        "-n",
        namespace,
    ]
    apply_cmd = ["apply", "-f", "-", "-n", namespace]

    secret_yaml = _run_kubectl(create_cmd).stdout
    applied = subprocess.run(
        ["kubectl", *apply_cmd],
        input=secret_yaml,
        check=True,
        text=True,
        capture_output=True,
        env=_kubectl_env(),
    )

    print(
        f"[skaffold tls] synced {SECRET_NAME} from {cert_path.name} / {key_path.name}: "
        f"{applied.stdout.strip()}",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
