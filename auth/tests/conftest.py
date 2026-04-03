# tests/conftest.py
from __future__ import annotations

import importlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any, AsyncGenerator, Dict, List, Optional

import jwt
import pytest
import pytest_asyncio
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from httpx import ASGITransport, AsyncClient
from pymongo.errors import DuplicateKeyError


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class TestRSAKeys:
    kid: str
    private_key: rsa.RSAPrivateKey
    public_key: rsa.RSAPublicKey
    public_key_pem: str
    jwk: Dict[str, Any]
    jwks: Dict[str, Any]


def make_test_rsa_keys(kid: str = "test-kid") -> TestRSAKeys:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_key = private_key.public_key()

    public_pem = public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("utf-8")

    jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(public_key))
    jwk["kid"] = kid
    jwk["use"] = "sig"
    jwk["alg"] = "RS256"

    return TestRSAKeys(
        kid=kid,
        private_key=private_key,
        public_key=public_key,
        public_key_pem=public_pem,
        jwk=jwk,
        jwks={"keys": [jwk]},
    )


class FakeCPU:
    """
    Мінімальний замінник CpuPool/CpuExecutor для тестів.
    PasswordService / інші сервіси можуть викликати `await cpu.run(fn, ...)`.
    """

    async def run(self, fn, *args, **kwargs):
        return fn(*args, **kwargs)


class _FakeCursor:
    """
    Cursor, який працює і з `await cursor.to_list(...)`, і з `async for ... in cursor`.
    """

    def __init__(self, docs: List[dict]):
        self._docs = docs
        self._skip = 0
        self._limit: Optional[int] = None

        self._iter_list: Optional[List[dict]] = None
        self._iter_idx: int = 0

    def sort(self, *args, **kwargs) -> "_FakeCursor":
        return self

    def skip(self, n: int) -> "_FakeCursor":
        self._skip = max(0, int(n))
        return self

    def limit(self, n: int) -> "_FakeCursor":
        self._limit = max(0, int(n))
        return self

    def _materialize(self) -> List[dict]:
        docs = self._docs[self._skip :]
        if self._limit is not None:
            docs = docs[: self._limit]
        return [dict(d) for d in docs]

    async def to_list(self, length: Optional[int] = None) -> List[dict]:
        docs = self._materialize()
        if length is not None:
            docs = docs[:length]
        return docs

    def __aiter__(self):
        self._iter_list = self._materialize()
        self._iter_idx = 0
        return self

    async def __anext__(self):
        assert self._iter_list is not None
        if self._iter_idx >= len(self._iter_list):
            raise StopAsyncIteration
        item = self._iter_list[self._iter_idx]
        self._iter_idx += 1
        return dict(item)


class FakeUsersColl:
    """
    Мінімальний in-memory аналог motor collection для users.
    Підтримує методи, які реально використовують роутери.
    """

    def __init__(self):
        self.docs: Dict[str, dict] = {}  # key: user_id
        self.inserted: List[dict] = []

    async def create_index(self, *args, **kwargs):
        return None

    async def insert_one(self, doc: dict):
        user_id = doc.get("user_id")
        email = (doc.get("email") or "").strip().lower()

        if user_id and user_id in self.docs:
            raise DuplicateKeyError("duplicate user_id")

        for d in self.docs.values():
            if (d.get("email") or "").strip().lower() == email and email:
                raise DuplicateKeyError("duplicate email")

        self.docs[user_id] = dict(doc)
        self.inserted.append(dict(doc))

        class _Res:
            inserted_id = user_id

        return _Res()

    async def find_one(self, flt: dict) -> Optional[dict]:
        if "user_id" in flt:
            doc = self.docs.get(flt["user_id"])
            return dict(doc) if doc else None

        if "email" in flt:
            email = (flt["email"] or "").strip().lower()
            for d in self.docs.values():
                if (d.get("email") or "").strip().lower() == email:
                    return dict(d)
            return None

        return None

    def _matches_filter(self, doc: dict, flt: dict) -> bool:
        # Small matcher for tests that call list/search without real Mongo.
        if not flt:
            return True

        if "is_admin" in flt and doc.get("is_admin") is not flt["is_admin"]:
            return False

        if "$or" in flt:
            matched = False
            for clause in flt["$or"]:
                if "user_name" in clause:
                    pattern = str(clause["user_name"].get("$regex", ""))
                    if pattern.lower() in str(doc.get("user_name", "")).lower():
                        matched = True
                if "email" in clause:
                    pattern = str(clause["email"].get("$regex", "")).replace("^[^@]*", "").replace("[^@]*@", "")
                    local_part = str(doc.get("email", "")).split("@", 1)[0].lower()
                    if pattern.lower() in local_part:
                        matched = True
            if not matched:
                return False

        return True

    def find(self, flt: Optional[dict] = None) -> _FakeCursor:
        flt = flt or {}
        docs = list(self.docs.values())

        docs = [d for d in docs if self._matches_filter(d, flt)]

        return _FakeCursor([dict(d) for d in docs])

    async def count_documents(self, flt: Optional[dict] = None) -> int:
        flt = flt or {}
        return sum(1 for d in self.docs.values() if self._matches_filter(d, flt))

    async def find_one_and_update(self, flt: dict, update: dict, return_document=None):
        doc = await self.find_one(flt)
        if not doc:
            return None

        set_doc = update.get("$set", {})
        next_email = (set_doc.get("email") or doc.get("email") or "").strip().lower()
        if next_email:
            for existing in self.docs.values():
                if existing.get("user_id") == doc.get("user_id"):
                    continue
                if (existing.get("email") or "").strip().lower() == next_email:
                    raise DuplicateKeyError("duplicate email")
        doc.update(set_doc)
        self.docs[doc["user_id"]] = dict(doc)
        return dict(doc)

    async def find_one_and_delete(self, flt: dict):
        doc = await self.find_one(flt)
        if not doc:
            return None
        self.docs.pop(doc["user_id"], None)
        return dict(doc)

    async def delete_one(self, flt: dict):
        doc = await self.find_one(flt)

        class _Res:
            deleted_count: int = 0

        res = _Res()
        if not doc:
            return res
        self.docs.pop(doc["user_id"], None)
        res.deleted_count = 1
        return res


