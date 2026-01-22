import os
import base64
import logging
import jwt
import bcrypt
import re
import json
import secrets
import hashlib
import hmac
from datetime import datetime, timedelta, timezone
from typing import Optional, List
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Depends, Header, Path, Query, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr, Field

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
from pymongo.errors import DuplicateKeyError

"""
Auth Service

Responsibilities:
- Manage auth.users collection in MongoDB
- Issue RS256 JWTs
- Expose JWKS for Gateway verification
- Provide basic user and admin APIs (signup, login, me, admin/users)
- Manage API key for developer access (stored hashed), and exchange it for short-lived JWT
"""

JWT_KEY = os.getenv("JWT_KEY")
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = os.getenv("MONGO_DB")
API_KEY_PEPPER = os.getenv("API_KEY_PEPPER")
INTERNAL_AUTH_TOKEN = os.getenv("INTERNAL_AUTH_TOKEN")

KEY_ID = "phase1-key"

mongo_client: AsyncIOMotorClient | None = None
users_coll = None
api_keys_coll = None


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _require_setting(name: str, value: Optional[str]) -> str:
    if value:
        return value
    raise HTTPException(status_code=500, detail=f"Missing required setting: {name}")


def load_or_generate_rsa(key_str: str):
    """Load PEM-encoded RSA private key from env"""
    if key_str and "BEGIN" in key_str:
        try:
            return serialization.load_pem_private_key(key_str.encode(), password=None)
        except Exception:
            pass
        try:
            return serialization.load_pem_private_key(
                key_str.replace("\\n", "\n").encode(), password=None
            )
        except Exception:
            pass
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


private_key = load_or_generate_rsa(JWT_KEY)
public_key = private_key.public_key()

pub_numbers = public_key.public_numbers()
n_b64 = base64.urlsafe_b64encode(
    pub_numbers.n.to_bytes((pub_numbers.n.bit_length() + 7) // 8, "big")
).decode().rstrip("=")
e_b64 = base64.urlsafe_b64encode(
    pub_numbers.e.to_bytes((pub_numbers.e.bit_length() + 7) // 8, "big")
).decode().rstrip("=")

JWKS = {
    "keys": [
        {
            "kty": "RSA",
            "alg": "RS256",
            "use": "sig",
            "kid": KEY_ID,
            "n": n_b64,
            "e": e_b64,
        }
    ]
}


class UserPublic(BaseModel):
    user_id: str
    user_name: str
    email: EmailStr
    is_admin: bool = False
    plan: int = 0
    created_at: datetime
    age: Optional[int] = None
    total_guesses: Optional[int] = 0
    total_correct: Optional[int] = 0
    acc_guessing_ai: Optional[int] = 0
    acc_guessing_real: Optional[int] = 0


class SignupRequest(BaseModel):
    user_name: str = Field(..., min_length=1)
    email: EmailStr
    password: str = Field(..., min_length=6)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class LoginResponse(BaseModel):
    token: str
    user: UserPublic


class UpdateMeRequest(BaseModel):
    user_name: Optional[str] = None
    email: Optional[EmailStr] = None
    password: Optional[str] = None


class AdminUpdateUserRequest(BaseModel):
    user_name: Optional[str] = None
    email: Optional[EmailStr] = None
    password: Optional[str] = None
    age: Optional[int] = None
    is_admin: Optional[bool] = None


class TokenUser(BaseModel):
    user_id: str
    email: Optional[str] = None
    is_admin: bool = False
    plan: int = 0


# ---- API key models ----

class ApiKeyPublic(BaseModel):
    key_id: str
    created_at: datetime
    last_used_at: Optional[datetime] = None
    last4: str


class ApiKeyGetResponse(BaseModel):
    key: Optional[ApiKeyPublic] = None


class ApiKeyCreateResponse(BaseModel):
    api_key: str
    key: ApiKeyPublic


class ApiKeyExchangeRequest(BaseModel):
    api_key: str


class ApiKeyExchangeResponse(BaseModel):
    token: str
    exp: int


@asynccontextmanager
async def lifespan(app: FastAPI):
    global mongo_client, users_coll, api_keys_coll

    mongo_client = AsyncIOMotorClient(MONGO_URI)
    db = mongo_client[MONGO_DB]
    users_coll = db["auth.users"]
    api_keys_coll = db["auth.api_keys"]

    await users_coll.create_index([("email", 1)], name="uniq_email", unique=True)
    await users_coll.create_index([("user_id", 1)], name="uniq_user_id", unique=True)

    await api_keys_coll.create_index([("key_id", 1)], name="uniq_key_id", unique=True)
    await api_keys_coll.create_index([("user_id", 1)], name="uniq_user_id_one_key", unique=True)

    try:
        yield
    finally:
        mongo_client.close()
        mongo_client = None
        users_coll = None
        api_keys_coll = None


app = FastAPI(lifespan=lifespan)


# Helpers

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def build_user_public(doc: dict) -> UserPublic:
    return UserPublic(
        user_id=doc["user_id"],
        user_name=doc.get("user_name", ""),
        email=doc["email"],
        is_admin=bool(doc.get("is_admin", False)),
        plan=int(doc.get("plan", 0)),
        created_at=doc.get("created_at", _now_utc()),
        age=doc.get("age"),
        total_guesses=doc.get("total_guesses", 0),
        total_correct=doc.get("total_correct", 0),
        acc_guessing_ai=doc.get("acc_guessing_ai", 0),
        acc_guessing_real=doc.get("acc_guessing_real", 0),
    )


def issue_jwt(user_doc: dict) -> str:
    now = _now_utc()
    payload = {
        "sub": user_doc["user_id"],
        "email": user_doc["email"],
        "user_name": user_doc.get("user_name"),
        "is_admin": bool(user_doc.get("is_admin", False)),
        "plan": int(user_doc.get("plan", 0)),
        "iat": now,
        "exp": now + timedelta(hours=1),
    }
    token = jwt.encode(
        payload,
        private_key,
        algorithm="RS256",
        headers={"kid": KEY_ID},
    )
    return token


def issue_jwt_from_api_key(user_doc: dict, *, api_key_id: str) -> tuple[str, int]:
    """
    Short-lived JWT for API access. Keeps same main fields (sub/email/user_name/is_admin/plan).
    Adds token_type + api_key_id (harmless for existing consumers).
    """
    now = _now_utc()
    exp_dt = now + timedelta(minutes=5)
    payload = {
        "sub": user_doc["user_id"],
        "email": user_doc["email"],
        "user_name": user_doc.get("user_name"),
        "is_admin": bool(user_doc.get("is_admin", False)),
        "plan": int(user_doc.get("plan", 0)),
        "token_type": "api_key",
        "api_key_id": api_key_id,
        "iat": now,
        "exp": exp_dt,
    }
    token = jwt.encode(
        payload,
        private_key,
        algorithm="RS256",
        headers={"kid": KEY_ID},
    )
    return token, int(exp_dt.timestamp())


def _parse_bearer_token(authorization: Optional[str]) -> str:
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
        )
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Authorization header format",
        )
    return parts[1]


