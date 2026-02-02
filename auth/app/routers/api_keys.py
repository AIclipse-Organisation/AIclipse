from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel
from pymongo.errors import DuplicateKeyError

from app.deps.authz import get_current_user
from app.routers.public import TokenUser
from app.services.api_keys import ApiKeyService
from app.services.tokens import TokenService

router = APIRouter(tags=["api-keys"])


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


class ApiKeyPublic(BaseModel):
    key_id: str
    created_at: datetime
    last_used_at: Optional[datetime] = None
    last4: str


class ApiKeyGetResponse(BaseModel):
    key: Optional[ApiKeyPublic] = None


class ApiKeyCreateResponse(BaseModel):
    api_key: str
    key: ApiKeyPublic


class ApiKeyExchangeRequest(BaseModel):
    api_key: str


class ApiKeyExchangeResponse(BaseModel):
    token: str
    exp: int


@router.get("/me/api-key", response_model=ApiKeyGetResponse)
async def get_my_api_key(request: Request, user: TokenUser = Depends(get_current_user)):
    keys = request.app.state.api_repo.keys
    doc = await keys.find_one({"user_id": user.user_id})
    if not doc:
        return ApiKeyGetResponse(key=None)

    pub = ApiKeyPublic(
        key_id=doc["key_id"],
        created_at=doc.get("created_at", _now_utc()),
        last_used_at=doc.get("last_used_at"),
        last4=doc.get("last4", "????"),
    )
    return ApiKeyGetResponse(key=pub)


@router.post("/me/api-key", response_model=ApiKeyCreateResponse, status_code=status.HTTP_201_CREATED)
async def rotate_my_api_key(request: Request, user: TokenUser = Depends(get_current_user)):
    users = request.app.state.user_repo.users
    keys = request.app.state.api_repo.keys

    settings = request.app.state.settings
    api = ApiKeyService(request.app.state.cpu, pepper=settings.API_KEY_PEPPER)

    user_doc = await users.find_one({"user_id": user.user_id})
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")

    now = _now_utc()

    key_id, secret, full_key = api.generate()
    secret_hash = await api.hash_secret(secret)

    doc = {
        "key_id": key_id,
        "user_id": user.user_id,
        "secret_hash": secret_hash,
        "created_at": now,
        "last_used_at": None,
        "last4": secret[-4:],
    }

    try:
        await keys.replace_one({"user_id": user.user_id}, doc, upsert=True)
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="API key rotation conflict; retry")

    pub = ApiKeyPublic(
        key_id=key_id,
        created_at=now,
        last_used_at=None,
        last4=doc["last4"],
    )
    return ApiKeyCreateResponse(api_key=full_key, key=pub)


@router.delete("/me/api-key")
async def delete_my_api_key(request: Request, user: TokenUser = Depends(get_current_user)):
    keys = request.app.state.api_repo.keys
    res = await keys.delete_one({"user_id": user.user_id})
    return {"revoked": bool(res.deleted_count)}


@router.post("/internal/api-key/exchange", response_model=ApiKeyExchangeResponse)
async def exchange_api_key(
    request: Request,
    body: ApiKeyExchangeRequest,
    x_internal_token: Optional[str] = Header(None, alias="X-Internal-Token"),
):
    settings = request.app.state.settings

    expected = settings.INTERNAL_AUTH_TOKEN
    if not x_internal_token or not ApiKeyService.constant_time_equals(x_internal_token, expected):
        raise HTTPException(status_code=403, detail="Forbidden")

    keys = request.app.state.api_repo.keys
    users = request.app.state.user_repo.users

    api = ApiKeyService(request.app.state.cpu, pepper=settings.API_KEY_PEPPER)
    tokens = TokenService(request.app.state.cpu, request.app.state.keys)

    full_key = body.api_key.strip()
    key_id, secret = api.parse_full_key(full_key)

    key_doc = await keys.find_one({"key_id": key_id})
    if not key_doc:
        raise HTTPException(status_code=401, detail="Invalid API key")

    stored = str(key_doc.get("secret_hash") or "")
    ok = await api.verify_secret(secret, stored)
    if not ok:
        raise HTTPException(status_code=401, detail="Invalid API key")

    try:
        await keys.update_one({"key_id": key_id}, {"$set": {"last_used_at": _now_utc()}})
    except Exception:
        logging.warning("Non-critical: failed to update api key", exc_info=True)

    user_doc = await users.find_one({"user_id": key_doc["user_id"]})
    if not user_doc:
        raise HTTPException(status_code=401, detail="Invalid API key")

    token, exp = await tokens.issue_api_key_token(user_doc, api_key_id=key_id)
    return ApiKeyExchangeResponse(token=token, exp=exp)
