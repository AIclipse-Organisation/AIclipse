import asyncio
import json
import logging
from typing import Any, Dict

import httpx
import jwt
from fastapi import HTTPException, Request, status

from app.core.settings import require_setting


class JwksService:
    def __init__(self):
        self.cache: Dict[str, Any] = {}
        self.lock = asyncio.Lock()

    async def refresh(self, app, *, force: bool = False, kid: str | None = None) -> None:
        s = app.state.settings
        auth_uri = require_setting("AUTH_URI", s.auth_uri)

        async with self.lock:
            if not force and kid is not None and kid in self.cache:
                return

            url = auth_uri.rstrip("/") + "/.well-known/jwks.json"
            client: httpx.AsyncClient = app.state.http
            try:
                resp = await client.get(url, timeout=5.0)
                resp.raise_for_status()
            except httpx.HTTPError as exc:
                logging.error("Failed to refresh JWKS: %s", exc)
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="Unable to fetch JWKS from auth service",
                )

            try:
                data = resp.json()
            except ValueError:
                logging.error("JWKS response is not valid JSON")
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="Auth JWKS is invalid JSON",
                )

            def _parse_keys(d: dict) -> Dict[str, Any]:
                keys: Dict[str, Any] = {}
                for jwk_obj in d.get("keys", []):
                    jwk_kid = jwk_obj.get("kid")
                    if not jwk_kid:
                        continue
                    try:
                        public_key = jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(jwk_obj))
                    except Exception as exc:
                        logging.error("Failed to parse JWK for kid=%s: %s", jwk_kid, exc)
                        continue
                    keys[jwk_kid] = public_key
                return keys

            parsed = await app.state.cpu.run(_parse_keys, data)

            if not parsed:
                logging.error("Received empty JWKS")
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="Auth JWKS has no keys",
                )

            self.cache.clear()
            self.cache.update(parsed)


async def decode_jwt_rs256(request: Request, token: str) -> Dict[str, Any]:

    try:
        header = jwt.get_unverified_header(token)
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token header",
        )

    kid = header.get("kid")
    if not kid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing kid in token header",
        )

    jwks: JwksService = request.app.state.jwks

    if kid not in jwks.cache:
        await jwks.refresh(request.app, kid=kid)

    key = jwks.cache.get(kid)
    if not key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unknown signing key",
        )

    def _decode_with_key(pub_key: Any) -> Dict[str, Any]:
        return jwt.decode(token, key=pub_key, algorithms=["RS256"])

    try:
        return await request.app.state.cpu.run(_decode_with_key, key)

    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired",
        )

    except jwt.InvalidSignatureError:
        await jwks.refresh(request.app, force=True, kid=kid)
        key2 = jwks.cache.get(kid)
        if not key2:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Unknown signing key",
            )
        try:
            return await request.app.state.cpu.run(_decode_with_key, key2)
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

    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )
