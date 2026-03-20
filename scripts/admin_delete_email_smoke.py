import json
import os
import time
from typing import Any

import redis
import requests


GATEWAY_URL = os.getenv("GATEWAY_URL", "")
ADMIN_BEARER_TOKEN = os.getenv("ADMIN_BEARER_TOKEN", "")
TARGET_USER_ID = os.getenv("TARGET_USER_ID", "")
DELETE_REASON_CODE = os.getenv("DELETE_REASON_CODE", "user_request")
DELETE_REASON_DETAIL = os.getenv("DELETE_REASON_DETAIL", "Smoke test admin delete")
REDIS_URI = os.getenv("REDIS_URI", "")
AUTH_EVENT_STREAM = os.getenv("AUTH_EVENT_STREAM", "auth-events")
EVENT_LOOKBACK = int(os.getenv("EVENT_LOOKBACK", "300"))
EMAIL_DEDUPE_TIMEOUT_S = int(os.getenv("EMAIL_DEDUPE_TIMEOUT_S", "30"))


def _require(name: str, value: str) -> None:
    if not value:
        raise RuntimeError(f"Missing required env var: {name}")


def _delete_user() -> dict[str, Any]:
    # Call the same admin delete endpoint used by the UI.
    url = f"{GATEWAY_URL.rstrip('/')}/auth/admin/user/{TARGET_USER_ID}"
    headers = {
        "Authorization": f"Bearer {ADMIN_BEARER_TOKEN}",
        "Content-Type": "application/json",
    }
    payload = {
        "reason_code": DELETE_REASON_CODE,
        "reason_detail": DELETE_REASON_DETAIL,
    }
    response = requests.delete(url, headers=headers, json=payload, timeout=20)
    if response.status_code != 200:
        raise RuntimeError(f"Delete failed: {response.status_code} {response.text}")

    body = response.json()
    if not body.get("deleted"):
        raise RuntimeError(f"Delete response is not successful: {json.dumps(body)}")
    return body


def _find_event(r: redis.Redis, log_id: str) -> dict[str, Any] | None:
    # Look through recent stream entries for this log_id.
    events = r.xrevrange(AUTH_EVENT_STREAM, "+", "-", count=EVENT_LOOKBACK)
    for _, fields in events:
        if fields.get("type") != "auth.user.deleted.admin":
            continue
        raw = fields.get("data")
        if not raw:
            continue
        try:
            payload = json.loads(raw)
        except Exception:
            continue
        if str(payload.get("log_id")) == log_id:
            return payload
    return None


def _wait_for_dedupe_key(r: redis.Redis, log_id: str, email: str) -> bool:
    # Worker sets this key. Success state is "sent".
    # "inflight" means send is still in progress.
    key = f"email_sent:{log_id}:{email.lower()}"
    deadline = time.time() + EMAIL_DEDUPE_TIMEOUT_S
    while time.time() < deadline:
        status = r.get(key)
        if status == "sent":
            return True
        time.sleep(1)
    return False


def main() -> None:
    # Require key env vars so the smoke test is repeatable.
    _require("GATEWAY_URL", GATEWAY_URL)
    _require("ADMIN_BEARER_TOKEN", ADMIN_BEARER_TOKEN)
    _require("TARGET_USER_ID", TARGET_USER_ID)
    _require("REDIS_URI", REDIS_URI)

    print("1/4 Deleting target user via gateway admin endpoint...")
    delete_body = _delete_user()
    log_id = str(delete_body.get("log_id") or "")
    user = delete_body.get("user") or {}
    deleted_email = str(user.get("email") or "").strip()
    if not log_id:
        raise RuntimeError("Delete response missing log_id")

    print(f"   Deleted user_id={user.get('user_id')} log_id={log_id}")

    print("2/4 Connecting to Redis and verifying auth deletion event...")
    r = redis.Redis.from_url(REDIS_URI, decode_responses=True)
    event_payload = _find_event(r, log_id)
    if not event_payload:
        raise RuntimeError(f"No auth.user.deleted.admin event found for log_id={log_id}")
    print("   Event found in stream.")

    if not deleted_email:
        raise RuntimeError("Delete response missing deleted user email")

    print("3/4 Waiting for email-worker dedupe key signal...")
    sent = _wait_for_dedupe_key(r, log_id, deleted_email)
    if not sent:
        raise RuntimeError(
            "Timed out waiting for email sent signal key. "
            "Check email-worker logs and Gmail API OAuth credentials."
        )
    print("   Email worker send signal detected.")

    print("4/4 Smoke test passed.")
    print("   You can also confirm mailbox delivery manually for final verification.")


if __name__ == "__main__":
    main()
