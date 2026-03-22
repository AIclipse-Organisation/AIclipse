from typing import Optional

from fastapi import APIRouter, Body, Depends, Path, Query, Request

from app.core.http_proxy import proxy_json
from app.core.settings import require_setting
from app.deps import get_current_admin, get_current_user
from app.models import UserContext

router = APIRouter()


def _auth_base_url(request: Request) -> str:
    s = request.app.state.settings
    return require_setting("AUTH_URI", s.auth_uri)


def _timeout(request: Request) -> float:
    return float(request.app.state.settings.http_timeout_s)


# Public auth routes


@router.post("/auth/signup")
async def gateway_auth_signup(request: Request, payload: dict = Body(...)):
    auth_uri = _auth_base_url(request)
    return await proxy_json(
        request,
        "POST",
        auth_uri,
        "/signup",
        json_body=payload,
        timeout_s=_timeout(request),
    )


@router.post("/auth/login")
async def gateway_auth_login(request: Request, payload: dict = Body(...)):
    auth_uri = _auth_base_url(request)
    return await proxy_json(
        request,
        "POST",
        auth_uri,
        "/login",
        json_body=payload,
        timeout_s=_timeout(request),
    )


@router.get("/auth/me")
async def gateway_auth_me_get(request: Request, user: UserContext = Depends(get_current_user)):
    auth_uri = _auth_base_url(request)
    return await proxy_json(
        request,
        "GET",
        auth_uri,
        "/me",
        headers={"Authorization": f"Bearer {user.token}"},
        timeout_s=_timeout(request),
    )


@router.patch("/auth/me")
async def gateway_auth_me_patch(
    request: Request,
    payload: dict = Body(...),
    user: UserContext = Depends(get_current_user),
):
    auth_uri = _auth_base_url(request)
    return await proxy_json(
        request,
        "PATCH",
        auth_uri,
        "/me",
        json_body=payload,
        headers={"Authorization": f"Bearer {user.token}"},
        timeout_s=_timeout(request),
    )


@router.delete("/auth/me")
async def gateway_auth_me_delete(request: Request, user: UserContext = Depends(get_current_user)):
    auth_uri = _auth_base_url(request)
    return await proxy_json(
        request,
        "DELETE",
        auth_uri,
        "/me",
        headers={"Authorization": f"Bearer {user.token}"},
        timeout_s=_timeout(request),
    )


# Admin auth routes


