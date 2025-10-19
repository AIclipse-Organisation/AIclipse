import os, logging
from fastapi import FastAPI
from pymongo import MongoClient

# Plans/Entitlements service. Returns user's plan; defaults to "free" for the demo.

app = FastAPI()

# Mongo is optional; service stays functional without it
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = os.getenv("MONGO_DB")

client = None
col = None
try:
    client = MongoClient(MONGO_URI)
    client.admin.command("ping")
    col = client[MONGO_DB].entitlements
except Exception:
    client = None
    col = None

@app.get("/entitlements/{user_id}")
def get_entitlements(user_id: str):
    # Fast path when Mongo is absent
    if col is None:
        return {"user_id": user_id, "plan": "free"}
    doc = col.find_one({"user_id": user_id})
    if doc:
        return {"user_id": user_id, "plan": doc.get("plan", "free")}
    # Initialize user with a "free" plan on first access
    col.insert_one({"user_id": user_id, "plan": "free"})
    return {"user_id": user_id, "plan": "free"}

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
