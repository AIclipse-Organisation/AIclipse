import os
import logging
from datetime import datetime, timezone
from uuid import uuid4
from typing import Optional, Annotated

import boto3
from botocore.exceptions import ClientError
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from pymongo import MongoClient
from bson import ObjectId

from pydantic import BaseModel, Field, ConfigDict
from pydantic.functional_serializers import PlainSerializer

app = FastAPI()

# ---- env ----
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = os.getenv("MONGO_DB", "aiclipse")

S3_ENDPOINT = os.getenv("S3_ENDPOINT")
S3_PUBLIC_ENDPOINT = os.getenv("S3_PUBLIC_ENDPOINT")
S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY")
S3_SECRET_KEY = os.getenv("S3_SECRET_KEY")
S3_BUCKET = os.getenv("S3_BUCKET", "images")

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_FILE_SIZE = 5 * 1024 * 1024

# ---- mongo ----
images = None
try:
    mc = MongoClient(MONGO_URI)
    mc.admin.command("ping")
    images = mc[MONGO_DB].images
except Exception:
    images = None

# ---- s3 / minio ----
s3 = boto3.client(
    "s3",
    endpoint_url=S3_ENDPOINT,
    aws_access_key_id=S3_ACCESS_KEY,
    aws_secret_access_key=S3_SECRET_KEY,
    region_name=os.getenv("AWS_REGION", "us-east-1"),
)

def ensure_bucket():
    try:
        s3.head_bucket(Bucket=S3_BUCKET)
        return
    except Exception:
        pass
    try:
        s3.create_bucket(Bucket=S3_BUCKET)
    except Exception as e:
        logging.warning("bucket ensure failed: %s", e)

@app.on_event("startup")
def _startup():
    ensure_bucket()

@app.get("/healthz")
def healthz():
    return {"status": "ok"}

# --------------------------------------------------
# URL helper
# --------------------------------------------------
def public_url_for_key(key: str) -> str:
    base = (S3_PUBLIC_ENDPOINT or "").rstrip("/")
    return f"{base}/{S3_BUCKET}/{key}"

def attach_url(doc: dict) -> dict:
    d = dict(doc)
    key = d.get("s3_key")
    if key:
        d["url"] = public_url_for_key(key)
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
):
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=415, detail="Unsupported Media Type")

    data = await file.read()
    if len(data) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="Payload Too Large")

    image_id = f"img_{uuid4().hex}"
    ext = (
        ".jpg" if file.content_type == "image/jpeg"
        else ".png" if file.content_type == "image/png"
        else ".webp"
    )

    key = f"{image_id}{ext}"

    try:
        s3.put_object(
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
        "is_public": bool(is_public),
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "is_reported": False,
    }

    if images is not None:
        try:
            res = images.insert_one(doc)
            doc["_id"] = res.inserted_id  # safe: Pydantic serializes it
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
