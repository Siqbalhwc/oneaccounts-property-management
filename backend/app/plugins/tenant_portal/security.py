"""
Passwords and sessions for tenant portal accounts. Deliberately NOT Supabase Auth:
tenants never become Supabase users, so they can never be mistaken for staff, never
get a profile row, and never appear in (or get billed against) your Supabase user list.

  * A portal session token is signed with a key derived from a server-side secret
    under a DIFFERENT purpose label, so Supabase can never accept it and a Supabase
    token can never be accepted here.
  * Temporary (first-login) passwords are NOT stored. They are re-derived from the
    server secret + account id + a counter, so an admin can re-print the slip until
    the tenant sets their own password -- and nothing sensitive sits in the database.
  * A tenant's own password is stored only as a salted scrypt hash.
"""

import base64
import hashlib
import hmac
import os
import re
import time
from typing import Optional

import jwt

from app.core.config import settings

AUDIENCE = "tenant-portal"
_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz"  # no 0/O/1/l/I look-alikes
_SCRYPT = dict(n=2**14, r=8, p=1, dklen=32)


def _root_key() -> bytes:
    secret = settings.supabase_service_role_key or settings.supabase_jwt_secret
    if not secret:
        raise RuntimeError("Server secret is not configured")
    return hmac.new(secret.encode(), b"oneaccounts.tenant-portal.v1", hashlib.sha256).digest()


# ---------------------------------------------------------------- usernames
def normalize_username(raw: Optional[str]) -> str:
    """CNIC / ID as typed ('35202-1234567-1', '35202 1234567 1') -> '3520212345671'."""
    return re.sub(r"[^a-z0-9]", "", (raw or "").lower())


def is_usable_username(username: str) -> bool:
    return len(username) >= 5


def mask_username(username: str) -> str:
    return ("*" * max(0, len(username) - 3)) + username[-3:] if username else ""


# ---------------------------------------------------------------- passwords
def temp_password(account_id: str, counter: int) -> str:
    digest = hmac.new(_root_key(), f"temp:{account_id}:{counter}".encode(), hashlib.sha256).digest()
    return "".join(_ALPHABET[b % len(_ALPHABET)] for b in digest[:10])


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT)
    return "s1$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(dk).decode()


def _scrypt_matches(password: str, stored: str) -> bool:
    try:
        _, salt_b64, dk_b64 = stored.split("$")
        expected = base64.b64decode(dk_b64)
        got = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt_b64), **_SCRYPT)
        return hmac.compare_digest(got, expected)
    except Exception:  # noqa: BLE001 -- malformed hash can never authenticate
        return False


_DUMMY_HASH: Optional[str] = None


def burn_time() -> None:
    """Spend the same time a real check would, so 'no such account' and 'wrong password'
    can't be told apart by how long the answer takes."""
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        _DUMMY_HASH = hash_password("not-a-real-password")
    _scrypt_matches("x", _DUMMY_HASH)


def verify_login_password(account: dict, password: str) -> bool:
    if account.get("password_hash") == "temp":
        expected = temp_password(account["id"], int(account.get("temp_counter") or 1))
        return hmac.compare_digest(expected.encode(), (password or "").encode())
    return _scrypt_matches(password or "", account.get("password_hash") or "")


# ---------------------------------------------------------------- sessions
def issue_token(account: dict, hours: int) -> str:
    now = int(time.time())
    claims = {
        "sub": account["id"],
        "cid": account["company_id"],
        "tid": account["tenant_id"],
        "tv": int(account["token_version"]),
        "aud": AUDIENCE,
        "iat": now,
        "exp": now + hours * 3600,
    }
    return jwt.encode(claims, _root_key(), algorithm="HS256")


def read_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, _root_key(), algorithms=["HS256"], audience=AUDIENCE)
    except jwt.PyJWTError:
        return None
