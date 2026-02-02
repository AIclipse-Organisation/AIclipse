import os
import logging
from datetime import datetime, timezone
from uuid import uuid4
from typing import Optional, Annotated
from contextlib import asynccontextmanager

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Query
from pymongo import MongoClient
from bson import ObjectId

from pydantic import BaseModel, Field, ConfigDict
from pydantic.functional_serializers import PlainSerializer

from fastapi import Request

import httpx


def sanitize_for_log(value: str | None) -> str:
    """
    Remove newline characters from values before logging to mitigate log injection.
    """
    if value is None:
        return ""
    # Strip carriage returns and newlines; keep other characters unchanged.
    return value.replace("\r", "").replace("\n", "")


# ---- env ----
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = os.getenv("MONGO_DB")

S3_ENDPOINT = os.getenv("S3_ENDPOINT")
S3_PUBLIC_ENDPOINT = os.getenv("S3_PUBLIC_ENDPOINT")

S3_BUCKET = "images"

MODEL_CYCLE_URL = os.getenv("MODEL_CYCLE_URL", "http://model-cycle:3000")

ALLOWED_TYPES = {"image/jpeg", "image/jpg", "image/png"}
MAX_FILE_SIZE = 5 * 1024 * 1024

# Presign TTLs (seconds)
PRESIGN_PRIVATE_EXPIRES_S = 300
PRESIGN_PUBLIC_EXPIRES_S = 3600

# ---- mongo ----
images = None
try:
    mc = MongoClient(MONGO_URI)
    mc.admin.command("ping")
    images = mc[MONGO_DB].images
except Exception:
    images = None

# ---- s3 / minio ----
_s3_cfg = Config(signature_version="s3v4", s3={"addressing_style": "path"})

# Internal client for upload and bucket operations
s3_internal = boto3.client(
    "s3",
    endpoint_url=S3_ENDPOINT,
    region_name="us-east-1",
    config=_s3_cfg,
)

# Public client for presigned URLs
s3_public = boto3.client(
    "s3",
    endpoint_url=S3_PUBLIC_ENDPOINT,
    region_name="us-east-1",
    config=_s3_cfg,
)

async def fetch_current_model_version() -> str:
    """
    Call the Model Cycle C# Microservice to get the currently deployed version.
    """
    url = f"{MODEL_CYCLE_URL}/api/models/current"
    try:
        async with httpx.AsyncClient() as client:
            # fast timeout to prevent hanging uploads if model service is down
            resp = await client.get(url, timeout=3.0) 
            resp.raise_for_status()
            data = resp.json()
            return data.get("version", "unknown")
    except Exception as e:
        logging.error(f"Failed to fetch model version from {url}: {e}")
        # Fallback to a default if the service is unreachable
        return "v0.0.0-fallback"


def ensure_bucket():
    try:
        s3_internal.head_bucket(Bucket=S3_BUCKET)
        return
    except Exception:
        pass
    try:
        s3_internal.create_bucket(Bucket=S3_BUCKET)
    except Exception as e:
        logging.warning("bucket ensure failed: %s", e)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    try:
        ensure_bucket()
    except Exception as exc:
        logging.warning("bucket ensure on startup failed: %s", exc)
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


# --------------------------------------------------
# URL helper (presigned)
# --------------------------------------------------
def presigned_get_url_for_key(key: str, *, is_public: bool) -> Optional[str]:
    expires = PRESIGN_PUBLIC_EXPIRES_S if is_public else PRESIGN_PRIVATE_EXPIRES_S
    try:
        return s3_public.generate_presigned_url(
            ClientMethod="get_object",
            Params={"Bucket": S3_BUCKET, "Key": key},
            ExpiresIn=expires,
            HttpMethod="GET",
        )
    except Exception:
        logging.exception("presign failed for key=%s", key)
        return None


def attach_url(doc: dict) -> dict:
    d = dict(doc)
    key = d.get("s3_key")
    if key:
        d["url"] = presigned_get_url_for_key(key, is_public=bool(d.get("is_public")))
    return d


# --------------------------------------------------
# BEST PRACTICE: ObjectId-safe response model
# --------------------------------------------------
PyObjectId = Annotated[
    ObjectId,
    PlainSerializer(lambda v: str(v), return_type=str),
]


class ImageOut(BaseModel):
    id: Optional[PyObjectId] = Field(default=None, alias="_id")

    image_id: str
    user_id: str
    s3_key: str
    verdict: str
    label: str
    confidence: float
    model_version: Optional[str] = None
    is_public: bool
    uploaded_at: str
    is_reported: bool
    url: Optional[str] = None

    model_config = ConfigDict(
        arbitrary_types_allowed=True,
        populate_by_name=True,
    )


# --------------------------------------------------

