import os, logging
import hashlib
import json
from fastapi import FastAPI, HTTPException
from pymongo import MongoClient
import redis

# Media service: validates uploads, issues upload target, marks asset ready on callback, emits 'media.uploaded'.

app = FastAPI()

# Config
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = os.getenv("MONGO_DB")
REDIS_URI = os.getenv("REDIS_URI")
STREAM = os.getenv("STREAM")
S3_ENDPOINT = os.getenv("S3_ENDPOINT")            # internal S3 endpoint
S3_PUBLIC_ENDPOINT = os.getenv("S3_PUBLIC_ENDPOINT")  # public URL base returned to client

# Optional Mongo store for assets; service stays operational without it
assets = None
try:
    mc = MongoClient(MONGO_URI)
    mc.admin.command("ping")
    assets = mc[MONGO_DB].assets
except Exception:
    assets = None

# Redis for id generation and eventing
r = redis.Redis.from_url(REDIS_URI, decode_responses=True)

# Upload constraints
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_FILE_SIZE = 5 * 1024 * 1024

@app.post("/media/uploads")
def create_upload(payload: dict):
    # Validate minimal contract coming from Gateway
    name = payload.get("name")
    content_type = payload.get("contentType")
    size = payload.get("size")
    owner_id = payload.get("owner_id")
    if not name or not content_type or size is None or not owner_id:
        raise HTTPException(status_code=400, detail="Missing required fields")
    if content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=415, detail="Unsupported Media Type")
    if size > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="Payload Too Large")

    # Create asset id and persist if Mongo is available
    asset_id = f"ast_{r.incr('asset_id_counter')}"
    if assets is not None:
        try:
            assets.insert_one({
                "asset_id": asset_id,
                "owner_id": owner_id,
                "name": name,
                "contentType": content_type,
                "size": size,
                "status": "pending"
            })
        except Exception:
            pass

    # Return a client-facing upload target
    key = f"media/uploads/{asset_id}/{name}"
    upload_url = f"{S3_PUBLIC_ENDPOINT.rstrip('/')}/{key}"  # demo: public URL, not presigned
    return {"asset_id": asset_id, "uploadUrl": upload_url}

@app.post("/media/storage-callback")
def storage_callback(payload: dict):
    # Called by storage after a successful PUT
    asset_id = payload.get("asset_id")
    if not asset_id:
        raise HTTPException(status_code=400, detail="asset_id is required")
    if assets is None:
        return {"status": "ok"}

    doc = assets.find_one({"asset_id": asset_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Asset not found")

    # Mark asset ready and compute a stable content hash placeholder
    sha = hashlib.sha256(asset_id.encode()).hexdigest()
    assets.update_one({"asset_id": asset_id}, {"$set": {"status": "ready", "sha256": sha}})

    # Emit event for consumers with internal S3 URI
    s3_uri = f"{S3_ENDPOINT.rstrip('/')}/media/uploads/{asset_id}/{doc['name']}"
    evt = {"asset_id": asset_id, "owner_id": doc["owner_id"], "s3_uri": s3_uri, "sha256": sha}
    r.xadd(STREAM, {"type": "media.uploaded", "data": json.dumps(evt)})
    return {"status": "ok"}

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
