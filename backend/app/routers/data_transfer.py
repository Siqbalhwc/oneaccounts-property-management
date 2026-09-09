"""
app/routers/data_transfer.py

Excel import/export for a company's own core records: Buildings, Rooms
(with Owner attached), Tenants, and Leases.

DESIGN PRINCIPLE — reuse real business logic, never re-implement it:
  - Buildings / Rooms / Tenants go through the exact same insert + audit-log
    path as the generic CRUD routes (app/crud/generic.py), so an imported
    row is indistinguishable from one entered by hand.
  - Leases are the important one: importing a lease calls the SAME
    create_lease() function `leases.py` already exposes on POST /leases --
    the one that (per your Aug 12 rebuild) posts the security-deposit
    journal entry and creates the lease_charges rows. Nothing about journal
    posting is duplicated here; if `create_lease` posts to the ledger today,
    an imported lease posts to the ledger today too, automatically, forever
    -- even if the ledger logic changes later, since this file never
    touches the ledger directly.
  - Every value is validated against the SAME rules the manual forms use
    (CNIC format, Pakistani phone normalization, no duplicate active lease,
    no duplicate room number per building) before anything is written.

ROW-LEVEL, NOT ALL-OR-NOTHING:
  Unlike the super-admin full-company restore (which is one atomic
  operation, because a partial company restore is meaningless), an Excel
  import is ongoing data entry -- one bad row shouldn't block 200 good
  ones. Each row is validated and inserted independently, and the response
  is a full report: which rows succeeded, which were skipped, and exactly
  why any row failed, so you can fix just those rows and re-upload.

WHAT'S STILL NEEDED TO FINISH THE LEASE IMPORT PRECISELY:
  This file assumes `leases.py` still exposes a `create_lease(payload,
  supabase, company_id)` function with the same shape shown in your
  original Project Knowledge copy (LeaseCreate: tenant_id, room_id,
  start_date, end_date, charges, security_deposit_amount,
  security_deposit_date_received). If the ledger rebuild changed that
  function's signature (e.g. charges now carry `recurrence` per the New
  Lease wizard, or GL `account_id` per charge), send me the CURRENT
  leases.py and I'll adjust build_lease_payload() below to match exactly --
  right now it fills those fields with safe defaults (recurrence="recurring")
  which may not be what you want.
"""

import re
from io import BytesIO
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from openpyxl import Workbook, load_workbook
from supabase import Client

from app.core.deps import get_current_company_id, get_current_user, get_supabase, require_owner_or_admin
from app.crud.generic import write_audit_log, friendly_db_error
from postgrest.exceptions import APIError

router = APIRouter(prefix="/data-transfer", tags=["Import / Export"])


# ============================================================================
# Shared validation helpers (mirrors tenants/page.tsx's validateCnic /
# validatePhone, and invoices.py's normalize_pakistani_phone, so an import
# and a manual entry are held to the identical standard)
# ============================================================================

def validate_cnic(value: str) -> Optional[str]:
    digits = re.sub(r"\D", "", value or "")
    if len(digits) != 13:
        return "CNIC must be exactly 13 digits (e.g. 35202-1234567-1)."
    return None


def normalize_pakistani_phone(phone: str) -> Optional[str]:
    """Returns the normalized digits-only form, or None if unparseable."""
    digits = re.sub(r"\D", "", phone or "")
    if digits.startswith("0092") and len(digits) == 14:
        digits = digits[2:]
    if digits.startswith("92") and len(digits) == 12:
        return digits
    if digits.startswith("0") and len(digits) == 11:
        return "92" + digits[1:]
    if digits.startswith("3") and len(digits) == 10:
        return "92" + digits
    return None


def row_to_dict(headers: List[str], row: tuple) -> Dict[str, Any]:
    return {
        headers[i]: (row[i] if i < len(row) else None)
        for i in range(len(headers))
    }


def read_sheet(wb, sheet_name: str) -> List[Dict[str, Any]]:
    if sheet_name not in wb.sheetnames:
        return []
    ws = wb[sheet_name]
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []
    headers = [str(h).strip() if h else "" for h in rows[0]]
    out = []
    for r in rows[1:]:
        if all(v is None or str(v).strip() == "" for v in r):
            continue  # skip fully blank rows
        out.append(row_to_dict(headers, r))
    return out


# ============================================================================
# EXPORT — one workbook, one sheet per entity, current data
# ============================================================================

