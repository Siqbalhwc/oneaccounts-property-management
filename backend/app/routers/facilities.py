"""
Facility specs -- the details of what a tenant has actually opted into.

A lease's *charges* say what a tenant pays for (Parking, Internet, ...).
This router records the specifics behind each: the vehicle/card number for
parking, the allowed speed for internet, meter number and allowed units for
electricity/water/gas, or free-form fields for anything else.

One row = one spec entry. A tenant with two vehicles has two Parking rows.
Specs are stored as jsonb so any facility, including custom ones, can carry
its own fields without another schema change.

Who may do what (central policy in app/core/access.py -- these are NOT in the
accountant's allowed-writes list, so the default rules apply):
  * Owner / Admin   create, edit, end
  * Accountant      view only
  * Auditor         view only

Nothing is hard-deleted: "ending" a facility keeps the record with an end date.
"""

import re
from datetime import date
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from supabase import Client

from app.core.deps import get_current_company_id, get_current_user, get_supabase
from app.crud.generic import write_audit_log

router = APIRouter(prefix="/facilities", tags=["Facilities"])

KINDS = ("parking", "internet", "electricity", "water", "gas", "other")

# Single source of truth for the fields each facility kind asks for. The
# frontend renders its forms from GET /facilities/templates, and the report
# uses the same labels, so the two can never drift apart.
TEMPLATES: Dict[str, Dict[str, Any]] = {
    "parking": {
        "label": "Parking",
        "hint": "Add one entry per vehicle. At least a vehicle number or card number is needed.",
        "fields": [
            {"key": "vehicle_type", "label": "Vehicle type", "type": "select", "options": ["Car", "Motorbike", "Bicycle", "Other"]},
            {"key": "vehicle_number", "label": "Vehicle number", "type": "text", "placeholder": "e.g. LEA-1234"},
            {"key": "card_number", "label": "Parking card number", "type": "text"},
            {"key": "slot", "label": "Slot / bay", "type": "text"},
        ],
    },
    "internet": {
        "label": "Internet",
        "hint": "Allowed speed is required.",
        "fields": [
            {"key": "speed_mbps", "label": "Allowed speed", "type": "number", "unit": "Mbps"},
            {"key": "connection_id", "label": "Connection / account ID", "type": "text"},
            {"key": "router_serial", "label": "Router serial", "type": "text"},
        ],
    },
    "electricity": {
        "label": "Electricity",
        "hint": "Meter number and the units the tenant may consume per month.",
        "fields": [
            {"key": "meter_number", "label": "Meter number", "type": "text"},
            {"key": "allowed_units", "label": "Allowed units", "type": "number", "unit": "units / month"},
            {"key": "opening_reading", "label": "Opening reading", "type": "number"},
        ],
    },
    "water": {
        "label": "Water",
        "hint": "Meter number and the units the tenant may consume per month.",
        "fields": [
            {"key": "meter_number", "label": "Meter number", "type": "text"},
            {"key": "allowed_units", "label": "Allowed units", "type": "number", "unit": "units / month"},
            {"key": "opening_reading", "label": "Opening reading", "type": "number"},
        ],
    },
    "gas": {
        "label": "Gas",
        "hint": "Meter number and the units the tenant may consume per month.",
        "fields": [
            {"key": "meter_number", "label": "Meter number", "type": "text"},
            {"key": "allowed_units", "label": "Allowed units", "type": "number", "unit": "units / month"},
            {"key": "opening_reading", "label": "Opening reading", "type": "number"},
        ],
    },
    "other": {
        "label": "Other facility",
        "hint": "Describe it in your own fields below (e.g. generator: 5 kVA, locker: L-12).",
        "fields": [],
    },
}

NUMERIC_KEYS = {"speed_mbps", "allowed_units", "opening_reading"}
UPPERCASE_KEYS = {"vehicle_number", "card_number"}
MAX_SPEC_KEYS = 20
MAX_VALUE_LEN = 200
_KEY_RE = re.compile(r"^[A-Za-z0-9 _.\-]{1,40}$")


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class FacilityCreate(BaseModel):
    lease_id: str
    label: str                      # e.g. "Parking" -- usually the lease charge it belongs to
    specs: Dict[str, Any] = {}
    notes: Optional[str] = None


