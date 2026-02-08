import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.cpu_pool import CpuPool
from app.core.jwks import JwksService
from app.core.settings import Settings
from app.routers.health import router as health_router
from app.routers.auth_proxy import router as auth_proxy_router
from app.routers.checks import router as checks_router
from app.routers.media import router as media_router
from app.routers.models import router as models_router


class _HealthzFilter(logging.Filter):
    # Hide health endpoints from access logs
    def filter(self, record):
        try:
            return "/healthz" not in record.getMessage()
        except Exception:
            return True


logging.getLogger("uvicorn.access").addFilter(_HealthzFilter())


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.settings = Settings.from_env()
    app.state.cpu = CpuPool(app.state.settings.cpu_pool_workers)
    app.state.http = httpx.AsyncClient(timeout=app.state.settings.http_timeout_s)
    app.state.jwks = JwksService()

    # Best-effort JWKS preload; if it fails, retry lazily on first request.
    try:
        await app.state.jwks.refresh(app, force=True)
    except Exception as exc:
        logging.warning("JWKS preload failed: %s", exc)
    yield

    await app.state.http.aclose()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(auth_proxy_router)
app.include_router(checks_router)
app.include_router(media_router)
app.include_router(models_router, prefix="/admin")
