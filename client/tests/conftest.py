from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from flask import Flask


CLIENT_ROOT = Path(__file__).resolve().parents[1]
if str(CLIENT_ROOT) not in sys.path:
    sys.path.insert(0, str(CLIENT_ROOT))


class ResponseStub:
    def __init__(self, status_code: int, json_data=None, *, json_exc: Exception | None = None):
        self.status_code = status_code
        self._json_data = json_data
        self._json_exc = json_exc

    def json(self):
        if self._json_exc is not None:
            raise self._json_exc
        return self._json_data


@pytest.fixture
def flask_app() -> Flask:
    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.config.update(TESTING=True)
    return app


@pytest.fixture
def auth_app_factory():
    from auth.middleware import register_auth_middleware
    from auth.routes import build_auth_blueprint

    def _factory(*, gateway=None, signup_enabled=lambda: True, with_blueprint=True, with_middleware=False):
        app = Flask(__name__)
        app.secret_key = "test-secret"
        app.config.update(TESTING=True)

        if gateway is None:
            gateway = SimpleNamespace(
                fetch_me=lambda token: (None, 500),
                login=lambda email, password: (None, 500),
                signup=lambda user_name, email, password: (None, 500),
                call_json=lambda method, path, **kwargs: (None, 500),
            )

        if with_blueprint:
            app.register_blueprint(build_auth_blueprint(gateway, is_signup_enabled=signup_enabled))
        if with_middleware:
            register_auth_middleware(app, gateway)
        return app, gateway

    return _factory


@pytest.fixture
def main_client_module(monkeypatch):
    monkeypatch.setenv("FLASK_SECRET_KEY", "test-secret")
    monkeypatch.setenv("APP_ENV", "dev")
    monkeypatch.setenv("GATEWAY_URI", "http://gateway.test")
    monkeypatch.setenv("COMMUNITY_URI", "http://community.test")
    monkeypatch.delenv("CENTRAL_CONFIG_URL", raising=False)

    sys.modules.pop("config", None)

    module_name = "client_main_for_tests"
    sys.modules.pop(module_name, None)

    spec = importlib.util.spec_from_file_location(module_name, CLIENT_ROOT / "main-client.py")
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)

    module.app.config.update(TESTING=True)
    module.app.secret_key = "test-secret"
    return module
