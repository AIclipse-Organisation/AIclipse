import hmac
import os
import re
import logging
from contextlib import asynccontextmanager

import anyio
from fastapi import FastAPI, Header, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator

from detector_modules.core.loader import manager, cleanup_old_models
from detector_modules.io.minio_client import fetch_latest_model_from_minio, download_model_weights
from routers.v1_0_1.checks import router as checks_v1_0_1_router

INTERNAL_AUTH_TOKEN = os.getenv("INTERNAL_AUTH_TOKEN", "")

# Whitelist for minio_path: alphanumeric, dots, slashes, underscores, hyphens.
# Blocks path traversal ("../"), absolute paths, and non-model extensions.
_MINIO_PATH_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_./-]{0,254}\.pt$")


def _require_internal_token(x_internal_token: str | None) -> None:
    if not INTERNAL_AUTH_TOKEN:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="INTERNAL_AUTH_TOKEN is not configured",
        )
    if not hmac.compare_digest(x_internal_token or "", INTERNAL_AUTH_TOKEN):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid internal auth token",
        )


# Define the expected payload from the C# service
class ModelUpdateRequest(BaseModel):
    version: str
    minio_path: str

    @field_validator("minio_path")
    @classmethod
    def validate_minio_path(cls, v: str) -> str:
        if ".." in v or not _MINIO_PATH_RE.match(v):
            raise ValueError("invalid minio_path")
        return v

    @field_validator("version")
    @classmethod
    def validate_version(cls, v: str) -> str:
        if not re.match(r"^[A-Za-z0-9._-]{1,64}$", v):
            raise ValueError("invalid version")
        return v

@asynccontextmanager
async def lifespan(app: FastAPI):
    max_inflight = int(os.getenv("DETECTOR_MAX_INFLIGHT", "4"))
    infer_conc = int(os.getenv("DETECTOR_INFER_CONCURRENCY", "1"))

    app.state.inflight_limiter = anyio.CapacityLimiter(max_inflight)
    app.state.infer_limiter = anyio.CapacityLimiter(infer_conc)

    # Check MinIO for the newest model
    latest_local_path = await anyio.to_thread.run_sync(fetch_latest_model_from_minio)

    #Load the model
    await anyio.to_thread.run_sync(manager.reload, latest_local_path)

    # Clean up previous model versions
    if latest_local_path:
        await anyio.to_thread.run_sync(cleanup_old_models, latest_local_path)

    yield

app = FastAPI(lifespan=lifespan)

class _HealthzFilter(logging.Filter):
    def filter(self, record):
        try:
            return "/healthz" not in record.getMessage()
        except Exception:
            return True

logging.getLogger("uvicorn.access").addFilter(_HealthzFilter())

@app.get("/healthz")
def healthz():
    return {"status": "ok"}

@app.post("/internal/reload-model")
async def reload_model(
    payload: ModelUpdateRequest,
    x_internal_token: str | None = Header(None, alias="X-Internal-Token"),
):
    _require_internal_token(x_internal_token)
    try:
        # Download the file from MinIO to the updates folder
        local_path = await anyio.to_thread.run_sync(
            download_model_weights, 
            payload.minio_path, 
            payload.version
        )
        
        # Trigger the memory swap
        await anyio.to_thread.run_sync(manager.reload, local_path)
        
        await anyio.to_thread.run_sync(cleanup_old_models, local_path)
        
        return {"status": "success", "version": payload.version}
    except Exception as e:
        logging.error(f"Failed to reload model: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})

app.include_router(checks_v1_0_1_router, prefix="/v1.0.1", tags=["v1.0.1"])