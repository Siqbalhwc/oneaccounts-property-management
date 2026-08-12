from datetime import date
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from supabase import Client

from app.core.deps import get_current_company_id, get_current_user, get_supabase
from app.crud.generic import write_audit_log
from app.services.ledger import get_account_id, post_journal_entry, resolve_room_owner

router = APIRouter(prefix="/leases", tags=["Leases"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class LeaseCharge(BaseModel):
    label: str
    amount: float


class LeaseCreate(BaseModel):
    tenant_id: str
    room_id: str
    start_date: date
    end_date: date
    agreement_doc_url: str | None = None
    charges: List[LeaseCharge]  # e.g. [{"label": "Rent", "amount": 20000}, ...]
    security_deposit_amount: float
    security_deposit_date_received: date


class ChargeUpdate(BaseModel):
    new_amount: float
    effective_from: date | None = None  # defaults to today


class TerminateRequest(BaseModel):
    reason: str | None = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.get("")
def list_leases(supabase: Client = Depends(get_supabase)):
    res = supabase.table("leases").select("*").order("created_at", desc=True).execute()
    return res.data


@router.get("/{lease_id}")
def get_lease(lease_id: str, supabase: Client = Depends(get_supabase)):
    res = supabase.table("leases").select("*").eq("id", lease_id).single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Lease not found")
    return res.data


class LeaseEdit(BaseModel):
    start_date: date | None = None
    end_date: date | None = None
    agreement_doc_url: str | None = None


@router.patch("/{lease_id}")
def edit_lease(
    lease_id: str,
    payload: LeaseEdit,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
    user: dict = Depends(get_current_user),
):
    """Edits a lease's dates (e.g. fixing a typo made at creation)."""
    before = supabase.table("leases").select("*").eq("id", lease_id).single().execute()
    if not before.data:
        raise HTTPException(status_code=404, detail="Lease not found")

    updates = {k: str(v) if v is not None else None for k, v in payload.model_dump(exclude_unset=True).items()}
    updates = {k: v for k, v in updates.items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")

    res = supabase.table("leases").update(updates).eq("id", lease_id).execute()
    after = res.data[0]
    write_audit_log(supabase, company_id, user["user_id"], "update", "leases", lease_id, before.data, after)
    return after


@router.post("", status_code=201)
def create_lease(
    payload: LeaseCreate,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    """
    Creates a lease + its initial rent-component charges + its security
    deposit in one call, and marks the room as occupied.

    Note: supabase-py talks to PostgREST over HTTP, so this isn't a single
    atomic DB transaction. For an MVP this is an acceptable trade-off; if you
    want true atomicity later, wrap this logic in a single Postgres function
    and call it via supabase.rpc() instead.
    """
    existing_active = (
        supabase.table("leases")
        .select("id, room_id")
        .eq("tenant_id", payload.tenant_id)
        .eq("status", "active")
        .execute()
    )
    if existing_active.data:
        room = (
            supabase.table("rooms")
            .select("room_number, building_id")
            .eq("id", existing_active.data[0]["room_id"])
            .single()
            .execute()
        )
        room_label = room.data["room_number"] if room.data else "another room"
        raise HTTPException(
            status_code=400,
            detail=(
                f"This tenant already has an active lease (room {room_label}). "
                "Terminate the existing lease before creating a new one."
            ),
        )

    lease_row = {
        "company_id": company_id,
        "tenant_id": payload.tenant_id,
        "room_id": payload.room_id,
        "start_date": str(payload.start_date),
        "end_date": str(payload.end_date),
        "agreement_doc_url": payload.agreement_doc_url,
        "status": "active",
    }
    lease_res = supabase.table("leases").insert(lease_row).execute()
    if not lease_res.data:
        raise HTTPException(status_code=400, detail="Failed to create lease")
    lease = lease_res.data[0]
    lease_id = lease["id"]

    try:
        charge_rows = [
            {
                "company_id": company_id,
                "lease_id": lease_id,
                "label": c.label,
                "amount": c.amount,
                "effective_from": str(payload.start_date),
            }
            for c in payload.charges
        ]
        supabase.table("lease_charges").insert(charge_rows).execute()

        supabase.table("security_deposits").insert(
            {
                "company_id": company_id,
                "lease_id": lease_id,
                "amount_received": payload.security_deposit_amount,
                "date_received": str(payload.security_deposit_date_received),
                "status": "held",
            }
        ).execute()

        supabase.table("rooms").update({"status": "occupied"}).eq(
            "id", payload.room_id
        ).execute()

        # Dr Bank / Cr Security Deposits Held -- cash received, held as a
        # liability until it's refunded (or partially retained) later via
        # security_deposits.py's /refund endpoint.
        if payload.security_deposit_amount > 0:
            bank_id = get_account_id(supabase, company_id, "1000")
            deposits_held_id = get_account_id(supabase, company_id, "2100")
            owner_id = resolve_room_owner(supabase, payload.room_id)
            room = supabase.table("rooms").select("building_id").eq("id", payload.room_id).single().execute().data
            building_id = room["building_id"] if room else None

            post_journal_entry(
                supabase,
                company_id=company_id,
                entry_date=str(payload.security_deposit_date_received),
                source_type="security_deposit",
                source_id=lease_id,
                description=f"Security deposit received - lease {lease_id}",
                lines=[
                    {
                        "account_id": bank_id, "direction": "debit", "amount": payload.security_deposit_amount,
                        "building_id": building_id, "room_id": payload.room_id, "owner_id": owner_id, "tenant_id": payload.tenant_id,
                    },
                    {
                        "account_id": deposits_held_id, "direction": "credit", "amount": payload.security_deposit_amount,
                        "building_id": building_id, "room_id": payload.room_id, "owner_id": owner_id, "tenant_id": payload.tenant_id,
                    },
                ],
            )
    except Exception as e:
        # Best-effort rollback since this isn't a real DB transaction.
        supabase.table("leases").delete().eq("id", lease_id).execute()
        raise HTTPException(status_code=400, detail=f"Failed to fully create lease: {e}")

    return {"lease": lease, "message": "Lease, charges, and deposit created"}


@router.get("/{lease_id}/charges")
def get_active_charges(lease_id: str, supabase: Client = Depends(get_supabase)):
    """Returns only the currently-in-effect charges (effective_to is null)."""
    res = (
        supabase.table("lease_charges")
        .select("*")
        .eq("lease_id", lease_id)
        .is_("effective_to", "null")
        .execute()
    )
    return res.data


@router.patch("/{lease_id}/charges/{charge_id}")
def update_charge_amount(
    lease_id: str,
    charge_id: str,
    payload: ChargeUpdate,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    """
    Edits a rent-component amount (e.g. water fee 1000 -> 1200) WITHOUT
    overwriting history. Closes the old charge row and inserts a new one,
    so past invoices remain accurate.
    """
    effective_date = payload.effective_from or date.today()

    old = (
        supabase.table("lease_charges")
        .select("*")
        .eq("id", charge_id)
        .single()
        .execute()
    )
    if not old.data:
        raise HTTPException(status_code=404, detail="Charge not found")

    supabase.table("lease_charges").update(
        {"effective_to": str(effective_date)}
    ).eq("id", charge_id).execute()

    new_row = (
        supabase.table("lease_charges")
        .insert(
            {
                "company_id": company_id,
                "lease_id": lease_id,
                "label": old.data["label"],
                "amount": payload.new_amount,
                "effective_from": str(effective_date),
            }
        )
        .execute()
    )
    return new_row.data[0]


@router.post("/{lease_id}/terminate")
def terminate_lease(
    lease_id: str,
    payload: TerminateRequest,
    supabase: Client = Depends(get_supabase),
):
    """
    Ends a lease and frees up the room. Does NOT touch the security deposit --
    use POST /security-deposits/{id}/refund separately once you've settled
    dues/damages.
    """
    lease = supabase.table("leases").select("*").eq("id", lease_id).single().execute()
    if not lease.data:
        raise HTTPException(status_code=404, detail="Lease not found")

    supabase.table("leases").update(
        {
            "status": "terminated",
            "terminated_at": str(date.today()),
            "termination_reason": payload.reason,
        }
    ).eq("id", lease_id).execute()

    supabase.table("rooms").update({"status": "vacant"}).eq(
        "id", lease.data["room_id"]
    ).execute()

    return {"message": "Lease terminated, room marked vacant"}
