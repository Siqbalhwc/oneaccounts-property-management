"""
Owner-occupied rooms.

When an owner lives in one of his own rooms, the lease needs a tenant. A
person can hold only one active lease and all tenant balances (invoice
opening balance, receipts, room-wise receivable, security held) are worked
out PER TENANT, so one owner can't simply be the tenant of many rooms --
every room's figures would merge. Instead each owner-occupied room gets its
OWN tenant record, created from the owner's details and linked to both the
owner (tenants.owner_id) and the room (tenants.owner_room_id).

The database allows the same CNIC on these owner-linked records only; for
everybody else (owner_id is null) the CNIC stays unique per company.

Everything here runs as the calling user (RLS applies) and is filtered to
the caller's company.
"""

import re
from typing import Any, Dict

from fastapi import HTTPException
from postgrest.exceptions import APIError
from supabase import Client

from app.services.ledger import resolve_room_owner


def _digits(value: Any) -> str:
    return re.sub(r"\D", "", str(value or ""))


def ensure_owner_tenant(supabase: Client, company_id: str, room_id: str) -> Dict[str, Any]:
    """Return the tenant record that represents the owner living in this
    room, creating it (once) from the owner's details. Raises HTTPException
    with a plain-English reason if it can't."""
    room_rows = (
        supabase.table("rooms")
        .select("id, room_number")
        .eq("id", room_id)
        .eq("company_id", company_id)
        .execute()
        .data
    )
    if not room_rows:
        raise HTTPException(status_code=404, detail="Room not found.")
    room = room_rows[0]

    owner_id = resolve_room_owner(supabase, room_id)
    if not owner_id:
        raise HTTPException(
            status_code=400,
            detail=f"Room {room['room_number']} has no owner (neither on the room nor on its building). Set the owner first.",
        )
    owner_rows = (
        supabase.table("owners")
        .select("id, name, phone, cnic, address")
        .eq("id", owner_id)
        .eq("company_id", company_id)
        .execute()
        .data
    )
    if not owner_rows:
        raise HTTPException(status_code=400, detail="This room's owner record could not be found.")
    owner = owner_rows[0]

    existing = (
        supabase.table("tenants")
        .select("*")
        .eq("company_id", company_id)
        .eq("owner_room_id", room_id)
        .execute()
        .data
    )
    if existing:
        rec = existing[0]
        if rec.get("owner_id") != owner["id"]:
            raise HTTPException(
                status_code=400,
                detail=f"Room {room['room_number']} already has an owner-occupant record for a different owner. The room's owner has changed - check the Tenants list before continuing.",
            )
        if rec.get("is_archived"):
            supabase.table("tenants").update({"is_archived": False}).eq("id", rec["id"]).execute()
            rec["is_archived"] = False
        return rec

    cnic = _digits(owner.get("cnic"))
    if len(cnic) != 13:
        raise HTTPException(
            status_code=400,
            detail=f'Owner "{owner["name"]}" has no valid CNIC (13 digits). Update the owner on the Owners page first.',
        )
    phone = _digits(owner.get("phone"))
    if len(phone) not in (10, 11) or (len(phone) == 11 and not phone.startswith("0")):
        raise HTTPException(
            status_code=400,
            detail=f'Owner "{owner["name"]}" has no valid phone number (e.g. 0300-1234567). Update the owner on the Owners page first.',
        )

    row = {
        "company_id": company_id,
        "full_name": owner["name"],
        "cnic": f"{cnic[:5]}-{cnic[5:12]}-{cnic[12]}",
        "phone": str(owner["phone"]).strip(),
        "address": owner.get("address"),
        "owner_id": owner["id"],
        "owner_room_id": room_id,
    }
    try:
        created = supabase.table("tenants").insert(row).execute().data
    except APIError:
        # Two requests racing for the same room: the unique index let one
        # win, so just return the record that now exists.
        again = (
            supabase.table("tenants").select("*").eq("company_id", company_id).eq("owner_room_id", room_id).execute().data
        )
        if again:
            return again[0]
        raise
    return created[0]
