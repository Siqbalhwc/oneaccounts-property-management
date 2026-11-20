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


# Account codes whose balance is read PER TENANT (invoice opening balance /
# arrears = 1100, security held = 2100).
TENANT_BALANCE_CODES = ("1100", "2100")


def apply_owner_tenant_rules(supabase: Client, company_id: str, lines: list) -> None:
    """Manual journal lines for owner-occupied rooms.

    Every owner-occupied room has its OWN tenant record (same owner name, so
    several look identical in a list). An invoice only counts arrears tagged
    to the tenant of ITS lease, so a line tagged to the wrong one of those
    look-alike records never shows up as arrears. Rules, enforced here so no
    screen or import can get around them:

      * A line on 1100 / 2100 for an owner-occupied room that has no tenant
        chosen gets that room's owner-tenant record automatically.
      * A line whose chosen tenant is an owner-occupant record of a DIFFERENT
        room than the line's room is refused with a plain-English message.

    `lines` are ManualJournalLine-like objects (attribute access); tenant_id
    is filled in place. Runs as the caller (RLS) and only sees this company.
    """
    room_ids = {l.room_id for l in lines if l.room_id}
    tenant_ids = {l.tenant_id for l in lines if l.tenant_id}
    if not room_ids and not tenant_ids:
        return

    by_room: Dict[str, Dict[str, Any]] = {}
    if room_ids:
        for t in (
            supabase.table("tenants")
            .select("id, full_name, owner_room_id")
            .eq("company_id", company_id)
            .in_("owner_room_id", list(room_ids))
            .execute()
            .data
        ):
            by_room[t["owner_room_id"]] = t

    chosen: Dict[str, Dict[str, Any]] = {}
    if tenant_ids:
        for t in (
            supabase.table("tenants")
            .select("id, full_name, owner_room_id")
            .eq("company_id", company_id)
            .in_("id", list(tenant_ids))
            .execute()
            .data
        ):
            chosen[t["id"]] = t

    codes: Dict[str, str] = {}
    account_ids = {l.account_id for l in lines}
    if account_ids:
        for a in (
            supabase.table("chart_of_accounts")
            .select("id, code")
            .eq("company_id", company_id)
            .in_("id", list(account_ids))
            .execute()
            .data
        ):
            codes[a["id"]] = str(a["code"]).strip()

    room_numbers: Dict[str, str] = {}
    wanted = {t["owner_room_id"] for t in chosen.values() if t.get("owner_room_id")} | room_ids
    if wanted:
        for r in (
            supabase.table("rooms")
            .select("id, room_number")
            .eq("company_id", company_id)
            .in_("id", list(wanted))
            .execute()
            .data
        ):
            room_numbers[r["id"]] = str(r["room_number"])

    for l in lines:
        t = chosen.get(l.tenant_id) if l.tenant_id else None
        if t and t.get("owner_room_id") and t["owner_room_id"] != l.room_id:
            own = room_numbers.get(t["owner_room_id"], "another room")
            here = room_numbers.get(l.room_id) if l.room_id else None
            raise HTTPException(
                status_code=400,
                detail=(
                    f'Tenant "{t["full_name"]}" here is the owner-occupant record of room {own}, '
                    + (f"but this line is for room {here}. " if here else "but this line has no room selected. ")
                    + "Choose the tenant record that belongs to the same room."
                ),
            )
        if not l.tenant_id and l.room_id and codes.get(l.account_id) in TENANT_BALANCE_CODES:
            owner_t = by_room.get(l.room_id)
            if owner_t:
                l.tenant_id = owner_t["id"]
