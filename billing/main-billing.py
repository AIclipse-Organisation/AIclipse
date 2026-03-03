import logging
import os
import re
from datetime import datetime, timedelta, timezone

import stripe
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel
from pymongo import MongoClient

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


# Collections
usage = None
users_coll = None
plan_coll = None
billing_coll = None


def _resolve_users_collection(db):
    auth_users = db["auth.users"]
    legacy_users = db["users"]

    try:
        if auth_users.estimated_document_count() > 0:
            logger.info("Using users collection: auth.users")
            return auth_users
    except Exception as e:
        logger.warning("Could not inspect auth.users: %s", e)

    try:
        if legacy_users.estimated_document_count() > 0:
            logger.info("Using users collection: users")
            return legacy_users
    except Exception as e:
        logger.warning("Could not inspect users: %s", e)

    logger.info("Using users collection default: auth.users")
    return auth_users

# -------------------------
# HELPERS
# -------------------------
def _now_utc() -> datetime:
    return datetime.now(timezone.utc)

def _month_end_from(start: datetime) -> datetime:
    return start + timedelta(days=30)

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

    usage = db.usage
    users_coll = _resolve_users_collection(db)
    plan_coll = db.plan
    billing_coll = db.billing

    logger.info("Mongo connected OK. DB=%s", MONGO_DB)

except Exception as e:
    logger.exception("Mongo connection failed: %s", e)
    usage = None
    users_coll = None
    plan_coll = None
    billing_coll = None

# -------------------------
# MODELS
# -------------------------
class CheckoutRequest(BaseModel):
    user_id: str
    plan_id: int
    email: str

class PortalRequest(BaseModel):
    customer_id: str


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

