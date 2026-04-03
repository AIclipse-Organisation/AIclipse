from typing import Optional, Tuple

import httpx
from fastapi import Depends, Header, HTTPException, Request, status

from app.core.jwks import decode_jwt_rs256
from app.core.settings import require_setting
from app.models import UserContext

API_KEY_ALLOWED_PATHS = {"/v1/checks", "/checks"}


def _parse_bearer_token(authorization: Optional[str]) -> str:
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing auth token (Authorization Bearer or auth cookie)",
        )
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Authorization header format",
        )
    return parts[1]


def _require_internal_token(request: Request) -> str:
    s = request.app.state.settings
    return require_setting("INTERNAL_AUTH_TOKEN", s.internal_auth_token)


def _parse_bool_header(value: Optional[str]) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


async def _exchange_api_key_for_jwt(request: Request, api_key: str) -> Tuple[str, int]:
    """
    Exchange API key -> short-lived RS256 JWT in Auth service.
    Returns (jwt, exp_unix).
    """
    s = request.app.state.settings
    auth_uri = require_setting("AUTH_URI", s.auth_uri)

    url = auth_uri.rstrip("/") + "/internal/api-key/exchange"
    headers = {
        "Accept": "application/json",
        "X-Internal-Token": _require_internal_token(request),
    }

    client: httpx.AsyncClient = request.app.state.http

    try:
        resp = await client.post(url, json={"api_key": api_key}, headers=headers, timeout=5.0)
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Auth exchange unreachable: {exc}",
        )

    if resp.status_code == 401:
        raise HTTPException(status_code=401, detail="Invalid API key")
    if resp.status_code == 403:
        raise HTTPException(status_code=403, detail="API key exchange forbidden")
    if resp.status_code >= 500:
        raise HTTPException(status_code=502, detail="Auth service error on exchange")

    try:
        data = resp.json()
    except ValueError:
        raise HTTPException(status_code=502, detail="Auth exchange returned invalid JSON")

    token = data.get("token")
    exp = data.get("exp")
    if not token or not exp:
        raise HTTPException(status_code=502, detail="Auth exchange missing token/exp")

    return str(token), int(exp)


async def get_current_user(
    request: Request,
    authorization: Optional[str] = Header(None),
) -> UserContext:
    token = _parse_bearer_token(authorization)
    payload = await decode_jwt_rs256(request, token)

    user_id = payload.get("sub") or payload.get("user_id")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing subject",
        )

    return UserContext(
        user_id=str(user_id),
        email=payload.get("email"),
        is_admin=bool(payload.get("is_admin", False)),
        plan=payload.get("plan"),
        user_name=payload.get("user_name"),
        token=token,
    )


async def get_current_user_any(
    request: Request,
    authorization: Optional[str] = Header(None),
    x_api_key: Optional[str] = Header(None, alias="X-Api-Key"),
) -> UserContext:
    """
    Accept either:
      - X-Api-Key (only on whitelisted routes) -> exchange -> RS256 verify -> UserContext
      - Authorization: Bearer <jwt> (normal browser flow)
    """
    if x_api_key:
        if request.url.path not in API_KEY_ALLOWED_PATHS:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="API key not allowed on this route",
            )

        jwt_token, _exp = await _exchange_api_key_for_jwt(request, x_api_key)
        payload = await decode_jwt_rs256(request, jwt_token)

        user_id = payload.get("sub") or payload.get("user_id")
        if not user_id:
            raise HTTPException(status_code=401, detail="Token missing subject")

        return UserContext(
            user_id=str(user_id),
            email=payload.get("email"),
            is_admin=bool(payload.get("is_admin", False)),
            plan=payload.get("plan"),
            user_name=payload.get("user_name"),
            token=jwt_token,
        )

    return await get_current_user(request, authorization=authorization)


async def get_internal_user(
    request: Request,
    x_internal_token: Optional[str] = Header(None, alias="X-Internal-Token"),
    x_user_id: Optional[str] = Header(None, alias="X-User-Id"),
    x_user_email: Optional[str] = Header(None, alias="X-User-Email"),
    x_user_name: Optional[str] = Header(None, alias="X-User-Name"),
    x_user_is_admin: Optional[str] = Header(None, alias="X-User-Is-Admin"),
) -> UserContext:
    expected_token = _require_internal_token(request)
    if x_internal_token != expected_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid internal auth token",
        )

    user_id = str(x_user_id or "").strip()
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing forwarded user id",
        )

    return UserContext(
        user_id=user_id,
        email=(str(x_user_email).strip() or None) if x_user_email is not None else None,
        user_name=(str(x_user_name).strip() or None) if x_user_name is not None else None,
        is_admin=_parse_bool_header(x_user_is_admin),
    )


async def require_internal_request(
    request: Request,
    x_internal_token: Optional[str] = Header(None, alias="X-Internal-Token"),
) -> bool:
    expected_token = _require_internal_token(request)
    if x_internal_token != expected_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid internal auth token",
        )
    return True


async def get_current_user_or_internal(
    request: Request,
    authorization: Optional[str] = Header(None),
    x_internal_token: Optional[str] = Header(None, alias="X-Internal-Token"),
    x_user_id: Optional[str] = Header(None, alias="X-User-Id"),
    x_user_email: Optional[str] = Header(None, alias="X-User-Email"),
    x_user_name: Optional[str] = Header(None, alias="X-User-Name"),
    x_user_is_admin: Optional[str] = Header(None, alias="X-User-Is-Admin"),
) -> UserContext:
    if authorization:
        return await get_current_user(request, authorization=authorization)

    return await get_internal_user(
        request,
        x_internal_token=x_internal_token,
        x_user_id=x_user_id,
        x_user_email=x_user_email,
        x_user_name=x_user_name,
        x_user_is_admin=x_user_is_admin,
    )


async def get_current_admin(user: UserContext = Depends(get_current_user)) -> UserContext:
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )
    return user
