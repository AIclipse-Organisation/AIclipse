import json
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
import stripe
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel
from pymongo import MongoClient
from pymongo.errors import DuplicateKeyError

app = FastAPI()

# -------------------------
# ENV
# -------------------------
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = os.getenv("MONGO_DB")

STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET")
STRIPE_PUBLISHABLE_KEY = os.getenv("STRIPE_PUBLISHABLE_KEY")
CLIENT_URL = os.getenv("CLIENT_URL")

AUTH_URI = os.getenv("AUTH_URI")
INTERNAL_AUTH_TOKEN = os.getenv("INTERNAL_AUTH_TOKEN")

# Stripe setup
if STRIPE_SECRET_KEY:
    stripe.api_key = STRIPE_SECRET_KEY

# -------------------------
# LOGGING
# -------------------------
logger = logging.getLogger("billing")
logging.basicConfig(level=logging.INFO)

logger.info("Billing service starting...")
logger.info("CLIENT_URL=%s", CLIENT_URL)
logger.info("MONGO_URI set=%s", bool(MONGO_URI))
logger.info("MONGO_DB=%s", MONGO_DB)


# Collections (billing's own data — user data is read/written via auth internal API)
plan_coll = None
billing_coll = None

# -------------------------
# AUTH INTERNAL API
# -------------------------
_auth_http = httpx.Client(timeout=5.0)

