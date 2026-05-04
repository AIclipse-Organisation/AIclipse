import pytest

from app.core.settings import Settings
from app.db.mongo import mongo_lifespan


def test_settings_default_mongo_timeout_is_one_minute(monkeypatch):
    monkeypatch.setenv("JWT_KEY", "jwt")
    monkeypatch.setenv("MONGO_URI", "mongodb://mongo-srv:27017")
    monkeypatch.setenv("MONGO_DB", "aiclipse")
    monkeypatch.setenv("API_KEY_PEPPER", "pepper")
    monkeypatch.setenv("INTERNAL_AUTH_TOKEN", "internal")
    monkeypatch.setenv("REDIS_URI", "redis://redis-srv:6379")
    monkeypatch.delenv("MONGO_TIMEOUT_MS", raising=False)

    settings = Settings.from_env()

    assert settings.MONGO_TIMEOUT_MS == 60000


@pytest.mark.asyncio
async def test_mongo_lifespan_applies_configured_timeout(monkeypatch):
    created_clients = []

    class FakeClient:
        def __init__(self, uri, **kwargs):
            self.uri = uri
            self.kwargs = kwargs
            self.closed = False
            created_clients.append(self)

        def __getitem__(self, name):
            return {"name": name}

        def close(self):
            self.closed = True

    monkeypatch.setattr("app.db.mongo.AsyncIOMotorClient", FakeClient)
    settings = Settings(
        JWT_KEY="jwt",
        MONGO_URI="mongodb://mongo-srv:27017",
        MONGO_DB="aiclipse",
        API_KEY_PEPPER="pepper",
        INTERNAL_AUTH_TOKEN="internal",
        REDIS_URI="redis://redis-srv:6379",
        MONGO_TIMEOUT_MS=60000,
    )

    async with mongo_lifespan(settings) as db:
        assert db == {"name": "aiclipse"}

    assert len(created_clients) == 1
    assert created_clients[0].uri == "mongodb://mongo-srv:27017"
    assert created_clients[0].kwargs == {
        "connectTimeoutMS": 60000,
        "socketTimeoutMS": 60000,
        "serverSelectionTimeoutMS": 60000,
    }
    assert created_clients[0].closed is True
