from __future__ import annotations

import asyncio
import json
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Optional, List
from uuid import uuid4

logger = logging.getLogger(__name__)

import jwt
from email_validator import EmailNotValidError, validate_email
from fastapi import APIRouter, Depends, Header, HTTPException, Path, Request, status
from pydantic import BaseModel, EmailStr, Field
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.services.passwords import (
    PasswordService,
    PasswordValidationError,
)
from app.services.tokens import TokenService


router = APIRouter()


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)

class UserAccuracyRequest(BaseModel):
    user_ids: List[str]


class UserPublic(BaseModel):
    user_id: str
    user_name: str
    email: EmailStr
    is_admin: bool = False
    plan: int = 0
    access_status: str = "approved"
    reviewed_at: Optional[datetime] = None
    reviewed_by_user_id: Optional[str] = None
    created_at: datetime
    date_of_birth: Optional[str] = None
    total_guesses: Optional[int] = 0
    total_correct: Optional[int] = 0
    acc_guessing_ai: Optional[int] = 0
    acc_guessing_real: Optional[int] = 0
    # Admin post accuracy tracking
    admin_guesses_total: Optional[int] = 0
    admin_guesses_correct: Optional[int] = 0
    admin_fake_correct: Optional[int] = 0
    admin_fake_total: Optional[int] = 0
    admin_real_correct: Optional[int] = 0
    admin_real_total: Optional[int] = 0
    monthly_usage_count: Optional[int] = 0
    usage_reset_date: Optional[datetime] = None
    stripe_customer_id: Optional[str] = None
    do_not_show_disclaimer_again: bool = False
    do_not_show_quick_start_again: bool = False
    # Gamification fields
    community_score: Optional[int] = 0
    current_streak: Optional[int] = 0
    longest_streak: Optional[int] = 0
    last_activity_date: Optional[datetime] = None
    how_did_you_find_us: Optional[str] = None
    how_did_you_find_us_detail: Optional[str] = None


FREE_TIER_LIMIT = 10
MIN_USER_AGE = 18
MAX_USER_AGE = 150
    
class UserAccuracy(BaseModel):
    user_id: str
    admin_fake_correct: Optional[int] = 0
    admin_fake_total: Optional[int] = 0
    admin_real_correct: Optional[int] = 0
    admin_real_total: Optional[int] = 0


HOW_DID_YOU_FIND_US_OPTIONS = {
    "social_media",
    "browsing",
    "friend_or_colleague",
    "news_article",
    "youtube",
    "linkedin",
    "other",
}


class SignupRequest(BaseModel):
    user_name: str = Field(..., min_length=1)
    email: str
    date_of_birth: str = Field(..., pattern=r"^\d{2}-\d{2}-\d{4}$")
    password: str
    how_did_you_find_us: str
    how_did_you_find_us_detail: Optional[str] = None


class SignupPendingResponse(BaseModel):
    pending: bool = True
    message: str


class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    token: str
    user: UserPublic


class UpdateMeRequest(BaseModel):
    user_name: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None
    do_not_show_disclaimer_again: Optional[bool] = None
    do_not_show_quick_start_again: Optional[bool] = None


class TokenUser(BaseModel):
    user_id: str
    email: Optional[str] = None
    is_admin: bool = False
    plan: int = 0


