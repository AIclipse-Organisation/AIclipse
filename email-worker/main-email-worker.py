import json
import logging
import os
import base64
import threading
import time
from datetime import datetime, timezone
from email.message import EmailMessage
from typing import Any

import redis
import requests
from fastapi import FastAPI, Header, HTTPException, status
from pydantic import BaseModel, Field


app = FastAPI()
logger = logging.getLogger("email_worker")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))


class _HealthzOnceFilter(logging.Filter):
    """Allow the first /healthz access-log line through; drop all subsequent ones."""

    _logged = False

    def filter(self, record: logging.LogRecord) -> bool:
        if "/healthz" in record.getMessage():
            if not _HealthzOnceFilter._logged:
                _HealthzOnceFilter._logged = True
                return True
            return False
        return True


REDIS_URI = os.getenv("REDIS_URI")
STREAM = "auth-events"
GROUP = "email-workers"
CONSUMER = os.getenv("HOSTNAME", "email-worker")
DLQ_STREAM = "auth-events-dlq"
DEDUPE_TTL_S = 86400
# Temporary lock while one worker is actively sending one email event.
SEND_LOCK_TTL_S = 300
MAX_RETRIES = 3
RETRY_BACKOFF_S = 1.5
REDIS_CONNECT_TIMEOUT_S = 3.0
REDIS_SOCKET_TIMEOUT_S = 8.0

# Gmail API settings.
GMAIL_CLIENT_ID = os.getenv("GMAIL_CLIENT_ID")
GMAIL_CLIENT_SECRET = os.getenv("GMAIL_CLIENT_SECRET")
GMAIL_REFRESH_TOKEN = os.getenv("GMAIL_REFRESH_TOKEN")
GMAIL_SENDER_EMAIL = os.getenv("GMAIL_SENDER_EMAIL")
GMAIL_TOKEN_URL = "https://oauth2.googleapis.com/token"
GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1"
GMAIL_TIMEOUT_S = 15.0
SUPPORT_EMAIL = GMAIL_SENDER_EMAIL
INTERNAL_AUTH_TOKEN = os.getenv("INTERNAL_AUTH_TOKEN")

# Redis client is initialized on startup and reused by worker + endpoints.
r: redis.Redis | None = None
_gmail_access_token: str | None = None
_gmail_access_token_expiry_s: float = 0.0
_startup_retry_logged_at_s: float = 0.0


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
    return redis.Redis.from_url(
        REDIS_URI,
        decode_responses=True,
        socket_connect_timeout=REDIS_CONNECT_TIMEOUT_S,
        socket_timeout=REDIS_SOCKET_TIMEOUT_S,
    )


def _log_startup_retry(err: Exception) -> None:
    global _startup_retry_logged_at_s

    now = time.time()
    if _startup_retry_logged_at_s == 0.0 or now - _startup_retry_logged_at_s >= 10.0:
        logger.warning("startup_retry err=%s", err)
        _startup_retry_logged_at_s = now


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


def _get_gmail_access_token() -> str:
    global _gmail_access_token
    global _gmail_access_token_expiry_s

    now = time.time()
    if _gmail_access_token and now < (_gmail_access_token_expiry_s - 30):
        return _gmail_access_token

    response = requests.post(
        GMAIL_TOKEN_URL,
        data={
            "client_id": GMAIL_CLIENT_ID,
            "client_secret": GMAIL_CLIENT_SECRET,
            "refresh_token": GMAIL_REFRESH_TOKEN,
            "grant_type": "refresh_token",
        },
        timeout=(5, GMAIL_TIMEOUT_S),
    )
    if response.status_code < 200 or response.status_code >= 300:
        raise RuntimeError(f"Gmail token refresh failed status={response.status_code} body={response.text}")

    payload = response.json()
    token = payload.get("access_token")
    expires_in = int(payload.get("expires_in", 3600))
    if not token:
        raise RuntimeError(f"Gmail token refresh missing access_token payload={payload}")

    _gmail_access_token = str(token)
    _gmail_access_token_expiry_s = now + expires_in
    return _gmail_access_token


def _build_deleted_email(payload: dict[str, Any]) -> EmailMessage:
    # Plain text email works across most inbox clients.
    # Required event fields come from auth admin-delete payload.
    recipient = payload.get("deleted_user_email") # This is the email address of the deleted user, which is the recipient of this notification email
    deleted_at = payload.get("deleted_at") or datetime.now(timezone.utc).isoformat()
    admin_email = payload.get("deleted_by_email") # This is the email address of the administrator who performed the deletion, which is included in the email content for context.
    reason_detail_raw = (
        payload.get("reason_detail")
        or payload.get("additional_context")
        or payload.get("additionalContext")
        or ""
    )
    reason_detail = str(reason_detail_raw).strip()

    msg = EmailMessage()
    msg["Subject"] = "Your AIclipse account has been deleted"
    msg["From"] = GMAIL_SENDER_EMAIL
    msg["To"] = recipient
    lines = [
        "Hello,",
        "",
        "This is a confirmation that your AIclipse account has been deleted by an administrator.",
        "",
        f"Deletion time (UTC): {deleted_at}",
        f"Performed by: {admin_email}",
        f"Reason code: {payload.get('reason_code', 'unspecified')}",
    ]
    if reason_detail:
        lines.append(f"Additional context: {reason_detail}")
    lines.extend([
        "",
        "If you believe this was a mistake, contact support immediately.",
        f"Support: {SUPPORT_EMAIL}",
        "",
        "Regards,",
        "AIclipse",
    ])
    msg.set_content("\n".join(lines))
    return msg