def decode_jwt_local(token: str) -> TokenUser:
    try:
        payload = jwt.decode(token, key=public_key, algorithms=["RS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired",
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing sub",
        )

    return TokenUser(
        user_id=user_id,
        email=payload.get("email"),
        is_admin=bool(payload.get("is_admin", False)),
        plan=int(payload.get("plan", 0)),
    )


async def get_current_user(authorization: Optional[str] = Header(None)) -> TokenUser:
    token = _parse_bearer_token(authorization)
    return decode_jwt_local(token)


async def get_current_admin(user: TokenUser = Depends(get_current_user)) -> TokenUser:
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )
    return user


def _hmac_sha256_hex(value: str, *, pepper: str) -> str:
    mac = hmac.new(pepper.encode("utf-8"), value.encode("utf-8"), hashlib.sha256)
    return mac.hexdigest()


def _generate_api_key() -> tuple[str, str, str]:
    """
    Returns (key_id, secret, full_key)
    full_key format: {key_id}.{secret}
    """
    key_id = f"ak_{uuid4()}"
    secret = "sk_" + secrets.token_urlsafe(32)
    full_key = f"{key_id}.{secret}"
    return key_id, secret, full_key


def _parse_full_api_key(full_key: str) -> tuple[str, str]:
    if not full_key or "." not in full_key:
        raise HTTPException(status_code=401, detail="Invalid API key format")
    key_id, secret = full_key.split(".", 1)
    if not key_id.startswith("ak_") or not secret.startswith("sk_"):
        raise HTTPException(status_code=401, detail="Invalid API key format")
    return key_id, secret


# Routes


