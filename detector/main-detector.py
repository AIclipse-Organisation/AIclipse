import os, logging
import time
import json
import threading
from uuid import uuid4
from fastapi.responses import JSONResponse
import requests
import redis
import hashlib
import random
from redis.exceptions import ResponseError, ConnectionError, TimeoutError
from fastapi import FastAPI, HTTPException, Request

# Detector service: consumes 'jobs.submitted' from Redis Streams, emits progress/completed,
# and finalizes jobs via Jobs /internal/jobs/{id}/complete. Minimal P1 simulation.

app = FastAPI()

MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = os.getenv("MONGO_DB")
REDIS_URI = os.getenv("REDIS_URI")
STREAM = os.getenv("STREAM")
GROUP = os.getenv("GROUP")
JOBS_URI = os.getenv("JOBS_URI")
HOSTNAME = os.getenv("HOSTNAME")

r = None
processed_cache = {}  # in-process dedup cache keyed by (asset_id, threshold)

def connect():
    # Single client with decoded strings
    return redis.Redis.from_url(REDIS_URI, decode_responses=True)

def ensure_group():
    # Create consumer group at stream head; ignore if it already exists
    try:
        r.xgroup_create(STREAM, GROUP, id="0-0", mkstream=True)
    except ResponseError as e:
        if "BUSYGROUP" not in str(e):
            raise

def process_jobs():
    # Blocking read loop; consumer name aids observability in Redis
    consumer = HOSTNAME
    while True:
        try:
            results = r.xreadgroup(GROUP, consumer, {STREAM: ">"}, block=2000, count=1)
        except ResponseError as e:
            # Auto-recreate group if deleted
            if "NOGROUP" in str(e):
                try:
                    ensure_group()
                except Exception:
                    time.sleep(1)
                continue
            time.sleep(1)
            continue
        except (ConnectionError, TimeoutError):
            time.sleep(1)
            continue
        if not results:
            continue
        for _, messages in results:
            for msg_id, fields in messages:
                t = fields.get("type")
                d = fields.get("data")
                if t != "jobs.submitted":
                    # Ack irrelevant events on the same stream
                    try:
                        r.xack(STREAM, GROUP, msg_id)
                    except Exception:
                        pass
                    continue
                try:
                    ev = json.loads(d) if isinstance(d, str) else (d or {})
                except Exception:
                    ev = {}
                job_id = ev.get("job_id")
                asset_id = ev.get("asset_id")
                params = ev.get("params", {})
                thr = params.get("threshold", 0.5)
                key = (asset_id, thr)
                try:
                    # Fast path: reuse cached result for identical input/params
                    if key in processed_cache:
                        out = processed_cache[key]
                        metrics = {"gpu_s": 0.0, "bytes_in": 0, "bytes_out": 0}
                        requests.post(
                            f"{JOBS_URI}/internal/jobs/{job_id}/complete",
                            json={"status": "completed", "summary": out["summary"], "outputs": out["outputs"], "metrics": metrics},
                            timeout=5
                        )
                        r.xadd(STREAM, {"type": "jobs.completed", "data": json.dumps({"job_id": job_id, "outputs": out["outputs"], "metrics": metrics})})
                        r.xack(STREAM, GROUP, msg_id)
                        continue
                    # Simulated inference signal
                    x = random.random()
                    is_ai = bool(x >= thr)
                    score = round(x, 2)
                    summary = {"is_ai": is_ai, "score": score, "model_version": "1.0.0"}
                    # Fake artifact and checksum
                    uri = f"s3://bucket/detector/outputs/{job_id}/result.json"
                    sha = hashlib.sha256((job_id + str(score)).encode()).hexdigest()
                    outputs = [{"type": "application/json", "uri": uri, "sha256": sha}]
                    # Synthetic usage metrics
                    metrics = {"gpu_s": round(random.uniform(5.0, 15.0), 1), "bytes_in": 5242880, "bytes_out": 1024}
                    # Finalize job and broadcast completion
                    requests.post(
                        f"{JOBS_URI}/internal/jobs/{job_id}/complete",
                        json={"status": "completed", "summary": summary, "outputs": outputs, "metrics": metrics},
                        timeout=5
                    )
                    r.xadd(STREAM, {"type": "jobs.completed", "data": json.dumps({"job_id": job_id, "outputs": outputs, "metrics": metrics})})
                    processed_cache[key] = {"summary": summary, "outputs": outputs}
                finally:
                    # Prevent pending build-up
                    try:
                        r.xack(STREAM, GROUP, msg_id)
                    except Exception:
                        pass

@app.on_event("startup")
def start():
    # Connect to Redis with retry, ensure group, start worker thread
    global r
    while True:
        try:
            r = connect()
            r.ping()
            break
        except Exception:
            time.sleep(1)
    while True:
        try:
            ensure_group()
            break
        except Exception:
            time.sleep(1)
    threading.Thread(target=process_jobs, daemon=True).start()

from detector_modules.service.detector_service import predict_from_bytes

@app.post("/checks")
async def detector_checks(request: Request):
    # Read raw image bytes
    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="Empty body, expected image bytes")

    # Read Request-Id (for logging / tracing)
    request_id = request.headers.get("x-request-id") or str(uuid4())
    user_id = request.headers.get("x-user-id", "unknown")

    bytes_in = len(body)

    try:
            verdict, confidence, label = predict_from_bytes(body)
            result = {
                "verdict": verdict,
                "label": label,
                "confidence": confidence
            }
            print(
                f"[Detector] Results = [verdict = {result['verdict']} [confidence = {result['confidence']}]"
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Detector failure: {str(e)}")


    print(
        f"[Detector] request_id={request_id} user_id={user_id} "
    )

    return JSONResponse(result)

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