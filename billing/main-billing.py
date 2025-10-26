import logging, os
from datetime import datetime
from fastapi import FastAPI
from pymongo import MongoClient

# Billing service for Phase 1 simulation.
# Accepts aggregated usage events from Jobs and stores them for audit.

app = FastAPI()

# Mongo connection parameters supplied via environment.
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = os.getenv("MONGO_DB")

# Best-effort Mongo init. For the demo, startup must not fail if Mongo is absent.
usage = None
try:
    client = MongoClient(MONGO_URI)
    client.admin.command("ping")
    usage = client[MONGO_DB].usage  # collection: usage
except Exception:
    usage = None  # operate in write-through-noop mode

@app.post("/usage")
def record_usage(payload: dict):
    # Expects a JSON payload with fields like user_id, job_id, metrics, bytes_in, gpu_s, etc.
    if not payload:
        return {"ok": False}
    data = dict(payload)
    data["timestamp"] = datetime.utcnow()  # server-side canonical time
    if usage is not None:
        try:
            usage.insert_one(data)
        except Exception:
            # For Phase 1 the write is best-effort; failures are non-fatal.
            pass
    return {"ok": True}

class _HealthzFilter(logging.Filter):
    # Keep access logs clean by hiding /healthz
    def filter(self, record):
        try:
            return "/healthz" not in record.getMessage()
        except Exception:
            return True

logging.getLogger("uvicorn.access").addFilter(_HealthzFilter())

@app.get("/healthz")
def healthz():
    return {"status": "ok"}