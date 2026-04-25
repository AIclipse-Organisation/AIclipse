import logging

import httpx
from fastapi import HTTPException, Request, Response, status

from app.core.external_request import build_external_proto_headers
from app.core.settings import require_setting
from app.models import UserContext


def get_cycle_url(request: Request) -> str:
    settings = request.app.state.settings
    return require_setting("MODEL_CYCLE_URI", settings.model_cycle_uri)


def _internal_cycle_headers(request: Request, user: UserContext | None = None) -> dict[str, str]:
    settings = request.app.state.settings
    internal_token = require_setting("INTERNAL_AUTH_TOKEN", settings.internal_auth_token)

    headers: dict[str, str] = {"X-Internal-Token": internal_token}
    if user is None:
        return headers

    headers["X-User-Id"] = user.user_id
    headers["X-User-Is-Admin"] = "true" if user.is_admin else "false"
    if user.email:
        headers["X-User-Email"] = user.email
    if user.user_name:
        headers["X-User-Name"] = user.user_name
    return headers


async def proxy_cycle_request(
    request: Request,
    *,
    method: str,
    path: str,
    timeout: float = 30.0,
    include_body: bool = False,
    forward_headers: tuple[str, ...] = (),
    user: UserContext | None = None,
) -> Response:
    url = f"{get_cycle_url(request)}{path}"
    client: httpx.AsyncClient = request.app.state.http
    headers = {
        **_internal_cycle_headers(request, user),
        **build_external_proto_headers(request),
    }
    for header_name in forward_headers:
        header_value = request.headers.get(header_name)
        if header_value:
            headers[header_name] = header_value

    body = await request.body() if include_body else None
    if include_body:
        headers["Content-Type"] = request.headers.get("Content-Type", "application/json")

    try:
        resp = await client.request(
            method,
            url,
            content=body,
            headers=headers,
            timeout=timeout,
        )
    except httpx.RequestError as exc:
        logging.error("Model Cycle connection failed: %s", exc)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail="Model Cycle unreachable")

    return Response(
        content=resp.content,
        status_code=resp.status_code,
        media_type=resp.headers.get("content-type", "application/json"),
    )
