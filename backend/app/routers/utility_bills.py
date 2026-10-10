"""
app/routers/utility_bills.py

Monthly bill-basis charges (electricity, water, gas, ...) from Excel.
All logic lives in services/utility_upload.py and services/utility_bills.py;
this file only wires the endpoints, the permission checks and the response
shapes.

Permissions
  * Every endpoint requires the "utility_bills" feature (on by default; a
    platform admin can switch it off per company in Tower).
  * Preview and Save require owner/admin, even when the optional Access
    Control feature is off. With Access Control on, accountants and
    auditors are also refused every POST by the central policy table.
  * Every query runs through the caller's own RLS-scoped client, so only the
    caller's own company (and, for building-scoped users, their buildings)
    can ever be read or written.
"""

from datetime import date
from io import BytesIO
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from supabase import Client

from app.core.deps import (
    get_current_company_id,
    get_current_user,
    get_supabase,
    require_feature,
    require_owner_or_admin,
)
from app.services.invoice_batch import fetch_all, fetch_in
from app.services.room_search import split_terms
from app.services.utility_upload import (
    build_template,
    commit_upload,
    evaluate_upload,
    month_start,
    parse_month_value,
    public_rows,
    read_upload,
)

router = APIRouter(prefix="/utility-bills", tags=["Utility bills"])


def _month(value: str) -> date:
    try:
        parsed = parse_month_value(value)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if parsed is None:
        raise HTTPException(status_code=400, detail="Please choose the bill month.")
    return month_start(parsed)


@router.get("/template")
def download_template(
    month: str = Query(..., description="Bill month, e.g. 2026-10"),
    building_id: Optional[str] = Query(None),
    supabase: Client = Depends(get_supabase),
    _feature: None = Depends(require_feature("utility_bills")),
):
    bill_month = _month(month)
    content = build_template(supabase, bill_month, building_id)
    return StreamingResponse(
        BytesIO(content),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="utility_bills_{bill_month.strftime("%Y_%m")}.xlsx"'},
    )


@router.post("/preview")
def preview_upload(
    month: str = Form(...),
    file: UploadFile = File(...),
    supabase: Client = Depends(get_supabase),
    _admin: None = Depends(require_owner_or_admin),
    _feature: None = Depends(require_feature("utility_bills")),
):
    """Reads the file and reports what WOULD happen. Writes nothing."""
    bill_month = _month(month)
    rows = read_upload(file.file.read())
    ev = evaluate_upload(supabase, rows, bill_month)
    return {
        "month": str(bill_month),
        "summary": ev["summary"],
        "rows": public_rows(ev["rows"]),
        "savable": ev["summary"]["update"] + ev["summary"]["stored"],
    }


@router.post("/commit")
def commit_bills(
    month: str = Form(...),
    start: int = Form(0),
    file: UploadFile = File(...),
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
    user: dict = Depends(get_current_user),
    _admin: None = Depends(require_owner_or_admin),
    _feature: None = Depends(require_feature("utility_bills")),
):
    """
    Saves the valid rows and recalculates the affected draft/sent invoices.
    If the file is too big to finish inside one request, `next_start` is set:
    send the same file again with start=next_start to continue.
    """
    bill_month = _month(month)
    if start < 0:
        raise HTTPException(status_code=400, detail="start cannot be negative.")
    rows = read_upload(file.file.read())
    return commit_upload(supabase, company_id, user["user_id"], rows, bill_month, start=start)


@router.get("")
def list_bills(
    month: str = Query(...),
    building_id: Optional[str] = Query(None),
    search: Optional[str] = Query(None, max_length=200, description="Building, apartment, tenant or utility"),
    supabase: Client = Depends(get_supabase),
    _feature: None = Depends(require_feature("utility_bills")),
):
    """Saved bills for one month, with the building, room and invoice status.

    `search` is purely additive: every word typed must appear in the row's
    building, apartment, tenant, utility or bill reference, so "Sunrise 101"
    finds apartment 101 in Sunrise. Omit it and nothing changes."""
    bill_month = _month(month)
    search_terms = [t.lower() for t in split_terms(search)]
    bills = fetch_all(
        lambda: supabase.table("utility_bills").select("*").eq("bill_month", str(bill_month)).order("id")
    )
    if not bills:
        return []
    lease_ids = list({b["lease_id"] for b in bills})
    leases = {l["id"]: l for l in fetch_in(supabase, "leases", "id, room_id, tenant_id", "id", lease_ids)}
    rooms = {
        r["id"]: r
        for r in fetch_in(supabase, "rooms", "id, room_number, building_id", "id", list({l["room_id"] for l in leases.values()}))
    }
    buildings = {
        b["id"]: b["name"]
        for b in fetch_in(supabase, "buildings", "id, name", "id", list({r["building_id"] for r in rooms.values() if r.get("building_id")}))
    }
    tenants = {t["id"]: t["full_name"] for t in fetch_in(supabase, "tenants", "id, full_name", "id", list({l["tenant_id"] for l in leases.values()}))}
    invoices = {
        i["lease_id"]: i["status"]
        for i in fetch_in(
            supabase, "invoices", "id, lease_id, status", "lease_id", lease_ids,
            extra=lambda q: q.eq("invoice_month", str(bill_month)),
        )
    }

    out = []
    for b in bills:
        lease = leases.get(b["lease_id"])
        if lease is None:
            continue  # a lease this user may not see (building scope): its bill is hidden too
        room = rooms.get(lease["room_id"]) or {}
        if building_id and room.get("building_id") != building_id:
            continue
        if search_terms:
            haystack = " ".join(
                str(x or "")
                for x in (
                    buildings.get(room.get("building_id"), ""),
                    room.get("room_number", ""),
                    tenants.get(lease["tenant_id"], ""),
                    b["label"],
                    b.get("bill_reference"),
                )
            ).lower()
            if not all(t in haystack for t in search_terms):
                continue
        out.append(
            {
                "id": b["id"],
                "building": buildings.get(room.get("building_id"), ""),
                "room": room.get("room_number", ""),
                "tenant": tenants.get(lease["tenant_id"], ""),
                "utility": b["label"],
                "amount": float(b["amount"]),
                "bill_reference": b.get("bill_reference"),
                "invoice_status": invoices.get(b["lease_id"]),
                "saved_at": b.get("updated_at") or b.get("created_at"),
            }
        )
    out.sort(key=lambda r: (r["building"], str(r["room"]), r["utility"]))
    return out