def build_user_public(doc: dict) -> UserPublic:
    access_status = doc.get("access_status")
    if access_status not in {"pending", "approved", "rejected"}:
        access_status = "approved" if bool(doc.get("access_granted", True)) else "pending"

    return UserPublic(
        user_id=doc["user_id"],
        user_name=doc.get("user_name", ""),
        email=doc["email"],
        is_admin=bool(doc.get("is_admin", False)),
        access_status=access_status,
        reviewed_at=doc.get("reviewed_at"),
        reviewed_by_user_id=doc.get("reviewed_by_user_id"),
        plan=int(doc.get("plan", 0)),
        created_at=doc.get("created_at", _now_utc()),
        date_of_birth=doc.get("date_of_birth"),
        total_guesses=doc.get("total_guesses", 0),
        total_correct=doc.get("total_correct", 0),
        acc_guessing_ai=doc.get("acc_guessing_ai", 0),
        acc_guessing_real=doc.get("acc_guessing_real", 0),
        # Admin post accuracy
        admin_guesses_total=doc.get("admin_guesses_total", 0),
        admin_guesses_correct=doc.get("admin_guesses_correct", 0),
        admin_fake_correct=doc.get("admin_fake_correct", 0),
        admin_fake_total=doc.get("admin_fake_total", 0),
        admin_real_correct=doc.get("admin_real_correct", 0),
        admin_real_total=doc.get("admin_real_total", 0),
        monthly_usage_count=doc.get("monthly_usage_count", 0),
        usage_reset_date=doc.get("usage_reset_date"),
        stripe_customer_id=doc.get("stripe_customer_id"),
        do_not_show_disclaimer_again=bool(doc.get("do_not_show_disclaimer_again", False)),
        do_not_show_quick_start_again=bool(doc.get("do_not_show_quick_start_again", False)),
        # Gamification fields
        community_score=doc.get("community_score", 0),
        current_streak=doc.get("current_streak", 0),
        longest_streak=doc.get("longest_streak", 0),
        last_activity_date=doc.get("last_activity_date"),
        how_did_you_find_us=doc.get("how_did_you_find_us"),
        how_did_you_find_us_detail=doc.get("how_did_you_find_us_detail"),
    )


def _normalize_utc(dt: Optional[datetime]) -> Optional[datetime]:
    if not isinstance(dt, datetime):
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _next_month_start(now: datetime) -> datetime:
    return (now.replace(day=1, hour=0, minute=0, second=0, microsecond=0) + timedelta(days=32)).replace(day=1)


def _calculate_age(dob: date, today: date) -> int:
    return (today.year - dob.year) - ((today.month, today.day) < (dob.month, dob.day))


def validate_date_of_birth(date_of_birth: Optional[str], *, required: bool = False) -> Optional[str]:
    if date_of_birth is None or str(date_of_birth).strip() == "":
        if required:
            raise HTTPException(status_code=400, detail="Date of birth is required")
        return None

    try:
        dob = datetime.strptime(str(date_of_birth).strip(), "%d-%m-%Y").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Date of birth must be in DD-MM-YYYY format")

    age = _calculate_age(dob, datetime.now(timezone.utc).date())
    if age < MIN_USER_AGE:
        raise HTTPException(status_code=400, detail="You must be at least 18 years old")
    if age > MAX_USER_AGE:
        raise HTTPException(status_code=400, detail="Please provide a valid date of birth")

    return dob.strftime("%d-%m-%Y")


def normalize_email_or_400(email: Optional[str], *, required: bool = False) -> Optional[str]:
    if email is None:
        if required:
            raise HTTPException(status_code=400, detail="Email is required")
        return None

    email_raw = str(email).strip()
    if not email_raw:
        if required:
            raise HTTPException(status_code=400, detail="Email is required")
        return None

    try:
        return validate_email(email_raw, check_deliverability=False).normalized.lower()
    except EmailNotValidError:
        raise HTTPException(status_code=400, detail="Please enter a valid email address.")


def _parse_bearer_token(authorization: Optional[str]) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="Invalid Authorization header format")
    return parts[1]


def _is_user_approved(doc: dict) -> bool:
    status_val = doc.get("access_status")
    if status_val in {"pending", "approved", "rejected"}:
        return status_val == "approved"
    return bool(doc.get("access_granted", True))


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


