from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from supabase import Client

from app.core.deps import get_current_company_id, get_current_user, get_supabase
from app.crud.generic import write_audit_log

router = APIRouter(prefix="/room-occupants", tags=["Roommates"])


class OccupantCreate(BaseModel):
    tenant_id: str      # the lease-holding tenant they're associated with
    room_id: str
    full_name: str
    cnic: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    moved_in_date: Optional[date] = None


class OccupantEdit(BaseModel):
    full_name: Optional[str] = None
    cnic: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    moved_out_date: Optional[date] = None  # the main way this gets used: recording when someone left


@router.get("")
def list_occupants(
    tenant_id: Optional[str] = Query(None),
    room_id: Optional[str] = Query(None),
    supabase: Client = Depends(get_supabase),
):
    """Full history by default -- both current and past roommates -- since
    the whole point is a retained record, not just who's there right now."""
    query = supabase.table("room_occupants").select("*")
    if tenant_id:
        query = query.eq("tenant_id", tenant_id)
    if room_id:
        query = query.eq("room_id", room_id)
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
    row = payload.model_dump()
    row["moved_in_date"] = str(row["moved_in_date"]) if row.get("moved_in_date") else str(date.today())
    row["company_id"] = company_id
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
    """No delete endpoint on purpose -- this is a retained record for police
    reporting, so a roommate who's left gets moved_out_date set, not removed."""
    before = supabase.table("room_occupants").select("*").eq("id", occupant_id).single().execute()
    if not before.data:
        raise HTTPException(status_code=404, detail="Not found")

    updates = {k: (str(v) if isinstance(v, date) else v) for k, v in payload.model_dump(exclude_unset=True).items()}
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")

    res = supabase.table("room_occupants").update(updates).eq("id", occupant_id).execute()
    after = res.data[0]
    write_audit_log(supabase, company_id, user["user_id"], "update", "room_occupants", occupant_id, before.data, after)
    return after
