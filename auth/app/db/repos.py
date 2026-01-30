from motor.motor_asyncio import AsyncIOMotorDatabase


class UserRepo:
    def __init__(self, db: AsyncIOMotorDatabase):
        self.users = db["auth.users"]

    async def ensure_indexes(self):
        await self.users.create_index([("email", 1)], name="uniq_email", unique=True)
        await self.users.create_index([("user_id", 1)], name="uniq_user_id", unique=True)


class ApiKeyRepo:
    def __init__(self, db: AsyncIOMotorDatabase):
        self.keys = db["auth.api_keys"]

    async def ensure_indexes(self):
        await self.keys.create_index([("key_id", 1)], name="uniq_key_id", unique=True)
        await self.keys.create_index([("user_id", 1)], name="uniq_user_id_one_key", unique=True)