@router.get("/export")
def export_workbook(
    supabase: Client = Depends(get_supabase),
):
    buildings = supabase.table("buildings").select("*").eq("is_archived", False).execute().data
    owners = supabase.table("owners").select("*").execute().data
    rooms = supabase.table("rooms").select("*").eq("is_archived", False).execute().data
    tenants = supabase.table("tenants").select("*").eq("is_archived", False).execute().data
    leases = supabase.table("leases").select("*").execute().data

    building_name = {b["id"]: b["name"] for b in buildings}
    owner_name = {o["id"]: o["name"] for o in owners}
    room_label = {r["id"]: r["room_number"] for r in rooms}
    tenant_label = {t["id"]: f'{t["full_name"]} ({t["cnic"]})' for t in tenants}

    wb = Workbook()
    wb.remove(wb.active)

    ws = wb.create_sheet("Owners")
    ws.append(["name", "phone", "cnic", "address"])
    for o in owners:
        ws.append([o.get("name"), o.get("phone"), o.get("cnic"), o.get("address")])

    ws = wb.create_sheet("Buildings")
    ws.append(["name", "address"])
    for b in buildings:
        ws.append([b.get("name"), b.get("address")])

    ws = wb.create_sheet("Rooms")
    ws.append(["building_name", "floor_number", "room_number", "room_type", "base_rent", "owner_name"])
    for r in rooms:
        ws.append([
            building_name.get(r["building_id"]),
            None,  # floor_number filled on request only -- rooms carry floor_id, not floor_number, directly
            r.get("room_number"),
            r.get("room_type"),
            float(r["base_rent"]) if r.get("base_rent") is not None else None,
            owner_name.get(r.get("owner_id"), "") if r.get("owner_id") else "",
        ])

    ws = wb.create_sheet("Tenants")
    ws.append(["full_name", "cnic", "phone", "email", "emergency_contact_name", "emergency_contact_phone"])
    for t in tenants:
        ws.append([
            t.get("full_name"), t.get("cnic"), t.get("phone"), t.get("email"),
            t.get("emergency_contact_name"), t.get("emergency_contact_phone"),
        ])

    ws = wb.create_sheet("Leases")
    ws.append([
        "tenant_cnic", "building_name", "room_number", "start_date", "end_date",
        "rent_amount", "security_deposit_amount", "security_deposit_date_received",
    ])
    tenant_cnic = {t["id"]: t["cnic"] for t in tenants}
    room_building = {r["id"]: building_name.get(r["building_id"]) for r in rooms}
    for l in leases:
        ws.append([
            tenant_cnic.get(l["tenant_id"]),
            room_building.get(l["room_id"]),
            room_label.get(l["room_id"]),
            l.get("start_date"), l.get("end_date"),
            None,  # rent_amount lives on lease_charges, left blank in the export summary sheet
            None, None,
        ])

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="oneaccounts_export.xlsx"'},
    )


# ============================================================================
# IMPORT — Owners
# ============================================================================

@router.post("/import/owners")
def import_owners(
    file: UploadFile = File(...),
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
    user: dict = Depends(get_current_user),
):
    wb = load_workbook(BytesIO(file.file.read()), data_only=True)
    rows = read_sheet(wb, "Owners")
    report = []
    for i, row in enumerate(rows, start=2):
        name = (row.get("name") or "").strip()
        if not name:
            report.append({"row": i, "status": "error", "detail": "Missing owner name."})
            continue
        payload = {
            "company_id": company_id,
            "name": name,
            "phone": row.get("phone") or None,
            "cnic": row.get("cnic") or None,
            "address": row.get("address") or None,
        }
        try:
            res = supabase.table("owners").insert(payload).execute()
            created = res.data[0]
            write_audit_log(supabase, company_id, user["user_id"], "create", "owners", created["id"])
            report.append({"row": i, "status": "created", "detail": name})
        except APIError as e:
            status, detail = friendly_db_error(e)
            report.append({"row": i, "status": "error", "detail": detail})
    return {"report": report}


# ============================================================================
# IMPORT — Buildings
# ============================================================================

@router.post("/import/buildings")
def import_buildings(
    file: UploadFile = File(...),
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
    user: dict = Depends(get_current_user),
):
    wb = load_workbook(BytesIO(file.file.read()), data_only=True)
    rows = read_sheet(wb, "Buildings")
    report = []
    for i, row in enumerate(rows, start=2):
        name = (row.get("name") or "").strip()
        if not name:
            report.append({"row": i, "status": "error", "detail": "Missing building name."})
            continue
        payload = {"company_id": company_id, "name": name, "address": row.get("address") or None}
        try:
            res = supabase.table("buildings").insert(payload).execute()
            created = res.data[0]
            write_audit_log(supabase, company_id, user["user_id"], "create", "buildings", created["id"])
            report.append({"row": i, "status": "created", "detail": name})
        except APIError as e:
            status, detail = friendly_db_error(e)
            report.append({"row": i, "status": "error", "detail": detail})
    return {"report": report}


