from __future__ import annotations

from unittest.mock import Mock

from services.auth.session import clear_authenticated_user, resolve_current_user, store_authenticated_user


def test_store_authenticated_user_sets_only_canonical_session_fields(flask_app):
    with flask_app.test_request_context("/"):
        from flask import session

        store_authenticated_user({"user_id": "u_1", "email": "user@example.com", "is_admin": True})

        assert dict(session) == {
            "current_user": {"user_id": "u_1", "email": "user@example.com", "is_admin": True},
            "is_admin": True,
        }


def test_clear_authenticated_user_removes_canonical_session_fields(flask_app):
    with flask_app.test_request_context("/"):
        from flask import session

        session["current_user"] = {"user_id": "u_1"}
        session["is_admin"] = True
        session["extra"] = "keep-me"

        clear_authenticated_user()

        assert dict(session) == {"extra": "keep-me"}


def test_resolve_current_user_always_refetches_and_stores_live_user(flask_app):
    gateway = Mock()
    gateway.fetch_me.return_value = (
        {"user_id": "u_live", "email": "live@example.com", "is_admin": False},
        200,
    )

    with flask_app.test_request_context("/"):
        from flask import session

        session["current_user"] = {"user_id": "u_cached", "email": "cached@example.com", "is_admin": True}
        session["is_admin"] = True

        user, status = resolve_current_user(gateway, "token-123")

        assert status == 200
        assert user == {"user_id": "u_live", "email": "live@example.com", "is_admin": False}
        assert session["current_user"] == user
        assert session["is_admin"] is False
        gateway.fetch_me.assert_called_once_with("token-123")


def test_resolve_current_user_clears_session_on_failed_revalidation(flask_app):
    gateway = Mock()
    gateway.fetch_me.return_value = (None, 401)

    with flask_app.test_request_context("/"):
        from flask import session

        session["current_user"] = {"user_id": "u_cached", "email": "cached@example.com", "is_admin": True}
        session["is_admin"] = True

        user, status = resolve_current_user(gateway, "token-123")

        assert user is None
        assert status == 401
        assert dict(session) == {}
