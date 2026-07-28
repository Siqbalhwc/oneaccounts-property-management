"""
Every dependency here revolves around ONE idea:

    The FastAPI backend never decides which company's data a request can see.
    It just forwards the caller's own Supabase JWT to Postgres, and Postgres
    Row Level Security (defined in schema.sql) decides. This means even a bug
    in our Python code can't leak data across companies -- the database itself
    refuses the query.

get_current_user() decodes the JWT ONLY for convenience (e.g. to know whose
company_id to stamp on a new row). It is NOT used as the security boundary.
"""

import jwt
from fastapi import Depends, Header, HTTPException
from supabase import Client, create_client

from app.core.config import settings


def get_token(authorization: str = Header(...)) -> str:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    return authorization.split(" ", 1)[1]


def get_supabase(token: str = Depends(get_token)) -> Client:
    """A Supabase client authenticated as the calling user. All RLS policies apply."""
    client = create_client(settings.supabase_url, settings.supabase_anon_key)
    client.postgrest.auth(token)
    return client


def get_current_user(token: str = Depends(get_token)) -> dict:
    """
    Reads the user_id/email out of the JWT WITHOUT verifying its signature.
    This is intentional and safe: this value is only ever used to look up
    convenience info (like which company to stamp on a new row). The actual
    security boundary is Postgres RLS, which cryptographically verifies this
    same token for real every time get_supabase() uses it in a query -- so a
    forged/tampered token would simply fail there, returning no data.

    We deliberately don't verify locally because Supabase now supports two
    different signing schemes across projects (legacy shared HS256 secret vs.
    newer asymmetric signing keys), and hard-coding one breaks the other.
    """
    try:
        payload = jwt.decode(token, options={"verify_signature": False})
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Malformed token")
    return {"user_id": payload.get("sub"), "email": payload.get("email")}


def get_current_company_id(
    supabase: Client = Depends(get_supabase),
    user: dict = Depends(get_current_user),
) -> str:
    """Looks up the caller's company_id from their own profile row."""
    res = (
        supabase.table("profiles")
        .select("company_id")
        .eq("id", user["user_id"])
        .single()
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=403, detail="No profile found for this user")
    return res.data["company_id"]


def require_owner_or_admin(
    supabase: Client = Depends(get_supabase),
    user: dict = Depends(get_current_user),
) -> None:
    """Blocks the request unless the caller's role is owner or admin."""
    profile = (
        supabase.table("profiles").select("role").eq("id", user["user_id"]).single().execute()
    )
    if not profile.data or profile.data["role"] not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Only an owner or admin can do this.")


def get_service_client() -> Client:
    """
    A Supabase client using the SERVICE ROLE key, which bypasses RLS entirely.
    Used ONLY for narrow, trusted server-side operations (like uploading a
    company logo to Storage) where we've already independently verified the
    caller's company_id via their own JWT beforehand. Never expose this key
    to the frontend.
    """
    if not settings.supabase_service_role_key:
        raise HTTPException(
            status_code=500,
            detail="SUPABASE_SERVICE_ROLE_KEY is not configured on the backend",
        )
    return create_client(settings.supabase_url, settings.supabase_service_role_key)
