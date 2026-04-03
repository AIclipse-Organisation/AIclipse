import os
import logging
from datetime import datetime, timezone
from uuid import uuid4
from typing import Optional, Annotated
from contextlib import asynccontextmanager

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from fastapi import FastAPI, UploadFile, File, Form, Header, HTTPException, Query
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


def can_manage_image(doc: dict, user_id: str | None, is_admin: bool) -> bool:
    if is_admin:
        return True
    if user_id is None:
        return False
    return doc.get("user_id") == user_id


# ---- env ----
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = os.getenv("MONGO_DB")

S3_ENDPOINT = os.getenv("S3_ENDPOINT")
S3_PUBLIC_ENDPOINT = os.getenv("S3_PUBLIC_ENDPOINT")

S3_BUCKET = "images"

MODEL_CYCLE_URL = os.getenv("MODEL_CYCLE_URL", "http://model-cycle:3000")

ALLOWED_TYPES = {"image/jpeg", "image/jpg", "image/png"}
MAX_FILE_SIZE = 20 * 1024 * 1024

# Presign TTLs (seconds)
PRESIGN_PRIVATE_EXPIRES_S = 300
PRESIGN_PUBLIC_EXPIRES_S = 3600

# ---- mongo ----
mc = None


def _build_mongo_client() -> MongoClient:
    return MongoClient(
        MONGO_URI,
        serverSelectionTimeoutMS=2000,
        connectTimeoutMS=2000,
        socketTimeoutMS=2000,
    )


def get_images_collection():
    global mc

    if not MONGO_URI or not MONGO_DB:
        return None

    for _ in range(2):
        try:
            if mc is None:
                mc = _build_mongo_client()
            mc.admin.command("ping")
            return mc[MONGO_DB].images
        except Exception:
            logging.exception("mongo connection unavailable")
            if mc is not None:
                try:
                    mc.close()
                except Exception:
                    logging.exception("failed to close stale mongo client")
            mc = None

    return None

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


def attach_required_url(doc: dict) -> dict:
    d = attach_url(doc)
    if d.get("s3_key") and not d.get("url"):
        raise HTTPException(status_code=503, detail="Image storage unavailable")
    return d


def delete_object_if_present(key: str) -> None:
    try:
        s3_internal.delete_object(Bucket=S3_BUCKET, Key=key)
    except ClientError:
        logging.exception("s3 delete_object failed for rollback")


def persist_image_document(doc: dict, *, s3_key: str) -> dict:
    images = get_images_collection()
    if images is None:
        delete_object_if_present(s3_key)
        raise HTTPException(status_code=503, detail="Image metadata store unavailable")

    try:
        res = images.insert_one(doc)
        doc["_id"] = res.inserted_id
        return doc
    except Exception:
        logging.exception("mongo insert failed")
        delete_object_if_present(s3_key)
        raise HTTPException(status_code=503, detail="Failed to persist image metadata")


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


class ImageLookupIn(BaseModel):
    image_ids: list[str]


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

    doc = persist_image_document(doc, s3_key=key)

    return attach_url(doc)


@app.get("/images")
def list_images(user_id: str | None = None, is_public: bool | None = None):
    images = get_images_collection()
    if images is None:
        raise HTTPException(status_code=503, detail="Image metadata store unavailable")

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

    items = [attach_required_url(it) for it in items]
    return {"items": items}


@app.post("/images/lookup")
def lookup_images(body: ImageLookupIn):
    images = get_images_collection()
    if images is None:
        raise HTTPException(status_code=503, detail="Image metadata store unavailable")

    image_ids = []
    seen = set()
    for raw_id in body.image_ids:
        image_id = str(raw_id or "").strip()
        if not image_id or image_id in seen:
            continue
        seen.add(image_id)
        image_ids.append(image_id)

    if not image_ids:
        return {"items": []}

    items = list(
        images.find(
            {
                "image_id": {"$in": image_ids},
                "is_public": True,
            },
            {"_id": 0},
        )
    )
    item_map = {item["image_id"]: attach_required_url(item) for item in items}
    return {"items": [item_map[image_id] for image_id in image_ids if image_id in item_map]}


@app.get("/image/{image_id}")
def get_image(image_id: str, user_id: str | None = None):
    images = get_images_collection()
    if images is None:
        raise HTTPException(status_code=503, detail="Image metadata store unavailable")

    doc = images.find_one({"image_id": image_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")

    if (user_id is not None and doc.get("user_id") == user_id) or doc.get("is_public") is True:
        return attach_required_url(doc)

    raise HTTPException(status_code=404, detail="Not found")


@app.patch("/image/{image_id}")
def update_image(
    image_id: str,
    user_id: str | None = Query(None),
    is_public: bool | None = Query(None),
    x_is_admin: bool = Header(False, alias="X-Is-Admin"),
):
    """
    Update an image's is_public field.
    Only the owner or admin can update the image.
    """
    images = get_images_collection()
    if images is None:
        raise HTTPException(status_code=503, detail="Image metadata store unavailable")

    # Find the image document
    doc = images.find_one({"image_id": image_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Image not found")

    if not can_manage_image(doc, user_id, x_is_admin):
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
        "Successfully updated image %s (user: %s, admin: %s)",
        sanitize_for_log(str(image_id)),
        sanitize_for_log(user_id),
        sanitize_for_log(str(x_is_admin)),
    )
    return attach_required_url(updated_doc)


@app.delete("/image/{image_id}")
def delete_image(
    image_id: str,
    user_id: str | None = Query(None),
    x_is_admin: bool = Header(False, alias="X-Is-Admin"),
):
    """
    Delete an image from both MinIO storage and MongoDB.
    Only the owner or admin can delete the image.
    """
    images = get_images_collection()
    if images is None:
        raise HTTPException(status_code=503, detail="Image metadata store unavailable")

    # Find the image document
    doc = images.find_one({"image_id": image_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Image not found")

    if not can_manage_image(doc, user_id, x_is_admin):
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

    result = images.delete_one({"image_id": image_id})
    if result.deleted_count == 0:
        logging.warning(
            "Image %s not found in MongoDB during deletion",
            sanitize_for_log(str(image_id)),
        )
        raise HTTPException(status_code=404, detail="Image not found in database")

    logging.info(
        "Successfully deleted image %s (user: %s, admin: %s)",
        sanitize_for_log(str(image_id)),
        sanitize_for_log(user_id),
        sanitize_for_log(str(x_is_admin)),
    )
    return {"message": "Image deleted successfully", "image_id": image_id}


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    return response