@router.post("/signup", response_model=SignupPendingResponse, status_code=status.HTTP_202_ACCEPTED)
async def signup(request: Request, payload: SignupRequest):
    users = request.app.state.user_repo.users
    pwd = PasswordService(request.app.state.cpu)

    # Clean inputs first. Example: " Alice@EXAMPLE.com " -> "alice@example.com".
    user_name = (payload.user_name).strip()
    email_raw = (payload.email).strip()
    password = (payload.password).strip()
    date_of_birth = validate_date_of_birth(payload.date_of_birth, required=True)
    how_did_you_find_us = (payload.how_did_you_find_us or "").strip()
    how_did_you_find_us_detail = (payload.how_did_you_find_us_detail or "").strip() or None

    if not user_name:
        raise HTTPException(status_code=400, detail="Username is required")
    if not email_raw:
        raise HTTPException(status_code=400, detail="Email is required")
    if not password:
        raise HTTPException(status_code=400, detail="Password is required")
    if not how_did_you_find_us or how_did_you_find_us not in HOW_DID_YOU_FIND_US_OPTIONS:
        raise HTTPException(status_code=400, detail="Please tell us how you found us.")
    if how_did_you_find_us == "other" and not how_did_you_find_us_detail:
        raise HTTPException(status_code=400, detail="Please elaborate on how you found us.")

    email_norm = normalize_email_or_400(email_raw, required=True)

    existing = await users.find_one({"email": email_norm})
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    try:
        hashed = await pwd.hash_password(password)
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
        # Save cleaned values, not raw input.
        "user_name": user_name.strip(),
        "email": email_norm,
        "password": hashed,
        "is_admin": False,
        "access_status": "pending",
        "reviewed_at": None,
        "reviewed_by_user_id": None,
        "plan": 0,
        "created_at": _now_utc(),
        "date_of_birth": date_of_birth,
        "total_guesses": 0,
        "total_correct": 0,
        "acc_guessing_ai": 0,
        "acc_guessing_real": 0,
        "monthly_usage_count": 0,
        "usage_reset_date": None,
        "stripe_customer_id": None,
        "do_not_show_disclaimer_again": False,
        "do_not_show_quick_start_again": False,
        "how_did_you_find_us": how_did_you_find_us,
        "how_did_you_find_us_detail": how_did_you_find_us_detail,
    }

    await users.insert_one(user_doc)
    return SignupPendingResponse(
        pending=True,
        message="Thank you for your interest! An admin will review your request and get back to you shortly.",
    )


@router.post("/login", response_model=LoginResponse)
async def login(request: Request, payload: LoginRequest):
    users = request.app.state.user_repo.users
    pwd = PasswordService(request.app.state.cpu)
    tokens = TokenService(request.app.state.cpu, request.app.state.keys)

    email_norm = normalize_email_or_400(payload.email, required=True)
    user_doc = await users.find_one({"email": email_norm})
    if not user_doc:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    ok = await pwd.verify_password(payload.password, user_doc["password"])
    if not ok:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not _is_user_approved(user_doc):
        raise HTTPException(status_code=403, detail="Your account is pending admin approval.")

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
        update_doc["email"] = normalize_email_or_400(raw["email"])
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
    if "do_not_show_disclaimer_again" in raw and raw["do_not_show_disclaimer_again"] is not None:
        update_doc["do_not_show_disclaimer_again"] = bool(raw["do_not_show_disclaimer_again"])
    if "do_not_show_quick_start_again" in raw and raw["do_not_show_quick_start_again"] is not None:
        update_doc["do_not_show_quick_start_again"] = bool(raw["do_not_show_quick_start_again"])

    if not update_doc:
        doc = await users.find_one({"user_id": user.user_id})
        if not doc:
            raise HTTPException(status_code=404, detail="User not found")
        return build_user_public(doc)

    try:
        result = await users.find_one_and_update(
            {"user_id": user.user_id},
            {"$set": update_doc},
            return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Email already registered")
    if not result:
        raise HTTPException(status_code=404, detail="User not found")

    return build_user_public(result)


@router.get("/public/user/{user_id}")
async def get_public_user(request: Request, user_id: str = Path(...)):
    users = request.app.state.user_repo.users
    doc = await users.find_one({"user_id": user_id})
    if not doc:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "user_id": doc["user_id"],
        "user_name": doc.get("user_name", ""),
        "community_score": doc.get("community_score", 0),
        "current_streak": doc.get("current_streak", 0),
        "admin_guesses_correct": doc.get("admin_guesses_correct", 0),
        "admin_guesses_total": doc.get("admin_guesses_total", 0),
        "created_at": doc.get("created_at"),
    }


@router.delete("/me")
async def delete_me(request: Request, user: TokenUser = Depends(get_current_user)):
    users = request.app.state.user_repo.users
    result = await users.find_one_and_delete({"user_id": user.user_id})
    if not result:
        raise HTTPException(status_code=404, detail="User not found")

    try:
        await asyncio.wait_for(
            request.app.state.event_redis.xadd(
                request.app.state.settings.AUTH_EVENT_STREAM,
                {
                    "type": "auth.user.deleted.self",
                    "data": json.dumps({
                        "event_type": "auth.user.deleted.self",
                        "deleted_user_id": result["user_id"],
                    }),
                },
            ),
            timeout=request.app.state.settings.AUTH_EVENT_PUBLISH_TIMEOUT_S,
        )
    except Exception:
        logger.exception(
            "failed_to_publish_self_delete_event user_id=%s", result["user_id"]
        )

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
