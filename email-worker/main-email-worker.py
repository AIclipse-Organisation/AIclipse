import json
import logging
import os
import smtplib
import threading
import time
from datetime import datetime, timezone
from email.message import EmailMessage
from typing import Any

import redis
from fastapi import FastAPI, Header, HTTPException, status
from pydantic import BaseModel, Field


app = FastAPI()
logger = logging.getLogger("email_worker")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))


REDIS_URI = os.getenv("REDIS_URI")
STREAM = os.getenv("EMAIL_STREAM", "auth-events")
GROUP = os.getenv("EMAIL_GROUP", "email-workers")
CONSUMER = os.getenv("HOSTNAME", "email-worker")
DLQ_STREAM = os.getenv("EMAIL_DLQ_STREAM", "auth-events-dlq")
# Dedupe key lifetime; example: if same log_id + recipient is seen within 24 hours, skip sending again.
DEDUPE_TTL_S = int( "86400" )  # 24 hours in seconds
# Temporary lock while one worker is actively sending one email event.
SEND_LOCK_TTL_S = int(os.getenv("EMAIL_SEND_LOCK_TTL_S", "300"))
# Retry policy 
MAX_RETRIES = int (3)
RETRY_BACKOFF_S = float( "1.5")

# SMTP settings (Gmail by default).
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "465"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME", "")
SMTP_APP_PASSWORD = os.getenv("SMTP_APP_PASSWORD", "")
SMTP_FROM_EMAIL = os.getenv("SMTP_FROM_EMAIL", SMTP_USERNAME)
SUPPORT_EMAIL = os.getenv("SUPPORT_EMAIL", SMTP_FROM_EMAIL)
SMTP_USE_SSL = os.getenv("SMTP_USE_SSL", "true").strip().lower() in {"1", "true", "yes", "on"}
SMTP_TIMEOUT_S = float(os.getenv("SMTP_TIMEOUT_S", "15"))
INTERNAL_AUTH_TOKEN = os.getenv("INTERNAL_AUTH_TOKEN", "")

# Redis client is initialized on startup and reused by worker + endpoints.
r: redis.Redis | None = None


def _require_redis() -> redis.Redis:
    """Return initialized Redis client or raise a safe runtime error."""
    if r is None:
        raise RuntimeError("Redis client is not initialized yet")
    return r


def _require_redis_http() -> redis.Redis:
    """Return initialized Redis client or a safe HTTP 503 for API callers."""
    if r is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Redis client is not initialized yet",
        )
    return r


class ReplayRequest(BaseModel):
    # Limit replay size for safety. Example: max 200 per call.
    count: int = Field(10, ge=1, le=200)
    # If true, replayed entries are removed from DLQ after enqueue.
    delete_after_replay: bool = True


def _require_internal_token(x_internal_token: str | None) -> None:
    # Protect internal endpoints with shared token.
    if not INTERNAL_AUTH_TOKEN:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="INTERNAL_AUTH_TOKEN is not configured",
        )
    if x_internal_token != INTERNAL_AUTH_TOKEN:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")


def _connect_redis() -> redis.Redis:
    # decode_responses=True gives str values instead of bytes.
    return redis.Redis.from_url(REDIS_URI, decode_responses=True)


def _ensure_group() -> None:
    redis_client = _require_redis()
    try:
        # Create group if it is missing.
        # Also create stream if it is missing.
        redis_client.xgroup_create(STREAM, GROUP, id="0", mkstream=True)
    except redis.ResponseError as err:
        # "BUSYGROUP" means the group already exists. This is expected on normal restarts, so ignore this error.
        if "BUSYGROUP" not in str(err):
            # Any other error is real, so raise it.
            raise


