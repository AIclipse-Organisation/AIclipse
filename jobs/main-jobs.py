import os, logging
import json
import datetime
import redis
from fastapi import FastAPI, HTTPException
from pymongo import MongoClient

# Jobs service: persists job state, emits 'jobs.submitted', accepts '/internal/.../complete',
# and exposes GET /jobs/{id} for Gateway owner checks.

app = FastAPI()

# Config
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = os.getenv("MONGO_DB")
REDIS_URI = os.getenv("REDIS_URI")
STREAM = os.getenv("STREAM")

# Fallback store when Mongo is unavailable (demo-friendly)
mem_jobs = {}

# Best-effort Mongo init; service remains operational without Mongo
client = None
jobs_col = None
try:
    client = MongoClient(MONGO_URI)
    client.admin.command("ping")
    jobs_col = client[MONGO_DB].jobs
except Exception:
    client = None
    jobs_col = None

# Redis client for id generation and eventing
r = redis.Redis.from_url(REDIS_URI, decode_responses=True)

@app.post("/checks")
def create_check(payload: dict):
    # Validate minimal inputs passed from Gateway (Gateway injects owner_id)
    asset_id = payload.get("asset_id")
    owner_id = payload.get("owner_id")
    params = payload.get("params", {})
    if not asset_id or not owner_id:
        raise HTTPException(status_code=400, detail="asset_id and owner_id required")

    # Monotonic job ids via Redis to stay consistent across replicas
    jid = r.incr("job_id_counter")
    job_id = f"job_{jid}"

    # Initial job document
    doc = {
        "job_id": job_id,
        "owner_id": owner_id,
        "asset_id": asset_id,
        "params": params,
        "status": "pending",
        "summary": None,
        "error": None,
        "outputs": [],
        "created_at": datetime.datetime.utcnow()
    }

    # Persist to Mongo if available, otherwise memory
    if jobs_col is None:
        mem_jobs[job_id] = doc
    else:
        jobs_col.insert_one(doc)

    # Emit submission event for Detector
    evt = {
        "job_id": job_id,
        "owner_id": owner_id,
        "asset_id": asset_id,
        "params": params,
        "detector": {"type": "ai-detector", "version": "1.0.0"}
    }
    r.xadd(STREAM, {"type": "jobs.submitted", "data": json.dumps(evt)})

    return {"job_id": job_id, "status": "pending"}

@app.post("/internal/jobs/{job_id}/complete")
def complete(job_id: str, payload: dict):
    # Upserts completion fields from detector callbacks
    if jobs_col is None:
        job = mem_jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        if job.get("status") in ("completed", "failed"):
            return {"status": "already_done"}
        status = payload.get("status") or ("failed" if payload.get("error") else "completed")
        job.update({
            "status": status,
            "summary": payload.get("summary") if status == "completed" else None,
            "error": payload.get("error") if status == "failed" else None,
            "outputs": payload.get("outputs", []),
            "updated_at": datetime.datetime.utcnow()
        })
    else:
        job = jobs_col.find_one({"job_id": job_id})
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        if job.get("status") in ("completed", "failed"):
            return {"status": "already_done"}
        status = payload.get("status") or ("failed" if payload.get("error") else "completed")
        update = {
            "status": status,
            "summary": payload.get("summary") if status == "completed" else None,
            "error": payload.get("error") if status == "failed" else None,
            "outputs": payload.get("outputs", []),
            "updated_at": datetime.datetime.utcnow()
        }
        jobs_col.update_one({"job_id": job_id}, {"$set": update})

    return {"status": "ok"}

@app.get("/jobs/{job_id}")
def get_job(job_id: str):
    # Raw job for Gateway; Gateway enforces owner check and scrubs internal fields
    if jobs_col is None:
        job = mem_jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        return {
            "job_id": job["job_id"],
            "status": job["status"],
            "owner_id": job["owner_id"],
            "asset_id": job["asset_id"],
            "summary": job.get("summary"),
            "outputs": job.get("outputs", []),
            "error": job.get("error")
        }
    job = jobs_col.find_one({"job_id": job_id})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "job_id": job["job_id"],
        "status": job["status"],
        "owner_id": job["owner_id"],
        "asset_id": job["asset_id"],
        "summary": job.get("summary"),
        "outputs": job.get("outputs", []),
        "error": job.get("error")
    }

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
