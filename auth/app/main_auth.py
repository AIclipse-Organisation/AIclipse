import os
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
import redis.asyncio as redis_async

from app.core.cpu_pool import CpuPool
from app.core.keys import build_keys
from app.core.settings import Settings
from app.db.mongo import mongo_lifespan
from app.db.repos import UserRepo, ApiKeyRepo, UserDeletionLogRepo
from app.routers.public import router as public_router
from app.routers.admin import router as admin_router
from app.routers.api_keys import router as api_keys_router


class _HealthzFilter(logging.Filter):
    def filter(self, record):
        try:
            return "/healthz" not in record.getMessage()
        except Exception:
            logging.getLogger("uvicorn.error").debug(
                "HealthzFilter failed while processing access log record",
                exc_info=True,
            )
            return True


logging.getLogger("uvicorn.access").addFilter(_HealthzFilter())


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = Settings.from_env()
    keys = build_keys(settings.JWT_KEY)
    cpu = CpuPool.from_max_concurrency(settings.CPU_POOL_CONCURRENCY)
    event_redis = redis_async.Redis.from_url(
        settings.REDIS_URI,
        decode_responses=True,
        socket_connect_timeout=2,
        socket_timeout=2,
    )

    async with mongo_lifespan(settings) as db:
        user_repo = UserRepo(db)
        api_repo = ApiKeyRepo(db)
        deletion_log_repo = UserDeletionLogRepo(db)
        await user_repo.ensure_indexes()
        await user_repo.ensure_default_user_fields()
        await api_repo.ensure_indexes()
        await deletion_log_repo.ensure_indexes()
        # Old users may have age field; migrate to date_of_birth only when explicitly requested.
        # Keep default off so startup avoids repeated full-collection scans on large datasets.
        run_legacy_dob_migration = os.getenv("RUN_LEGACY_DOB_MIGRATION", "false").lower() == "true"
        if run_legacy_dob_migration:
            await user_repo.users.update_many(
                {"date_of_birth": {"$exists": False}},
                {"$set": {"date_of_birth": None}},
            )

        app.state.settings = settings
        app.state.keys = keys
        app.state.cpu = cpu
        app.state.user_repo = user_repo
        app.state.api_repo = api_repo
        app.state.deletion_log_repo = deletion_log_repo
        # Route handlers read this from app.state. Example: admin delete route.
        app.state.event_redis = event_redis

        try:
            yield
        finally:
            # Close Redis cleanly on shutdown/reload.
            await event_redis.aclose()


app = FastAPI(lifespan=lifespan)

app.include_router(public_router)
app.include_router(admin_router)
app.include_router(api_keys_router)


@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(request, exc: RequestValidationError):
    # Log validation errors with path. Example: missing "date_of_birth" in /signup.
    logging.getLogger("uvicorn.error").warning(
        "request_validation_error path=%s errors=%s",
        request.url.path,
        exc.errors(),
    )
    return JSONResponse(status_code=422, content={"detail": exc.errors()})


@app.get("/.well-known/jwks.json")
def jwks():
    return JSONResponse(content=app.state.keys.jwks)


@app.get("/healthz")
def healthz():
    return {"status": "ok"}
