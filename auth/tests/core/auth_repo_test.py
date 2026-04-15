import pytest

from app.db.repos import UserRepo


@pytest.mark.asyncio
async def test_ensure_default_user_fields_backfills_existing_users(users_coll):
    await users_coll.insert_one(
        {
            "user_id": "u_missing_pref",
            "user_name": "Missing Pref",
            "email": "missingpref@example.com",
            "password": "hashed",
            "is_admin": False,
            "plan": 0,
        }
    )

    class FakeDb:
        def __getitem__(self, name):
            assert name == "auth.users"
            return users_coll

    repo = UserRepo(FakeDb())
    await repo.ensure_default_user_fields()

    stored = await users_coll.find_one({"user_id": "u_missing_pref"})
    assert stored is not None
    assert stored["do_not_show_disclaimer_again"] is False
    assert stored["do_not_show_quick_start_again"] is False