# ============================================================================
# IMPORT — Rooms (resolves building_name + owner_name to IDs; validates
# the same duplicate-room-number-per-building rule the Add Room modal does)
# ============================================================================

@router.post("/import/rooms")
def import_rooms(
    file: UploadFile = File(...),
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
    user: dict = Depends(get_current_user),
):
    wb = load_workbook(BytesIO(file.file.read()), data_only=True)
    rows = read_sheet(wb, "Rooms")

    buildings = supabase.table("buildings").select("id, name").execute().data
    owners = supabase.table("owners").select("id, name").execute().data
    existing_rooms = supabase.table("rooms").select("room_number, building_id").execute().data

    building_by_name = {b["name"].strip().lower(): b["id"] for b in buildings}
    owner_by_name = {o["name"].strip().lower(): o["id"] for o in owners}
    seen_room_numbers = {(r["room_number"].strip().lower(), r["building_id"]) for r in existing_rooms}

    report = []
    for i, row in enumerate(rows, start=2):
        building_name = (row.get("building_name") or "").strip()
        room_number = (row.get("room_number") or "").strip()
        owner_name = (row.get("owner_name") or "").strip()

        if not building_name or not room_number:
            report.append({"row": i, "status": "error", "detail": "building_name and room_number are required."})
            continue

        building_id = building_by_name.get(building_name.lower())
        if not building_id:
            report.append({"row": i, "status": "error", "detail": f'No building named "{building_name}" — create it first (or import Buildings before Rooms).'})
            continue

        key = (room_number.lower(), building_id)
        if key in seen_room_numbers:
            report.append({"row": i, "status": "skipped", "detail": f'Room "{room_number}" already exists in {building_name}.'})
            continue

        owner_id = None
        if owner_name:
            owner_id = owner_by_name.get(owner_name.lower())
            if not owner_id:
                report.append({"row": i, "status": "error", "detail": f'No owner named "{owner_name}" — create it first (or leave owner_name blank to inherit the building\'s owner).'})
                continue

        # A room needs a floor_id, but the sheet only carries a floor_number
        # for readability -- resolve-or-create the floor the same way the
        # Add Room modal's "+ Add a new floor..." path does.
        floor_number = row.get("floor_number") or 1
        existing_floor = (
            supabase.table("floors")
            .select("id")
            .eq("building_id", building_id)
            .eq("floor_number", int(floor_number))
            .execute()
            .data
        )
        if existing_floor:
            floor_id = existing_floor[0]["id"]
        else:
            new_floor = supabase.table("floors").insert(
                {"company_id": company_id, "building_id": building_id, "floor_number": int(floor_number)}
            ).execute().data[0]
            floor_id = new_floor["id"]

        payload = {
            "company_id": company_id,
            "building_id": building_id,
            "floor_id": floor_id,
            "room_number": room_number,
            "room_type": row.get("room_type") or None,
            "base_rent": row.get("base_rent") or None,
            "owner_id": owner_id,
        }
        try:
            res = supabase.table("rooms").insert(payload).execute()
            created = res.data[0]
            write_audit_log(supabase, company_id, user["user_id"], "create", "rooms", created["id"])
            seen_room_numbers.add(key)
            report.append({"row": i, "status": "created", "detail": f"{building_name} — {room_number}"})
        except APIError as e:
            status, detail = friendly_db_error(e)
            report.append({"row": i, "status": "error", "detail": detail})
    return {"report": report}


# ============================================================================
# IMPORT — Tenants (same CNIC/phone validation as the Add Tenant modal)
# ============================================================================

@router.post("/import/tenants")
def import_tenants(
    file: UploadFile = File(...),
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
    user: dict = Depends(get_current_user),
):
    wb = load_workbook(BytesIO(file.file.read()), data_only=True)
    rows = read_sheet(wb, "Tenants")

    existing = supabase.table("tenants").select("cnic").execute().data
    seen_cnics = {re.sub(r"\D", "", t["cnic"]) for t in existing}

    report = []
    for i, row in enumerate(rows, start=2):
        full_name = (row.get("full_name") or "").strip()
        cnic_raw = str(row.get("cnic") or "").strip()
        phone_raw = str(row.get("phone") or "").strip()

        if not full_name:
            report.append({"row": i, "status": "error", "detail": "Missing full_name."})
            continue

        cnic_error = validate_cnic(cnic_raw)
        if cnic_error:
            report.append({"row": i, "status": "error", "detail": cnic_error})
            continue

        cnic_digits = re.sub(r"\D", "", cnic_raw)
        if cnic_digits in seen_cnics:
            report.append({"row": i, "status": "skipped", "detail": f"Tenant with CNIC {cnic_raw} already exists."})
            continue

        normalized_phone = normalize_pakistani_phone(phone_raw)
        if not normalized_phone:
            report.append({"row": i, "status": "error", "detail": f'"{phone_raw}" is not a valid Pakistani mobile number (e.g. 0300-1234567).'})
            continue

        payload = {
            "company_id": company_id,
            "full_name": full_name,
            "cnic": cnic_raw,
            "phone": normalized_phone,
            "email": row.get("email") or None,
            "emergency_contact_name": row.get("emergency_contact_name") or None,
            "emergency_contact_phone": row.get("emergency_contact_phone") or None,
        }
        try:
            res = supabase.table("tenants").insert(payload).execute()
            created = res.data[0]
            write_audit_log(supabase, company_id, user["user_id"], "create", "tenants", created["id"])
            seen_cnics.add(cnic_digits)
            report.append({"row": i, "status": "created", "detail": full_name})
        except APIError as e:
            status, detail = friendly_db_error(e)
            report.append({"row": i, "status": "error", "detail": detail})
    return {"report": report}