def _build_email(payload: dict[str, Any]) -> EmailMessage:
    # Plain text email works across most inbox clients.
    # Required event fields come from auth admin-delete payload.
    recipient = payload.get("deleted_user_email") # This is the email address of the deleted user, which is the recipient of this notification email
    deleted_at = payload.get("deleted_at") or datetime.now(timezone.utc).isoformat()
    admin_email = payload.get("deleted_by_email") # This is the email address of the administrator who performed the deletion, which is included in the email content for context.

    msg = EmailMessage()
    msg["Subject"] = "Your AIclipse account has been deleted"
    msg["From"] = SMTP_FROM_EMAIL
    msg["To"] = recipient
    msg.set_content(
        "Hello,\n\n"
        "This is a confirmation that your AIclipse account has been deleted by an administrator.\n\n"
        f"Deletion time (UTC): {deleted_at}\n"
        f"Performed by: {admin_email}\n"
        f"Reason code: {payload.get('reason_code', 'unspecified')}\n\n"
        "If you believe this was a mistake, contact support immediately.\n"
        f"Support: {SUPPORT_EMAIL}\n\n"
        "Regards,\n"
        "AIclipse"
    )
    return msg


def _send_email(msg: EmailMessage) -> None:
    # Support both authenticated SSL SMTP (e.g., Gmail) and local unauthenticated SMTP.
    if SMTP_USE_SSL:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=SMTP_TIMEOUT_S) as server:
            if SMTP_USERNAME and SMTP_APP_PASSWORD:
                server.login(SMTP_USERNAME, SMTP_APP_PASSWORD)
            server.send_message(msg)
        return

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=SMTP_TIMEOUT_S) as server:
        if SMTP_USERNAME and SMTP_APP_PASSWORD:
            server.login(SMTP_USERNAME, SMTP_APP_PASSWORD)
        server.send_message(msg)


def _dedupe_key(log_id: str, email: str) -> str:
    # Build one unique key per delete action + recipient email.
    # If the same event comes again, this key lets us skip duplicate sends.
    return f"email_sent:{log_id}:{email.lower()}"


def _process_event(fields: dict[str, str]) -> None:
    # Ignore events that are not admin-delete events.
    if fields.get("type") != "auth.user.deleted.admin":
        return

    # Event payload is JSON stored as text in fields["data"].
    raw = fields.get("data")
    if not raw:
        raise ValueError("Missing event data")

    payload = json.loads(raw)
    log_id = str(payload.get("log_id") or "")
    recipient = str(payload.get("deleted_user_email") or "").strip()
    if not log_id or not recipient:
        raise ValueError("Event missing log_id or deleted_user_email")

    redis_client = _require_redis()
    key = _dedupe_key(log_id, recipient)
    # Create short "inflight" lock so only one send attempt is active at a time.
    # This lock is removed on failure and replaced with "sent" on success.
    first_send = redis_client.set(key, "inflight", ex=SEND_LOCK_TTL_S, nx=True)
    if not first_send:
        state = redis_client.get(key)
        if state == "inflight":
            logger.info("skip_inflight_send log_id=%s recipient=%s", log_id, recipient)
        else:
            logger.info("skip_duplicate_send log_id=%s recipient=%s", log_id, recipient)
        return

    message = _build_email(payload)
    try:
        _send_email(message)
        # Mark as sent for dedupe window after successful SMTP handoff.
        redis_client.set(key, "sent", ex=DEDUPE_TTL_S)
    except Exception:
        # Release lock so retry loop can attempt again.
        try:
            redis_client.delete(key)
        except Exception:
            logger.warning("dedupe_key_delete_failed log_id=%s recipient=%s", log_id, recipient)
        raise

    logger.info("email_sent log_id=%s recipient=%s", log_id, recipient)


