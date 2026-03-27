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


class UserDeletionLogRepo:
    def __init__(self, db: AsyncIOMotorDatabase):
        self.logs = db["auth.user_deletion_logs"]

    async def ensure_indexes(self):
        # TTL for 30-day retention
        await self.logs.create_index(
            [("deleted_at", 1)],
            name="ttl_deleted_at_30d",
            expireAfterSeconds=30 * 24 * 60 * 60,
        )
        await self.logs.create_index([("deleted_user_id", 1)], name="idx_deleted_user")
        await self.logs.create_index([("deleted_by_user_id", 1)], name="idx_deleted_by")
