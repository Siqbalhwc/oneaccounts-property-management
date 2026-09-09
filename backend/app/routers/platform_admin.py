"""
The "Tower" view: a cross-tenant overview available ONLY to whoever has
is_platform_admin=true on their own profile (set manually via SQL -- there
is no in-app way to grant this to yourself or anyone else).

Every endpoint here first checks the CALLER's own admin flag using their own
RLS-scoped client (safe self-lookup, no cross-tenant read needed for that
check). Only after that passes do we use the service-role client to actually
read across every company.
"""

import json
from datetime import date, datetime
from decimal import Decimal
from io import BytesIO
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from supabase import Client

from app.core.deps import get_current_user, get_service_client, get_supabase

router = APIRouter(prefix="/platform", tags=["Platform Admin (Tower)"])


def require_platform_admin(
    supabase: Client = Depends(get_supabase),
    user: dict = Depends(get_current_user),
) -> None:
    profile = (
        supabase.table("profiles")
        .select("is_platform_admin")
        .eq("id", user["user_id"])
        .single()
        .execute()
    )
    if not profile.data or not profile.data.get("is_platform_admin"):
        raise HTTPException(status_code=403, detail="Platform admin access required.")


@router.get("/login-log")
def list_login_log(
    limit: int = 300,
    company_id: Optional[str] = None,
    _admin: None = Depends(require_platform_admin),
    service_client=Depends(get_service_client),
):
    """
    Every login attempt across every company -- who, when, and what
    happened (succeeded, blocked as pending, blocked as suspended, etc).
    Written by POST /auth/log-login, which fires right after each
    successful Supabase sign-in. Cross-tenant by nature, so this is
    platform-admin only, same gate as every other Tower endpoint.
    """
    query = service_client.table("login_log").select("*").order("created_at", desc=True).limit(limit)
    if company_id:
        query = query.eq("company_id", company_id)
    return query.execute().data


@router.get("/companies")
def list_all_companies(_admin: None = Depends(require_platform_admin), service_client=Depends(get_service_client)):
    companies = service_client.table("companies").select("*").execute().data
    buildings = service_client.table("buildings").select("id, company_id").execute().data
    tenants = service_client.table("tenants").select("id, company_id").execute().data
    rooms = service_client.table("rooms").select("id, company_id, status").execute().data
    payments = service_client.table("payments").select("company_id, amount, payment_date").execute().data
    profiles = service_client.table("profiles").select("company_id, is_suspended").execute().data

    from datetime import date

    current_month = date.today().strftime("%Y-%m")

    result = []
    for c in companies:
        cid = c["id"]
        company_rooms = [r for r in rooms if r["company_id"] == cid]
        occupied = len([r for r in company_rooms if r["status"] == "occupied"])
        company_profiles = [p for p in profiles if p["company_id"] == cid]
        income_this_month = sum(
            float(p["amount"])
            for p in payments
            if p["company_id"] == cid and str(p["payment_date"]).startswith(current_month)
        )
        result.append(
            {
                "id": cid,
                "name": c["name"],
                "created_at": c["created_at"],
                "status": c.get("status", "active"),
                "suspended_reason": c.get("suspended_reason"),
                "suspended_at": c.get("suspended_at"),
                "max_users": c.get("max_users"),
                "building_count": len([b for b in buildings if b["company_id"] == cid]),
                "tenant_count": len([t for t in tenants if t["company_id"] == cid]),
                "room_count": len(company_rooms),
                "occupied_room_count": occupied,
                "user_count": len(company_profiles),
                "suspended_user_count": len([p for p in company_profiles if p.get("is_suspended")]),
                "income_this_month": income_this_month,
            }
        )

    return result


@router.get("/companies/{company_id}")
def get_company_detail(
    company_id: str,
    _admin: None = Depends(require_platform_admin),
    service_client=Depends(get_service_client),
):
    """Drill-down view for one company: its own row, its users, and its feature flags."""
    company = service_client.table("companies").select("*").eq("id", company_id).single().execute()
    if not company.data:
        raise HTTPException(status_code=404, detail="Company not found")
    users = (
        service_client.table("profiles")
        .select("id, full_name, role, phone, is_suspended, suspended_at, created_at")
        .eq("company_id", company_id)
        .execute()
        .data
    )
    flags = (
        service_client.table("company_feature_flags")
        .select("*")
        .eq("company_id", company_id)
        .execute()
        .data
    )
    return {"company": company.data, "users": users, "feature_flags": flags}


class SuspendCompanyRequest(BaseModel):
    reason: Optional[str] = None


