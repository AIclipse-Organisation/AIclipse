import base64
from dataclasses import dataclass

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa


KEY_ID = "phase1-key"


def load_rsa_private_key(pem: str):
    try:
        return serialization.load_pem_private_key(pem.encode(), password=None)
    except Exception:
        return serialization.load_pem_private_key(pem.replace("\\n", "\n").encode(), password=None)


@dataclass(frozen=True)
class KeyMaterial:
    private_key: rsa.RSAPrivateKey
    public_key: rsa.RSAPublicKey
    jwks: dict


def build_keys(jwt_key_pem: str) -> KeyMaterial:
    private_key = load_rsa_private_key(jwt_key_pem)
    public_key = private_key.public_key()

    pub_numbers = public_key.public_numbers()
    n_b64 = base64.urlsafe_b64encode(
        pub_numbers.n.to_bytes((pub_numbers.n.bit_length() + 7) // 8, "big")
    ).decode().rstrip("=")
    e_b64 = base64.urlsafe_b64encode(
        pub_numbers.e.to_bytes((pub_numbers.e.bit_length() + 7) // 8, "big")
    ).decode().rstrip("=")

    jwks = {
        "keys": [
            {"kty": "RSA", "alg": "RS256", "use": "sig", "kid": KEY_ID, "n": n_b64, "e": e_b64}
        ]
    }
    return KeyMaterial(private_key=private_key, public_key=public_key, jwks=jwks)
