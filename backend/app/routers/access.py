"""
Users, roles and building access.

  GET  /access/me                         who am I + what may I do (frontend uses this)
  GET  /access/roles                      role list with labels
  GET  /access/buildings?company_id=      buildings that can be assigned
  GET  /access/users?company_id=          users of a company with role + buildings
  POST /access/users                      create a user (+ role + buildings)
  PATCH /access/users/{id}                change role / buildings / name / suspend
  PUT  /access/company/{id}/enabled       platform admin: switch the feature on/off

Who may call what:
  * Platform admin (Tower): any company -- pass company_id.
  * Company owner: only their own company; may hand out admin / accountant /
    auditor (and the legacy manager / staff), never 'owner'.
  * Everyone else: 403.

SECURITY NOTE: these endpoints WRITE through the service-role client, so they
must not trust get_current_user() (which reads the JWT without verifying its
signature). _verified_caller() proves the token is genuine by reading the
caller's own profile through THEIR RLS-scoped session -- Postgres validates
the token for real there; a forged token gets nothing back.
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr
from supabase import Client

from app.core.access import (
    COMPANY_ASSIGNABLE_ROLES,
    PLATFORM_ASSIGNABLE_ROLES,
    ROLE_LABELS,
    invalidate_access_cache,
    load_access_context,
    permissions_for,
)
from app.core.deps import get_current_user, get_service_client, get_supabase
from app.crud.generic import write_audit_log

router = APIRouter(prefix="/access", tags=["Access Control"])


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
def _verified_caller(supabase: Client, user: dict, service_client) -> dict:
    own = supabase.table("profiles").select("id").eq("id", user["user_id"]).execute().data
    if not own:
        raise HTTPException(status_code=401, detail="Could not verify your session. Please sign in again.")
    ctx = load_access_context(user["user_id"], service_client, use_cache=False)
    if not ctx:
        raise HTTPException(status_code=403, detail="No profile found for this user")
    return ctx


def _scope_company(caller: dict, company_id: Optional[str]) -> str:
    """Which company is the caller allowed to manage, for this request?"""
    if caller["is_platform_admin"]:
        if not company_id:
            raise HTTPException(status_code=400, detail="company_id is required.")
        return company_id
    if caller["role"] != "owner":
        raise HTTPException(status_code=403, detail="Only the company owner can manage users and access.")
    if company_id and company_id != caller["company_id"]:
        raise HTTPException(status_code=403, detail="You can only manage your own company.")
    return caller["company_id"]


def _assignable(caller: dict) -> set:
    return PLATFORM_ASSIGNABLE_ROLES if caller["is_platform_admin"] else COMPANY_ASSIGNABLE_ROLES


def _validate_buildings(service_client, company_id: str, building_ids: List[str]) -> List[str]:
    ids = sorted(set(building_ids))
    if not ids:
        return []
    found = (
        service_client.table("buildings").select("id").eq("company_id", company_id).in_("id", ids).execute().data
    )
    if len(found) != len(ids):
        raise HTTPException(status_code=400, detail="One or more selected buildings don't belong to this company.")
    return ids


def _replace_assignments(service_client, company_id: str, user_id: str, building_ids: List[str], by: str) -> None:
    service_client.table("user_building_access").delete().eq("user_id", user_id).execute()
    if building_ids:
        service_client.table("user_building_access").insert(
            [
                {"company_id": company_id, "user_id": user_id, "building_id": b, "created_by": by}
                for b in building_ids
            ]
        ).execute()


# --------------------------------------------------------------------------
# read endpoints
# --------------------------------------------------------------------------
@router.get("/me")
def my_access(user: dict = Depends(get_current_user), service_client=Depends(get_service_client)):
    ctx = load_access_context(user["user_id"], service_client, use_cache=False)
    if not ctx:
        raise HTTPException(status_code=403, detail="No profile found for this user")
    perms = permissions_for(ctx)
    return {
        "role": ctx["role"],
        "role_label": ROLE_LABELS.get(ctx["role"], ctx["role"]),
        "is_platform_admin": ctx["is_platform_admin"],
        "access_control_enabled": ctx["enabled"],
        "scoped": ctx["scoped"],
        "building_ids": ctx["building_ids"],
        "can_manage_users": ctx["is_platform_admin"] or ctx["role"] == "owner",
        **perms,
    }


@router.get("/roles")
def list_roles(user: dict = Depends(get_current_user), service_client=Depends(get_service_client)):
    ctx = load_access_context(user["user_id"], service_client)
    allowed = _assignable(ctx) if ctx else COMPANY_ASSIGNABLE_ROLES
    return [{"value": r, "label": ROLE_LABELS[r]} for r in ["owner", "admin", "accountant", "auditor", "manager", "staff"] if r in allowed]


@router.get("/buildings")
def assignable_buildings(
    company_id: Optional[str] = Query(None),
    supabase: Client = Depends(get_supabase),
    user: dict = Depends(get_current_user),
    service_client=Depends(get_service_client),
):
    caller = _verified_caller(supabase, user, service_client)
    cid = _scope_company(caller, company_id)
    return (
        service_client.table("buildings")
        .select("id, name")
        .eq("company_id", cid)
        .eq("is_archived", False)
        .order("name")
        .execute()
        .data
    )


@router.get("/users")
def list_users(
    company_id: Optional[str] = Query(None),
    supabase: Client = Depends(get_supabase),
    user: dict = Depends(get_current_user),
    service_client=Depends(get_service_client),
):
    caller = _verified_caller(supabase, user, service_client)
    cid = _scope_company(caller, company_id)

    profiles = (
        service_client.table("profiles")
        .select("id, full_name, role, phone, is_suspended, created_at")
        .eq("company_id", cid)
        .order("created_at")
        .execute()
        .data
    )
    access_rows = service_client.table("user_building_access").select("user_id, building_id").eq("company_id", cid).execute().data
    by_user: dict[str, list[str]] = {}
    for r in access_rows:
        by_user.setdefault(r["user_id"], []).append(r["building_id"])

    emails: dict[str, str] = {}
    try:  # email lives in auth.users; best-effort only
        for u in service_client.auth.admin.list_users(page=1, per_page=1000):
            emails[str(u.id)] = u.email
    except Exception:
        pass

    company = service_client.table("companies").select("id, name, access_control_enabled").eq("id", cid).execute().data
    return {
        "company": company[0] if company else None,
        "users": [
            {
                **p,
                "email": emails.get(p["id"]),
                "role_label": ROLE_LABELS.get(p["role"], p["role"]),
                "building_ids": by_user.get(p["id"], []),
            }
            for p in profiles
            if p["role"] in ROLE_LABELS  # hide Implementation-portal client roles from this screen
        ],
    }


# --------------------------------------------------------------------------
# write endpoints
# --------------------------------------------------------------------------
class CreateUser(BaseModel):
    full_name: str
    email: EmailStr
    password: str
    role: str
    building_ids: List[str] = []
    company_id: Optional[str] = None  # platform admin only


class UpdateUser(BaseModel):
    full_name: Optional[str] = None
    role: Optional[str] = None
    building_ids: Optional[List[str]] = None
    is_suspended: Optional[bool] = None


@router.post("/users", status_code=201)
def create_user(
    payload: CreateUser,
    supabase: Client = Depends(get_supabase),
    user: dict = Depends(get_current_user),
    service_client=Depends(get_service_client),
):
    caller = _verified_caller(supabase, user, service_client)
    cid = _scope_company(caller, payload.company_id)

    if payload.role not in _assignable(caller):
        raise HTTPException(status_code=400, detail=f"You can't assign the role '{payload.role}'.")
    if len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")
    if payload.role == "owner" and payload.building_ids:
        raise HTTPException(status_code=400, detail="An owner always sees every building; don't assign specific buildings.")
    building_ids = _validate_buildings(service_client, cid, payload.building_ids)

    company = service_client.table("companies").select("max_users").eq("id", cid).execute().data
    if not company:
        raise HTTPException(status_code=404, detail="Company not found.")
    max_users = company[0].get("max_users")
    if max_users is not None:
        n = service_client.table("profiles").select("id", count="exact").eq("company_id", cid).execute().count or 0
        if n >= max_users:
            raise HTTPException(status_code=403, detail=f"This company's plan allows up to {max_users} users.")

    try:
        auth_result = service_client.auth.admin.create_user(
            {"email": payload.email, "password": payload.password, "email_confirm": True}
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not create account: {e}")
    new_id = auth_result.user.id

    try:
        service_client.table("profiles").insert(
            {"id": new_id, "company_id": cid, "full_name": payload.full_name, "role": payload.role}
        ).execute()
        _replace_assignments(service_client, cid, new_id, building_ids, caller["user_id"])
    except Exception as e:
        try:
            service_client.auth.admin.delete_user(new_id)  # cascades profile + assignments
        except Exception:
            pass
        raise HTTPException(status_code=400, detail=f"Failed to create user: {e}")

    write_audit_log(
        service_client, cid, caller["user_id"], "create_user", "profiles", new_id,
        None, {"role": payload.role, "building_ids": building_ids},
    )
    invalidate_access_cache(new_id)
    return {"message": "User created", "user_id": new_id}


@router.patch("/users/{target_id}")
def update_user(
    target_id: str,
    payload: UpdateUser,
    company_id: Optional[str] = Query(None),
    supabase: Client = Depends(get_supabase),
    user: dict = Depends(get_current_user),
    service_client=Depends(get_service_client),
):
    caller = _verified_caller(supabase, user, service_client)
    cid = _scope_company(caller, company_id)

    rows = service_client.table("profiles").select("*").eq("id", target_id).eq("company_id", cid).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="User not found in this company.")
    target = rows[0]

    if target_id == caller["user_id"] and (payload.role is not None or payload.is_suspended):
        raise HTTPException(status_code=400, detail="You can't change your own role or suspend yourself.")
    if target["role"] == "owner" and not caller["is_platform_admin"]:
        raise HTTPException(status_code=403, detail="Only the platform admin can change an owner.")

    updates: dict = {}
    if payload.full_name is not None:
        updates["full_name"] = payload.full_name
    if payload.role is not None:
        if payload.role not in _assignable(caller):
            raise HTTPException(status_code=400, detail=f"You can't assign the role '{payload.role}'.")
        updates["role"] = payload.role
    if payload.is_suspended is not None:
        updates["is_suspended"] = payload.is_suspended
    new_role = updates.get("role", target["role"])

    if payload.building_ids is not None:
        if new_role == "owner" and payload.building_ids:
            raise HTTPException(status_code=400, detail="An owner always sees every building.")
        building_ids = _validate_buildings(service_client, cid, payload.building_ids)
    elif updates.get("role") == "owner":
        building_ids = []  # promoting to owner clears any building limits
        payload.building_ids = []
    else:
        building_ids = None

    if payload.is_suspended is not None:
        from datetime import datetime, timezone

        updates["suspended_at"] = datetime.now(timezone.utc).isoformat() if payload.is_suspended else None

    if updates:
        service_client.table("profiles").update(updates).eq("id", target_id).execute()
    if payload.building_ids is not None:
        _replace_assignments(service_client, cid, target_id, building_ids or [], caller["user_id"])

    write_audit_log(
        service_client, cid, caller["user_id"], "update_user", "profiles", target_id,
        {"role": target["role"], "is_suspended": target.get("is_suspended")},
        {**updates, **({"building_ids": building_ids} if building_ids is not None else {})},
    )
    invalidate_access_cache(target_id)
    return {"message": "User updated"}


class EnabledRequest(BaseModel):
    enabled: bool


@router.put("/company/{company_id}/enabled")
def set_access_control(
    company_id: str,
    payload: EnabledRequest,
    supabase: Client = Depends(get_supabase),
    user: dict = Depends(get_current_user),
    service_client=Depends(get_service_client),
):
    caller = _verified_caller(supabase, user, service_client)
    if not caller["is_platform_admin"]:
        raise HTTPException(status_code=403, detail="Only the platform admin can switch Access Control on or off.")
    res = (
        service_client.table("companies")
        .update({"access_control_enabled": payload.enabled})
        .eq("id", company_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Company not found.")
    write_audit_log(
        service_client, company_id, caller["user_id"], "access_control_toggle", "companies", company_id,
        None, {"access_control_enabled": payload.enabled},
    )
    invalidate_access_cache()
    return {"access_control_enabled": payload.enabled}