# -------------------------
# USAGE (optional)
# -------------------------
@app.post("/usage")
def record_usage(payload: dict):
    if not payload:
        return {"ok": False}

    data = dict(payload)
    data["timestamp"] = datetime.utcnow()

    if usage is not None:
        try:
            usage.insert_one(data)
        except Exception as e:
            logger.warning("usage.insert_one failed: %s", e)

    return {"ok": True}

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

    if users_coll is None or plan_coll is None:
        raise HTTPException(status_code=503, detail="Database not available")

    plan_prices = {
        1: {"name": "Plus Plan", "amount": 999},
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
        event = stripe.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)
    except ValueError:
        logger.exception("Webhook invalid payload (not JSON?)")
        raise HTTPException(status_code=400, detail="Invalid payload")
    except stripe.error.SignatureVerificationError:
        logger.exception("Webhook signature verification failed")
        raise HTTPException(status_code=400, detail="Invalid signature")

    event_type = event.get("type")
    event_id = event.get("id")

    logger.info("Webhook verified: id=%s type=%s", event_id, event_type)

    if users_coll is None or plan_coll is None or billing_coll is None:
        logger.error("DB not available; cannot persist billing updates.")
        return {"status": "db unavailable"}

    # --- checkout completed ---
    if event_type == "checkout.session.completed":
        session = event["data"]["object"]
        meta = session.get("metadata") or {}

        session_id = session.get("id")
        customer_from_session = session.get("customer")

        user_id = meta.get("user_id")
        plan_id_raw = meta.get("plan_id", "0")
        amount_paid = meta.get("amount_paid")
        stripe_customer_id = meta.get("stripe_customer_id") or session.get("customer")

        logger.info(
            "resolved user_id=%s plan_id=%s amount_paid=%s customer_id=%s",
            user_id, plan_id_raw, amount_paid, stripe_customer_id
        )


        logger.info(
            "checkout.session.completed: session=%s customer=%s metadata=%s",
            session_id, customer_from_session, meta
        )
        logger.info(
            "resolved: user_id=%s plan_id=%s amount_paid=%s customer_id=%s",
            user_id, plan_id_raw, amount_paid, stripe_customer_id
        )

        try:
            new_plan = int(plan_id_raw)
        except Exception:
            new_plan = 0

        if not user_id:
            logger.warning("missing user_id in metadata; ignoring session=%s", session_id)
            return {"status": "ignored", "reason": "missing_user_id"}

        # Read current plan for audit
        user_doc = users_coll.find_one({"user_id": user_id}) or {}
        original_plan = int(user_doc.get("plan", 0))
        logger.info("user lookup: user_id=%s found=%s original_plan=%s", user_id, bool(user_doc), original_plan)

        now = _now_utc()
        period_start = now
        period_end = _month_end_from(period_start)

        upd = users_coll.update_one(
            {"user_id": user_id},
            {"$set": {"plan": new_plan, "stripe_customer_id": stripe_customer_id}},
        )
        logger.info("users.update_one matched=%s modified=%s", upd.matched_count, upd.modified_count)

        plan_ins = plan_coll.insert_one(
            {
                "user_id": user_id,
                "timestamp": now,
                "original_plan": original_plan,
                "new_plan": new_plan,
                "success": True,
                "stripe_customer_id": stripe_customer_id,
                "stripe_session_id": session_id,
                "stripe_event_id": event_id,
            }
        )
        logger.info("plan.insert_one id=%s", str(plan_ins.inserted_id))

        bill_ins = billing_coll.insert_one(
            {
                "user_id": user_id,
                "plan": new_plan,
                "status": "active",
                "billing_period_start": period_start,
                "billing_period_end": period_end,
                "amount_paid": amount_paid,
                "stripe_session_id": session_id,
                "stripe_event_id": event_id,
            }
        )
        logger.info("billing.insert_one id=%s", str(bill_ins.inserted_id))

        logger.info("UPGRADE COMPLETE user=%s %s->%s", user_id, original_plan, new_plan)


    # --- subscription deleted ---
    elif event_type == "customer.subscription.deleted":
        subscription = event["data"]["object"]
        customer_id = subscription.get("customer")

        logger.info("customer.subscription.deleted customer=%s", customer_id)

        last_plan = plan_coll.find_one(
            {"stripe_customer_id": customer_id},
            sort=[("timestamp", -1)],
        )

        if last_plan and last_plan.get("user_id"):
            user_id = last_plan["user_id"]
            current_user = users_coll.find_one({"user_id": user_id}) or {}
            current_plan = int(current_user.get("plan", 0))

            users_coll.update_one({"user_id": user_id}, {"$set": {"plan": 0}})

            billing_coll.insert_one({
                "user_id": user_id,
                "plan": current_plan,
                "status": "canceled",
                "billing_period_start": None,
                "billing_period_end": None,
                "amount_paid": None,
            })

            logger.info("Subscription cancelled: customer=%s user=%s", customer_id, user_id)
        else:
            logger.warning("No plan record found for customer=%s", customer_id)

    else:
        logger.info("Unhandled webhook type=%s (ignored)", event_type)

    return {"status": "success"}

# -------------------------
# BILLING PORTAL
# -------------------------
@app.post("/create-portal-session")
async def create_portal_session(request: PortalRequest):
    if not STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Stripe not configured")

    try:
        session = stripe.billing_portal.Session.create(
            customer=request.customer_id,
            return_url=f"{CLIENT_URL}/plan",
        )
        return {"url": session.url}
    except stripe.error.StripeError as e:
        raise HTTPException(status_code=400, detail=str(e))

# -------------------------
# ADMIN (testing)
# -------------------------
@app.post("/admin/upgrade-plan")
async def admin_upgrade_plan(user_id: str, plan_id: int):
    if users_coll is None or plan_coll is None or billing_coll is None:
        raise HTTPException(status_code=503, detail="Database not available")

    user_doc = users_coll.find_one({"user_id": user_id}) or {}
    original_plan = int(user_doc.get("plan", 0))

    now = _now_utc()
    period_start = now
    period_end = _month_end_from(period_start)

    res = users_coll.update_one({"user_id": user_id}, {"$set": {"plan": int(plan_id)}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")

    plan_coll.insert_one({
        "user_id": user_id,
        "timestamp": now,
        "original_plan": original_plan,
        "new_plan": int(plan_id),
        "success": True,
        "stripe_customer_id": None,
    })

    billing_coll.insert_one({
        "user_id": user_id,
        "plan": int(plan_id),
        "status": "active",
        "billing_period_start": period_start,
        "billing_period_end": period_end,
        "amount_paid": None,
    })

    return {"ok": True, "user_id": user_id, "plan": plan_id}