@app.post("/signup", response_model=UserPublic, status_code=status.HTTP_201_CREATED)
async def signup(payload: SignupRequest):
    assert users_coll is not None

    email_norm = payload.email.strip().lower()

    existing = await users_coll.find_one({"email": email_norm})
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )

    now = _now_utc()
    user_doc = {
        "user_id": f"u_{uuid4()}",
        "user_name": payload.user_name.strip(),
        "email": email_norm,
        "password": hash_password(payload.password),
        "is_admin": False,
        "plan": 0,
        "created_at": now,
        "age": None,
        "total_guesses": 0,
        "total_correct": 0,
        "acc_guessing_ai": 0,
        "acc_guessing_real": 0,
    }

    await users_coll.insert_one(user_doc)

    return build_user_public(user_doc)


@app.post("/login", response_model=LoginResponse)
async def login(payload: LoginRequest):
    assert users_coll is not None

    email_norm = payload.email.strip().lower()
    user_doc = await users_coll.find_one({"email": email_norm})
    if not user_doc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    if not verify_password(payload.password, user_doc["password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    token = issue_jwt(user_doc)
    return LoginResponse(token=token, user=build_user_public(user_doc))


@app.get("/me", response_model=UserPublic)
async def get_me(user: TokenUser = Depends(get_current_user)):
    assert users_coll is not None
    doc = await users_coll.find_one({"user_id": user.user_id})
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    return build_user_public(doc)


@app.patch("/me", response_model=UserPublic)
async def update_me(
    body: UpdateMeRequest,
    user: TokenUser = Depends(get_current_user),
):
    assert users_coll is not None

    raw = body.model_dump(exclude_unset=True)

    if any(str(k).startswith("$") for k in raw.keys()):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Update operators not allowed",
        )

    update_doc = {}
    if "user_name" in raw and raw["user_name"] is not None:
        update_doc["user_name"] = raw["user_name"].strip()

    if "email" in raw and raw["email"] is not None:
        update_doc["email"] = raw["email"].strip().lower()

    if "password" in raw and raw["password"]:
        update_doc["password"] = hash_password(raw["password"])

    if not update_doc:
        doc = await users_coll.find_one({"user_id": user.user_id})
        if not doc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found",
            )
        return build_user_public(doc)

    result = await users_coll.find_one_and_update(
        {"user_id": user.user_id},
        {"$set": update_doc},
        return_document=True,
    )

    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return build_user_public(result)


@app.delete("/me")
async def delete_me(user: TokenUser = Depends(get_current_user)):
    assert users_coll is not None
    result = await users_coll.find_one_and_delete({"user_id": user.user_id})
    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    return {
        "deleted": True,
        "user_id": result["user_id"],
        "message": "Your account has been permanently deleted",
    }


@app.get("/admin/users")
async def admin_list_users(
    user_name: Optional[str] = Query(None),
    admin: TokenUser = Depends(get_current_admin),
):
    assert users_coll is not None

    query: dict = {}
    if user_name:
        query["user_name"] = {"$regex": re.escape(user_name), "$options": "i"}

    cursor = users_coll.find(query).sort("created_at", -1).limit(200)
    items: List[UserPublic] = []
    async for doc in cursor:
        items.append(build_user_public(doc))

    return {"items": items}


@app.get("/admin/user/{user_id}", response_model=UserPublic)
async def admin_get_user(
    user_id: str = Path(...),
    admin: TokenUser = Depends(get_current_admin),
):
    assert users_coll is not None
    doc = await users_coll.find_one({"user_id": user_id})
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    return build_user_public(doc)


@app.patch("/admin/user/{user_id}", response_model=UserPublic)
async def admin_update_user(
    user_id: str,
    body: AdminUpdateUserRequest,
    admin: TokenUser = Depends(get_current_admin),
):
    assert users_coll is not None

    raw = body.model_dump(exclude_unset=True)
    if any(str(k).startswith("$") for k in raw.keys()):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Update operators not allowed",
        )

    update_doc: dict = {}
    if "user_name" in raw and raw["user_name"] is not None:
        update_doc["user_name"] = raw["user_name"].strip()
    if "email" in raw and raw["email"] is not None:
        update_doc["email"] = raw["email"].strip().lower()
    if "password" in raw and raw["password"]:
        update_doc["password"] = hash_password(raw["password"])
    if "age" in raw and raw["age"] is not None:
        update_doc["age"] = raw["age"]
    if "is_admin" in raw and raw["is_admin"] is not None:
        update_doc["is_admin"] = bool(raw["is_admin"])

    if not update_doc:
        doc = await users_coll.find_one({"user_id": user_id})
        if not doc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found",
            )
        return build_user_public(doc)

    result = await users_coll.find_one_and_update(
        {"user_id": user_id},
        {"$set": update_doc},
        return_document=True,
    )

    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return build_user_public(result)


