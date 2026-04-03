from typing import Optional

import httpx
from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query, Request, Response, status

from app.core.http_proxy import proxy_json
from app.core.settings import require_setting
from app.deps import get_current_user
from app.models import UserContext

router = APIRouter()


def _community_base_url(request: Request) -> str:
    s = request.app.state.settings
    return require_setting("COMMUNITY_URI", s.community_uri)


def _timeout(request: Request) -> float:
    return float(request.app.state.settings.http_timeout_s)


def _auth_headers(request: Request, user: UserContext | None = None) -> dict[str, str] | None:
    internal_token = require_setting(
        "INTERNAL_AUTH_TOKEN",
        request.app.state.settings.internal_auth_token,
    )
    headers = {"X-Internal-Token": internal_token}
    if user is None:
        return headers

    headers.update({
        "X-User-Id": user.user_id,
        "X-User-Is-Admin": "true" if user.is_admin else "false",
    })
    if user.email:
        headers["X-User-Email"] = user.email
    if user.user_name:
        headers["X-User-Name"] = user.user_name
    return headers


@router.get("/community/posts")
async def gateway_community_posts_get(
    request: Request,
    page: Optional[str] = Query(None),
    limit: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    image_id: Optional[str] = Query(None),
    post_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    user = None
    if authorization and authorization.strip().lower() != "bearer":
        user = await get_current_user(request, authorization=authorization)

    params = {
        key: value
        for key, value in {
            "page": page,
            "limit": limit,
            "user_id": user_id,
            "image_id": image_id,
            "post_id": post_id,
        }.items()
        if value is not None
    }
    return await proxy_json(
        request,
        "GET",
        _community_base_url(request),
        "/community/posts",
        params=params or None,
        headers=_auth_headers(request, user),
        timeout_s=_timeout(request),
    )


@router.post("/community/posts")
async def gateway_community_posts_create(
    request: Request,
    payload: dict = Body(...),
    user: UserContext = Depends(get_current_user),
):
    return await proxy_json(
        request,
        "POST",
        _community_base_url(request),
        "/community/posts",
        json_body=payload,
        headers=_auth_headers(request, user),
        timeout_s=_timeout(request),
    )


@router.patch("/community/posts")
async def gateway_community_posts_patch(
    request: Request,
    payload: dict = Body(...),
    post_id: str = Query(...),
    user: UserContext = Depends(get_current_user),
):
    return await proxy_json(
        request,
        "PATCH",
        _community_base_url(request),
        "/community/posts",
        json_body=payload,
        params={"post_id": post_id},
        headers=_auth_headers(request, user),
        timeout_s=_timeout(request),
    )


@router.delete("/community/posts")
async def gateway_community_posts_delete(
    request: Request,
    post_id: str = Query(...),
    user: UserContext = Depends(get_current_user),
):
    return await proxy_json(
        request,
        "DELETE",
        _community_base_url(request),
        "/community/posts",
        json_body={"post_id": post_id},
        params={"post_id": post_id},
        headers=_auth_headers(request, user),
        timeout_s=_timeout(request),
    )


@router.post("/community/posts/vote")
async def gateway_community_posts_vote(
    request: Request,
    payload: dict = Body(...),
    user: UserContext = Depends(get_current_user),
):
    return await proxy_json(
        request,
        "POST",
        _community_base_url(request),
        "/community/posts/vote",
        json_body=payload,
        headers=_auth_headers(request, user),
        timeout_s=_timeout(request),
    )


@router.post("/community/posts/click")
async def gateway_community_posts_click(request: Request, payload: dict = Body(...)):
    return await proxy_json(
        request,
        "POST",
        _community_base_url(request),
        "/community/posts/click",
        json_body=payload,
        headers=_auth_headers(request),
        timeout_s=_timeout(request),
    )


@router.post("/community/posts/report")
async def gateway_community_posts_report(
    request: Request,
    payload: dict = Body(...),
    user: UserContext = Depends(get_current_user),
):
    return await proxy_json(
        request,
        "POST",
        _community_base_url(request),
        "/community/posts/report",
        json_body=payload,
        headers=_auth_headers(request, user),
        timeout_s=_timeout(request),
    )


@router.post("/community/posts/moderation-status")
async def gateway_community_posts_moderation_status(request: Request, payload: dict = Body(...)):
    client: httpx.AsyncClient = request.app.state.http
    url = _community_base_url(request).rstrip("/") + "/community/posts/moderation-status"

    try:
        resp = await client.post(
            url,
            json=payload,
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
                **(_auth_headers(request) or {}),
            },
            timeout=_timeout(request),
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

    return Response(
        content=resp.content,
        status_code=resp.status_code,
        media_type="application/json",
    )


@router.get("/community/posts/comments")
async def gateway_community_comments_get(
    request: Request,
    post_id: Optional[str] = Query(None),
    comment_id: Optional[str] = Query(None),
):
    params = {
        key: value
        for key, value in {
            "post_id": post_id,
            "comment_id": comment_id,
        }.items()
        if value is not None
    }
    return await proxy_json(
        request,
        "GET",
        _community_base_url(request),
        "/community/posts/comments",
        params=params or None,
        headers=_auth_headers(request),
        timeout_s=_timeout(request),
    )


@router.post("/community/posts/comments")
async def gateway_community_comments_create(
    request: Request,
    payload: dict = Body(...),
    user: UserContext = Depends(get_current_user),
):
    return await proxy_json(
        request,
        "POST",
        _community_base_url(request),
        "/community/posts/comments",
        json_body=payload,
        headers=_auth_headers(request, user),
        timeout_s=_timeout(request),
    )


@router.delete("/community/posts/comments")
async def gateway_community_comments_delete(
    request: Request,
    comment_id: str = Query(...),
    user: UserContext = Depends(get_current_user),
):
    return await proxy_json(
        request,
        "DELETE",
        _community_base_url(request),
        "/community/posts/comments",
        params={"comment_id": comment_id},
        headers=_auth_headers(request, user),
        timeout_s=_timeout(request),
    )


@router.get("/community/notifications")
async def gateway_community_notifications(
    request: Request,
    unread_only: Optional[str] = Query(None),
    user: UserContext = Depends(get_current_user),
):
    params = {"unread_only": unread_only} if unread_only is not None else None
    return await proxy_json(
        request,
        "GET",
        _community_base_url(request),
        "/community/notifications",
        params=params,
        headers=_auth_headers(request, user),
        timeout_s=_timeout(request),
    )


@router.get("/community/notifications/unread-count")
async def gateway_community_notifications_unread_count(
    request: Request,
    user: UserContext = Depends(get_current_user),
):
    return await proxy_json(
        request,
        "GET",
        _community_base_url(request),
        "/community/notifications/unread-count",
        headers=_auth_headers(request, user),
        timeout_s=_timeout(request),
    )


@router.post("/community/notifications/read")
async def gateway_community_notifications_read(
    request: Request,
    payload: dict = Body(...),
    user: UserContext = Depends(get_current_user),
):
    return await proxy_json(
        request,
        "POST",
        _community_base_url(request),
        "/community/notifications/read",
        json_body=payload,
        headers=_auth_headers(request, user),
        timeout_s=_timeout(request),
    )
