from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import uuid4

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field
from pymongo import ReturnDocument

from app.services.passwords import (
    PasswordService,
    PasswordValidationError,
)
from app.services.tokens import TokenService


router = APIRouter()


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


class UserPublic(BaseModel):
    user_id: str
    user_name: str
    email: EmailStr
    is_admin: bool = False
    plan: int = 0
    created_at: datetime
    age: Optional[int] = None
    total_guesses: Optional[int] = 0
    total_correct: Optional[int] = 0
    acc_guessing_ai: Optional[int] = 0
    acc_guessing_real: Optional[int] = 0
    monthly_usage_count: Optional[int] = 0
    usage_reset_date: Optional[datetime] = None
    stripe_customer_id: Optional[str] = None


FREE_TIER_LIMIT = 10


class SignupRequest(BaseModel):
    user_name: str = Field(..., min_length=1)
    email: EmailStr
    password: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class LoginResponse(BaseModel):
    token: str
    user: UserPublic


class UpdateMeRequest(BaseModel):
    user_name: Optional[str] = None
    email: Optional[EmailStr] = None
    password: Optional[str] = None


class TokenUser(BaseModel):
    user_id: str
    email: Optional[str] = None
    is_admin: bool = False
    plan: int = 0


def build_user_public(doc: dict) -> UserPublic:
    return UserPublic(
        user_id=doc["user_id"],
        user_name=doc.get("user_name", ""),
        email=doc["email"],
        is_admin=bool(doc.get("is_admin", False)),
        plan=int(doc.get("plan", 0)),
        created_at=doc.get("created_at", _now_utc()),
        age=doc.get("age"),
        total_guesses=doc.get("total_guesses", 0),
        total_correct=doc.get("total_correct", 0),
        acc_guessing_ai=doc.get("acc_guessing_ai", 0),
        acc_guessing_real=doc.get("acc_guessing_real", 0),
        monthly_usage_count=doc.get("monthly_usage_count", 0),
        usage_reset_date=doc.get("usage_reset_date"),
        stripe_customer_id=doc.get("stripe_customer_id"),
    )


def _normalize_utc(dt: Optional[datetime]) -> Optional[datetime]:
    if not isinstance(dt, datetime):
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _next_month_start(now: datetime) -> datetime:
    return (now.replace(day=1, hour=0, minute=0, second=0, microsecond=0) + timedelta(days=32)).replace(day=1)


def _parse_bearer_token(authorization: Optional[str]) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="Invalid Authorization header format")
    return parts[1]


def decode_jwt_local(request: Request, token: str) -> TokenUser:
    public_key = request.app.state.keys.public_key
    try:
        payload = jwt.decode(token, key=public_key, algorithms=["RS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Token missing sub")

    return TokenUser(
        user_id=str(user_id),
        email=payload.get("email"),
        is_admin=bool(payload.get("is_admin", False)),
        plan=int(payload.get("plan", 0)),
    )


async def get_current_user(request: Request, authorization: Optional[str] = Header(None)) -> TokenUser:
    token = _parse_bearer_token(authorization)
    return decode_jwt_local(request, token)


@router.post("/signup", response_model=UserPublic, status_code=status.HTTP_201_CREATED)
async def signup(request: Request, payload: SignupRequest):
    users = request.app.state.user_repo.users
    pwd = PasswordService(request.app.state.cpu)

    email_norm = payload.email.strip().lower()
    existing = await users.find_one({"email": email_norm})
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    try:
        hashed = await pwd.hash_password(payload.password)
    except PasswordValidationError as e:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "weak_password",
                "message": str(e),
                "checks": e.checks,
                "failed": e.failed,
            },
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    user_doc = {
        "user_id": f"u_{uuid4()}",
        "user_name": payload.user_name.strip(),
        "email": email_norm,
        "password": hashed,
        "is_admin": False,
        "plan": 0,
        "created_at": _now_utc(),
        "age": None,
        "total_guesses": 0,
        "total_correct": 0,
        "acc_guessing_ai": 0,
        "acc_guessing_real": 0,
        "monthly_usage_count": 0,
        "usage_reset_date": None,
        "stripe_customer_id": None,
    }

    await users.insert_one(user_doc)
    return build_user_public(user_doc)


@router.post("/login", response_model=LoginResponse)
async def login(request: Request, payload: LoginRequest):
    users = request.app.state.user_repo.users
    pwd = PasswordService(request.app.state.cpu)
    tokens = TokenService(request.app.state.cpu, request.app.state.keys)

    email_norm = payload.email.strip().lower()
    user_doc = await users.find_one({"email": email_norm})
    if not user_doc:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    ok = await pwd.verify_password(payload.password, user_doc["password"])
    if not ok:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = await tokens.issue_user_token(user_doc)
    return LoginResponse(token=token, user=build_user_public(user_doc))


