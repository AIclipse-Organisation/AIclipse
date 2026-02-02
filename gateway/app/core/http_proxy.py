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
