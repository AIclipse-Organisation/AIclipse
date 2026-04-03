from __future__ import annotations

from unittest.mock import Mock

import requests

from auth.gateway import GatewayClient
from tests.conftest import ResponseStub


def test_fetch_me_sends_bearer_token_and_uses_fixed_timeout(monkeypatch):
    captured = {}

    def fake_get(url, headers, timeout):
        captured.update(url=url, headers=headers, timeout=timeout)
        return ResponseStub(200, {"user_id": 7, "email": "user@example.com"})

    monkeypatch.setattr(requests, "get", fake_get)

    client = GatewayClient("http://gateway.test", timeout_seconds=99)
    data, status = client.fetch_me("token-123")

    assert status == 200
    assert data == {"user_id": 7, "email": "user@example.com"}
    assert captured["url"] == "http://gateway.test/auth/me"
    assert captured["headers"]["Authorization"] == "Bearer token-123"
    assert captured["headers"]["Accept"] == "application/json"
    assert captured["timeout"] == 5


def test_fetch_me_returns_502_when_gateway_returns_invalid_json(monkeypatch):
    monkeypatch.setattr(requests, "get", lambda *args, **kwargs: ResponseStub(200, json_exc=ValueError("bad json")))

    client = GatewayClient("http://gateway.test")
    data, status = client.fetch_me("token")

    assert data is None
    assert status == 502


def test_call_json_returns_unreachable_error_when_request_fails(monkeypatch):
    def fake_patch(*args, **kwargs):
        raise requests.RequestException("boom")

    monkeypatch.setattr(requests, "patch", fake_patch)

    client = GatewayClient("http://gateway.test", timeout_seconds=13)
    data, status = client.call_json("PATCH", "/auth/me", token="abc", json_data={"name": "Neo"})

    assert status == 502
    assert data == {"detail": "Gateway unreachable"}


def test_call_json_adds_invalid_json_fallback_and_preserves_status(monkeypatch):
    captured = {}

    def fake_delete(url, headers=None, params=None, timeout=None):
        captured.update(url=url, headers=headers, params=params, timeout=timeout)
        return ResponseStub(418, json_exc=ValueError("bad json"))

    monkeypatch.setattr(requests, "delete", fake_delete)

    client = GatewayClient("http://gateway.test", timeout_seconds=13)
    data, status = client.call_json("DELETE", "/auth/api-key", token=None)

    assert status == 418
    assert data == {"detail": "Invalid JSON from gateway"}
    assert captured["url"] == "http://gateway.test/auth/api-key"
    assert captured["headers"] == {"Accept": "application/json"}
    assert captured["params"] is None
    assert captured["timeout"] == 13
