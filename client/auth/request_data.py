from __future__ import annotations

from flask import request


def extract_payload() -> dict:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        payload = {}

    if request.form:
        for key, value in request.form.items():
            if key not in payload:
                payload[key] = value

    return payload
