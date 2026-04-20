from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Dict, Optional

from typing import List

from fastapi import APIRouter, Depends, HTTPException, Path, Request
from pydantic import BaseModel

from app.deps.authz import require_internal_token
from app.routers.public import UserAccuracy, UserAccuracyRequest

router = APIRouter(prefix="/internal", tags=["internal"], dependencies=[Depends(require_internal_token)])
logger = logging.getLogger(__name__)


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


# ── User info (used by billing to read plan) ──────────────────────────

class UserInfoResponse(BaseModel):
    user_id: str
    plan: int
    stripe_customer_id: Optional[str] = None


@router.get("/user/{user_id}", response_model=UserInfoResponse)
async def get_user_info(
    request: Request,
    user_id: str = Path(...),
):
    users = request.app.state.user_repo.users
    doc = await users.find_one(
        {"user_id": user_id},
        {"plan": 1, "stripe_customer_id": 1},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="User not found")

    return UserInfoResponse(
        user_id=user_id,
        plan=int(doc.get("plan", 0) or 0),
        stripe_customer_id=doc.get("stripe_customer_id"),
    )


# ── Plan update (used by billing) ──────────────────────────────────────

class UpdatePlanRequest(BaseModel):
    plan: int
    stripe_customer_id: Optional[str] = None


class UpdatePlanResponse(BaseModel):
    updated: bool
    previous_plan: int


@router.post("/user/{user_id}/plan", response_model=UpdatePlanResponse)
async def update_user_plan(
    request: Request,
    body: UpdatePlanRequest,
    user_id: str = Path(...),
):
    users = request.app.state.user_repo.users

    set_fields: dict = {"plan": body.plan}
    if body.stripe_customer_id is not None:
        set_fields["stripe_customer_id"] = body.stripe_customer_id

    doc = await users.find_one_and_update(
        {"user_id": user_id},
        {"$set": set_fields},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="User not found")

    previous_plan = int(doc.get("plan", 0))
    return UpdatePlanResponse(updated=True, previous_plan=previous_plan)


# ── Stats increment (used by community voting) ─────────────────────────

class IncrementStatsRequest(BaseModel):
    inc: Dict[str, int] = {}

ALLOWED_INC_FIELDS = frozenset({
    "total_guesses",
    "total_correct",
    "admin_guesses_total",
    "admin_guesses_correct",
    "admin_fake_correct",
    "admin_fake_total",
    "admin_real_correct",
    "admin_real_total",
    "community_score",
})


@router.post("/user/{user_id}/stats", status_code=200)
async def increment_user_stats(
    request: Request,
    body: IncrementStatsRequest,
    user_id: str = Path(...),
):
    if not body.inc:
        raise HTTPException(status_code=400, detail="Nothing to update")

    bad_keys = set(body.inc.keys()) - ALLOWED_INC_FIELDS
    if bad_keys:
        raise HTTPException(status_code=400, detail=f"Disallowed fields: {sorted(bad_keys)}")

    users = request.app.state.user_repo.users
    result = await users.update_one({"user_id": user_id}, {"$inc": body.inc})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")

    return {"updated": True}


# ── Activity recording (used by community gamification) ─────────────────

class RecordActivityRequest(BaseModel):
    points: int = 0


@router.post("/user/{user_id}/activity", status_code=200)
async def record_user_activity(
    request: Request,
    body: RecordActivityRequest,
    user_id: str = Path(...),
):
    users = request.app.state.user_repo.users
    now = _now_utc()

    doc = await users.find_one(
        {"user_id": user_id},
        {"last_activity_date": 1, "current_streak": 1, "longest_streak": 1},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="User not found")

    # Streak calculation
    current_streak = doc.get("current_streak") or 0
    longest_streak = doc.get("longest_streak") or 0
    last_activity = doc.get("last_activity_date")

    today = now.replace(hour=0, minute=0, second=0, microsecond=0)

    if last_activity is None:
        current_streak = 1
    else:
        if not last_activity.tzinfo:
            last_activity = last_activity.replace(tzinfo=timezone.utc)
        last_day = last_activity.replace(hour=0, minute=0, second=0, microsecond=0)
        days_diff = (today - last_day).days

        if days_diff == 0:
            pass  # same day, no streak change
        elif days_diff == 1:
            current_streak += 1
        else:
            current_streak = 1

    if current_streak > longest_streak:
        longest_streak = current_streak

    update: dict = {
        "$set": {
            "current_streak": current_streak,
            "longest_streak": longest_streak,
            "last_activity_date": now,
        },
    }
    if body.points > 0:
        update["$inc"] = {"community_score": body.points}

    await users.update_one({"user_id": user_id}, update)

    return {
        "updated": True,
        "current_streak": current_streak,
        "longest_streak": longest_streak,
    }


@router.post("/users/accuracy", response_model=List[UserAccuracy])
async def get_users_accuracy(
    request: Request,
    body: UserAccuracyRequest,
):
    users_col = request.app.state.user_repo.users

    cursor = users_col.find(
        {"user_id": {"$in": body.user_ids}},
        {
            "user_id": 1,
            "admin_fake_correct": 1,
            "admin_fake_total": 1,
            "admin_real_correct": 1,
            "admin_real_total": 1,
            "_id": 0,
        },
    )

    results = []
    async for doc in cursor:
        results.append(UserAccuracy(**doc))

    return results