class FacilityEdit(BaseModel):
    label: Optional[str] = None
    specs: Optional[Dict[str, Any]] = None
    notes: Optional[str] = None


class FacilityEnd(BaseModel):
    ended_on: Optional[date] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def classify_label(label: str) -> str:
    l = (label or "").lower()
    if "park" in l:
        return "parking"
    if any(w in l for w in ("internet", "wifi", "wi-fi", "broadband")):
        return "internet"
    if any(w in l for w in ("electric", "power")):
        return "electricity"
    if "water" in l:
        return "water"
    if "gas" in l:
        return "gas"
    return "other"


def _humanize(key: str) -> str:
    for t in TEMPLATES.values():
        for f in t["fields"]:
            if f["key"] == key:
                return f["label"]
    return key.replace("_", " ").strip().capitalize()


def normalize_specs(kind: str, specs: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(specs, dict):
        raise HTTPException(status_code=400, detail="Specs must be a set of field/value pairs.")
    out: Dict[str, Any] = {}
    for raw_key, raw_val in specs.items():
        key = str(raw_key).strip()
        if not _KEY_RE.match(key):
            raise HTTPException(
                status_code=400,
                detail=f"Field name '{key}' isn't allowed (letters, numbers, spaces, - _ . only, up to 40 characters).",
            )
        if raw_val is None or (isinstance(raw_val, str) and not raw_val.strip()):
            continue  # blank fields are simply not stored
        if isinstance(raw_val, (dict, list, bool)):
            raise HTTPException(status_code=400, detail=f"'{_humanize(key)}' must be plain text or a number.")

        if key in NUMERIC_KEYS:
            try:
                num = float(str(raw_val).replace(",", "").strip())
            except ValueError:
                raise HTTPException(status_code=400, detail=f"'{_humanize(key)}' must be a number.")
            if num < 0 or (key == "speed_mbps" and num == 0):
                raise HTTPException(status_code=400, detail=f"'{_humanize(key)}' must be greater than zero." if key == "speed_mbps" else f"'{_humanize(key)}' can't be negative.")
            out[key] = int(num) if num == int(num) else num
            continue

        text = re.sub(r"\s+", " ", str(raw_val)).strip()
        if len(text) > MAX_VALUE_LEN:
            raise HTTPException(status_code=400, detail=f"'{_humanize(key)}' is too long (max {MAX_VALUE_LEN} characters).")
        out[key] = text.upper() if key in UPPERCASE_KEYS else text

    if len(out) > MAX_SPEC_KEYS:
        raise HTTPException(status_code=400, detail=f"Too many fields (max {MAX_SPEC_KEYS}).")
    return out


def validate_for_kind(kind: str, specs: Dict[str, Any], notes: Optional[str]) -> None:
    if kind == "parking" and not (specs.get("vehicle_number") or specs.get("card_number")):
        raise HTTPException(status_code=400, detail="Parking needs at least a vehicle number or a card number.")
    if kind == "internet" and "speed_mbps" not in specs:
        raise HTTPException(status_code=400, detail="Internet needs the allowed speed (Mbps).")
    if not specs and not (notes or "").strip():
        raise HTTPException(status_code=400, detail="Add at least one detail or a note for this facility.")


def _check_parking_duplicates(supabase: Client, specs: Dict[str, Any], exclude_id: Optional[str] = None) -> None:
    """A vehicle or parking card can't belong to two active tenants at once."""
    for key, what in (("vehicle_number", "vehicle"), ("card_number", "parking card")):
        value = specs.get(key)
        if not value:
            continue
        rows = (
            supabase.table("lease_facilities")
            .select("id, tenant_id")
            .eq("kind", "parking")
            .eq("is_active", True)
            .eq(f"specs->>{key}", value)
            .execute()
            .data
        )
        rows = [r for r in rows if r["id"] != exclude_id]
        if rows:
            t = supabase.table("tenants").select("full_name").eq("id", rows[0]["tenant_id"]).execute().data
            who = t[0]["full_name"] if t else "another tenant"
            raise HTTPException(status_code=409, detail=f"This {what} ({value}) is already registered to {who}.")


def _clean_notes(notes: Optional[str]) -> Optional[str]:
    notes = (notes or "").strip()
    if len(notes) > 1000:
        raise HTTPException(status_code=400, detail="Notes are too long (max 1000 characters).")
    return notes or None


def _display_specs(kind: str, specs: Dict[str, Any]) -> list[dict]:
    fields = {f["key"]: f for f in TEMPLATES.get(kind, {}).get("fields", [])}
    # known fields first in their template order, then any custom ones
    ordered = [k for k in fields if k in specs] + [k for k in specs if k not in fields]
    out = []
    for k in ordered:
        f = fields.get(k)
        out.append({"label": f["label"] if f else _humanize(k), "value": specs[k], "unit": (f or {}).get("unit")})
    return out


# ---------------------------------------------------------------------------
# Read endpoints (static paths first, before "/{facility_id}")
# ---------------------------------------------------------------------------
@router.get("/templates")
def templates():
    return {"kinds": TEMPLATES}


@router.get("/register")
def register(
    building_id: Optional[str] = Query(None),
    kind: Optional[str] = Query(None),
    search: Optional[str] = Query(None, description="Tenant, room, vehicle/card/meter number, anything in the specs"),
    include_ended: bool = Query(False),
    supabase: Client = Depends(get_supabase),
):
    """Facilities register across all tenants -- e.g. every vehicle in the
    building for the guards, every internet connection and its speed, every
    meter. Visibility comes from the caller's own RLS-scoped client, so a
    building-restricted user only sees facilities on leases they can see."""
    if kind and kind not in KINDS:
        raise HTTPException(status_code=400, detail="Unknown facility type.")

    query = supabase.table("lease_facilities").select("*")
    if kind:
        query = query.eq("kind", kind)
    if not include_ended:
        query = query.eq("is_active", True)
    facilities = query.order("created_at", desc=False).execute().data

    leases = {l["id"]: l for l in supabase.table("leases").select("id, status, tenant_id, room_id").execute().data}
    rooms = {r["id"]: r for r in supabase.table("rooms").select("id, room_number, building_id").execute().data}
    buildings = {b["id"]: b for b in supabase.table("buildings").select("id, name").execute().data}
    tenant_ids = sorted({f["tenant_id"] for f in facilities})
    tenants: dict[str, dict] = {}
    for i in range(0, len(tenant_ids), 100):
        for t in supabase.table("tenants").select("id, full_name, phone").in_("id", tenant_ids[i : i + 100]).execute().data:
            tenants[t["id"]] = t

    q = (search or "").strip().lower()
    rows = []
    for f in facilities:
        lease = leases.get(f["lease_id"])
        if not lease:
            continue  # lease not visible to this user (building scope) -> neither is its facility
        room = rooms.get(f["room_id"], {})
        if building_id and room.get("building_id") != building_id:
            continue
        building = buildings.get(room.get("building_id"), {})
        tenant = tenants.get(f["tenant_id"], {})
        display = _display_specs(f["kind"], f.get("specs") or {})
        if q:
            hay = " ".join(
                [
                    tenant.get("full_name") or "",
                    str(room.get("room_number") or ""),
                    building.get("name") or "",
                    f.get("label") or "",
                    f.get("notes") or "",
                    *[str(d["value"]) for d in display],
                ]
            ).lower()
            if q not in hay:
                continue
        rows.append(
            {
                **f,
                "specs_display": display,
                "tenant_name": tenant.get("full_name"),
                "tenant_phone": tenant.get("phone"),
                "room_number": room.get("room_number"),
                "building_id": room.get("building_id"),
                "building_name": building.get("name"),
                "lease_status": lease.get("status"),
            }
        )
    rows.sort(key=lambda r: ((r["building_name"] or "").lower(), str(r["room_number"] or ""), r["label"] or ""))
    counts = {k: sum(1 for r in rows if r["kind"] == k) for k in KINDS}
    return {"rows": rows, "total": len(rows), "counts_by_kind": counts}


@router.get("")
def list_facilities(
    lease_id: Optional[str] = Query(None),
    tenant_id: Optional[str] = Query(None),
    kind: Optional[str] = Query(None),
    include_ended: bool = Query(False),
    supabase: Client = Depends(get_supabase),
):
    query = supabase.table("lease_facilities").select("*")
    if lease_id:
        query = query.eq("lease_id", lease_id)
    if tenant_id:
        query = query.eq("tenant_id", tenant_id)
    if kind:
        query = query.eq("kind", kind)
    if not include_ended:
        query = query.eq("is_active", True)
    rows = query.order("created_at", desc=False).execute().data
    for r in rows:
        r["specs_display"] = _display_specs(r["kind"], r.get("specs") or {})
    return rows


# ---------------------------------------------------------------------------
# Write endpoints (Owner / Admin)
# ---------------------------------------------------------------------------
@router.post("", status_code=201)
def create_facility(
    payload: FacilityCreate,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
    user: dict = Depends(get_current_user),
):
    label = (payload.label or "").strip()
    if not label or len(label) > 60:
        raise HTTPException(status_code=400, detail="Facility name is required (max 60 characters).")

    lease = supabase.table("leases").select("id, tenant_id, room_id, status").eq("id", payload.lease_id).execute().data
    if not lease:
        raise HTTPException(status_code=404, detail="Lease not found.")
    lease = lease[0]
    if lease["status"] != "active":
        raise HTTPException(status_code=400, detail="Facilities can only be added to an active lease.")

    kind = classify_label(label)
    specs = normalize_specs(kind, payload.specs)
    notes = _clean_notes(payload.notes)
    validate_for_kind(kind, specs, notes)
    if kind == "parking":
        _check_parking_duplicates(supabase, specs)

    res = (
        supabase.table("lease_facilities")
        .insert(
            {
                "company_id": company_id,
                "lease_id": lease["id"],
                "tenant_id": lease["tenant_id"],
                "room_id": lease["room_id"],
                "label": label,
                "kind": kind,
                "specs": specs,
                "notes": notes,
                "created_by": user["user_id"],
            }
        )
        .execute()
    )
    created = res.data[0]
    write_audit_log(supabase, company_id, user["user_id"], "create", "lease_facilities", created["id"])
    created["specs_display"] = _display_specs(kind, specs)
    return created


@router.patch("/{facility_id}")
def edit_facility(
    facility_id: str,
    payload: FacilityEdit,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
    user: dict = Depends(get_current_user),
):
    before = supabase.table("lease_facilities").select("*").eq("id", facility_id).execute().data
    if not before:
        raise HTTPException(status_code=404, detail="Not found")
    before = before[0]
    if not before["is_active"]:
        raise HTTPException(status_code=400, detail="This facility has ended; the record is read-only.")

    data = payload.model_dump(exclude_unset=True)
    label = before["label"]
    if "label" in data:
        label = (data["label"] or "").strip()
        if not label or len(label) > 60:
            raise HTTPException(status_code=400, detail="Facility name is required (max 60 characters).")
    kind = classify_label(label)
    specs = normalize_specs(kind, data["specs"]) if "specs" in data else (before.get("specs") or {})
    notes = _clean_notes(data["notes"]) if "notes" in data else before.get("notes")
    validate_for_kind(kind, specs, notes)
    if kind == "parking":
        _check_parking_duplicates(supabase, specs, exclude_id=facility_id)

    res = (
        supabase.table("lease_facilities")
        .update({"label": label, "kind": kind, "specs": specs, "notes": notes})
        .eq("id", facility_id)
        .execute()
    )
    after = res.data[0]
    write_audit_log(supabase, company_id, user["user_id"], "update", "lease_facilities", facility_id, before, after)
    after["specs_display"] = _display_specs(kind, specs)
    return after


@router.post("/{facility_id}/end")
def end_facility(
    facility_id: str,
    payload: FacilityEnd,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
    user: dict = Depends(get_current_user),
):
    """Stops a facility (tenant gave up the parking spot, sold the car...).
    The record stays, with an end date, rather than being deleted."""
    before = supabase.table("lease_facilities").select("*").eq("id", facility_id).execute().data
    if not before:
        raise HTTPException(status_code=404, detail="Not found")
    if not before[0]["is_active"]:
        raise HTTPException(status_code=400, detail="This facility has already ended.")
    res = (
        supabase.table("lease_facilities")
        .update({"is_active": False, "ended_on": str(payload.ended_on or date.today())})
        .eq("id", facility_id)
        .execute()
    )
    after = res.data[0]
    write_audit_log(supabase, company_id, user["user_id"], "end", "lease_facilities", facility_id, before[0], after)
    return after