@app.delete("/admin/user/{user_id}")
async def admin_delete_user(
    user_id: str,
    admin: TokenUser = Depends(get_current_admin),
):
    assert users_coll is not None

    result = await users_coll.find_one_and_delete({"user_id": user_id})
    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return {
        "deleted": True,
        "user": {
            "user_id": result["user_id"],
            "email": result["email"],
        },
    }


# ---- API key management ----

@app.get("/me/api-key", response_model=ApiKeyGetResponse)
async def get_my_api_key(user: TokenUser = Depends(get_current_user)):
    assert api_keys_coll is not None

    doc = await api_keys_coll.find_one({"user_id": user.user_id})
    if not doc:
        return ApiKeyGetResponse(key=None)

    pub = ApiKeyPublic(
        key_id=doc["key_id"],
        created_at=doc.get("created_at", _now_utc()),
        last_used_at=doc.get("last_used_at"),
        last4=doc.get("last4", "????"),
    )
    return ApiKeyGetResponse(key=pub)


@app.post("/me/api-key", response_model=ApiKeyCreateResponse, status_code=status.HTTP_201_CREATED)
async def rotate_my_api_key(user: TokenUser = Depends(get_current_user)):
    assert api_keys_coll is not None
    assert users_coll is not None

    pepper = _require_setting("API_KEY_PEPPER", API_KEY_PEPPER)

    user_doc = await users_coll.find_one({"user_id": user.user_id})
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")

    now = _now_utc()

    key_id, secret, full_key = _generate_api_key()
    secret_hash = _hmac_sha256_hex(secret, pepper=pepper)

    doc = {
        "key_id": key_id,
        "user_id": user.user_id,
        "secret_hash": secret_hash,
        "created_at": now,
        "last_used_at": None,
        "last4": secret[-4:],
    }

    try:
        await api_keys_coll.replace_one({"user_id": user.user_id}, doc, upsert=True)
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="API key rotation conflict; retry")

    pub = ApiKeyPublic(
        key_id=key_id,
        created_at=now,
        last_used_at=None,
        last4=doc["last4"],
    )

    return ApiKeyCreateResponse(api_key=full_key, key=pub)


@app.delete("/me/api-key")
async def delete_my_api_key(user: TokenUser = Depends(get_current_user)):
    assert api_keys_coll is not None

    res = await api_keys_coll.delete_one({"user_id": user.user_id})
    return {"revoked": bool(res.deleted_count)}


@app.post("/internal/api-key/exchange", response_model=ApiKeyExchangeResponse)
async def exchange_api_key(
    body: ApiKeyExchangeRequest,
    x_internal_token: Optional[str] = Header(None, alias="X-Internal-Token"),
):
    assert api_keys_coll is not None
    assert users_coll is not None

    expected = _require_setting("INTERNAL_AUTH_TOKEN", INTERNAL_AUTH_TOKEN)
    if not x_internal_token or not hmac.compare_digest(x_internal_token, expected):
        raise HTTPException(status_code=403, detail="Forbidden")

    pepper = _require_setting("API_KEY_PEPPER", API_KEY_PEPPER)

    full_key = body.api_key.strip()
    key_id, secret = _parse_full_api_key(full_key)

    key_doc = await api_keys_coll.find_one({"key_id": key_id})
    if not key_doc:
        raise HTTPException(status_code=401, detail="Invalid API key")

    want = str(key_doc.get("secret_hash") or "")
    got = _hmac_sha256_hex(secret, pepper=pepper)
    if not want or not hmac.compare_digest(want, got):
        raise HTTPException(status_code=401, detail="Invalid API key")

    try:
        await api_keys_coll.update_one({"key_id": key_id}, {"$set": {"last_used_at": _now_utc()}})
    except Exception:
        pass

    user_doc = await users_coll.find_one({"user_id": key_doc["user_id"]})
    if not user_doc:
        raise HTTPException(status_code=401, detail="Invalid API key")

    token, exp = issue_jwt_from_api_key(user_doc, api_key_id=key_id)
    return ApiKeyExchangeResponse(token=token, exp=exp)


@app.get("/.well-known/jwks.json")
def jwks():
    return JSONResponse(content=JWKS)


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
