import os
import logging
from contextlib import asynccontextmanager

import anyio
from fastapi import FastAPI

from routers.v1_0_1.checks import router as checks_v1_0_1_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    max_inflight = int(os.getenv("DETECTOR_MAX_INFLIGHT", "4"))
    infer_conc = int(os.getenv("DETECTOR_INFER_CONCURRENCY", "1"))

    # Max number of requests allowed inside detector at once (waiting + running)
    app.state.inflight_limiter = anyio.CapacityLimiter(max_inflight)

    # Max number of actual inferences running concurrently
    app.state.infer_limiter = anyio.CapacityLimiter(infer_conc)

    from detector_modules.core.loader import get_model
    get_model()

    yield


app = FastAPI(lifespan=lifespan)


class _HealthzFilter(logging.Filter):
    # Hide /healthz from access logs
    def filter(self, record):
        try:
            return "/healthz" not in record.getMessage()
        except Exception:
            return True

logging.getLogger("uvicorn.access").addFilter(_HealthzFilter())

@app.get("/healthz")
def healthz():
    return {"status": "ok"}

app.include_router(checks_v1_0_1_router, prefix="/v1.0.1", tags=["v1.0.1"])
