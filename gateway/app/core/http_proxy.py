from typing import Optional

import httpx
from fastapi import HTTPException, Request, Response, status


async def proxy_json(
    request: Request,
    method: str,
    base_url: str,
    path: str,
    *,
    json_body: Optional[dict] = None,
    headers: Optional[dict] = None,
    params: Optional[dict] = None,
    timeout_s: float = 10.0,
) -> Response:
    url = base_url.rstrip("/") + path

    client: httpx.AsyncClient = request.app.state.http
    try:
        resp = await client.request(
            method=method,
            url=url,
            json=json_body,
            headers=headers,
            params=params,
            timeout=timeout_s,
        )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Upstream request failed: {exc}",
        )

    if 500 <= resp.status_code <= 599:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Upstream service error",
        )

    content_type = resp.headers.get("content-type", "application/json")
    return Response(
        content=resp.content,
        status_code=resp.status_code,
        media_type=content_type,
    )


async def proxy_raw(
    request: Request,
    method: str,
    base_url: str,
    path: str,
    *,
    forward_headers: Optional[list[str]] = None,
    timeout_s: float = 10.0,
) -> Response:
    """Proxy a request forwarding the raw body bytes unchanged.

    Use this instead of proxy_json whenever the upstream must receive the
    original bytes (e.g. Stripe webhook signature verification).
    """
    url = base_url.rstrip("/") + path
    raw_body = await request.body()

    headers: dict = {}
    for header_name in (forward_headers or []):
        value = request.headers.get(header_name)
        if value:
            headers[header_name] = value

    client: httpx.AsyncClient = request.app.state.http
    try:
        resp = await client.request(
            method=method,
            url=url,
            content=raw_body,
            headers=headers,
            timeout=timeout_s,
        )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Upstream request failed: {exc}",
        )

    if 500 <= resp.status_code <= 599:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Upstream service error",
        )

    content_type = resp.headers.get("content-type", "application/json")
    return Response(
        content=resp.content,
        status_code=resp.status_code,
        media_type=content_type,
    )