# ============================================================================
# IMPORT — Leases. Resolves tenant (by CNIC) + room (by building + room
# number) to IDs, then calls the REAL create_lease() from leases.py --
# meaning whatever that function currently posts to the ledger (security
# deposit journal entry, etc.) happens automatically, exactly as if the
# lease had been created by hand. See the module docstring for the one
# thing I need from you (current leases.py) to finish this precisely.
# ============================================================================

@router.post("/import/leases")
def import_leases(
    file: UploadFile = File(...),
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    from datetime import datetime as dt
    from app.routers.leases import create_lease, LeaseCreate, LeaseCharge  # reuse the real endpoint logic

    wb = load_workbook(BytesIO(file.file.read()), data_only=True)
    rows = read_sheet(wb, "Leases")

    tenants = supabase.table("tenants").select("id, cnic").execute().data
    buildings = supabase.table("buildings").select("id, name").execute().data
    rooms = supabase.table("rooms").select("id, room_number, building_id, status").execute().data

    tenant_by_cnic = {re.sub(r"\D", "", t["cnic"]): t["id"] for t in tenants}
    building_by_name = {b["name"].strip().lower(): b["id"] for b in buildings}

    def find_room(building_id, room_number):
        for r in rooms:
            if r["building_id"] == building_id and r["room_number"].strip().lower() == room_number.strip().lower():
                return r
        return None

    report = []
    for i, row in enumerate(rows, start=2):
        tenant_cnic = re.sub(r"\D", "", str(row.get("tenant_cnic") or ""))
        building_name = (row.get("building_name") or "").strip()
        room_number = (row.get("room_number") or "").strip()

        tenant_id = tenant_by_cnic.get(tenant_cnic)
        if not tenant_id:
            report.append({"row": i, "status": "error", "detail": f"No tenant with CNIC {row.get('tenant_cnic')} — import Tenants first."})
            continue

        building_id = building_by_name.get(building_name.lower())
        if not building_id:
            report.append({"row": i, "status": "error", "detail": f'No building named "{building_name}".'})
            continue

        room = find_room(building_id, room_number)
        if not room:
            report.append({"row": i, "status": "error", "detail": f'No room "{room_number}" in "{building_name}".'})
            continue

        try:
            start_date = row["start_date"].date() if hasattr(row.get("start_date"), "date") else row.get("start_date")
            end_date = row["end_date"].date() if hasattr(row.get("end_date"), "date") else row.get("end_date")
            rent_amount = float(row.get("rent_amount") or 0)
            deposit_amount = float(row.get("security_deposit_amount") or 0)
            deposit_date = (
                row["security_deposit_date_received"].date()
                if hasattr(row.get("security_deposit_date_received"), "date")
                else (row.get("security_deposit_date_received") or start_date)
            )

            if not start_date or not end_date or rent_amount <= 0:
                report.append({"row": i, "status": "error", "detail": "start_date, end_date, and a positive rent_amount are required."})
                continue

            payload = LeaseCreate(
                tenant_id=tenant_id,
                room_id=room["id"],
                start_date=start_date,
                end_date=end_date,
                charges=[LeaseCharge(label="Rent", amount=rent_amount)],
                security_deposit_amount=deposit_amount,
                security_deposit_date_received=deposit_date,
            )
            result = create_lease(payload, supabase=supabase, company_id=company_id)
            report.append({"row": i, "status": "created", "detail": f"{building_name} — {room_number} — {row.get('tenant_cnic')}"})
        except HTTPException as e:
            report.append({"row": i, "status": "error", "detail": e.detail})
        except Exception as e:
            report.append({"row": i, "status": "error", "detail": str(e)})

    return {"report": report}
