from __future__ import annotations

from auth.gateway import GatewayClient
from services.integrations import gateway as gateway_integration
from tests.conftest import ResponseStub


def test_build_gateway_headers_forwards_https_external_proto(flask_app):
    with flask_app.test_request_context(
        "/images",
        base_url="http://aiclipse.local",
        headers={"X-Forwarded-Proto": "https, http"},
    ):
        headers = gateway_integration.build_gateway_headers(token="token-123")

    assert headers == {
        "Accept": "application/json",
        "Authorization": "Bearer token-123",
        "X-External-Proto": "https",
    }


def test_build_gateway_headers_omits_external_proto_outside_https(flask_app):
    with flask_app.test_request_context("/images", base_url="http://aiclipse.local"):
        headers = gateway_integration.build_gateway_headers(token="token-123")

    assert headers == {
        "Accept": "application/json",
        "Authorization": "Bearer token-123",
    }


def test_fetch_me_sends_bearer_token_and_uses_fixed_timeout(monkeypatch):
    captured = {}

    class FakeSession:
        def request(self, method, url, headers=None, params=None, json=None, data=None, files=None, timeout=None):
            captured.update(
                method=method,
                url=url,
                headers=headers,
                params=params,
                json=json,
                data=data,
                files=files,
                timeout=timeout,
            )
            return ResponseStub(200, {"user_id": 7, "email": "user@example.com"})

    monkeypatch.setattr(gateway_integration, "get_gateway_session", lambda: FakeSession())

    client = GatewayClient("http://gateway.test", timeout_seconds=99)
    data, status = client.fetch_me("token-123")

    assert status == 200
    assert data == {"user_id": 7, "email": "user@example.com"}
    assert captured["method"] == "GET"
    assert captured["url"] == "http://gateway.test/auth/me"
    assert captured["headers"]["Authorization"] == "Bearer token-123"
    assert captured["headers"]["Accept"] == "application/json"
    assert captured["timeout"] == 5


def test_fetch_me_returns_502_when_gateway_returns_invalid_json(monkeypatch):
    class FakeSession:
        def request(self, *args, **kwargs):
            return ResponseStub(200, json_exc=ValueError("bad json"))

    monkeypatch.setattr(gateway_integration, "get_gateway_session", lambda: FakeSession())

    client = GatewayClient("http://gateway.test")
    data, status = client.fetch_me("token")

    assert data is None
    assert status == 502


def test_call_json_returns_unreachable_error_when_request_fails(monkeypatch):
    class FakeSession:
        def request(self, *args, **kwargs):
            raise gateway_integration.requests.RequestException("boom")

    monkeypatch.setattr(gateway_integration, "get_gateway_session", lambda: FakeSession())

    client = GatewayClient("http://gateway.test", timeout_seconds=13)
    data, status = client.call_json("PATCH", "/auth/me", token="abc", json_data={"name": "Neo"})

    assert status == 502
    assert data == {"detail": "Gateway unreachable"}


def test_call_json_adds_invalid_json_fallback_and_preserves_status(monkeypatch):
    captured = {}

    class FakeSession:
        def request(self, method, url, headers=None, params=None, json=None, data=None, files=None, timeout=None):
            captured.update(
                method=method,
                url=url,
                headers=headers,
                params=params,
                json=json,
                data=data,
                files=files,
                timeout=timeout,
            )
            return ResponseStub(418, json_exc=ValueError("bad json"))

    monkeypatch.setattr(gateway_integration, "get_gateway_session", lambda: FakeSession())

    client = GatewayClient("http://gateway.test", timeout_seconds=13)
    data, status = client.call_json("DELETE", "/auth/api-key", token=None)

    assert status == 418
    assert data == {"detail": "Invalid JSON from gateway"}
    assert captured["method"] == "DELETE"
    assert captured["url"] == "http://gateway.test/auth/api-key"
    assert captured["headers"] == {"Accept": "application/json"}
    assert captured["params"] is None
    assert captured["json"] is None
    assert captured["timeout"] == 13


def test_request_gateway_response_reuses_shared_session(monkeypatch):
    session_ctor_calls = []

    class FakeSession:
        def request(self, *args, **kwargs):
            return ResponseStub(200, {"ok": True})

        def close(self):
            return None

    def fake_session_ctor():
        session_ctor_calls.append(True)
        return FakeSession()

    gateway_integration.reset_gateway_session()
    monkeypatch.setattr(gateway_integration.requests, "Session", fake_session_ctor)

    session_one = gateway_integration.get_gateway_session()
    session_two = gateway_integration.get_gateway_session()

    assert session_one is session_two
    assert len(session_ctor_calls) == 1
    gateway_integration.reset_gateway_session()
