"""
Roommates -- people who live in a room alongside the lease-holding tenant.

The lease and the room stay in the tenant's name. This is a retained
register for police verification / monitoring, so nothing here is ever
hard-deleted.

Who may do what (enforced centrally in app/core/access.py, plus the owner
check on /remove below which holds even when Access Control is switched off):
  * Owner       add, edit, remove, report
  * Admin       add, edit, remove, report
  * Accountant  add, report                      (cannot edit or remove)
  * Auditor     report only
"""

import re
from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from supabase import Client

from app.core.access import EFFECTIVE_ROLE, load_access_context
from app.core.deps import (
    get_current_company_id,
    get_current_user,
    get_service_client,
    get_supabase,
)
from app.crud.generic import write_audit_log
from app.services import phone as phone_service

router = APIRouter(prefix="/room-occupants", tags=["Roommates"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class OccupantCreate(BaseModel):
    tenant_id: str      # the lease-holding tenant they're associated with
    room_id: str
    full_name: str
    relationship: Optional[str] = None  # e.g. "Brother", "Friend", "Spouse"
    cnic: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    moved_in_date: Optional[date] = None


class OccupantEdit(BaseModel):
    full_name: Optional[str] = None
    relationship: Optional[str] = None
    cnic: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None


class OccupantRemove(BaseModel):
    reason: str
    moved_out_date: Optional[date] = None  # defaults to today


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _clean(value: Optional[str]) -> Optional[str]:
    value = (value or "").strip()
    return value or None


def _format_cnic(raw: str) -> str:
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) != 13:
        raise HTTPException(
            status_code=400,
            detail="CNIC must be exactly 13 digits (e.g. 35202-1234567-1).",
        )
    return f"{digits[:5]}-{digits[5:12]}-{digits[12]}"


def _cnic_digits(value: Optional[str]) -> str:
    return re.sub(r"\D", "", value or "")


def require_owner_or_admin_role(
    user: dict = Depends(get_current_user),
    service_client=Depends(get_service_client),
) -> None:
    """Only an owner or admin (legacy 'manager' counts as admin), or a platform
    admin, may pass.

    Deliberately independent of the Access Control feature switch: this is a
    new action with no legacy behaviour to preserve, and 'accountants can't
    remove a roommate' must hold for every company."""
    ctx = load_access_context(user["user_id"], service_client, use_cache=False)
    allowed = bool(ctx) and (
        EFFECTIVE_ROLE.get(ctx["role"]) in ("owner", "admin") or ctx["is_platform_admin"]
    )
    if not allowed:
        raise HTTPException(status_code=403, detail="Only an owner or admin can remove a roommate.")


def _fetch_by_ids(supabase: Client, table: str, columns: str, ids: list[str]) -> list[dict]:
    """in_() lookups in chunks so a large portfolio can't blow the URL length."""
    out: list[dict] = []
    unique = sorted({i for i in ids if i})
    for i in range(0, len(unique), 100):
        out += supabase.table(table).select(columns).in_("id", unique[i : i + 100]).execute().data
    return out


def _check_duplicates(supabase: Client, tenant: dict, cnic: Optional[str], exclude_id: Optional[str] = None) -> None:
    if not cnic:
        return
    digits = _cnic_digits(cnic)
    if digits == _cnic_digits(tenant.get("cnic")):
        raise HTTPException(status_code=400, detail="This CNIC belongs to the tenant themselves, not a roommate.")
    rows = (
        supabase.table("room_occupants")
        .select("id, full_name, cnic")
        .is_("moved_out_date", "null")
        .not_.is_("cnic", "null")
        .execute()
        .data
    )
    for r in rows:
        if r["id"] != exclude_id and _cnic_digits(r.get("cnic")) == digits:
            raise HTTPException(
                status_code=409,
                detail=f"{r['full_name']} with this CNIC is already registered as a current roommate.",
            )


# ---------------------------------------------------------------------------
# Report (must be declared before "/{occupant_id}")
# ---------------------------------------------------------------------------
@router.get("/report")
def roommates_report(
    building_id: Optional[str] = Query(None),
    search: Optional[str] = Query(None, description="Tenant, roommate, CNIC or room"),
    include_past: bool = Query(False, description="Also list roommates who have moved out"),
    only_with_roommates: bool = Query(False),
    supabase: Client = Depends(get_supabase),
):
    """Tenant-wise roommates register. Every tenant with an active lease is a
    row (so 'no roommates declared' is visible too), each with their roommates.

    Visibility is inherited from the caller's own RLS-scoped client: a
    building-restricted user only sees leases/rooms in their buildings, and
    therefore only their roommates."""
    leases = (
        supabase.table("leases")
        .select("id, tenant_id, room_id, status, start_date, end_date")
        .eq("status", "active")
        .execute()
        .data
    )
    rooms = {r["id"]: r for r in supabase.table("rooms").select("id, room_number, building_id").execute().data}
    buildings = {b["id"]: b for b in supabase.table("buildings").select("id, name").execute().data}
    tenants = {
        t["id"]: t
        for t in _fetch_by_ids(supabase, "tenants", "id, full_name, cnic, phone", [l["tenant_id"] for l in leases])
    }

    if building_id:
        leases = [l for l in leases if rooms.get(l["room_id"], {}).get("building_id") == building_id]

    visible_tenant_ids = {l["tenant_id"] for l in leases}
    occ_query = supabase.table("room_occupants").select("*").order("moved_in_date", desc=False)
    if not include_past:
        occ_query = occ_query.is_("moved_out_date", "null")
    occupants = [o for o in occ_query.execute().data if o["tenant_id"] in visible_tenant_ids]

    by_tenant: dict[str, list[dict]] = {}
    for o in occupants:
        by_tenant.setdefault(o["tenant_id"], []).append(o)

    q = (search or "").strip().lower()
    rows = []
    for l in leases:
        tenant = tenants.get(l["tenant_id"], {})
        room = rooms.get(l["room_id"], {})
        building = buildings.get(room.get("building_id"), {})
        mates = by_tenant.get(l["tenant_id"], [])
        if only_with_roommates and not mates:
            continue
        if q:
            hay = " ".join(
                [
                    tenant.get("full_name") or "",
                    tenant.get("cnic") or "",
                    str(room.get("room_number") or ""),
                    building.get("name") or "",
                    *[(m.get("full_name") or "") + " " + (m.get("cnic") or "") for m in mates],
                ]
            ).lower()
            if q not in hay:
                continue
        rows.append(
            {
                "tenant_id": l["tenant_id"],
                "tenant_name": tenant.get("full_name"),
                "tenant_cnic": tenant.get("cnic"),
                "tenant_phone": tenant.get("phone"),
                "lease_id": l["id"],
                "room_id": l["room_id"],
                "room_number": room.get("room_number"),
                "building_id": room.get("building_id"),
                "building_name": building.get("name"),
                "current_roommate_count": sum(1 for m in mates if not m.get("moved_out_date")),
                "roommates": mates,
            }
        )
    rows.sort(key=lambda r: ((r["building_name"] or "").lower(), str(r["room_number"] or "")))
    return {
        "rows": rows,
        "total_tenants": len(rows),
        "total_current_roommates": sum(r["current_roommate_count"] for r in rows),
    }


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------
@router.get("")
def list_occupants(
    tenant_id: Optional[str] = Query(None),
    room_id: Optional[str] = Query(None),
    lease_id: Optional[str] = Query(None),
    supabase: Client = Depends(get_supabase),
):
    """Full history by default -- both current and past roommates -- since
    the whole point is a retained record, not just who's there right now."""
    query = supabase.table("room_occupants").select("*")
    if tenant_id:
        query = query.eq("tenant_id", tenant_id)
    if room_id:
        query = query.eq("room_id", room_id)
    if lease_id:
        query = query.eq("lease_id", lease_id)
    return query.order("created_at", desc=True).execute().data


@router.get("/{occupant_id}")
def get_occupant(occupant_id: str, supabase: Client = Depends(get_supabase)):
    res = supabase.table("room_occupants").select("*").eq("id", occupant_id).single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Not found")
    return res.data


@router.post("", status_code=201)
def add_occupant(
    payload: OccupantCreate,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
    user: dict = Depends(get_current_user),
):
    full_name = _clean(payload.full_name)
    if not full_name:
        raise HTTPException(status_code=400, detail="Roommate's full name is required.")

    # Roommates only attach to a CURRENT tenant: the tenant must hold an active
    # lease on exactly this room (the lease itself never changes hands).
    lease = (
        supabase.table("leases")
        .select("id, room_id")
        .eq("tenant_id", payload.tenant_id)
        .eq("status", "active")
        .execute()
        .data
    )
    if not lease:
        raise HTTPException(status_code=400, detail="Roommates can only be added to a tenant with an active lease.")
    if lease[0]["room_id"] != payload.room_id:
        raise HTTPException(status_code=400, detail="That room is not this tenant's current room.")

    tenant = supabase.table("tenants").select("id, cnic").eq("id", payload.tenant_id).single().execute().data
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found.")

    cnic = _format_cnic(payload.cnic) if _clean(payload.cnic) else None
    phone = phone_service.validate_and_normalize(payload.phone) if _clean(payload.phone) else None
    _check_duplicates(supabase, tenant, cnic)

    moved_in = payload.moved_in_date or date.today()
    row = {
        "company_id": company_id,
        "tenant_id": payload.tenant_id,
        "room_id": payload.room_id,
        "lease_id": lease[0]["id"],
        "full_name": full_name,
        "relationship": _clean(payload.relationship),
        "cnic": cnic,
        "phone": phone,
        "address": _clean(payload.address),
        "moved_in_date": str(moved_in),
        "added_by": user["user_id"],
    }
    res = supabase.table("room_occupants").insert(row).execute()
    created = res.data[0]
    write_audit_log(supabase, company_id, user["user_id"], "create", "room_occupants", created["id"])
    return created


@router.patch("/{occupant_id}")
def edit_occupant(
    occupant_id: str,
    payload: OccupantEdit,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
    user: dict = Depends(get_current_user),
):
    """Correct a roommate's details (Owner / Admin). Moving someone out is NOT
    done here -- that is the owner/admin-only POST /{id}/remove below."""
    before = supabase.table("room_occupants").select("*").eq("id", occupant_id).single().execute()
    if not before.data:
        raise HTTPException(status_code=404, detail="Not found")
    if before.data.get("moved_out_date"):
        raise HTTPException(status_code=400, detail="This roommate has already been removed; the record is read-only.")

    data = payload.model_dump(exclude_unset=True)
    updates: dict = {}
    if "full_name" in data:
        name = _clean(data["full_name"])
        if not name:
            raise HTTPException(status_code=400, detail="Roommate's full name can't be blank.")
        updates["full_name"] = name
    if "relationship" in data:
        updates["relationship"] = _clean(data["relationship"])
    if "address" in data:
        updates["address"] = _clean(data["address"])
    if "cnic" in data:
        updates["cnic"] = _format_cnic(data["cnic"]) if _clean(data["cnic"]) else None
        if updates["cnic"]:
            tenant = (
                supabase.table("tenants").select("id, cnic").eq("id", before.data["tenant_id"]).single().execute().data
            )
            _check_duplicates(supabase, tenant or {}, updates["cnic"], exclude_id=occupant_id)
    if "phone" in data:
        updates["phone"] = phone_service.validate_and_normalize(data["phone"]) if _clean(data["phone"]) else None
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")

    res = supabase.table("room_occupants").update(updates).eq("id", occupant_id).execute()
    after = res.data[0]
    write_audit_log(supabase, company_id, user["user_id"], "update", "room_occupants", occupant_id, before.data, after)
    return after


@router.post("/{occupant_id}/remove")
def remove_occupant(
    occupant_id: str,
    payload: OccupantRemove,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
    user: dict = Depends(get_current_user),
    _perm: None = Depends(require_owner_or_admin_role),
):
    """Owner / Admin only. Marks the roommate as moved out (record is kept for the
    police register -- who removed them, when, and why)."""
    reason = _clean(payload.reason)
    if not reason or len(reason) < 3:
        raise HTTPException(status_code=400, detail="Please give a short reason for removing this roommate.")

    before = supabase.table("room_occupants").select("*").eq("id", occupant_id).single().execute()
    if not before.data:
        raise HTTPException(status_code=404, detail="Not found")
    if before.data.get("moved_out_date"):
        raise HTTPException(status_code=400, detail="This roommate has already been removed.")

    moved_out = payload.moved_out_date or date.today()
    if str(moved_out) < str(before.data["moved_in_date"]):
        raise HTTPException(status_code=400, detail="Move-out date can't be before the move-in date.")

    res = (
        supabase.table("room_occupants")
        .update(
            {
                "moved_out_date": str(moved_out),
                "removed_at": datetime.now(timezone.utc).isoformat(),
                "removed_by": user["user_id"],
                "removal_reason": reason,
            }
        )
        .eq("id", occupant_id)
        .execute()
    )
    after = res.data[0]
    write_audit_log(supabase, company_id, user["user_id"], "remove", "room_occupants", occupant_id, before.data, after)
    return after