@router.get("/auth/admin/users")
async def gateway_admin_list_users(
    request: Request,
    search: Optional[str] = Query(None),
    user_name: Optional[str] = Query(None),
    is_admin: Optional[bool] = Query(None),
    access_status: Optional[str] = Query(None),
    sort: str = Query("created_at"),
    order: str = Query("desc"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    admin: UserContext = Depends(get_current_admin),
):
    auth_uri = _auth_base_url(request)
    normalized_search = search if search is not None else user_name

    params: dict = {
        "page": page,
        "page_size": page_size,
        "sort": sort,
        "order": order,
    }
    if normalized_search:
        params["search"] = normalized_search
    if user_name:
        params["user_name"] = user_name
    if is_admin is not None:
        params["is_admin"] = is_admin
    if access_status:
        params["access_status"] = access_status

    return await proxy_json(
        request,
        "GET",
        auth_uri,
        "/admin/users",
        headers={"Authorization": f"Bearer {admin.token}"},
        params=params,
        timeout_s=_timeout(request),
    )


@router.post("/auth/admin/users")
async def gateway_admin_create_user(
    request: Request,
    payload: dict = Body(...),
    admin: UserContext = Depends(get_current_admin),
):
    auth_uri = _auth_base_url(request)
    return await proxy_json(
        request,
        "POST",
        auth_uri,
        "/admin/users",
        json_body=payload,
        headers={"Authorization": f"Bearer {admin.token}"},
        timeout_s=_timeout(request),
    )


@router.get("/auth/admin/user/{user_id}")
async def gateway_admin_get_user(
    request: Request,
    user_id: str = Path(...),
    admin: UserContext = Depends(get_current_admin),
):
    auth_uri = _auth_base_url(request)
    return await proxy_json(
        request,
        "GET",
        auth_uri,
        f"/admin/user/{user_id}",
        headers={"Authorization": f"Bearer {admin.token}"},
        timeout_s=_timeout(request),
    )


@router.patch("/auth/admin/user/{user_id}")
async def gateway_admin_update_user(
    request: Request,
    user_id: str = Path(...),
    payload: dict = Body(...),
    admin: UserContext = Depends(get_current_admin),
):
    auth_uri = _auth_base_url(request)
    return await proxy_json(
        request,
        "PATCH",
        auth_uri,
        f"/admin/user/{user_id}",
        json_body=payload,
        headers={"Authorization": f"Bearer {admin.token}"},
        timeout_s=_timeout(request),
    )


@router.delete("/auth/admin/user/{user_id}")
async def gateway_admin_delete_user(
    request: Request,
    user_id: str = Path(...),
    payload: dict = Body(...),
    admin: UserContext = Depends(get_current_admin),
):
    auth_uri = _auth_base_url(request)
    return await proxy_json(
        request,
        "DELETE",
        auth_uri,
        f"/admin/user/{user_id}",
        json_body=payload,
        headers={"Authorization": f"Bearer {admin.token}"},
        timeout_s=_timeout(request),
    )


@router.get("/auth/admin/user-deletion-logs")
async def gateway_admin_deletion_logs(
    request: Request,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    admin: UserContext = Depends(get_current_admin),
):
    auth_uri = _auth_base_url(request)
    params = {"page": page, "page_size": page_size}

    return await proxy_json(
        request,
        "GET",
        auth_uri,
        "/admin/user-deletion-logs",
        headers={"Authorization": f"Bearer {admin.token}"},
        params=params,
        timeout_s=_timeout(request),
    )


@router.get("/auth/admin/access-requests")
async def gateway_admin_access_requests(
    request: Request,
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    admin: UserContext = Depends(get_current_admin),
):
    auth_uri = _auth_base_url(request)
    params: dict = {"page": page, "page_size": page_size}
    if search:
        params["search"] = search

    return await proxy_json(
        request,
        "GET",
        auth_uri,
        "/admin/access-requests",
        headers={"Authorization": f"Bearer {admin.token}"},
        params=params,
        timeout_s=_timeout(request),
    )


@router.post("/auth/admin/access-requests/{user_id}/approve")
async def gateway_admin_approve_access_request(
    request: Request,
    user_id: str = Path(...),
    admin: UserContext = Depends(get_current_admin),
):
    auth_uri = _auth_base_url(request)
    return await proxy_json(
        request,
        "POST",
        auth_uri,
        f"/admin/access-requests/{user_id}/approve",
        headers={"Authorization": f"Bearer {admin.token}"},
        timeout_s=_timeout(request),
    )


@router.delete("/auth/admin/access-requests/{user_id}/reject")
async def gateway_admin_reject_access_request(
    request: Request,
    user_id: str = Path(...),
    admin: UserContext = Depends(get_current_admin),
):
    auth_uri = _auth_base_url(request)
    return await proxy_json(
        request,
        "DELETE",
        auth_uri,
        f"/admin/access-requests/{user_id}/reject",
        headers={"Authorization": f"Bearer {admin.token}"},
        timeout_s=_timeout(request),
    )


# API key routes


@router.get("/auth/api-key")
async def gateway_get_api_key(request: Request, user: UserContext = Depends(get_current_user)):
    auth_uri = _auth_base_url(request)
    return await proxy_json(
        request,
        "GET",
        auth_uri,
        "/me/api-key",
        headers={"Authorization": f"Bearer {user.token}"},
        timeout_s=_timeout(request),
    )


@router.post("/auth/api-key")
async def gateway_rotate_api_key(request: Request, user: UserContext = Depends(get_current_user)):
    auth_uri = _auth_base_url(request)
    return await proxy_json(
        request,
        "POST",
        auth_uri,
        "/me/api-key",
        headers={"Authorization": f"Bearer {user.token}"},
        timeout_s=_timeout(request),
    )


@router.delete("/auth/api-key")
async def gateway_delete_api_key(request: Request, user: UserContext = Depends(get_current_user)):
    auth_uri = _auth_base_url(request)
    return await proxy_json(
        request,
        "DELETE",
        auth_uri,
        "/me/api-key",
        headers={"Authorization": f"Bearer {user.token}"},
        timeout_s=_timeout(request),
    )


# Usage routes


@router.post("/usage/check")
async def usage_check(request: Request, user: UserContext = Depends(get_current_user)):
    auth_uri = _auth_base_url(request)
    return await proxy_json(
        request,
        "POST",
        auth_uri,
        "/usage/check",
        headers={"Authorization": f"Bearer {user.token}"},
        timeout_s=_timeout(request),
    )


@router.post("/usage/increment")
async def usage_increment(request: Request, user: UserContext = Depends(get_current_user)):
    auth_uri = _auth_base_url(request)
    return await proxy_json(
        request,
        "POST",
        auth_uri,
        "/usage/increment",
        headers={"Authorization": f"Bearer {user.token}"},
        timeout_s=_timeout(request),
    )