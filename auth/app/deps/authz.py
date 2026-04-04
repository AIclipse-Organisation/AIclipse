from __future__ import annotations

import hmac
from typing import Optional

from fastapi import Depends, Header, HTTPException, Request, status

from app.routers.public import TokenUser, _parse_bearer_token, decode_jwt_local


async def get_current_user(request: Request, authorization: Optional[str] = Header(None)) -> TokenUser:
    token = _parse_bearer_token(authorization)
    return decode_jwt_local(request, token)


async def get_current_admin(user: TokenUser = Depends(get_current_user)) -> TokenUser:
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin privileges required")
    return user


async def require_internal_token(
    request: Request,
    x_internal_token: Optional[str] = Header(None, alias="X-Internal-Token"),
) -> None:
    expected = request.app.state.settings.INTERNAL_AUTH_TOKEN
    if not x_internal_token or not hmac.compare_digest(x_internal_token, expected):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