@router.post("/companies/{company_id}/suspend")
def suspend_company(
    company_id: str,
    payload: SuspendCompanyRequest,
    admin_user: dict = Depends(get_current_user),
    _admin: None = Depends(require_platform_admin),
    service_client=Depends(get_service_client),
):
    """
    Blocks this company from all data access. Enforcement is in Postgres
    (auth_company_id() returns NULL once status != 'active', which every
    RLS isolation policy depends on) -- this endpoint just flips the flag
    that function reads. Existing logged-in sessions are blocked on their
    very next request, no token revocation needed.
    """
    from datetime import datetime

    res = (
        service_client.table("companies")
        .update({"status": "suspended", "suspended_reason": payload.reason, "suspended_at": datetime.utcnow().isoformat()})
        .eq("id", company_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Company not found")
    return res.data[0]


@router.post("/companies/{company_id}/activate")
def activate_company(
    company_id: str,
    _admin: None = Depends(require_platform_admin),
    service_client=Depends(get_service_client),
):
    res = (
        service_client.table("companies")
        .update({"status": "active", "suspended_reason": None, "suspended_at": None})
        .eq("id", company_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Company not found")
    return res.data[0]


class SetUserLimitRequest(BaseModel):
    max_users: Optional[int] = None  # null = unlimited


@router.put("/companies/{company_id}/user-limit")
def set_user_limit(
    company_id: str,
    payload: SetUserLimitRequest,
    _admin: None = Depends(require_platform_admin),
    service_client=Depends(get_service_client),
):
    if payload.max_users is not None and payload.max_users < 1:
        raise HTTPException(status_code=400, detail="max_users must be at least 1, or null for unlimited")
    res = (
        service_client.table("companies")
        .update({"max_users": payload.max_users})
        .eq("id", company_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Company not found")
    return res.data[0]


@router.post("/users/{user_id}/suspend")
def suspend_user(
    user_id: str,
    _admin: None = Depends(require_platform_admin),
    service_client=Depends(get_service_client),
):
    """Suspends ONE user, not their whole company -- e.g. an offboarded
    employee whose login should stop working immediately."""
    from datetime import datetime

    res = (
        service_client.table("profiles")
        .update({"is_suspended": True, "suspended_at": datetime.utcnow().isoformat()})
        .eq("id", user_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="User not found")
    return res.data[0]


@router.post("/users/{user_id}/activate")
def activate_user(
    user_id: str,
    _admin: None = Depends(require_platform_admin),
    service_client=Depends(get_service_client),
):
    res = (
        service_client.table("profiles")
        .update({"is_suspended": False, "suspended_at": None})
        .eq("id", user_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="User not found")
    return res.data[0]


# Known feature keys the Tower UI can toggle. Anything not listed here can
# still be set via the API (feature_key is just a free-form string in the
# table) -- this list exists only to drive dropdown/checkbox labels in the
# frontend, not to restrict what's possible.
KNOWN_FEATURE_KEYS = {
    "data_export": "Export data (CSV/PDF downloads)",
    "data_import": "Bulk data import",
    "whatsapp_invoicing": "WhatsApp invoice sending",
}


@router.get("/feature-keys")
def list_known_feature_keys(_admin: None = Depends(require_platform_admin)):
    return KNOWN_FEATURE_KEYS


class SetFeatureFlagRequest(BaseModel):
    feature_key: str
    enabled: bool


@router.put("/companies/{company_id}/features")
def set_feature_flag(
    company_id: str,
    payload: SetFeatureFlagRequest,
    admin_user: dict = Depends(get_current_user),
    _admin: None = Depends(require_platform_admin),
    service_client=Depends(get_service_client),
):
    existing = (
        service_client.table("company_feature_flags")
        .select("id")
        .eq("company_id", company_id)
        .eq("feature_key", payload.feature_key)
        .execute()
        .data
    )
    from datetime import datetime

    row = {
        "company_id": company_id,
        "feature_key": payload.feature_key,
        "enabled": payload.enabled,
        "updated_at": datetime.utcnow().isoformat(),
        "updated_by": admin_user["user_id"],
    }
    if existing:
        res = service_client.table("company_feature_flags").update(row).eq("id", existing[0]["id"]).execute()
    else:
        res = service_client.table("company_feature_flags").insert(row).execute()
    return res.data[0]


# ============================================================================
# Full-company backup / restore (added — requires schema_patch_022, which
# defines platform_admin_export_company() / platform_admin_import_company()
# in Postgres; see that patch file for what it does and doesn't include).
# ============================================================================

def _json_default(obj):
    if isinstance(obj, (date, datetime)):
        return obj.isoformat()
    if isinstance(obj, Decimal):
        return float(obj)
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")


@router.get("/companies/{company_id}/backup")
def backup_company(
    company_id: str,
    _admin: None = Depends(require_platform_admin),
    service_client: Client = Depends(get_service_client),
):
    """
    Full, single-file backup of one company: every business table (buildings,
    rooms, tenants, leases, chart of accounts, every journal entry, etc).
    Does NOT include team member logins (profiles) or the audit trail --
    see the comment block at the top of schema_patch_022 for why.
    """
    result = service_client.rpc(
        "platform_admin_export_company", {"p_company_id": company_id}
    ).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Company not found or has no data")

    company_name = (result.data.get("company") or {}).get("name") or "company"
    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in company_name)
    filename = f"backup_{safe_name}_{date.today().isoformat()}.json"

    payload = json.dumps(result.data, indent=2, default=_json_default).encode("utf-8")

    return StreamingResponse(
        BytesIO(payload),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/companies/{company_id}/restore")
def restore_company(
    company_id: str,
    file: UploadFile = File(...),
    _admin: None = Depends(require_platform_admin),
    service_client: Client = Depends(get_service_client),
):
    """
    Restores a backup .json (from the endpoint above) into {company_id}.
    {company_id} must already exist and be completely empty -- the
    underlying SQL function refuses to run otherwise. Every ID in the
    backup is regenerated on the way in, and the whole restore is one
    atomic operation: if anything fails, nothing partial is left behind.
    """
    raw = file.file.read()
    try:
        backup_data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"That file isn't valid JSON: {e}")

    try:
        result = service_client.rpc(
            "platform_admin_import_company",
            {
                "p_backup": backup_data,
                "p_target_company_id": company_id,
                "p_force": False,
            },
        ).execute()
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    return result.data
