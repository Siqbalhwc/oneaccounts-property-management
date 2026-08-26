"""
Adding a teammate is DIFFERENT from signup: this always attaches the new
person to the CALLER's own company (never a company they specify), and only
an owner/admin may do it. This is what keeps "invite a colleague" from ever
being usable to attach yourself to someone else's tenant.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from supabase import Client

from app.core.deps import get_current_company_id, get_current_user, get_service_client, get_supabase

router = APIRouter(prefix="/company/team", tags=["Team"])

ALLOWED_ROLES = {"admin", "manager", "accountant", "staff"}  # owner is not grantable via invite


class InviteRequest(BaseModel):
    full_name: str
    email: EmailStr
    password: str
    role: str = "staff"


@router.get("")
def list_team(supabase: Client = Depends(get_supabase)):
    res = supabase.table("profiles").select("id, full_name, role, phone, created_at").execute()
    return res.data


@router.post("", status_code=201)
def invite_teammate(
    payload: InviteRequest,
    supabase: Client = Depends(get_supabase),
    user: dict = Depends(get_current_user),
    company_id: str = Depends(get_current_company_id),
    service_client=Depends(get_service_client),
):
    if payload.role not in ALLOWED_ROLES:
        raise HTTPException(
            status_code=400, detail=f"Role must be one of: {', '.join(sorted(ALLOWED_ROLES))}"
        )

    # Only an owner or admin may add teammates.
    caller = (
        supabase.table("profiles").select("role").eq("id", user["user_id"]).single().execute()
    )
    if not caller.data or caller.data["role"] not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Only an owner or admin can add team members.")

    if len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")

    # Enforce the platform-admin-set seat limit, if any. Checked via the
    # service client because a plain company session can't read companies
    # rows beyond what auth_company_id() exposes for other purposes, and
    # this needs the raw max_users value, not just RLS pass/fail.
    company = service_client.table("companies").select("max_users").eq("id", company_id).single().execute()
    max_users = (company.data or {}).get("max_users")
    if max_users is not None:
        current_count = (
            service_client.table("profiles").select("id", count="exact").eq("company_id", company_id).execute()
        )
        if (current_count.count or 0) >= max_users:
            raise HTTPException(
                status_code=403,
                detail=f"Your plan allows up to {max_users} team members. Contact support to increase this limit.",
            )

    try:
        auth_result = service_client.auth.admin.create_user(
            {"email": payload.email, "password": payload.password, "email_confirm": True}
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not create account: {e}")

    new_user_id = auth_result.user.id

    try:
        # company_id comes from the CALLER's own profile, never from the request body.
        service_client.table("profiles").insert(
            {
                "id": new_user_id,
                "company_id": company_id,
                "full_name": payload.full_name,
                "role": payload.role,
            }
        ).execute()
    except Exception as e:
        try:
            service_client.auth.admin.delete_user(new_user_id)
        except Exception:
            pass
        raise HTTPException(status_code=400, detail=f"Failed to add teammate: {e}")

    return {"message": "Teammate added", "user_id": new_user_id}
