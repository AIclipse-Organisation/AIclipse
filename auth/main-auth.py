import os
import base64
import logging
import jwt
import bcrypt
import re
import json
from datetime import datetime, timedelta
from typing import Optional, List

from fastapi import FastAPI, HTTPException, Depends, Header, Path, Query, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr, Field
from uuid import uuid4

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId

"""
Auth Service

Responsibilities:
- Manage auth.users collection in MongoDB
- Issue RS256 JWTs
- Expose JWKS for Gateway verification
- Provide basic user and admin APIs (signup, login, me, admin/users)
"""

app = FastAPI()

JWT_KEY = os.getenv("JWT_KEY")
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = os.getenv("MONGO_DB")

KEY_ID = "phase1-key"

mongo_client: AsyncIOMotorClient | None = None
users_coll = None


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


# Startup / shutdown


@app.on_event("startup")
async def startup_event():
    global mongo_client, users_coll
    mongo_client = AsyncIOMotorClient(MONGO_URI)
    db = mongo_client[MONGO_DB]
    users_coll = db["auth.users"]

    # Ensure useful indexes
    await users_coll.create_index("email", unique=True)
    await users_coll.create_index("user_id", unique=True)


@app.on_event("shutdown")
async def shutdown_event():
    global mongo_client
    if mongo_client:
        mongo_client.close()
        mongo_client = None


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
        created_at=doc.get("created_at", datetime.utcnow()),
        age=doc.get("age"),
        total_guesses=doc.get("total_guesses", 0),
        total_correct=doc.get("total_correct", 0),
    )


def issue_jwt(user_doc: dict) -> str:
    now = datetime.utcnow()
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

    now = datetime.utcnow()
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

    raw = body.dict(exclude_unset=True)

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

    raw = body.dict(exclude_unset=True)
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
