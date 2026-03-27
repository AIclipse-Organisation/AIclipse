from contextlib import asynccontextmanager
from motor.motor_asyncio import AsyncIOMotorClient

from app.core.settings import Settings


@asynccontextmanager
async def mongo_lifespan(settings: Settings):
    client = AsyncIOMotorClient(settings.MONGO_URI)
    db = client[settings.MONGO_DB]
    try:
        yield db
    finally:
        client.close()