def _observe() -> None:
    # Worker loop: read events, process them, retry on transient failures.
    while True:
        redis_client = _require_redis()
        try:
            # Read new messages for this consumer group.
            events = redis_client.xreadgroup(GROUP, CONSUMER, {STREAM: ">"}, block=5000, count=5)
        except Exception as err:
            # Redis read failed. Wait a bit and keep the worker running.
            logger.warning("xreadgroup_failed err=%s", err)
            time.sleep(1)
            continue

        if not events:
            continue

        for _, messages in events:
            for message_id, fields in messages:
                try:
                    # Retry this message a few times before moving it to DLQ.
                    attempt = 0
                    while True:
                        try:
                            _process_event(fields)
                            break
                        except Exception as err:
                            attempt += 1
                            if attempt >= MAX_RETRIES:
                                # Retries are used up. Save failure details in DLQ.
                                payload = {
                                    "failed_id": message_id,
                                    "error": str(err),
                                    "type": fields.get("type", ""),
                                    "data": fields.get("data", ""),
                                }
                                redis_client.xadd(DLQ_STREAM, {"type": "email.send.failed", "data": json.dumps(payload)})
                                logger.exception("email_send_failed id=%s", message_id)
                                break
                            # Wait longer after each retry (1x, 2x, 4x...).
                            sleep_s = RETRY_BACKOFF_S * (2 ** (attempt - 1))
                            logger.warning(
                                "email_send_retry id=%s attempt=%s err=%s sleep_s=%s",
                                message_id,
                                attempt,
                                err,
                                sleep_s,
                            )
                            time.sleep(sleep_s)
                finally:
                    try:
                        # Always acknowledge so that one bad message does not loop forever.
                        # Failure details are preserved in DLQ when needed.
                        redis_client.xack(STREAM, GROUP, message_id)
                    except Exception as err:
                        logger.warning("xack_failed id=%s err=%s", message_id, err)


@app.on_event("startup")
def startup() -> None:
    # Fail fast if required settings are missing.
    if not REDIS_URI:
        raise RuntimeError("REDIS_URI is required")
    if not SMTP_HOST or not SMTP_PORT or not SMTP_FROM_EMAIL:
        raise RuntimeError("SMTP_HOST, SMTP_PORT, and SMTP_FROM_EMAIL are required")

    global r
    while True:
        try:
            r = _connect_redis()
            # Confirm Redis is reachable before starting worker thread.
            r.ping()
            _ensure_group()
            break
        except Exception as err:
            # Keep retrying so service recovers when Redis comes up later.
            logger.warning("startup_retry err=%s", err)
            time.sleep(1)

    logger.info("email_worker_started stream=%s group=%s", STREAM, GROUP)
    # Start worker in background so API endpoints stay responsive.
    threading.Thread(target=_observe, daemon=True).start()


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/internal/dlq")
def list_dlq(
    count: int = 20,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    # Return recent failed sends from DLQ.
    _require_internal_token(x_internal_token)
    if count < 1 or count > 200:
        raise HTTPException(status_code=400, detail="count must be between 1 and 200")

    redis_client = _require_redis_http()
    # Read newest items first for faster debugging.
    entries = redis_client.xrevrange(DLQ_STREAM, "+", "-", count=count)
    items: list[dict[str, Any]] = []
    for message_id, fields in entries:
        items.append(
            {
                "id": message_id,
                "type": fields.get("type"),
                "data": fields.get("data"),
            }
        )
    return {"stream": DLQ_STREAM, "count": len(items), "items": items}


@app.post("/internal/dlq/replay")
def replay_dlq(
    body: ReplayRequest,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    # Put failed DLQ items back on main stream for another try.
    # Example use: after fixing SMTP credentials.
    _require_internal_token(x_internal_token)

    redis_client = _require_redis_http()
    # Replay newest failures first.
    entries = redis_client.xrevrange(DLQ_STREAM, "+", "-", count=body.count)
    if not entries:
        return {"replayed": 0, "deleted": 0, "target_stream": STREAM}

    replayed = 0
    deleted = 0
    for message_id, fields in entries:
        try:
            raw = fields.get("data")
            if not raw:
                continue
            wrapped = json.loads(raw)
            original_type = wrapped.get("type")
            original_data = wrapped.get("data")
            if not original_type or original_data is None:
                # Skip bad DLQ records, but continue replaying others.
                continue

            redis_client.xadd(
                STREAM,
                {
                    "type": str(original_type),
                    "data": str(original_data),
                    "replayed_from": DLQ_STREAM,
                    "replayed_at": datetime.now(timezone.utc).isoformat(),
                },
            )
            replayed += 1

            if body.delete_after_replay:
                # Delete only records that were replayed successfully.
                deleted += int(redis_client.xdel(DLQ_STREAM, message_id))
        except Exception:
            logger.exception("dlq_replay_failed id=%s", message_id)

    return {
        "replayed": replayed,
        "deleted": deleted,
        "target_stream": STREAM,
        "delete_after_replay": body.delete_after_replay,
    }
