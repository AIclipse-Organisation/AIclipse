from __future__ import annotations

import asyncio
import json
import logging
import re
import secrets
import string
from datetime import datetime, timezone
from typing import List, Literal, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, status
from pydantic import BaseModel, EmailStr, Field
from pymongo import ReturnDocument

from app.deps.authz import get_current_admin
from app.routers.public import (
    UserPublic,
    build_user_public,
    TokenUser,
    UserAccuracy,
    UserAccuracyRequest,
    _now_utc,
    validate_date_of_birth,
)
from app.services.passwords import PasswordService, PasswordValidationError


router = APIRouter(prefix="/admin", tags=["admin"])
logger = logging.getLogger(__name__)


REASON_CODES = (
    "test_purpose",
    "user_request",
    "spam_abuse",
    "security",
    "other",
)


def _generate_password(length: int = 16) -> str:
    if length < 4:
        raise ValueError("Password length must be at least 4")

    required_chars = [
        secrets.choice(string.ascii_lowercase),
        secrets.choice(string.ascii_uppercase),
        secrets.choice(string.digits),
        secrets.choice("!@#$%^&*?"),
    ]
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*?"
    remaining_chars = [secrets.choice(alphabet) for _ in range(length - len(required_chars))]
    password_chars = required_chars + remaining_chars
    secrets.SystemRandom().shuffle(password_chars)
    return "".join(password_chars)


class AdminCreateUserRequest(BaseModel):
    user_name: str = Field(..., min_length=1, max_length=120)
    email: EmailStr
    password: Optional[str] = Field(
        None,
        min_length=8,
        max_length=72,
        description="Password policy is max 72 UTF-8 bytes. Multi-byte characters may reduce the effective character limit.",
    )
    is_admin: bool = False
    date_of_birth: str = Field(..., pattern=r"^\d{2}-\d{2}-\d{4}$")


class AdminCreateUserResponse(BaseModel):
    user: UserPublic
    temporary_password: Optional[str] = None


class AdminUpdateUserRequest(BaseModel):
    user_name: Optional[str] = None
    email: Optional[EmailStr] = None
    password: Optional[str] = Field(
        None,
        min_length=8,
        max_length=72,
        description="Password policy is max 72 UTF-8 bytes. Multi-byte characters may reduce the effective character limit.",
    )
    date_of_birth: Optional[str] = Field(None, pattern=r"^\d{2}-\d{2}-\d{4}$")
    is_admin: Optional[bool] = None


class AdminDeleteUserRequest(BaseModel):
    reason_code: Literal[
        "test_purpose",
        "user_request",
        "spam_abuse",
        "security",
        "other",
    ]
    reason_detail: Optional[str] = Field(None, max_length=500)


class AdminListResponse(BaseModel):
    items: List[UserPublic]
    page: int
    page_size: int
    total: int


class UserDeletionLog(BaseModel):
    log_id: str
    deleted_user_id: str
    deleted_user_email: Optional[str] = None
    deleted_user_name: Optional[str] = None
    deleted_by_user_id: str
    deleted_by_email: Optional[str] = None
    reason_code: str
    reason_detail: Optional[str] = None
    deleted_at: datetime
    user_snapshot: dict


