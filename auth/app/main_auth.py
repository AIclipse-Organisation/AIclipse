import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from app.core.cpu_pool import CpuPool
from app.core.keys import build_keys
from app.core.settings import Settings
from app.db.mongo import mongo_lifespan
from app.db.repos import UserRepo, ApiKeyRepo
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

    async with mongo_lifespan(settings) as db:
        user_repo = UserRepo(db)
        api_repo = ApiKeyRepo(db)
        await user_repo.ensure_indexes()
        await api_repo.ensure_indexes()

        app.state.settings = settings
        app.state.keys = keys
        app.state.cpu = cpu
        app.state.user_repo = user_repo
        app.state.api_repo = api_repo

        yield


app = FastAPI(lifespan=lifespan)

app.include_router(public_router)
app.include_router(admin_router)
app.include_router(api_keys_router)


@app.get("/.well-known/jwks.json")
def jwks():
    return JSONResponse(content=app.state.keys.jwks)


@app.get("/healthz")
def healthz():
    return {"status": "ok"}
