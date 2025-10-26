import logging, os, base64, jwt
from datetime import datetime, timedelta
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

"""
Auth service for P1 simulation.
- Issues RS256 JWTs and exposes JWKS for Gateway verification.
- Generates an ephemeral RSA key if JWT_KEY is unset. OK for P1 demo, not for production.
"""

app = FastAPI()

# Private key for signing JWT (PEM). Optional in P1; generated if missing.
JWT_KEY = os.getenv("JWT_KEY")

# Static key id is acceptable for P1. Rotate keys and ids in later phases.
KEY_ID = "phase1-key"


def load_or_generate_rsa(key_str: str):
    # Load PEM-encoded RSA private key from env or generate a demo key
    if key_str and "BEGIN" in key_str:
        try:
            return serialization.load_pem_private_key(key_str.encode(), password=None)
        except Exception:
            pass
        # Handle \n-escaped PEM from env files.
        try:
            return serialization.load_pem_private_key(key_str.replace("\\n", "\n").encode(), password=None)
        except Exception:
            pass
    # Ephemeral key for demo only.
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


private_key = load_or_generate_rsa(JWT_KEY)
public_key = private_key.public_key()

# Build minimal JWKS with modulus and exponent. Gateway fetches this at /.well-known/jwks.json
pub = public_key.public_numbers()
n_b64 = base64.urlsafe_b64encode(pub.n.to_bytes((pub.n.bit_length() + 7) // 8, "big")).decode().rstrip("=")
e_b64 = base64.urlsafe_b64encode(pub.e.to_bytes((pub.e.bit_length() + 7) // 8, "big")).decode().rstrip("=")
JWKS = {"keys": [{"kty": "RSA", "alg": "RS256", "use": "sig", "kid": KEY_ID, "n": n_b64, "e": e_b64}]}


@app.post("/login")
def login(_: dict):
    # Return a short-lived RS256 JWT for demo user u_1
    now = datetime.utcnow()
    token = jwt.encode(
        {"sub": "u_1", "iat": now, "exp": now + timedelta(hours=1)},
        private_key,
        algorithm="RS256",
        headers={"kid": KEY_ID},
    )
    return {"token": token}


@app.get("/.well-known/jwks.json")
def jwks():
    # JWKS endpoint used by Gateway to validate tokens
    return JSONResponse(content=JWKS)


class _HealthzFilter(logging.Filter):
    # Keep access logs clean by hiding /healthz noise
    def filter(self, record):
        try:
            return "/healthz" not in record.getMessage()
        except Exception:
            return True


logging.getLogger("uvicorn.access").addFilter(_HealthzFilter())


@app.get("/healthzz")
def healthz():
    return {"status": "ok"}