@router.get("/users", response_model=AdminListResponse)
async def admin_list_users(
    request: Request,
    search: Optional[str] = Query(None, description="Search by name or email"),
    is_admin: Optional[bool] = Query(None),
    access_status: Optional[str] = Query(None, pattern="^(approved|pending|rejected)$"),
    sort: str = Query("created_at", pattern="^(created_at|user_name|email)$"),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    admin: TokenUser = Depends(get_current_admin),
):
    users = request.app.state.user_repo.users

    filters: List[dict] = []
    if search:
        escaped = re.escape(search)
        name_pattern = {"$regex": escaped, "$options": "i"}
        # Email search is restricted to local-part only (before '@') to avoid
        # matching every account by shared domains like gmail.com.
        local_part_pattern = {"$regex": f"^[^@]*{escaped}[^@]*@", "$options": "i"}
        filters.append({"$or": [{"user_name": name_pattern}, {"email": local_part_pattern}]})
    if is_admin is not None:
        filters.append({"is_admin": is_admin})

    if access_status == "pending":
        filters.append(
            {
                "$or": [
                    {"access_status": "pending"},
                    {"$and": [{"access_status": {"$exists": False}}, {"access_granted": False}]},
                ]
            }
        )
    elif access_status == "approved":
        filters.append(
            {
                "$or": [
                    {"access_status": "approved"},
                    {
                        "$and": [
                            {"access_status": {"$exists": False}},
                            {
                                "$or": [
                                    {"access_granted": {"$exists": False}},
                                    {"access_granted": True},
                                ]
                            },
                        ]
                    },
                ]
            }
        )
    elif access_status == "rejected":
        filters.append({"access_status": "rejected"})

    if not filters:
        query: dict = {}
    elif len(filters) == 1:
        query = filters[0]
    else:
        query = {"$and": filters}

    sort_dir = -1 if order == "desc" else 1
    skip = (page - 1) * page_size

    cursor = users.find(query).sort(sort, sort_dir).skip(skip).limit(page_size)
    items: List[UserPublic] = []
    async for doc in cursor:
        items.append(build_user_public(doc))

    total = await users.count_documents(query)

    return AdminListResponse(items=items, page=page, page_size=page_size, total=total)


@router.post("/users", response_model=AdminCreateUserResponse, status_code=status.HTTP_201_CREATED)
async def admin_create_user(
    request: Request,
    body: AdminCreateUserRequest,
    admin: TokenUser = Depends(get_current_admin),
):
    users = request.app.state.user_repo.users
    pwd = PasswordService(request.app.state.cpu)

    email_norm = body.email.strip().lower()
    existing = await users.find_one({"email": email_norm})
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    generated_password = body.password is None
    raw_password = body.password or _generate_password()
    try:
        hashed = await pwd.hash_password(raw_password)
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
        "user_name": body.user_name.strip(),
        "email": email_norm,
        "password": hashed,
        "is_admin": bool(body.is_admin),
        "access_status": "approved",
        "reviewed_at": _now_utc(),
        "reviewed_by_user_id": admin.user_id,
        "plan": 0,
        "created_at": _now_utc(),
        "date_of_birth": validate_date_of_birth(body.date_of_birth),
        "total_guesses": 0,
        "total_correct": 0,
        "acc_guessing_ai": 0,
        "acc_guessing_real": 0,
        "monthly_usage_count": 0,
        "usage_reset_date": None,
        "stripe_customer_id": None,
        "do_not_show_disclaimer_again": False,
    }

    await users.insert_one(user_doc)

    return AdminCreateUserResponse(
        user=build_user_public(user_doc),
        temporary_password=raw_password if generated_password else None,
    )


# Called from model-cycle so removed the admin requirement.
@router.post("/users/accuracy", response_model=List[UserAccuracy])
async def admin_get_users_accuracy(
    request: Request,
    body: UserAccuracyRequest
):
    users_col = request.app.state.user_repo.users

    # Fetch only the users in the provided list
    cursor = users_col.find(
        {"user_id": {"$in": body.user_ids}},
        {
            "user_id": 1,
            "admin_fake_correct": 1,
            "admin_fake_total": 1,
            "admin_real_correct": 1,
            "admin_real_total": 1,
            "_id": 0
        }
    )

    results = []
    async for doc in cursor:
        results.append(UserAccuracy(**doc))

    return results


@router.get("/user/{user_id}", response_model=UserPublic)
async def admin_get_user(
    request: Request,
    user_id: str = Path(...),
    admin: TokenUser = Depends(get_current_admin),
):
    users = request.app.state.user_repo.users
    doc = await users.find_one({"user_id": user_id})
    if not doc:
        raise HTTPException(status_code=404, detail="User not found")
    return build_user_public(doc)


