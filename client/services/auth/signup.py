from __future__ import annotations

from datetime import datetime
from typing import Any

from auth.gateway import GatewayClient


def _is_valid_email_address(value: str) -> bool:
    if not value or any(char.isspace() for char in value):
        return False

    local_part, separator, domain = value.partition("@")
    if separator != "@" or not local_part or not domain:
        return False

    if "@" in domain or domain.startswith(".") or domain.endswith("."):
        return False

    labels = domain.split(".")
    return len(labels) >= 2 and all(label for label in labels)


def submit_signup_request(gateway: GatewayClient, payload: dict[str, Any]) -> tuple[dict[str, Any], int]:
    user_name = str(payload.get("user_name") or "").strip()
    email = str(payload.get("email") or "").strip()
    date_of_birth_raw = payload.get("date_of_birth")
    password = payload.get("password") or ""
    how_did_you_find_us = str(payload.get("how_did_you_find_us") or "").strip()
    how_did_you_find_us_detail = str(payload.get("how_did_you_find_us_detail") or "").strip()

    if not user_name or not email or not password or date_of_birth_raw is None or not how_did_you_find_us:
        return {"detail": "Please fill username, email, date of birth, password and how you found us."}, 400

    if how_did_you_find_us == "other" and not how_did_you_find_us_detail:
        return {"detail": "Please elaborate on how you found us."}, 400

    try:
        dob = datetime.strptime(str(date_of_birth_raw), "%d-%m-%Y").date()
        today = datetime.now().date()
        age = (today.year - dob.year) - ((today.month, today.day) < (dob.month, dob.day))
        if age < 18:
            return {"detail": "You must be at least 18 years old to sign up."}, 400
        if age > 150:
            return {"detail": "Please provide a valid date of birth."}, 400
    except ValueError:
        return {"detail": "Date of birth must be in DD-MM-YYYY format."}, 400

    if not _is_valid_email_address(email):
        return {"detail": "Please enter a valid email address."}, 400

    data, status = gateway.signup(
        user_name,
        email,
        str(date_of_birth_raw),
        password,
        how_did_you_find_us,
        how_did_you_find_us_detail or None,
    )
    if data is None:
        data = {"detail": "Signup failed"}
    return data, status
