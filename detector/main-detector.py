import os
import logging
from contextlib import asynccontextmanager

import anyio
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from detector_modules.core.loader import manager, cleanup_old_models
from detector_modules.io.minio_client import fetch_latest_model_from_minio, download_model_weights
from routers.v1_0_1.checks import router as checks_v1_0_1_router

# Define the expected payload from the C# service
class ModelUpdateRequest(BaseModel):
    version: str
    minio_path: str

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
async def reload_model(payload: ModelUpdateRequest):
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