class FakeDeletionLogsColl:
    def __init__(self):
        # Keeps deletion logs in memory for assertions.
        self.docs: List[dict] = []

    async def create_index(self, *args, **kwargs):
        return None

    async def insert_one(self, doc: dict):
        self.docs.append(dict(doc))

        class _Res:
            inserted_id = doc.get("log_id")

        return _Res()

    def find(self, flt: Optional[dict] = None) -> _FakeCursor:
        return _FakeCursor([dict(d) for d in self.docs])


class FakeEventRedis:
    def __init__(self):
        # Records xadd calls. Example: assert event type after admin delete.
        self.calls: List[dict] = []

    async def xadd(self, stream: str, payload: dict):
        self.calls.append({"stream": stream, "payload": payload})
        return "1-0"


class FakeApiKeysColl:
    """
    In-memory аналог для api keys.
    """

    def __init__(self):
        self.docs: Dict[str, dict] = {}  # key: key_id

    async def create_index(self, *args, **kwargs):
        return None

    async def insert_one(self, doc: dict):
        key_id = doc.get("key_id")
        if key_id and key_id in self.docs:
            raise DuplicateKeyError("duplicate key_id")
        self.docs[key_id] = dict(doc)

        class _Res:
            inserted_id = key_id

        return _Res()

    async def find_one(self, flt: dict) -> Optional[dict]:
        if "key_id" in flt:
            d = self.docs.get(flt["key_id"])
            return dict(d) if d else None
        if "user_id" in flt:
            for d in self.docs.values():
                if d.get("user_id") == flt["user_id"]:
                    return dict(d)
        return None

    async def find_one_and_update(self, flt: dict, update: dict, return_document=None):
        doc = await self.find_one(flt)
        if not doc:
            return None
        set_doc = update.get("$set", {})
        doc.update(set_doc)
        self.docs[doc["key_id"]] = dict(doc)
        return dict(doc)

    async def find_one_and_delete(self, flt: dict):
        doc = await self.find_one(flt)
        if not doc:
            return None
        self.docs.pop(doc["key_id"], None)
        return dict(doc)

    async def replace_one(self, flt: dict, replacement: dict, upsert: bool = False):
        existing = await self.find_one(flt)

        class _Res:
            matched_count: int = 0
            modified_count: int = 0
            upserted_id: Optional[str] = None

        res = _Res()

        if existing:
            key_id = existing.get("key_id")
            self.docs[key_id] = dict(replacement)
            res.matched_count = 1
            res.modified_count = 1
            return res

        if upsert:
            key_id = replacement.get("key_id") or flt.get("key_id")
            if not key_id:
                raise ValueError("replace_one upsert requires key_id")
            self.docs[key_id] = dict(replacement)
            res.upserted_id = key_id
            res.modified_count = 1
            return res

        return res

    async def delete_one(self, flt: dict):
        """
        Motor delete_one: повертає обʼєкт з deleted_count.
        """
        doc = await self.find_one(flt)

        class _Res:
            deleted_count: int = 0

        res = _Res()
        if not doc:
            return res

        key_id = doc.get("key_id")
        if key_id in self.docs:
            self.docs.pop(key_id, None)
            res.deleted_count = 1
        return res


@pytest.fixture()
def auth_mod():
    # Реальний модуль сервісу (app/main_auth.py)
    return importlib.import_module("app.main_auth")


@pytest.fixture()
def users_coll() -> FakeUsersColl:
    return FakeUsersColl()


@pytest.fixture()
def api_keys_coll() -> FakeApiKeysColl:
    return FakeApiKeysColl()


@pytest.fixture()
def deletion_logs_coll() -> FakeDeletionLogsColl:
    return FakeDeletionLogsColl()


@pytest.fixture()
def event_redis() -> FakeEventRedis:
    return FakeEventRedis()


@pytest.fixture()
def app_state(auth_mod, users_coll, api_keys_coll, deletion_logs_coll, event_redis):
    keys = make_test_rsa_keys()

    # Only include settings fields these tests need.
    settings = SimpleNamespace(
        INTERNAL_AUTH_TOKEN="internal-test-token",
        API_KEY_PEPPER="pepper-test",
        API_KEY_SALT="salt-test",
        AUTH_EVENT_STREAM="auth-events",
        AUTH_EVENT_PUBLISH_TIMEOUT_S=1.5,
    )

    st = auth_mod.app.state
    st.cpu = FakeCPU()
    st.keys = keys
    st.user_repo = SimpleNamespace(users=users_coll)
    st.api_repo = SimpleNamespace(keys=api_keys_coll)
    st.deletion_log_repo = SimpleNamespace(logs=deletion_logs_coll)
    st.event_redis = event_redis
    st.settings = settings

    # якщо десь у коді/тестах читають з модуля напряму
    auth_mod._test_keys = keys
    auth_mod._test_settings = settings

    return st


@pytest_asyncio.fixture()
async def client(auth_mod, app_state) -> AsyncGenerator[AsyncClient, None]:
    transport = ASGITransport(app=auth_mod.app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