@router.patch("/user/{user_id}", response_model=UserPublic)
async def admin_update_user(
    request: Request,
    user_id: str,
    body: AdminUpdateUserRequest,
    admin: TokenUser = Depends(get_current_admin),
):
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
        update_doc["password"] = await pwd.hash_password(raw["password"])
    if "date_of_birth" in raw and raw["date_of_birth"] is not None:
        update_doc["date_of_birth"] = validate_date_of_birth(raw["date_of_birth"])
    if "is_admin" in raw and raw["is_admin"] is not None:
        update_doc["is_admin"] = bool(raw["is_admin"])

    if not update_doc:
        doc = await users.find_one({"user_id": user_id})
        if not doc:
            raise HTTPException(status_code=404, detail="User not found")
        return build_user_public(doc)

    result = await users.find_one_and_update(
        {"user_id": user_id},
        {"$set": update_doc},
        return_document=ReturnDocument.AFTER,
    )
    if not result:
        raise HTTPException(status_code=404, detail="User not found")

    return build_user_public(result)


@router.delete("/user/{user_id}")
async def admin_delete_user(
    request: Request,
    user_id: str,
    body: AdminDeleteUserRequest,
    admin: TokenUser = Depends(get_current_admin),
):
    users = request.app.state.user_repo.users
    logs = request.app.state.deletion_log_repo.logs

    # Delete first so audit logs only represent successful deletions.
    user_doc = await users.find_one_and_delete({"user_id": user_id})
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")

    snapshot = {k: v for k, v in user_doc.items() if k != "password"}
    if "_id" in snapshot:
        snapshot["_id"] = str(snapshot["_id"])

    log_doc = {
        "log_id": f"del_{uuid4()}",
        "deleted_user_id": user_doc.get("user_id"),
        "deleted_user_email": user_doc.get("email"),
        "deleted_user_name": user_doc.get("user_name"),
        "deleted_by_user_id": admin.user_id,
        "deleted_by_email": admin.email,
        "reason_code": body.reason_code,
        "reason_detail": body.reason_detail,
        "deleted_at": datetime.now(timezone.utc),
        "user_snapshot": snapshot,
    }

    await logs.insert_one(log_doc)

    # Keep log_id in event so workers can trace it. Example: find same log in audit logs.
    event_payload = {
        "event_type": "auth.user.deleted.admin",
        "log_id": log_doc["log_id"],
        "deleted_user_id": user_doc.get("user_id"),
        "deleted_user_email": user_doc.get("email"),
        "deleted_user_name": user_doc.get("user_name"),
        "deleted_by_user_id": admin.user_id,
        "deleted_by_email": admin.email,
        "reason_code": body.reason_code,
        "reason_detail": body.reason_detail,
        "additional_context": body.reason_detail,
        "deleted_at": log_doc["deleted_at"].isoformat(),
    }

    try:
        # Push event to Redis stream. Email worker handles it later.
        await asyncio.wait_for(
            request.app.state.event_redis.xadd(
                request.app.state.settings.AUTH_EVENT_STREAM,
                {
                    "type": "auth.user.deleted.admin",
                    "data": json.dumps(event_payload),
                },
            ),
            timeout=request.app.state.settings.AUTH_EVENT_PUBLISH_TIMEOUT_S,
        )
    except Exception:
        # Deletion should remain successful even if event publication fails
        logger.exception(
            "failed_to_publish_admin_delete_event log_id=%s user_id=%s",
            log_doc["log_id"],
            user_doc.get("user_id"),
        )

    return {
        "deleted": True,
        "log_id": log_doc["log_id"],
        "user": {
            "user_id": user_doc.get("user_id"),
            "email": user_doc.get("email"),
        },
    }


@router.get("/user-deletion-logs", response_model=List[UserDeletionLog])
async def admin_list_user_deletion_logs(
    request: Request,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    admin: TokenUser = Depends(get_current_admin),
):
    logs = request.app.state.deletion_log_repo.logs
    skip = (page - 1) * page_size

    cursor = (
        logs.find()
        .sort("deleted_at", -1)
        .skip(skip)
        .limit(page_size)
    )

    items: List[UserDeletionLog] = []
    async for doc in cursor:
        items.append(UserDeletionLog(**doc))

    return items

