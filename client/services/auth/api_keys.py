from __future__ import annotations

from typing import Literal

from auth.gateway import GatewayClient


def proxy_api_key_request(
    gateway: GatewayClient,
    *,
    token: str,
    method: Literal["GET", "POST", "DELETE"],
) -> tuple[dict, int]:
    data, status = gateway.call_json(method, "/auth/api-key", token=token)
    if data is None:
        data = {"detail": "Invalid JSON from gateway"}
    return data, status
