import importlib.util
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import re
from typing import Any, AsyncIterator, Dict, List, Optional

import pytest
import pytest_asyncio
import httpx


def _auth_root() -> Path:
    # auth/tests/conftest.py -> auth/
    return Path(__file__).resolve().parents[1]


def _entrypoint_path() -> Path:
    p = _auth_root() / "main-auth.py"
    if not p.exists():
        raise RuntimeError(f"Expected auth entrypoint at: {p}")
    return p


def _load_auth_module():
    entry = _entrypoint_path()
    spec = importlib.util.spec_from_file_location("auth_service", entry)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Failed to load module from {entry}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["auth_service"] = mod
    spec.loader.exec_module(mod)
    return mod


class FakeCursor:
    def __init__(self, docs: List[Dict[str, Any]]):
        self._docs = docs
        self._sort_field: Optional[str] = None
        self._sort_dir: int = -1
        self._limit: Optional[int] = None

    def sort(self, field: str, direction: int):
        self._sort_field = field
        self._sort_dir = direction
        return self

    def limit(self, n: int):
        self._limit = n
        return self

    def __aiter__(self) -> AsyncIterator[Dict[str, Any]]:
        docs = list(self._docs)
        if self._sort_field:
            reverse = self._sort_dir == -1
            docs.sort(key=lambda d: d.get(self._sort_field), reverse=reverse)
        if self._limit is not None:
            docs = docs[: self._limit]
        return _AsyncIter(docs)


class _AsyncIter:
    def __init__(self, items: List[Dict[str, Any]]):
        self._items = items
        self._i = 0

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._i >= len(self._items):
            raise StopAsyncIteration
        v = self._items[self._i]
        self._i += 1
        return v


@dataclass
class InsertResult:
    inserted_id: str = "fake"


@dataclass
class DeleteResult:
    deleted_count: int = 0


@dataclass
class UpdateResult:
    matched_count: int = 0
    modified_count: int = 0


class FakeUsersColl:
    def __init__(self):
        self._docs: List[Dict[str, Any]] = []
        self.inserted: List[Dict[str, Any]] = []

    async def create_index(self, *_args, **_kwargs):
        return "ok"

    async def find_one(self, query: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if "email" in query:
            email = query["email"]
            for d in self._docs:
                if d.get("email") == email:
                    return dict(d)
            return None
        if "user_id" in query:
            uid = query["user_id"]
            for d in self._docs:
                if d.get("user_id") == uid:
                    return dict(d)
            return None
        return None

    async def insert_one(self, doc: Dict[str, Any]) -> InsertResult:
        self._docs.append(dict(doc))
        self.inserted.append(dict(doc))
        return InsertResult()

    async def find_one_and_update(
        self,
        query: Dict[str, Any],
        update: Dict[str, Any],
        return_document: Any = True,
    ) -> Optional[Dict[str, Any]]:
        uid = query.get("user_id")
        if not uid:
            return None

        for i, d in enumerate(self._docs):
            if d.get("user_id") == uid:
                patch = update.get("$set", {})
                d2 = dict(d)
                d2.update(patch)
                self._docs[i] = d2
                return dict(d2) if return_document else dict(d)

        return None

    async def find_one_and_delete(self, query: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        uid = query.get("user_id")
        if uid:
            for i, d in enumerate(self._docs):
                if d.get("user_id") == uid:
                    return self._docs.pop(i)
            return None
        return None

    def find(self, query: Dict[str, Any]) -> FakeCursor:
        if not query:
            return FakeCursor([dict(d) for d in self._docs])

        if "user_name" in query and isinstance(query["user_name"], dict):
            rx = query["user_name"].get("$regex", "")
            opt = query["user_name"].get("$options", "")
            flags = re.IGNORECASE if "i" in opt else 0
            r = re.compile(rx, flags)
            matched = [dict(d) for d in self._docs if r.search(d.get("user_name", ""))]
            return FakeCursor(matched)

        return FakeCursor([])


class FakeApiKeysColl:
    """
    In-memory replacement for Mongo collection used by API key routes.
    Supports only methods used by auth/main-auth.py.
    """

    def __init__(self):
        self._docs: List[Dict[str, Any]] = []

    async def create_index(self, *_args, **_kwargs):
        return "ok"

    async def find_one(self, query: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if "user_id" in query:
            uid = query["user_id"]
            for d in self._docs:
                if d.get("user_id") == uid:
                    return dict(d)
            return None
        if "key_id" in query:
            kid = query["key_id"]
            for d in self._docs:
                if d.get("key_id") == kid:
                    return dict(d)
            return None
        return None

    async def replace_one(self, query: Dict[str, Any], doc: Dict[str, Any], upsert: bool = False):
        uid = query.get("user_id")
        if uid is None:
            # Only user_id-based replace is needed.
            if upsert:
                self._docs.append(dict(doc))
            return

        for i, d in enumerate(self._docs):
            if d.get("user_id") == uid:
                self._docs[i] = dict(doc)
                return

        if upsert:
            self._docs.append(dict(doc))

    async def delete_one(self, query: Dict[str, Any]) -> DeleteResult:
        uid = query.get("user_id")
        if uid is None:
            return DeleteResult(0)

        for i, d in enumerate(self._docs):
            if d.get("user_id") == uid:
                self._docs.pop(i)
                return DeleteResult(1)

        return DeleteResult(0)

    async def update_one(self, query: Dict[str, Any], update: Dict[str, Any]) -> UpdateResult:
        kid = query.get("key_id")
        if kid is None:
            return UpdateResult(0, 0)

        patch = update.get("$set", {})
        for i, d in enumerate(self._docs):
            if d.get("key_id") == kid:
                d2 = dict(d)
                d2.update(patch)
                self._docs[i] = d2
                return UpdateResult(1, 1)

        return UpdateResult(0, 0)


@pytest.fixture(scope="session")
def auth_mod():
    return _load_auth_module()


@pytest.fixture()
def users_coll(auth_mod):
    coll = FakeUsersColl()
    auth_mod.users_coll = coll

    # Make sure required settings exist for tests that use API key routes.
    auth_mod.API_KEY_PEPPER = "test-pepper"
    auth_mod.INTERNAL_AUTH_TOKEN = "test-internal-token"

    return coll


@pytest.fixture()
def api_keys_coll(auth_mod):
    coll = FakeApiKeysColl()
    auth_mod.api_keys_coll = coll

    auth_mod.API_KEY_PEPPER = "test-pepper"
    auth_mod.INTERNAL_AUTH_TOKEN = "test-internal-token"

    return coll


@pytest_asyncio.fixture()
async def client(auth_mod, users_coll, api_keys_coll):
    transport = httpx.ASGITransport(app=auth_mod.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