@app.post("/upload/image", status_code=201, response_model=ImageOut)
async def upload_image(
    file: UploadFile = File(...),
    user_id: str = Form(...),
    verdict: str = Form(...),
    label: str = Form(...),
    confidence: float = Form(...),
    is_public: bool = Form(...),
    model_version: Optional[str] = Form(None),
):
    
    final_model_version = model_version
    if not final_model_version:
        final_model_version = await fetch_current_model_version()
        
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=415, detail="Unsupported Media Type")

    data = await file.read()
    if len(data) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="Payload Too Large")

    image_id = f"img_{uuid4().hex}"
    ct = (file.content_type or "").lower()
    ext = ".jpg" if ct in ("image/jpeg", "image/jpg") else ".png"
    key = f"{image_id}{ext}"

    try:
        s3_internal.put_object(
            Bucket=S3_BUCKET,
            Key=key,
            Body=data,
            ContentType=file.content_type,
        )
    except ClientError as e:
        logging.exception("s3 put_object failed")
        raise HTTPException(status_code=500, detail="Failed to store image") from e

    doc = {
        "image_id": image_id,
        "user_id": user_id,
        "s3_key": key,
        "verdict": verdict,
        "label": label,
        "confidence": float(confidence),
        "model_version": final_model_version, 
        "is_public": bool(is_public),
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "is_reported": False,
    }

    if images is not None:
        try:
            res = images.insert_one(doc)
            doc["_id"] = res.inserted_id 
        except Exception:
            logging.exception("mongo insert failed")

    return attach_url(doc)


@app.get("/images")
def list_images(user_id: str | None = None, is_public: bool | None = None):
    if images is None:
        return {"items": []}

    q = {}
    if user_id is not None:
        q["user_id"] = user_id
    if is_public is not None:
        q["is_public"] = bool(is_public)

    items = list(
        images.find(q, {"_id": 0})
        .sort("uploaded_at", -1)
        .limit(200)
    )

    items = [attach_url(it) for it in items]
    return {"items": items}


@app.get("/image/{image_id}")
def get_image(image_id: str, user_id: str | None = None):
    if images is None:
        raise HTTPException(status_code=404, detail="Not found")

    doc = images.find_one({"image_id": image_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")

    if (user_id is not None and doc.get("user_id") == user_id) or doc.get("is_public") is True:
        return attach_url(doc)

    raise HTTPException(status_code=404, detail="Not found")


@app.patch("/image/{image_id}")
def update_image(image_id: str, user_id: str | None = Query(None), is_public: bool | None = Query(None)):
    """
    Update an image's is_public field.
    Only the owner (user_id) can update their image.
    """
    if images is None:
        raise HTTPException(status_code=404, detail="Not found")

    # Find the image document
    doc = images.find_one({"image_id": image_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Image not found")

    # Security check: only owner can update
    if user_id is not None and doc.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="Forbidden: You can only update your own images")

    # Build update document
    update_doc = {}
    if is_public is not None:
        update_doc["is_public"] = bool(is_public)

    if not update_doc:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    # Update in MongoDB
    result = images.update_one({"image_id": image_id}, {"$set": update_doc})
    if result.matched_count == 0:
        logging.warning(
            "Image %s not found in MongoDB during update",
            sanitize_for_log(str(image_id)),
        )
        raise HTTPException(status_code=404, detail="Image not found in database")

    # Fetch and return updated document
    updated_doc = images.find_one({"image_id": image_id}, {"_id": 0})
    if not updated_doc:
        raise HTTPException(status_code=404, detail="Image not found after update")

    logging.info(
        "Successfully updated image %s (user: %s)",
        sanitize_for_log(str(image_id)),
        sanitize_for_log(str(user_id) if user_id else ""),
    )
    return attach_url(updated_doc)


@app.delete("/image/{image_id}")
def delete_image(image_id: str, user_id: str | None = None):
    """
    Delete an image from both MinIO storage and MongoDB.
    Only the owner (user_id) can delete their image.
    """
    if images is None:
        raise HTTPException(status_code=404, detail="Not found")

    # Find the image document
    doc = images.find_one({"image_id": image_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Image not found")

    # Security check only owner can delete
    if user_id is not None and doc.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="Forbidden: You can only delete your own images")

    # Delete from MinIO/S3 storage
    s3_key = doc.get("s3_key")
    if s3_key:
        try:
            s3_internal.delete_object(Bucket=S3_BUCKET, Key=s3_key)
            logging.info("Deleted image file from MinIO: %s", sanitize_for_log(str(s3_key)))
        except ClientError as e:
            logging.exception("Failed to delete image from MinIO: %s", sanitize_for_log(str(s3_key)))
            raise HTTPException(status_code=500, detail="Failed to delete image from storage") from e

    # Delete from MongoDB
    result = images.delete_one({"image_id": image_id})
    if result.deleted_count == 0:
        logging.warning(
            "Image %s not found in MongoDB during deletion",
            sanitize_for_log(str(image_id)),
        )
        raise HTTPException(status_code=404, detail="Image not found in database")

    logging.info(
        "Successfully deleted image %s (user: %s)",
        sanitize_for_log(str(image_id)),
        sanitize_for_log(str(user_id) if user_id else ""),
    )
    return {"message": "Image deleted successfully", "image_id": image_id}


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    return response