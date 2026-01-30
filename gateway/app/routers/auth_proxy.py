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
    user_name: Optional[str] = Query(None),
    admin: UserContext = Depends(get_current_admin),
):
    auth_uri = _auth_base_url(request)

    params: dict = {}
    if user_name:
        params["user_name"] = user_name

    return await proxy_json(
        request,
        "GET",
        auth_uri,
        "/admin/users",
        headers={"Authorization": f"Bearer {admin.token}"},
        params=params,
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
    admin: UserContext = Depends(get_current_admin),
):
    auth_uri = _auth_base_url(request)
    return await proxy_json(
        request,
        "DELETE",
        auth_uri,
        f"/admin/user/{user_id}",
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