def _build_access_approved_email(payload: dict[str, Any]) -> EmailMessage:
    recipient = payload.get("approved_user_email")
    approved_at = payload.get("approved_at") or datetime.now(timezone.utc).isoformat()
    admin_email = payload.get("approved_by_email")
    user_name = str(payload.get("approved_user_name") or "there").strip() or "there"

    msg = EmailMessage()
    msg["Subject"] = "Your AIclipse access request was approved"
    msg["From"] = GMAIL_SENDER_EMAIL
    msg["To"] = recipient
    msg.set_content(
        "\n".join(
            [
                f"Hello {user_name},",
                "",
                "Your AIclipse access request has been approved.",
                "You can now log in using the email and password you registered with.",
                "",
                f"Approval time (UTC): {approved_at}",
                f"Approved by: {admin_email or 'AIclipse admin'}",
                "",
                f"If you need help signing in, contact support: {SUPPORT_EMAIL}",
                "",
                "Regards,",
                "AIclipse",
            ]
        )
    )
    return msg


def _build_email(event_type: str, payload: dict[str, Any]) -> EmailMessage:
    if event_type == "auth.user.deleted.admin":
        return _build_deleted_email(payload)
    if event_type == "auth.access_request.approved":
        return _build_access_approved_email(payload)
    raise ValueError(f"Unsupported event type: {event_type}")


def _send_email(msg: EmailMessage) -> None:
    global _gmail_access_token
    global _gmail_access_token_expiry_s

    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")
    url = f"{GMAIL_API_BASE.rstrip('/')}/users/me/messages/send"

    def _post(token: str):
        return requests.post(
            url,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            json={"raw": raw},
            timeout=(5, GMAIL_TIMEOUT_S),
        )

    token = _get_gmail_access_token()
    response = _post(token)

    # If token expired unexpectedly, refresh once and retry.
    if response.status_code == 401:
        _gmail_access_token = None
        _gmail_access_token_expiry_s = 0.0
        token = _get_gmail_access_token()
        response = _post(token)

    if response.status_code < 200 or response.status_code >= 300:
        raise RuntimeError(f"Gmail send failed status={response.status_code} body={response.text}")


def _dedupe_key(event_id: str, email: str) -> str:
    # Build one unique key per email-triggering event + recipient email.
    # If the same event comes again, this key lets us skip duplicate sends.
    return f"email_sent:{event_id}:{email.lower()}"


def _process_event(fields: dict[str, str]) -> None:
    event_type = fields.get("type")
    if event_type not in {"auth.user.deleted.admin", "auth.access_request.approved"}:
        return

    # Event payload is JSON stored as text in fields["data"].
    raw = fields.get("data")
    if not raw:
        raise ValueError("Missing event data")

    payload = json.loads(raw)
    event_id = str(payload.get("event_id") or payload.get("log_id") or "").strip()
    if event_type == "auth.user.deleted.admin":
        recipient = str(payload.get("deleted_user_email") or "").strip()
    else:
        recipient = str(payload.get("approved_user_email") or "").strip()
    if not event_id or not recipient:
        raise ValueError("Event missing event_id/log_id or recipient email")

    redis_client = _require_redis()
    key = _dedupe_key(event_id, recipient)
    # Create short "inflight" lock so only one send attempt is active at a time.
    # This lock is removed on failure and replaced with "sent" on success.
    first_send = redis_client.set(key, "inflight", ex=SEND_LOCK_TTL_S, nx=True)
    if not first_send:
        state = redis_client.get(key)
        if state == "inflight":
            logger.info("skip_inflight_send event_id=%s recipient=%s", event_id, recipient)
        else:
            logger.info("skip_duplicate_send event_id=%s recipient=%s", event_id, recipient)
        return

    message = _build_email(event_type, payload)
    try:
        _send_email(message)
        # Mark as sent for dedupe window after successful Gmail API handoff.
        redis_client.set(key, "sent", ex=DEDUPE_TTL_S)
    except Exception:
        # Release lock so retry loop can attempt again.
        try:
            redis_client.delete(key)
        except Exception:
            logger.warning("dedupe_key_delete_failed event_id=%s recipient=%s", event_id, recipient)
        raise

    logger.info("email_sent event_type=%s event_id=%s recipient=%s", event_type, event_id, recipient)


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
    if not GMAIL_CLIENT_ID or not GMAIL_CLIENT_SECRET or not GMAIL_REFRESH_TOKEN or not GMAIL_SENDER_EMAIL:
        raise RuntimeError(
            "GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, and GMAIL_SENDER_EMAIL are required"
        )

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
            _log_startup_retry(err)
            time.sleep(1)

    # Suppress repeated /healthz probe noise — only log it once.
    logging.getLogger("uvicorn.access").addFilter(_HealthzOnceFilter())

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
