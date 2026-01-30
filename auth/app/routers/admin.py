from __future__ import annotations

import re
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from pydantic import BaseModel, EmailStr
from pymongo import ReturnDocument

from app.deps.authz import get_current_admin
from app.routers.public import UserPublic, build_user_public, TokenUser
from app.services.passwords import PasswordService


router = APIRouter(prefix="/admin", tags=["admin"])


class AdminUpdateUserRequest(BaseModel):
    user_name: Optional[str] = None
    email: Optional[EmailStr] = None
    password: Optional[str] = None
    age: Optional[int] = None
    is_admin: Optional[bool] = None


@router.get("/users")
async def admin_list_users(
    request: Request,
    user_name: Optional[str] = Query(None),
    admin: TokenUser = Depends(get_current_admin),
):
    users = request.app.state.user_repo.users

    query: dict = {}
    if user_name:
        query["user_name"] = {"$regex": re.escape(user_name), "$options": "i"}

    cursor = users.find(query).sort("created_at", -1).limit(200)
    items: List[UserPublic] = []
    async for doc in cursor:
        items.append(build_user_public(doc))

    return {"items": items}


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
    if "age" in raw and raw["age"] is not None:
        update_doc["age"] = raw["age"]
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
    admin: TokenUser = Depends(get_current_admin),
):
    users = request.app.state.user_repo.users
    result = await users.find_one_and_delete({"user_id": user_id})
    if not result:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "deleted": True,
        "user": {
            "user_id": result["user_id"],
            "email": result["email"],
        },
    }