# user_id is minted by auth as f"u_{uuid4()}". Validating at the URL
# interpolation boundary stops path traversal (e.g. "../admin") from routing
# the internal call to an unintended auth endpoint.
_USER_ID_RE = re.compile(r"^u_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def _require_valid_user_id(user_id: str) -> str:
    if not isinstance(user_id, str) or not _USER_ID_RE.match(user_id):
        raise HTTPException(status_code=400, detail="Invalid user_id")
    return user_id


def _auth_headers() -> dict:
    return {"X-Internal-Token": INTERNAL_AUTH_TOKEN} if INTERNAL_AUTH_TOKEN else {}


def _read_user_plan(user_id: str) -> dict:
    """Return {"user_id", "plan", "stripe_customer_id"} or {} if not found."""
    if not AUTH_URI or not INTERNAL_AUTH_TOKEN:
        raise HTTPException(status_code=503, detail="Auth service not configured")
    _require_valid_user_id(user_id)
    resp = _auth_http.get(f"{AUTH_URI}/internal/user/{user_id}", headers=_auth_headers())
    if resp.status_code == 404:
        return {}
    resp.raise_for_status()
    return resp.json()


def _update_user_plan(user_id: str, plan: int, stripe_customer_id: str | None = None) -> dict:
    """Update user plan via auth. Returns {"updated": bool, "previous_plan": int}."""
    if not AUTH_URI or not INTERNAL_AUTH_TOKEN:
        raise HTTPException(status_code=503, detail="Auth service not configured")
    _require_valid_user_id(user_id)
    body: dict = {"plan": plan}
    if stripe_customer_id is not None:
        body["stripe_customer_id"] = stripe_customer_id
    resp = _auth_http.post(
        f"{AUTH_URI}/internal/user/{user_id}/plan", json=body, headers=_auth_headers(),
    )
    resp.raise_for_status()
    return resp.json()

# -------------------------
# HELPERS
# -------------------------
def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _to_utc_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        return datetime.fromtimestamp(int(value), tz=timezone.utc)
    except Exception:
        return None


def _month_end_from(start: datetime) -> datetime:
    return start + timedelta(days=30)


def _iso_or_none(value: datetime | None) -> str | None:
    return value.isoformat() if isinstance(value, datetime) else None

def _cents_to_eur_str(cents: int) -> str:
    try:
        return f"{int(cents) / 100:.2f}"
    except Exception:
        return "0.00"

# -------------------------
# MONGO CONNECT
# -------------------------
try:
    if not MONGO_URI or not MONGO_DB:
        raise RuntimeError("Missing MONGO_URI or MONGO_DB")

    client = MongoClient(MONGO_URI)
    client.admin.command("ping")
    db = client[MONGO_DB]

    plan_coll = db.plan
    billing_coll = db.billing

    # Unique-sparse indexes give us atomic, retry-safe webhook handling:
    # Stripe retries deliver the same event_id; a second insert fails with
    # DuplicateKeyError, which each step catches to preserve forward progress
    # without needing transactions or pre-checks.
    plan_coll.create_index("stripe_event_id", unique=True, sparse=True)
    billing_coll.create_index("stripe_event_id", unique=True, sparse=True)

    logger.info("Mongo connected OK. DB=%s", MONGO_DB)

except Exception as e:
    logger.exception("Mongo connection failed: %s", e)
    plan_coll = None
    billing_coll = None

# -------------------------
# MODELS
# -------------------------
class CheckoutRequest(BaseModel):
    user_id: str
    plan_id: int
    email: str


class CancelSubscriptionRequest(BaseModel):
    user_id: str
    reason: str


class RequestLogSanitizer:
    _CONTROL_CHARS = re.compile(r"[\r\n\t\x00-\x1f\x7f]")

    @classmethod
    def _clean_text(cls, value, max_len: int = 128) -> str:
        text = "" if value is None else str(value)
        text = cls._CONTROL_CHARS.sub(" ", text).strip()
        if len(text) > max_len:
            return f"{text[:max_len]}..."
        return text

    @classmethod
    def user_id(cls, value) -> str:
        return cls._clean_text(value, max_len=64)

    @classmethod
    def plan_id(cls, value) -> int:
        try:
            return int(value)
        except Exception:
            return -1

    @classmethod
    def email(cls, value) -> str:
        cleaned = cls._clean_text(value, max_len=120)
        if "@" not in cleaned:
            return cleaned
        local, domain = cleaned.split("@", 1)
        masked_local = local[:1] + "***" if local else "***"
        return f"{masked_local}@{domain}"

    @classmethod
    def sanitize_checkout_input(cls, user_id, plan_id, email):
        cleaned_user_id = cls.user_id(user_id)
        cleaned_plan_id = cls.plan_id(plan_id)
        cleaned_email = cls.email(email)

        if not cleaned_user_id:
            raise HTTPException(status_code=400, detail="Invalid user_id")
        if cleaned_plan_id < 0:
            raise HTTPException(status_code=400, detail="Invalid plan_id")
        if not cleaned_email or "@" not in cleaned_email:
            raise HTTPException(status_code=400, detail="Invalid email")

        return cleaned_user_id, cleaned_plan_id, cleaned_email

# -------------------------
# HEALTH
# -------------------------
class _HealthzFilter(logging.Filter):
    def filter(self, record):
        try:
            return "/healthz" not in record.getMessage()
        except Exception:
            return True

logging.getLogger("uvicorn.access").addFilter(_HealthzFilter())

@app.get("/healthz")
def healthz():
    return {"status": "ok"}

@app.get("/config")
def get_config():
    return {"publishable_key": STRIPE_PUBLISHABLE_KEY}


@app.get("/subscription/status")
def get_subscription_status(user_id: str):
    if billing_coll is None:
        raise HTTPException(status_code=503, detail="Database not available")

    safe_user_id = RequestLogSanitizer.user_id(user_id)
    if not safe_user_id:
        raise HTTPException(status_code=400, detail="Invalid user_id")

    user_info = _read_user_plan(safe_user_id)
    current_plan = int(user_info.get("plan", 0) or 0)

    latest_bill = billing_coll.find_one(
        {
            "user_id": safe_user_id,
            "status": {"$in": ["active", "cancel_scheduled", "canceled"]},
        },
        sort=[("timestamp", -1), ("billing_period_end", -1)],
    )

    if not latest_bill:
        return {
            "user_id": safe_user_id,
            "plan": current_plan,
            "status": "none",
            "cancel_at_period_end": False,
            "billing_period_end": None,
        }

    return {
        "user_id": safe_user_id,
        "plan": current_plan,
        "status": latest_bill.get("status", "none"),
        "cancel_at_period_end": bool(latest_bill.get("cancel_at_period_end", False)),
        "billing_period_end": _iso_or_none(latest_bill.get("billing_period_end")),
    }

# -------------------------
# CHECKOUT
# -------------------------
@app.post("/create-checkout-session")
async def create_checkout_session(request: CheckoutRequest):
    safe_user_id, safe_plan_id, safe_email = RequestLogSanitizer.sanitize_checkout_input(
        request.user_id,
        request.plan_id,
        request.email,
    )

    if not STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Stripe not configured")

    if plan_coll is None:
        raise HTTPException(status_code=503, detail="Database not available")

    plan_prices = {
        1: {"name": "AIclipse Plus", "amount": 999},
        2: {"name": "Premium Plan", "amount": 1999},
    }

    if safe_plan_id not in plan_prices:
        # optional: log a constant message without the tainted value
        logger.info("create-checkout-session called with invalid plan_id")
        raise HTTPException(status_code=400, detail="Invalid plan ID")

    plan = plan_prices[safe_plan_id]

    # ✅ allowlisted / constant-ish value, not user-controlled
    logger.info("create-checkout-session called plan=%s", plan["name"])

    try:
        # Reuse Stripe customer id from latest plan record if any
        customer_id = None
        last_plan = plan_coll.find_one(
            {"user_id": safe_user_id, "stripe_customer_id": {"$exists": True, "$ne": None}},
            sort=[("timestamp", -1)],
        )
        if last_plan:
            customer_id = last_plan.get("stripe_customer_id")

        if customer_id:
            try:
                stripe.Customer.modify(
                    customer_id,
                    email=safe_email,
                    metadata={"user_id": safe_user_id},
                )
            except Exception as e:
                logger.warning("stripe.Customer.modify failed: %s", e)
        else:
            customer = stripe.Customer.create(
                email=safe_email,
                metadata={"user_id": safe_user_id},
            )
            customer_id = customer.id

        logger.info("Stripe customer_id=%s", customer_id)

        checkout_session = stripe.checkout.Session.create(
            customer=customer_id,
            payment_method_types=["card"],
            line_items=[{
                "price_data": {
                    "currency": "eur",
                    "product_data": {
                        "name": plan["name"],
                        "description": "Unlimited AI image scans per month",
                    },
                    "unit_amount": plan["amount"],
                    "recurring": {"interval": "month"},
                },
                "quantity": 1,
            }],
            mode="subscription",
            success_url=f"{CLIENT_URL}/plan?success=true",
            cancel_url=f"{CLIENT_URL}/plan?canceled=true",
            metadata={
                "user_id": safe_user_id,
                "plan_id": str(safe_plan_id),
                "amount_paid": _cents_to_eur_str(plan["amount"]),
                "stripe_customer_id": customer_id,
            },
        )

        logger.info("Checkout session created id=%s url=%s", checkout_session.id, checkout_session.url)
        return {"checkout_url": checkout_session.url, "session_id": checkout_session.id}

    except stripe.error.StripeError as e:
        logger.exception("Stripe error creating checkout session: %s", e)
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/subscription/cancel-at-period-end")
async def cancel_subscription_at_period_end(request: CancelSubscriptionRequest):
    if not STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Stripe not configured")

    if plan_coll is None or billing_coll is None:
        raise HTTPException(status_code=503, detail="Database not available")

    safe_user_id = RequestLogSanitizer.user_id(request.user_id)
    cancellation_reason = RequestLogSanitizer._clean_text(request.reason, max_len=120)

    if not safe_user_id:
        raise HTTPException(status_code=400, detail="Invalid user_id")
    if not cancellation_reason:
        raise HTTPException(status_code=400, detail="Cancellation reason is required")

    current_user = _read_user_plan(safe_user_id)
    current_plan = int(current_user.get("plan", 0) or 0)
    if current_plan <= 0:
        raise HTTPException(status_code=400, detail="No active paid subscription")

    latest_active = billing_coll.find_one(
        {
            "user_id": safe_user_id,
            "status": {"$in": ["active", "cancel_scheduled"]},
            "stripe_subscription_id": {"$exists": True, "$ne": None},
        },
        sort=[("timestamp", -1), ("billing_period_end", -1)],
    )
    if not latest_active:
        raise HTTPException(status_code=404, detail="No active subscription found")

    stripe_subscription_id = latest_active.get("stripe_subscription_id")
    if not stripe_subscription_id:
        raise HTTPException(status_code=404, detail="No active subscription found")

    existing_period_end = latest_active.get("billing_period_end")
    if latest_active.get("status") == "cancel_scheduled" or latest_active.get("cancel_at_period_end"):
        return {
            "ok": True,
            "status": "cancel_scheduled",
            "message": "Subscription cancellation already scheduled",
            "plan_active_until": _iso_or_none(existing_period_end),
        }

    now = _now_utc()
    try:
        stripe_sub = stripe.Subscription.modify(
            stripe_subscription_id,
            cancel_at_period_end=True,
            metadata={
                "cancel_reason": cancellation_reason,
                "cancel_requested_at": now.isoformat(),
            },
        )
    except stripe.error.StripeError as e:
        logger.exception("Stripe error scheduling cancellation: %s", e)
        raise HTTPException(status_code=400, detail=str(e))

    stripe_period_end = _to_utc_datetime(getattr(stripe_sub, "current_period_end", None))
    effective_period_end = stripe_period_end or latest_active.get("billing_period_end") or _month_end_from(now)

    billing_coll.update_many(
        {
            "user_id": safe_user_id,
            "stripe_subscription_id": stripe_subscription_id,
            "status": {"$in": ["active", "cancel_scheduled"]},
        },
        {
            "$set": {
                "status": "cancel_scheduled",
                "cancel_at_period_end": True,
                "cancel_requested_at": now,
                "billing_period_end": effective_period_end,
                "cancellation_reason": cancellation_reason,
                "timestamp": now,
            }
        },
    )

    plan_coll.insert_one(
        {
            "user_id": safe_user_id,
            "timestamp": now,
            "original_plan": current_plan,
            "new_plan": current_plan,
            "success": True,
            "action": "cancel_requested",
            "cancellation_reason": cancellation_reason,
            "stripe_subscription_id": stripe_subscription_id,
            "stripe_customer_id": latest_active.get("stripe_customer_id"),
        }
    )

    billing_coll.insert_one(
        {
            "user_id": safe_user_id,
            "plan": current_plan,
            "status": "cancel_scheduled",
            "cancel_at_period_end": True,
            "cancel_requested_at": now,
            "billing_period_start": latest_active.get("billing_period_start"),
            "billing_period_end": effective_period_end,
            "amount_paid": latest_active.get("amount_paid"),
            "cancellation_reason": cancellation_reason,
            "stripe_subscription_id": stripe_subscription_id,
            "stripe_customer_id": latest_active.get("stripe_customer_id"),
            "timestamp": now,
        }
    )

    return {
        "ok": True,
        "status": "cancel_scheduled",
        "message": "Subscription cancellation scheduled for period end",
        "plan_active_until": _iso_or_none(effective_period_end),
    }

# -------------------------
# WEBHOOK
# -------------------------
@app.post("/webhook")
async def stripe_webhook(request: Request):
    # Log that we got hit at all
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")

    logger.info("Webhook received: bytes=%s sig_header_present=%s",
                len(payload) if payload else 0, bool(sig_header))

    if not STRIPE_WEBHOOK_SECRET:
        logger.error("Webhook secret missing. Cannot verify signature.")
        raise HTTPException(status_code=500, detail="Webhook secret not configured")

    try:
        # Verify signature; we re-parse the payload ourselves so downstream code
        # works with a plain dict rather than stripe>=14 StripeObject
        # (which no longer subclasses dict).
        stripe.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)
    except ValueError:
        logger.exception("Webhook invalid payload (not JSON?)")
        raise HTTPException(status_code=400, detail="Invalid payload")
    except stripe.error.SignatureVerificationError:
        logger.exception("Webhook signature verification failed")
        raise HTTPException(status_code=400, detail="Invalid signature")

    event = json.loads(payload)

    # Stripe-controlled strings are stripped of control chars before any log
    # or DB use so that a crafted webhook can't forge log lines (invariant
    # #13 in ARCHITECTURE.md). Values still pass signature verification above.
    event_type = event.get("type")
    event_id = RequestLogSanitizer._clean_text(event.get("id"), max_len=64)

    logger.info("Webhook verified: id=%s type=%s", event_id, event_type)

    if plan_coll is None or billing_coll is None:
        logger.error("DB not available; cannot persist billing updates.")
        return {"status": "db unavailable"}

    # --- checkout completed ---
    if event_type == "checkout.session.completed":
        session = event["data"]["object"]
        meta = session.get("metadata") or {}

        session_id = session.get("id")
        stripe_subscription_id = session.get("subscription")

        user_id = meta.get("user_id")
        plan_id_raw = meta.get("plan_id", "0")
        amount_paid = meta.get("amount_paid")
        stripe_customer_id = meta.get("stripe_customer_id") or session.get("customer")

        try:
            new_plan = int(plan_id_raw)
        except Exception:
            new_plan = 0

        if not user_id or not _USER_ID_RE.match(user_id):
            # Returning 200 here avoids Stripe retrying a permanently-bad event.
            safe_session_id = RequestLogSanitizer._clean_text(session_id, max_len=64)
            logger.warning("missing/invalid user_id in metadata; ignoring session=%s", safe_session_id)
            return {"status": "ignored", "reason": "invalid_user_id"}
        # user_id has matched _USER_ID_RE (UUID format), so this is a no-op —
        # but it makes the sanitization explicit at the log boundary.
        user_id = RequestLogSanitizer._clean_text(user_id, max_len=64)

        logger.info(
            "checkout.session.completed: session=%s user_id=%s plan_id=%s amount_paid=%s customer_id=%s",
            session_id,
            user_id, plan_id_raw, amount_paid, stripe_customer_id
        )

        now = _now_utc()
        period_start = now
        period_end = _month_end_from(period_start)

        # Capture original plan before auth update so the audit row reflects
        # the true transition, even if a later step fails and Stripe retries.
        original_plan = int(_read_user_plan(user_id).get("plan", 0) or 0)

        # Step 1 (audit first): recording intent before mutating auth means a
        # retry sees DuplicateKeyError here and skips straight to the remaining
        # steps — original_plan stays accurate across retries.
        try:
            plan_coll.insert_one(
                {
                    "user_id": user_id,
                    "timestamp": now,
                    "original_plan": original_plan,
                    "new_plan": new_plan,
                    "success": True,
                    "stripe_customer_id": stripe_customer_id,
                    "stripe_session_id": session_id,
                    "stripe_event_id": event_id,
                    "stripe_subscription_id": stripe_subscription_id,
                    "action": "subscribe",
                }
            )
        except DuplicateKeyError:
            logger.info("plan audit already exists for event_id=%s (retry)", event_id)

        # Step 2: auth update is idempotent (set plan = N).
        _update_user_plan(user_id, new_plan, stripe_customer_id)
        logger.info("user plan updated: user_id=%s original_plan=%s new_plan=%s", user_id, original_plan, new_plan)

        # Step 3: billing audit.
        try:
            billing_coll.insert_one(
                {
                    "user_id": user_id,
                    "plan": new_plan,
                    "status": "active",
                    "billing_period_start": period_start,
                    "billing_period_end": period_end,
                    "amount_paid": amount_paid,
                    "stripe_session_id": session_id,
                    "stripe_event_id": event_id,
                    "stripe_subscription_id": stripe_subscription_id,
                    "stripe_customer_id": stripe_customer_id,
                    "cancel_at_period_end": False,
                    "cancellation_reason": None,
                    "timestamp": now,
                }
            )
        except DuplicateKeyError:
            logger.info("billing audit already exists for event_id=%s (retry)", event_id)

        logger.info("UPGRADE COMPLETE user=%s %s->%s", user_id, original_plan, new_plan)

    # --- subscription updated ---
    elif event_type == "customer.subscription.updated":
        subscription = event["data"]["object"]
        customer_id = subscription.get("customer")
        subscription_id = subscription.get("id")
        cancel_at_period_end = bool(subscription.get("cancel_at_period_end", False))
        period_end = _to_utc_datetime(subscription.get("current_period_end"))

        billing_coll.update_many(
            {
                "$or": [
                    {"stripe_subscription_id": subscription_id},
                    {"stripe_customer_id": customer_id},
                ],
                "status": {"$in": ["active", "cancel_scheduled"]},
            },
            {
                "$set": {
                    "status": "cancel_scheduled" if cancel_at_period_end else "active",
                    "cancel_at_period_end": cancel_at_period_end,
                    "billing_period_end": period_end,
                    "timestamp": _now_utc(),
                }
            },
        )


    # --- subscription deleted ---
    elif event_type == "customer.subscription.deleted":
        subscription = event["data"]["object"]
        customer_id = subscription.get("customer")
        subscription_id = subscription.get("id")
        period_end = _to_utc_datetime(subscription.get("current_period_end"))
        cancellation_details = subscription.get("cancellation_details") or {}
        cancellation_reason = cancellation_details.get("comment") or cancellation_details.get("reason")

        logger.info("customer.subscription.deleted received")

        last_billing = billing_coll.find_one(
            {
                "$or": [
                    {"stripe_subscription_id": subscription_id},
                    {"stripe_customer_id": customer_id},
                ],
            },
            sort=[("timestamp", -1), ("billing_period_end", -1)],
        )

        last_plan = None
        if not last_billing:
            last_plan = plan_coll.find_one(
                {"stripe_customer_id": customer_id},
                sort=[("timestamp", -1)],
            )

        user_id = None
        current_plan = 0
        if last_billing and last_billing.get("user_id"):
            user_id = last_billing["user_id"]
            current_plan = int(last_billing.get("plan", 0) or 0)
        elif last_plan and last_plan.get("user_id"):
            user_id = last_plan["user_id"]

        if user_id and not _USER_ID_RE.match(user_id):
            logger.warning("skipping deleted-subscription webhook: invalid user_id in stored record")
            user_id = None
        elif user_id:
            # Idempotent for valid IDs; makes log-time sanitization explicit.
            user_id = RequestLogSanitizer._clean_text(user_id, max_len=64)

        if user_id and last_billing is None:
            # user_id came from plan_coll; fetch current plan via auth.
            user_info = _read_user_plan(user_id)
            current_plan = int(user_info.get("plan", 0))

        if user_id:
            now = _now_utc()

            # Audit first (see checkout.session.completed for rationale).
            try:
                plan_coll.insert_one(
                    {
                        "user_id": user_id,
                        "timestamp": now,
                        "original_plan": current_plan,
                        "new_plan": 0,
                        "success": True,
                        "stripe_customer_id": customer_id,
                        "stripe_subscription_id": subscription_id,
                        "stripe_event_id": event_id,
                        "action": "subscription_deleted",
                        "cancellation_reason": cancellation_reason,
                    }
                )
            except DuplicateKeyError:
                logger.info("plan audit already exists for event_id=%s (retry)", event_id)

            _update_user_plan(user_id, 0)

            billing_coll.update_many(
                {
                    "user_id": user_id,
                    "$or": [
                        {"stripe_subscription_id": subscription_id},
                        {"stripe_customer_id": customer_id},
                    ],
                    "status": {"$in": ["active", "cancel_scheduled"]},
                },
                {
                    "$set": {
                        "status": "canceled",
                        "cancel_at_period_end": False,
                        "canceled_at": now,
                        "billing_period_end": period_end,
                        "cancellation_reason": cancellation_reason,
                        "timestamp": now,
                    }
                },
            )

            try:
                billing_coll.insert_one({
                    "user_id": user_id,
                    "plan": current_plan,
                    "status": "canceled",
                    "billing_period_start": None,
                    "billing_period_end": period_end,
                    "amount_paid": None,
                    "stripe_customer_id": customer_id,
                    "stripe_subscription_id": subscription_id,
                    "stripe_event_id": event_id,
                    "cancellation_reason": cancellation_reason,
                    "timestamp": now,
                })
            except DuplicateKeyError:
                logger.info("billing audit already exists for event_id=%s (retry)", event_id)

            logger.info("Subscription cancelled after delete webhook")
        else:
            logger.warning("No matching plan record found for deleted subscription webhook")

    else:
        logger.info("Unhandled webhook type=%s (ignored)", event_type)

    return {"status": "success"}

