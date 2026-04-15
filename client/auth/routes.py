from __future__ import annotations

from typing import Callable

from flask import Blueprint

from .gateway import GatewayClient
from .routes_api_keys import register_api_key_routes
from .routes_profile import register_profile_routes
from .routes_session import register_session_routes


def build_auth_blueprint(gateway: GatewayClient, *, is_signup_enabled: Callable[[], bool]) -> Blueprint:
    bp = Blueprint("auth", __name__)
    register_session_routes(bp, gateway=gateway, is_signup_enabled=is_signup_enabled)
    register_profile_routes(bp, gateway=gateway)
    register_api_key_routes(bp, gateway=gateway)
    return bp