@router.get("/access-requests", response_model=AdminListResponse)
async def admin_list_access_requests(
    request: Request,
    search: Optional[str] = Query(None, description="Search by name or email"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    admin: TokenUser = Depends(get_current_admin),
):
    users = request.app.state.user_repo.users

    query: dict = {
        "$or": [
            {"access_status": "pending"},
            {"$and": [{"access_status": {"$exists": False}}, {"access_granted": False}]},
        ]
    }
    if search:
        escaped = re.escape(search)
        name_pattern = {"$regex": escaped, "$options": "i"}
        local_part_pattern = {"$regex": f"^[^@]*{escaped}[^@]*@", "$options": "i"}
        query["$and"] = [{"$or": [{"user_name": name_pattern}, {"email": local_part_pattern}]}]

    skip = (page - 1) * page_size
    cursor = users.find(query).sort("created_at", -1).skip(skip).limit(page_size)
    items: List[UserPublic] = []
    async for doc in cursor:
        items.append(build_user_public(doc))

    total = await users.count_documents(query)
    return AdminListResponse(items=items, page=page, page_size=page_size, total=total)


@router.post("/access-requests/{user_id}/approve", response_model=UserPublic)
async def admin_approve_access_request(
    request: Request,
    user_id: str = Path(...),
    admin: TokenUser = Depends(get_current_admin),
):
    users = request.app.state.user_repo.users
    reviewed_at = _now_utc()
    result = await users.find_one_and_update(
        {
            "user_id": user_id,
            "$or": [
                {"access_status": "pending"},
                {"$and": [{"access_status": {"$exists": False}}, {"access_granted": False}]},
            ],
        },
        {
            "$set": {
                "access_status": "approved",
                "reviewed_at": reviewed_at,
                "reviewed_by_user_id": admin.user_id,
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Access request not found")

    event_payload = {
        "event_type": "auth.access_request.approved",
        "event_id": f"access_approved_{uuid4()}",
        "approved_user_id": result.get("user_id"),
        "approved_user_email": result.get("email"),
        "approved_user_name": result.get("user_name"),
        "approved_at": reviewed_at.isoformat(),
        "approved_by_user_id": admin.user_id,
        "approved_by_email": admin.email,
    }

    try:
        await asyncio.wait_for(
            request.app.state.event_redis.xadd(
                request.app.state.settings.AUTH_EVENT_STREAM,
                {
                    "type": "auth.access_request.approved",
                    "data": json.dumps(event_payload),
                },
            ),
            timeout=request.app.state.settings.AUTH_EVENT_PUBLISH_TIMEOUT_S,
        )
    except Exception:
        safe_user_id = str(result.get("user_id") or "").replace("\r", "").replace("\n", "")
        safe_admin_user_id = str(admin.user_id or "").replace("\r", "").replace("\n", "")
        logger.exception(
            "failed_to_publish_access_approved_event user_id=%s approved_by=%s",
            safe_user_id,
            safe_admin_user_id,
        )

    return build_user_public(result)


@router.delete("/access-requests/{user_id}/reject", status_code=status.HTTP_200_OK)
async def admin_reject_access_request(
    request: Request,
    user_id: str = Path(...),
    admin: TokenUser = Depends(get_current_admin),
):
    users = request.app.state.user_repo.users
    result = await users.find_one_and_update(
        {
            "user_id": user_id,
            "$or": [
                {"access_status": "pending"},
                {"$and": [{"access_status": {"$exists": False}}, {"access_granted": False}]},
            ],
        },
        {
            "$set": {
                "access_status": "rejected",
                "reviewed_at": _now_utc(),
                "reviewed_by_user_id": admin.user_id,
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Access request not found")
    return {"rejected": True, "user_id": result.get("user_id"), "email": result.get("email")}