@router.get("/me", response_model=UserPublic)
async def get_me(request: Request, user: TokenUser = Depends(get_current_user)):
    users = request.app.state.user_repo.users
    doc = await users.find_one({"user_id": user.user_id})
    if not doc:
        raise HTTPException(status_code=404, detail="User not found")
    return build_user_public(doc)


@router.patch("/me", response_model=UserPublic)
async def update_me(request: Request, body: UpdateMeRequest, user: TokenUser = Depends(get_current_user)):
    users = request.app.state.user_repo.users
    pwd = PasswordService(request.app.state.cpu)

    raw = body.model_dump(exclude_unset=True)
    if any(str(k).startswith("$") for k in raw.keys()):
        raise HTTPException(status_code=400, detail="Update operators not allowed")

    update_doc: dict = {}
    if "user_name" in raw and raw["user_name"] is not None:
        update_doc["user_name"] = raw["user_name"].strip()
    if "email" in raw and raw["email"] is not None:
        update_doc["email"] = raw["email"].strip().lower()
    if "password" in raw and raw["password"]:
        try:
            update_doc["password"] = await pwd.hash_password(raw["password"])
        except PasswordValidationError as e:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "weak_password",
                    "message": str(e),
                    "checks": e.checks,
                    "failed": e.failed,
                },
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    if not update_doc:
        doc = await users.find_one({"user_id": user.user_id})
        if not doc:
            raise HTTPException(status_code=404, detail="User not found")
        return build_user_public(doc)

    result = await users.find_one_and_update(
        {"user_id": user.user_id},
        {"$set": update_doc},
        return_document=ReturnDocument.AFTER,
    )
    if not result:
        raise HTTPException(status_code=404, detail="User not found")

    return build_user_public(result)


@router.delete("/me")
async def delete_me(request: Request, user: TokenUser = Depends(get_current_user)):
    users = request.app.state.user_repo.users
    result = await users.find_one_and_delete({"user_id": user.user_id})
    if not result:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "deleted": True,
        "user_id": result["user_id"],
        "message": "Your account has been permanently deleted",
    }


@router.post("/usage/check")
async def check_usage(request: Request, user: TokenUser = Depends(get_current_user)):
    users = request.app.state.user_repo.users

    doc = await users.find_one({"user_id": user.user_id})
    if not doc:
        raise HTTPException(status_code=404, detail="User not found")

    plan = int(doc.get("plan", 0))
    monthly_usage = int(doc.get("monthly_usage_count", 0))
    usage_reset_date = _normalize_utc(doc.get("usage_reset_date"))
    now = _now_utc()

    if usage_reset_date is None or now >= usage_reset_date:
        next_reset = _next_month_start(now)
        await users.update_one(
            {"user_id": user.user_id},
            {"$set": {"monthly_usage_count": 0, "usage_reset_date": next_reset}},
        )
        monthly_usage = 0
        usage_reset_date = next_reset

    if plan != 0:
        return {
            "allowed": True,
            "plan": plan,
            "unlimited": True,
            "monthly_usage": monthly_usage,
            "limit": FREE_TIER_LIMIT,
            "remaining": None,
            "usage_reset_date": usage_reset_date,
        }

    remaining = FREE_TIER_LIMIT - monthly_usage
    return {
        "allowed": monthly_usage < FREE_TIER_LIMIT,
        "plan": plan,
        "unlimited": False,
        "monthly_usage": monthly_usage,
        "limit": FREE_TIER_LIMIT,
        "remaining": max(0, remaining),
        "usage_reset_date": usage_reset_date,
    }


@router.post("/usage/increment")
async def increment_usage(request: Request, user: TokenUser = Depends(get_current_user)):
    users = request.app.state.user_repo.users

    doc = await users.find_one({"user_id": user.user_id})
    if not doc:
        raise HTTPException(status_code=404, detail="User not found")

    plan = int(doc.get("plan", 0))

    usage_reset_date = _normalize_utc(doc.get("usage_reset_date"))
    now = _now_utc()

    if usage_reset_date is None or now >= usage_reset_date:
        next_reset = _next_month_start(now)
        await users.update_one(
            {"user_id": user.user_id},
            {"$set": {"monthly_usage_count": 0, "usage_reset_date": next_reset}},
        )

    await users.update_one({"user_id": user.user_id}, {"$inc": {"monthly_usage_count": 1}})
    updated = await users.find_one({"user_id": user.user_id})
    return {
        "incremented": True,
        "plan": plan,
        "unlimited": plan != 0,
        "monthly_usage": int((updated or {}).get("monthly_usage_count", 0)),
    }
