import logging, os, json, jwt, threading, asyncio, requests, redis
from fastapi import FastAPI, Request, Header, HTTPException
from fastapi.responses import StreamingResponse
from jwt import PyJWKClient

# Gateway service: verifies RS256 JWT via JWKS, proxies Auth/Media/Jobs, and relays Redis Stream events as SSE.

app = FastAPI()

# Upstream service URIs and Redis config come from env
REDIS_URI = os.getenv("REDIS_URI")
STREAM = os.getenv("STREAM")
GROUP = os.getenv("GROUP")
AUTH_URI = os.getenv("AUTH_URI")
MEDIA_URI = os.getenv("MEDIA_URI")
JOBS_URI = os.getenv("JOBS_URI")
PLANS_URI = os.getenv("PLANS_URI")
BILLING_URI = os.getenv("BILLING_URI")
HOSTNAME = os.getenv("HOSTNAME")

r = redis.Redis.from_url(REDIS_URI, decode_responses=True)
try:
    # Ensure consumer group exists at stream head; ignore if already created
    r.xgroup_create(STREAM, GROUP, id="0-0", mkstream=True)
except Exception:
    pass

# JWKS client used to verify RS256 tokens issued by Auth
jwks_client = PyJWKClient(f"{AUTH_URI}/.well-known/jwks.json")

# Per-user SSE queues and job→user mapping for event routing
user_queues = {}
job_to_user = {}

def verify_bearer(auth_header: str):
    # Strict Bearer header check and RS256 verification against JWKS
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")
    token = auth_header.split(" ", 1)[1]
    key = jwks_client.get_signing_key_from_jwt(token).key
    try:
        return jwt.decode(token, key, algorithms=["RS256"], options={"verify_aud": False})
    except Exception:
        raise HTTPException(status_code=401, detail="Unauthorized")

def verify_token_str(token: str):
    # Token verification used by the SSE endpoint; token passed as query for the demo
    if not token:
        raise HTTPException(status_code=401, detail="Unauthorized")
    key = jwks_client.get_signing_key_from_jwt(token).key
    try:
        return jwt.decode(token, key, algorithms=["RS256"], options={"verify_aud": False})
    except Exception:
        raise HTTPException(status_code=401, detail="Unauthorized")

@app.post("/client/login")
@app.post("/api/client/login")
@app.get("/client/login")
@app.get("/api/client/login")
def proxy_login():
    # Proxy to Auth /login; no credentials in P1 demo
    try:
        resp = requests.post(f"{AUTH_URI}/login", json={}, timeout=5)
    except Exception:
        raise HTTPException(status_code=503, detail="auth unavailable")
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    return resp.json()

@app.post("/media/uploads")
@app.post("/api/media/uploads")
async def create_upload(request: Request, authorization: str = Header(None)):
    # Inject owner_id from JWT and pass through to Media; Media returns an upload target
    claims = verify_bearer(authorization)
    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    if "name" not in body:
        body["name"] = "demo.jpg"
    if "contentType" not in body:
        body["contentType"] = "image/jpeg"
    if "size" not in body:
        body["size"] = 1024
    body["owner_id"] = claims.get("sub")
    resp = requests.post(f"{MEDIA_URI}/media/uploads", json=body, timeout=5)
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    return resp.json()

@app.post("/checks")
@app.post("/api/checks")
def submit_check(payload: dict, authorization: str = Header(None)):
    # Create job in Jobs and record job→user for SSE routing; entitlement check is best-effort
    # Note: Idempotency-Key is not enforced here; add Redis-backed idempotency in Gateway later
    claims = verify_bearer(authorization)
    body = dict(payload or {})
    body["owner_id"] = claims.get("sub")
    if PLANS_URI:
        try:
            requests.get(f"{PLANS_URI}/entitlements/{claims.get('sub')}", timeout=2)
        except Exception:
            pass
    resp = requests.post(f"{JOBS_URI}/checks", json=body, timeout=5)
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    data = resp.json()
    jid = data.get("job_id")
    if jid:
        job_to_user[jid] = claims.get("sub")
    return data

@app.get("/jobs/{job_id}")
@app.get("/api/jobs/{job_id}")
def get_job(job_id: str, authorization: str = Header(None)):
    # Enforce owner check and scrub internal fields before returning
    claims = verify_bearer(authorization)
    resp = requests.get(f"{JOBS_URI}/jobs/{job_id}", timeout=5)
    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail="Job not found")
    job = resp.json()
    if str(job.get("owner_id")) != str(claims.get("sub")):
        raise HTTPException(status_code=403, detail="Forbidden")
    job.pop("owner_id", None)
    job.pop("asset_id", None)
    return job

def listen():
    # Background bridge: consume Redis events and push to per-user SSE queues
    consumer = HOSTNAME
    while True:
        try:
            res = r.xreadgroup(GROUP, consumer, {STREAM: ">"}, block=1000, count=10)
        except Exception:
            import time; time.sleep(1); continue
        if not res:
            continue
        for _, msgs in res:
            for mid, fields in msgs:
                t = fields.get("type")
                d = fields.get("data")
                try:
                    ev = json.loads(d) if isinstance(d, str) else (d or {})
                except Exception:
                    ev = {}
                if t in ("jobs.progress", "jobs.completed"):
                    jid = ev.get("job_id")
                    uid = job_to_user.get(jid)
                    if uid and uid in user_queues:
                        user_queues[uid].append(f"event: {t}\ndata: {json.dumps(ev)}\n\n")
                try:
                    r.xack(STREAM, GROUP, mid)
                except Exception:
                    pass

@app.on_event("startup")
def start():
    # Start the Redis listener thread on process startup
    threading.Thread(target=listen, daemon=True).start()

@app.get("/events")
@app.get("/api/events")
async def events(request: Request):
    # Token in query for demo simplicity; consider Authorization header in later phases
    token = request.query_params.get("token")
    claims = verify_token_str(token)
    uid = claims.get("sub")
    user_queues[uid] = []
    async def gen():
        try:
            while True:
                if await request.is_disconnected():
                    break
                if user_queues[uid]:
                    yield user_queues[uid].pop(0)
                else:
                    await asyncio.sleep(0.1)
        finally:
            user_queues.pop(uid, None)
    return StreamingResponse(gen(), media_type="text/event-stream")

class _HealthzFilter(logging.Filter):
    # Hide health endpoints from access logs
    def filter(self, record):
        try:
           return all(p not in record.getMessage() for p in ("/healthz", "/api/healthz"))
        except Exception:
            return True

logging.getLogger("uvicorn.access").addFilter(_HealthzFilter())

@app.get("/healthz")
@app.get("/api/healthz")
def healthz():
    return {"status": "ok"}
