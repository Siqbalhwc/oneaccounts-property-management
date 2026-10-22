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
from datetime import date
from io import BytesIO
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.worksheet.worksheet import Worksheet
from supabase import Client

from app.core.deps import get_current_company_id, get_current_user, get_supabase, require_owner_or_admin
from app.crud.generic import write_audit_log, friendly_db_error
from postgrest.exceptions import APIError
from app.services.invoice_batch import fetch_all
from app.services.ledger import JournalLine, UnbalancedJournalEntry, post_journal_entry
from app.services.invoicing import resync_current_month_invoice
from app.services.utility_bills import label_key

router = APIRouter(prefix="/data-transfer", tags=["Import / Export"])

ENTITY_SHEETS = ["Owners", "Buildings", "Rooms", "Tenants", "Leases"]
ENTITY_KEY_TO_SHEET = {
    "owners": "Owners",
    "buildings": "Buildings",
    "rooms": "Rooms",
    "tenants": "Tenants",
    "leases": "Leases",
}


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


def cell_str(value: Any) -> str:
    """
    Safely turns any Excel cell value into a stripped string, for columns a
    person would normally type text into (a name, a room number, a CNIC).
    Excel silently stores a cell like "301" as a number if it wasn't
    explicitly formatted as text -- openpyxl then hands that back as a
    Python int/float, not a str, and every import here used to do
    `(row.get("x") or "").strip()`, which crashes with an unhandled
    AttributeError the instant it hits one of those cells (ints/floats have
    no .strip()). Since that crash sat outside every row's try/except, it
    didn't just fail that one row -- it took down the entire import, for
    every row, with no readable error at all. This is the one place that
    conversion happens, so every import shares the same safe behavior:
    a whole-number float (301.0) becomes "301", not "301.0".
    """
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


# ============================================================================
# Charge columns on the Leases sheet.
#
# A lease can carry many charges (Rent, Parking, Internet, Service, ...).
# Besides rent_amount, ANY column headed  "charge: <Label>"  is read as one
# more charge on that lease -- e.g. "charge: Parking", "charge: Internet".
# Add "(one_time)" to the header for a one-off charge, e.g.
# "charge: Commission (one_time)". A blank or 0 cell means "no such charge
# on this lease". The label is what posts to the ledger, through the
# company's own charge_type_accounts mapping -- exactly like a charge typed
# on the New Lease form.
# ============================================================================

CHARGE_COL_RE = re.compile(r"^\s*charge\s*:\s*(.+?)\s*$", re.IGNORECASE)
ONE_TIME_RE = re.compile(r"\s*\(\s*one[_\- ]?time\s*\)\s*$", re.IGNORECASE)
DEFAULT_CHARGE_LABELS = ["Parking", "Internet", "Service Charges"]


def charge_identity(label: str) -> str:
    """Same-charge test that ignores case, spacing, 'bill', 'charge(s)' and a
    trailing plural s -- so 'Gas' and 'Gas Bill', or 'Service' and 'Service
    Charges', count as ONE charge and are never added twice."""
    words = label_key(label).replace("&", " & ").split()
    out = []
    for w in words:
        if w in ("charge", "charges"):
            continue
        if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
            w = w[:-1]
        out.append(w)
    return " ".join(out) or label_key(label)


def parse_charge_columns(headers) -> List[Dict[str, str]]:
    """[{header, label, recurrence}] for every 'charge: ...' column, in sheet order."""
    cols: List[Dict[str, str]] = []
    seen = set()
    for h in headers:
        m = CHARGE_COL_RE.match(str(h or ""))
        if not m:
            continue
        label = m.group(1).strip()
        recurrence = "recurring"
        ot = ONE_TIME_RE.search(label)
        if ot:
            recurrence = "one_time"
            label = label[: ot.start()].strip()
        if not label or charge_identity(label) in seen:
            continue
        seen.add(charge_identity(label))
        cols.append({"header": h, "label": label, "recurrence": recurrence})
    return cols


def parse_amount(value: Any, what: str) -> float:
    if value is None or str(value).strip() == "":
        return 0.0
    try:
        amount = float(str(value).replace(",", "").strip())
    except ValueError:
        raise ValueError(f'"{what}" must be a number, found "{value}".')
    if amount < 0:
        raise ValueError(f'"{what}" cannot be negative.')
    return amount


def charges_from_row(row: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Rent (rent_amount) first, then every 'charge: ...' column with an
    amount above 0. Raises ValueError with a plain-English reason."""
    out: List[Dict[str, Any]] = []
    seen = set()
    rent = parse_amount(row.get("rent_amount"), "rent_amount")
    if rent > 0:
        out.append({"label": "Rent", "amount": rent, "recurrence": "recurring"})
        seen.add(charge_identity("Rent"))
    for col in parse_charge_columns(list(row.keys())):
        amount = parse_amount(row.get(col["header"]), col["header"])
        if amount <= 0:
            continue
        ident = charge_identity(col["label"])
        if ident in seen:
            raise ValueError(f'"{col["label"]}" is listed twice for this lease.')
        seen.add(ident)
        out.append({"label": col["label"], "amount": amount, "recurrence": col["recurrence"]})
    return out


def company_charge_labels(supabase: Client) -> List[str]:
    """The company's own charge heads (from charge_type_accounts, which RLS
    scopes to the caller's company), minus Rent, de-duplicated -- used to
    build the Leases template columns. Falls back to a short default list."""
    try:
        rows = supabase.table("charge_type_accounts").select("label").execute().data or []
    except Exception:
        rows = []
    labels: List[str] = []
    seen = {charge_identity("Rent")}
    for r in sorted(rows, key=lambda r: str(r.get("label") or "").lower()):
        label = str(r.get("label") or "").strip()
        if not label or charge_identity(label) in seen:
            continue
        seen.add(charge_identity(label))
        labels.append(label)
    return labels or list(DEFAULT_CHARGE_LABELS)


HEADER_FONT = Font(bold=True, color="FFFFFF")
HEADER_FILL = PatternFill("solid", fgColor="2F4F3E")  # matches the app's "ledger" green
NOTE_FONT = Font(italic=True, size=9, color="6B7280")


def style_header_row(ws: Worksheet, num_columns: int) -> None:
    for col in range(1, num_columns + 1):
        cell = ws.cell(row=1, column=col)
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
    ws.freeze_panes = "A2"


def autosize_columns(ws: Worksheet, widths: List[int]) -> None:
    for i, width in enumerate(widths, start=1):
        ws.column_dimensions[ws.cell(row=1, column=i).column_letter].width = width


# ============================================================================
# TEMPLATES — a ready-to-fill starting point per entity, with the exact
# column headers the importer expects, one realistic example row, and a
# second "Instructions" sheet spelling out the same validation rules the
# manual Add/Edit forms enforce. This is the single source of truth for
# column names -- if you add a column here, add the matching check in the
# import function below it, and vice versa.
# ============================================================================

def _build_owners_template(ws: Worksheet) -> None:
    ws.append(["name", "phone", "cnic", "address"])
    ws.append(["Mr Khan", "0300-1234567", "35202-1234567-1", "House 12, Model Town, Lahore"])
    style_header_row(ws, 4)
    autosize_columns(ws, [22, 16, 18, 32])


def _build_buildings_template(ws: Worksheet) -> None:
    ws.append(["name", "address"])
    ws.append(["Sunrise Heights", "Main Boulevard, Gulberg, Lahore"])
    style_header_row(ws, 2)
    autosize_columns(ws, [24, 36])


def _build_rooms_template(ws: Worksheet) -> None:
    ws.append(["building_name", "floor_number", "room_number", "room_type", "base_rent", "owner_name"])
    ws.append(["Sunrise Heights", 1, "A-101", "1-bed", 20000, ""])
    style_header_row(ws, 6)
    autosize_columns(ws, [20, 12, 14, 14, 12, 20])


def _build_tenants_template(ws: Worksheet) -> None:
    ws.append(["full_name", "cnic", "phone", "email", "address"])
    ws.append(["Bilal Ahmed", "35202-1234567-1", "0300-1234567", "bilal@example.com", "House 12, Model Town, Lahore"])
    style_header_row(ws, 5)
    autosize_columns(ws, [20, 18, 16, 24, 32])


def _build_leases_template(ws: Worksheet, charge_labels: Optional[List[str]] = None) -> None:
    labels = charge_labels or list(DEFAULT_CHARGE_LABELS)
    charge_headers = [f"charge: {label}" for label in labels]
    headers = (
        ["tenant_cnic", "building_name", "room_number", "start_date", "end_date", "rent_amount"]
        + charge_headers
        + ["security_deposit_amount", "security_deposit_date_received"]
    )
    ws.append(headers)
    example = ["35202-1234567-1", "Sunrise Heights", "A-101", "2026-01-01", "2026-12-31", 20000]
    example += [1500 if i == 0 else None for i in range(len(charge_headers))]
    example += [40000, "2026-01-01"]
    ws.append(example)
    style_header_row(ws, len(headers))
    autosize_columns(ws, [18, 20, 14, 14, 14, 14] + [max(14, len(h) + 2) for h in charge_headers] + [20, 26])


TEMPLATE_BUILDERS = {
    "Owners": _build_owners_template,
    "Buildings": _build_buildings_template,
    "Rooms": _build_rooms_template,
    "Tenants": _build_tenants_template,
    "Leases": _build_leases_template,
}

INSTRUCTIONS = [
    ("Owners", "name", "Required."),
    ("Owners", "phone, cnic, address", "Optional."),
    ("Buildings", "name", "Required."),
    ("Buildings", "address", "Optional."),
    ("Rooms", "building_name", "Required. Must exactly match an existing building's name -- import Buildings first if it doesn't exist yet."),
    ("Rooms", "room_number", "Required. Must be unique within that building (matches the Add Room rule) -- a duplicate is skipped, not an error."),
    ("Rooms", "floor_number", "Optional, defaults to 1. Created automatically if that floor doesn't exist yet."),
    ("Rooms", "owner_name", "Optional. Leave blank to inherit the building's owner. If filled, must exactly match an existing owner's name -- import Owners first."),
    ("Rooms", "room_type, base_rent", "Optional."),
    ("Tenants", "full_name", "Required."),
    ("Tenants", "cnic", "Required. Exactly 13 digits (dashes optional) -- e.g. 35202-1234567-1. Same rule as the Add Tenant form. Duplicate CNICs are skipped, not an error."),
    ("Tenants", "phone", "Required. A valid Pakistani mobile number -- e.g. 0300-1234567 (11 digits starting with 0) or 3001234567 (10 digits). Same rule as the Add Tenant form."),
    ("Tenants", "email, address", "Optional."),
    ("Leases", "tenant_cnic", "Required. Must exactly match a tenant already imported/created -- import Tenants first."),
    ("Leases", "building_name, room_number", "Required. Must match an existing building + room -- import Buildings and Rooms first."),
    ("Leases", "start_date, end_date", "Required. Format YYYY-MM-DD (e.g. 2026-01-01)."),
    ("Leases", "rent_amount", "Creates the 'Rent' charge. May be 0 or blank if the lease has at least one other charge."),
    ("Leases", "charge: <Label>", "Optional, any number of columns -- one per extra charge (Parking, Internet, Service Charges, ...). Blank or 0 = no such charge. Add (one_time) to the header for a one-off charge, e.g. 'charge: Commission (one_time)'. The label must match one of your charge heads (Chart of Accounts > charge mapping) so it posts to the right income account; an unmapped label posts to Other Income."),
    ("Leases", "Add charges to existing leases", "The 'Add charges to existing leases' slot reads this same sheet. It matches each row to the ACTIVE lease already in that building + room (tenant CNIC must agree), adds only the charges that lease doesn't have yet, never changes an existing amount, and recalculates the current month's invoice. Use Preview first."),
    ("Leases", "security_deposit_amount, security_deposit_date_received", "Optional -- leave both blank for no deposit."),
    ("General", "Blank rows", "Skipped automatically -- fine to leave extra empty rows below your data."),
    ("General", "Import order", "Owners -> Buildings -> Rooms -> Tenants -> Leases. Later sheets look up earlier ones by name/CNIC, not by ID."),
    ("General", "Partial success", "Each row is independent. A bad row is reported with the exact reason and everything else still imports -- fix just that row and re-upload."),
]


def _build_instructions_sheet(ws: Worksheet) -> None:
    ws.append(["Sheet", "Column(s)", "Rule"])
    for sheet, cols, rule in INSTRUCTIONS:
        ws.append([sheet, cols, rule])
    style_header_row(ws, 3)
    autosize_columns(ws, [12, 34, 80])
    for row in range(2, len(INSTRUCTIONS) + 2):
        ws.cell(row=row, column=3).alignment = ws.cell(row=row, column=3).alignment.copy(wrap_text=True)


@router.get("/templates")
def download_all_templates(supabase: Client = Depends(get_supabase)):
    """One workbook with all five entity sheets (each header + one example
    row) plus an Instructions sheet listing every validation rule -- the
    safest starting point since it can't drift from what the importer
    actually checks (both live in this same file)."""
    wb = Workbook()
    wb.remove(wb.active)
    for sheet_name, builder in TEMPLATE_BUILDERS.items():
        if sheet_name == "Leases":
            _build_leases_template(wb.create_sheet(sheet_name), company_charge_labels(supabase))
        else:
            builder(wb.create_sheet(sheet_name))
    _build_instructions_sheet(wb.create_sheet("Instructions"))

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="oneaccounts_import_template.xlsx"'},
    )


# ----------------------------------------------------------------------------
# Journal entries template (separate from the five entity sheets above)
# ----------------------------------------------------------------------------
JOURNAL_HEADERS = [
    "entry_no", "entry_date", "description", "account_code", "debit", "credit",
    "building_name", "room_number", "tenant_cnic",
]

JOURNAL_INSTRUCTIONS = [
    ("entry_no", "Required on every row. Rows with the same entry_no form ONE journal entry. Total debit must equal total credit within each entry, otherwise the whole entry is declined (nothing is posted for it)."),
    ("entry_date", "Required. YYYY-MM-DD (e.g. 2026-09-30). Taken from the first row of the entry; every row of an entry must carry the same date."),
    ("description", "Required on the first row of each entry (the entry's title). Used to detect duplicates: an entry with the same date + description as one already posted is skipped, so uploading the same file twice cannot double your balances."),
    ("account_code", "Required. The account's code in your Chart of Accounts, e.g. 2100 Security Deposits Held, 1100 Accounts Receivable, 3001 Opening Balance. You choose the accounts and which side each goes on."),
    ("debit / credit", "Fill ONE of the two on each row (the other blank or 0). Amounts must be positive."),
    ("building_name", "Optional on offset lines; required whenever room_number is filled. Must match an existing building name."),
    ("room_number", "REQUIRED for lines on 1100 Accounts Receivable and 2100 Security Deposits Held (their balances are tracked per tenant/room). Leave blank on the offset line (e.g. 3001)."),
    ("tenant_cnic", "Optional. If blank, the tenant is taken from the active lease in that room. Fill it when the room has no active lease (e.g. a past tenant) -- it must match an existing tenant."),
    ("Posting", "Entries are posted as manual journal entries (Journal Voucher), dated as given, tagged to the building/room/tenant of each line. Posted entries are never edited -- a wrong one is reversed from the Journal screen. Always press Preview first."),
]


def _build_journal_template(wb: Workbook) -> None:
    ws = wb.create_sheet("Journal")
    ws.append(JOURNAL_HEADERS)
    sample = [
        ("S-1", "2026-09-30", "Opening security deposits - Sunrise Heights", "3001", 30000, None, "Sunrise Heights", None, None),
        ("S-1", "2026-09-30", "Opening security deposits - Sunrise Heights", "2100", None, 10000, "Sunrise Heights", "A-101", None),
        ("S-1", "2026-09-30", "Opening security deposits - Sunrise Heights", "2100", None, 20000, "Sunrise Heights", "A-102", None),
        ("R-1", "2026-09-30", "Opening receivable - Sunrise Heights", "1100", 12000, None, "Sunrise Heights", "A-101", None),
        ("R-1", "2026-09-30", "Opening receivable - Sunrise Heights", "1100", 8000, None, "Sunrise Heights", "A-102", None),
        ("R-1", "2026-09-30", "Opening receivable - Sunrise Heights", "3001", None, 20000, "Sunrise Heights", None, None),
    ]
    for row in sample:
        ws.append(list(row))
    style_header_row(ws, len(JOURNAL_HEADERS))
    autosize_columns(ws, [10, 12, 44, 14, 12, 12, 20, 14, 18])

    ins = wb.create_sheet("Instructions")
    ins.append(["Column", "Rule"])
    for col, rule in JOURNAL_INSTRUCTIONS:
        ins.append([col, rule])
    ins.append(["Sample", "The Journal sheet holds two example entries (opening security, opening receivable). Delete the example rows and put your own."])
    style_header_row(ins, 2)
    autosize_columns(ins, [18, 110])
    for r in range(2, len(JOURNAL_INSTRUCTIONS) + 3):
        ins.cell(row=r, column=2).alignment = ins.cell(row=r, column=2).alignment.copy(wrap_text=True)


@router.get("/templates/journal")
def download_journal_template():
    """Template for the Journal entries import (must stay above the
    /templates/{entity} route so 'journal' is not read as an entity name)."""
    wb = Workbook()
    wb.remove(wb.active)
    _build_journal_template(wb)
    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="journal_template.xlsx"'},
    )


@router.get("/templates/{entity}")
def download_template(entity: str, supabase: Client = Depends(get_supabase)):
    """Same as above but scoped to one entity -- what each 'Template' button
    next to an individual import slot downloads."""
    sheet_name = ENTITY_KEY_TO_SHEET.get(entity.lower())
    if not sheet_name:
        raise HTTPException(status_code=404, detail=f'Unknown entity "{entity}".')

    wb = Workbook()
    wb.remove(wb.active)
    if sheet_name == "Leases":
        _build_leases_template(wb.create_sheet(sheet_name), company_charge_labels(supabase))
    else:
        TEMPLATE_BUILDERS[sheet_name](wb.create_sheet(sheet_name))
    _build_instructions_sheet(wb.create_sheet("Instructions"))

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{sheet_name.lower()}_template.xlsx"'},
    )


# ============================================================================
# EXPORT — one workbook, one sheet per entity, current data
# ============================================================================

@router.get("/export")
def export_workbook(
    entities: Optional[str] = Query(
        None,
        description='Comma-separated subset to export: "owners,buildings,rooms,tenants,leases". Omit for all.',
    ),
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    requested = (
        {e.strip().lower() for e in entities.split(",") if e.strip()}
        if entities
        else set(ENTITY_KEY_TO_SHEET.keys())
    )
    unknown = requested - set(ENTITY_KEY_TO_SHEET.keys())
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown entities: {', '.join(sorted(unknown))}")

    try:
        buildings = (
            supabase.table("buildings").select("*").eq("company_id", company_id).eq("is_archived", False).execute().data
            if ("buildings" in requested or "rooms" in requested or "leases" in requested)
            else []
        )
        owners = (
            supabase.table("owners").select("*").eq("company_id", company_id).execute().data
            if ("owners" in requested or "rooms" in requested)
            else []
        )
        rooms = (
            supabase.table("rooms").select("*").eq("company_id", company_id).eq("is_archived", False).execute().data
            if ("rooms" in requested or "leases" in requested)
            else []
        )
        tenants = (
            supabase.table("tenants").select("*").eq("company_id", company_id).eq("is_archived", False).execute().data
            if ("tenants" in requested or "leases" in requested)
            else []
        )
        leases = (
            supabase.table("leases").select("*").eq("company_id", company_id).execute().data
            if "leases" in requested
            else []
        )
    except APIError as e:
        status, detail = friendly_db_error(e)
        raise HTTPException(status_code=status, detail=f"Couldn't read your data to export it: {detail}")

    building_name = {b["id"]: b["name"] for b in buildings}
    owner_name = {o["id"]: o["name"] for o in owners}
    room_label = {r["id"]: r["room_number"] for r in rooms}

    wb = Workbook()
    wb.remove(wb.active)

    if "owners" in requested:
        ws = wb.create_sheet("Owners")
        ws.append(["name", "phone", "cnic", "address"])
        for o in owners:
            ws.append([o.get("name"), o.get("phone"), o.get("cnic"), o.get("address")])
        style_header_row(ws, 4)
        autosize_columns(ws, [22, 16, 18, 32])

    if "buildings" in requested:
        ws = wb.create_sheet("Buildings")
        ws.append(["name", "address"])
        for b in buildings:
            ws.append([b.get("name"), b.get("address")])
        style_header_row(ws, 2)
        autosize_columns(ws, [24, 36])

    if "rooms" in requested:
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
        style_header_row(ws, 6)
        autosize_columns(ws, [20, 12, 14, 14, 12, 20])

    if "tenants" in requested:
        ws = wb.create_sheet("Tenants")
        ws.append(["full_name", "cnic", "phone", "email", "address"])
        for t in tenants:
            ws.append([
                t.get("full_name"), t.get("cnic"), t.get("phone"), t.get("email"), t.get("address"),
            ])
        style_header_row(ws, 5)
        autosize_columns(ws, [20, 18, 16, 24, 32])

    if "leases" in requested:
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
        style_header_row(ws, 8)
        autosize_columns(ws, [18, 20, 14, 14, 14, 14, 20, 26])

    if len(wb.sheetnames) == 0:
        raise HTTPException(status_code=400, detail="Nothing selected to export.")

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)

    suffix = "all" if len(requested) == len(ENTITY_KEY_TO_SHEET) else "_".join(sorted(requested))
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="oneaccounts_export_{suffix}.xlsx"'},
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
        name = cell_str(row.get("name"))
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
        except Exception as e:
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
        name = cell_str(row.get("name"))
        if not name:
            report.append({"row": i, "status": "error", "detail": "Missing building name."})
            continue
        payload = {"company_id": company_id, "name": name, "address": row.get("address") or None}
        try:
            res = supabase.table("buildings").insert(payload).execute()
            created = res.data[0]
            write_audit_log(supabase, company_id, user["user_id"], "create", "buildings", created["id"])
            report.append({"row": i, "status": "created", "detail": name})
        except Exception as e:
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
    # Pre-fetched once, same as buildings/owners/existing_rooms above, so a
    # sheet with many rows doesn't do a floors round-trip per row -- that
    # was the main reason a big Rooms import could run long enough to hit
    # the backend's 30s Vercel timeout and surface as "Failed to fetch"
    # with no readable error at all.
    existing_floors = supabase.table("floors").select("id, building_id, floor_number").execute().data

    building_by_name = {b["name"].strip().lower(): b["id"] for b in buildings}
    owner_by_name = {o["name"].strip().lower(): o["id"] for o in owners}
    seen_room_numbers = {(r["room_number"].strip().lower(), r["building_id"]) for r in existing_rooms}
    floor_by_key = {(f["building_id"], f["floor_number"]): f["id"] for f in existing_floors}

    report = []
    # Validate every row and resolve/create its floor first (no room
    # inserts yet), then write rooms in batches instead of one row (plus
    # one audit-log row) at a time. A sheet of a few hundred rooms was
    # doing a few hundred sequential round trips -- easily enough to run
    # past the backend's 30s limit and surface as "Failed to fetch", the
    # same underlying cause already fixed for Tenants.
    to_insert = []  # (report_row, label, payload)
    for i, row in enumerate(rows, start=2):
        building_name = cell_str(row.get("building_name"))
        room_number = cell_str(row.get("room_number"))
        owner_name = cell_str(row.get("owner_name"))

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
        # Add Room modal's "+ Add a new floor..." path does. Kept in its
        # own try/except so a problem with one row's floor (bad
        # floor_number text, a DB error creating it) is reported for that
        # row only.
        try:
            floor_number_raw = row.get("floor_number") or 1
            try:
                floor_number = int(floor_number_raw)
            except (TypeError, ValueError):
                report.append({
                    "row": i,
                    "status": "error",
                    "detail": f'floor_number "{floor_number_raw}" must be a whole number (leave blank for floor 1).',
                })
                continue

            floor_key = (building_id, floor_number)
            floor_id = floor_by_key.get(floor_key)
            if not floor_id:
                new_floor = supabase.table("floors").insert(
                    {"company_id": company_id, "building_id": building_id, "floor_number": floor_number}
                ).execute().data[0]
                floor_id = new_floor["id"]
                floor_by_key[floor_key] = floor_id
        except Exception as e:
            status, detail = friendly_db_error(e)
            report.append({"row": i, "status": "error", "detail": detail})
            continue

        payload = {
            "company_id": company_id,
            "building_id": building_id,
            "floor_id": floor_id,
            "room_number": room_number,
            "room_type": row.get("room_type") or None,
            "base_rent": row.get("base_rent") or None,
            "owner_id": owner_id,
        }
        # Mark seen right away (not just after a real insert) so a second
        # occurrence of the same room number later in this same sheet
        # still gets caught by the check above -- rows are no longer
        # inserted one at a time as they're validated.
        seen_room_numbers.add(key)
        to_insert.append((i, f"{building_name} — {room_number}", payload))

    BATCH_SIZE = 50
    for start in range(0, len(to_insert), BATCH_SIZE):
        batch = to_insert[start:start + BATCH_SIZE]
        payloads = [b[2] for b in batch]
        try:
            res = supabase.table("rooms").insert(payloads).execute()
            created_rows = res.data
            audit_rows = [
                {
                    "company_id": company_id,
                    "user_id": user["user_id"],
                    "action": "create",
                    "table_name": "rooms",
                    "record_id": created["id"],
                    "details": None,
                }
                for created in created_rows
            ]
            try:
                if audit_rows:
                    supabase.table("audit_log").insert(audit_rows).execute()
            except Exception:
                pass  # best-effort, same principle as write_audit_log's own try/except
            for (i, label, _), created in zip(batch, created_rows):
                report.append({"row": i, "status": "created", "detail": label})
        except Exception:
            # Something in this batch failed as a whole (e.g. a constraint
            # this function doesn't pre-check for) -- fall back to one row
            # at a time for just this batch, so each row is still reported
            # individually instead of the whole batch silently vanishing.
            for i, label, payload in batch:
                try:
                    res = supabase.table("rooms").insert(payload).execute()
                    created = res.data[0]
                    write_audit_log(supabase, company_id, user["user_id"], "create", "rooms", created["id"])
                    report.append({"row": i, "status": "created", "detail": label})
                except Exception as e:
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
    # Validate every row first with no database writes yet, then write in
    # batches instead of one row (plus one audit-log row) at a time. A
    # sheet with a few hundred tenants was doing a few hundred sequential
    # round trips to Supabase -- easily enough to run past the backend's
    # 30s limit and surface as a bare "Failed to fetch" with no readable
    # error, the same underlying cause as the Rooms import and the backup
    # restore timeout.
    to_insert = []  # (report_row, full_name, payload)
    for i, row in enumerate(rows, start=2):
        full_name = cell_str(row.get("full_name"))
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
            "address": row.get("address") or None,
        }
        # Mark seen right away (not just after a real insert) so a second
        # occurrence of the same CNIC later in this same sheet still gets
        # caught by the check above -- rows are no longer inserted one at
        # a time as they're validated, so this can't rely on the previous
        # row already being committed.
        seen_cnics.add(cnic_digits)
        to_insert.append((i, full_name, payload))

    BATCH_SIZE = 50
    for start in range(0, len(to_insert), BATCH_SIZE):
        batch = to_insert[start:start + BATCH_SIZE]
        payloads = [b[2] for b in batch]
        try:
            res = supabase.table("tenants").insert(payloads).execute()
            created_rows = res.data
            audit_rows = [
                {
                    "company_id": company_id,
                    "user_id": user["user_id"],
                    "action": "create",
                    "table_name": "tenants",
                    "record_id": created["id"],
                    "details": None,
                }
                for created in created_rows
            ]
            try:
                if audit_rows:
                    supabase.table("audit_log").insert(audit_rows).execute()
            except Exception:
                pass  # best-effort, same principle as write_audit_log's own try/except
            for (i, full_name, _), created in zip(batch, created_rows):
                report.append({"row": i, "status": "created", "detail": full_name})
        except Exception:
            # Something in this batch failed as a whole (e.g. a constraint
            # this function doesn't pre-check for) -- fall back to one row
            # at a time for just this batch, so each row is still reported
            # individually instead of the whole batch silently vanishing.
            for i, full_name, payload in batch:
                try:
                    res = supabase.table("tenants").insert(payload).execute()
                    created = res.data[0]
                    write_audit_log(supabase, company_id, user["user_id"], "create", "tenants", created["id"])
                    report.append({"row": i, "status": "created", "detail": full_name})
                except Exception as e:
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
        building_name = cell_str(row.get("building_name"))
        room_number = cell_str(row.get("room_number"))

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
            charge_rows = charges_from_row(row)
            deposit_amount = float(row.get("security_deposit_amount") or 0)
            deposit_date = (
                row["security_deposit_date_received"].date()
                if hasattr(row.get("security_deposit_date_received"), "date")
                else (row.get("security_deposit_date_received") or start_date)
            )

            if not start_date or not end_date:
                report.append({"row": i, "status": "error", "detail": "start_date and end_date are required."})
                continue
            if not charge_rows:
                report.append({"row": i, "status": "error", "detail": "At least one charge above 0 is required (rent_amount or a 'charge: ...' column)."})
                continue

            payload = LeaseCreate(
                tenant_id=tenant_id,
                room_id=room["id"],
                start_date=start_date,
                end_date=end_date,
                charges=[LeaseCharge(label=c["label"], amount=c["amount"], recurrence=c["recurrence"]) for c in charge_rows],
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


# ============================================================================
# IMPORT — Add charges to EXISTING leases.
#
# For leases that were created with rent only. Each row is matched to the
# ACTIVE lease already sitting in that building + room (the tenant's CNIC
# must agree), and only the charges that lease doesn't have yet are added.
#
# Safety rules, all enforced here in the backend:
#   * Preview by default (apply=false) -- nothing is written.
#   * Never changes or removes an existing charge; a different amount for a
#     charge the lease already has is reported and left alone.
#   * 'Gas' and 'Gas Bill' (etc.) count as the same charge, so nothing is
#     ever added twice; re-running the same file is harmless.
#   * New charges start on the lease's own start date, so they are never
#     prorated against the first month.
#   * The current month's invoice is then recalculated by the SAME routine
#     the Add Charge button uses (old entry reversed on its original date,
#     corrected entry posted on that date; an invoice with a payment against
#     it is left untouched).
#   * Owner/admin only, every lookup filtered to the caller's company.
#   * apply=true works through `limit` leases per call (the host allows
#     ~30s per request); the response says how many remain and the screen
#     calls again until none do.
# ============================================================================

@router.post("/import/lease-charges")
def import_lease_charges(
    file: UploadFile = File(...),
    apply: bool = Query(False, description="false = preview only (nothing is written)"),
    limit: int = Query(10, ge=1, le=25),
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
    user: dict = Depends(get_current_user),
    _admin: None = Depends(require_owner_or_admin),
):
    wb = load_workbook(BytesIO(file.file.read()), data_only=True)
    rows = read_sheet(wb, "Leases")
    if not rows:
        raise HTTPException(status_code=400, detail='No rows found on a sheet named "Leases".')
    if not parse_charge_columns(list(rows[0].keys())):
        raise HTTPException(status_code=400, detail='No "charge: ..." columns found -- download the Leases template for the right layout.')

    buildings = fetch_all(lambda: supabase.table("buildings").select("id, name").eq("company_id", company_id).order("id"))
    rooms = fetch_all(lambda: supabase.table("rooms").select("id, room_number, building_id").eq("company_id", company_id).order("id"))
    tenants = fetch_all(lambda: supabase.table("tenants").select("id, cnic, full_name").eq("company_id", company_id).order("id"))
    leases = fetch_all(lambda: supabase.table("leases").select("*").eq("company_id", company_id).eq("status", "active").order("id"))
    open_charges = fetch_all(
        lambda: supabase.table("lease_charges").select("id, lease_id, label, amount").eq("company_id", company_id).is_("effective_to", "null").order("id")
    )
    mapped_labels = {
        str(m["label"]).strip()
        for m in fetch_all(lambda: supabase.table("charge_type_accounts").select("id, label").eq("company_id", company_id).order("id"))
    }

    building_by_name = {str(b["name"]).strip().lower(): b for b in buildings}
    room_by_key = {(r["building_id"], str(r["room_number"]).strip().lower()): r for r in rooms}
    tenant_by_id = {t["id"]: t for t in tenants}
    leases_by_room: Dict[str, List[Dict[str, Any]]] = {}
    for l in leases:
        leases_by_room.setdefault(l["room_id"], []).append(l)
    charges_by_lease: Dict[str, List[Dict[str, Any]]] = {}
    for c in open_charges:
        charges_by_lease.setdefault(c["lease_id"], []).append(c)

    report: List[Dict[str, Any]] = []
    work: List[Dict[str, Any]] = []
    seen_leases = set()
    unmapped = set()

    for i, row in enumerate(rows, start=2):
        building_name = cell_str(row.get("building_name"))
        room_number = cell_str(row.get("room_number"))
        cnic_digits = re.sub(r"\D", "", cell_str(row.get("tenant_cnic")))
        where = f"{building_name} - {room_number}"
        try:
            wanted = charges_from_row(row)
        except ValueError as e:
            report.append({"row": i, "status": "error", "detail": f"{where}: {e}"})
            continue
        if not wanted:
            report.append({"row": i, "status": "skipped", "detail": f"{where}: every amount is 0 - nothing to add."})
            continue

        building = building_by_name.get(building_name.lower())
        if not building:
            report.append({"row": i, "status": "error", "detail": f'No building named "{building_name}".'})
            continue
        room = room_by_key.get((building["id"], room_number.lower()))
        if not room:
            report.append({"row": i, "status": "error", "detail": f'No room "{room_number}" in "{building_name}".'})
            continue
        candidates = leases_by_room.get(room["id"], [])
        if not candidates:
            report.append({"row": i, "status": "error", "detail": f"{where}: no active lease in this room - nothing to add charges to (create the lease first)."})
            continue
        lease = None
        for cand in candidates:
            t = tenant_by_id.get(cand["tenant_id"])
            if t and re.sub(r"\D", "", str(t.get("cnic") or "")) == cnic_digits:
                lease = cand
                break
        if not lease:
            t = tenant_by_id.get(candidates[0]["tenant_id"]) or {}
            report.append({
                "row": i, "status": "error",
                "detail": f"{where}: the active lease here belongs to {t.get('full_name', 'another tenant')} (CNIC {t.get('cnic', '?')}), not CNIC {row.get('tenant_cnic')} - skipped, check this row.",
            })
            continue
        if lease["id"] in seen_leases:
            report.append({"row": i, "status": "skipped", "detail": f"{where}: this lease already appears earlier in the file - only the first row is used."})
            continue
        seen_leases.add(lease["id"])

        existing = charges_by_lease.get(lease["id"], [])
        by_identity = {charge_identity(c["label"]): c for c in existing}
        to_add: List[Dict[str, Any]] = []
        notes: List[str] = []
        for c in wanted:
            have = by_identity.get(charge_identity(c["label"]))
            if have is None:
                to_add.append(c)
                if c["label"] not in mapped_labels:
                    unmapped.add(c["label"])
            elif abs(float(have["amount"]) - c["amount"]) > 0.005:
                notes.append(f'{c["label"]}: lease already has {float(have["amount"]):,.0f}, file says {c["amount"]:,.0f} - left unchanged')

        tenant_name = (tenant_by_id.get(lease["tenant_id"]) or {}).get("full_name", "")
        note_txt = (" | " + "; ".join(notes)) if notes else ""
        if not to_add:
            report.append({"row": i, "status": "skipped", "detail": f"{where} ({tenant_name}): nothing to add - charges already on the lease{note_txt}"})
            continue
        work.append({"row": i, "lease": lease, "to_add": to_add, "where": where, "tenant": tenant_name, "note": note_txt})

    warnings = [
        f'"{label}" is not mapped to an account in your charge settings - it will post to Other Income (4100).'
        for label in sorted(unmapped)
    ]

    def adds_text(items):
        return ", ".join(f'{c["label"]} {c["amount"]:,.0f}' for c in items)

    if not apply:
        for w in work:
            total = sum(c["amount"] for c in w["to_add"])
            report.append({
                "row": w["row"], "status": "created",
                "detail": f'{w["where"]} ({w["tenant"]}): would add {adds_text(w["to_add"])} = Rs {total:,.0f} per month{w["note"]}',
            })
        report.sort(key=lambda r: r["row"])
        return {"report": report, "applied": False, "to_change": len(work), "remaining": len(work), "warnings": warnings}

    batch, rest = work[:limit], work[limit:]
    for w in batch:
        lease = w["lease"]
        try:
            new_rows = [
                {
                    "company_id": company_id,
                    "lease_id": lease["id"],
                    "label": c["label"],
                    "amount": c["amount"],
                    "recurrence": c["recurrence"],
                    "effective_from": str(lease["start_date"]),
                    "show_on_invoice": True,
                }
                for c in w["to_add"]
            ]
            inserted = supabase.table("lease_charges").insert(new_rows).execute().data or []
            for ch in inserted:
                write_audit_log(supabase, company_id, user["user_id"], "create", "lease_charges", ch["id"], None, ch)
        except Exception as e:
            report.append({"row": w["row"], "status": "error", "detail": f'{w["where"]}: could not add charges - {e}'})
            continue

        invoice_text = ""
        try:
            updated = resync_current_month_invoice(supabase, company_id, lease)
            if updated:
                invoice_text = f' - this month\'s invoice now Rs {float(updated["total_amount"]):,.0f}'
            else:
                invoice_text = " - no editable current-month invoice (applies from the next invoice)"
        except Exception as e:
            invoice_text = f" - CHARGES SAVED but the invoice was not recalculated ({e}); open the lease and press resync"
        report.append({"row": w["row"], "status": "created", "detail": f'{w["where"]} ({w["tenant"]}): added {adds_text(w["to_add"])}{invoice_text}{w["note"]}'})

    report.sort(key=lambda r: r["row"])
    return {"report": report, "applied": True, "to_change": len(work), "remaining": len(rest), "warnings": warnings}


# ============================================================================
# IMPORT -- Journal entries (opening security, opening receivable, any
# balanced adjustment).
#
# Rules, all enforced here in the backend:
#   * Rows sharing an entry_no form one entry; debit total must equal credit
#     total or the WHOLE entry is declined (nothing of it is posted).
#   * Every line is checked (account exists, one side only, building/room/
#     tenant resolve inside THIS company). Lines on 1100 / 2100 must name a
#     room so the balance lands on the right tenant -- the same tagging the
#     room-wise report and Receive Payment screen read.
#   * Goes through post_journal_entry(), the same engine every other posting
#     uses, as a manual_adjustment (Journal Voucher), never edited later.
#   * Duplicate guard: an entry whose date + description match a posted
#     manual entry (or an earlier entry in the same file) is skipped.
#   * Overlap warning (not a block): a room that already has posted manual
#     lines on the same account is flagged, since that is how an opening
#     balance gets loaded twice under a different description.
#   * Preview by default; owner/admin only; each entry posts independently.
# ============================================================================

def parse_journal_date(value: Any) -> date:
    from datetime import datetime as _dt
    if isinstance(value, _dt):
        return value.date()
    if isinstance(value, date):
        return value
    text = cell_str(value)
    if not text:
        raise ValueError("entry_date is required.")
    try:
        return _dt.strptime(text[:10], "%Y-%m-%d").date()
    except ValueError:
        raise ValueError(f'entry_date "{text}" must look like 2026-09-30.')


@router.post("/import/journal")
def import_journal(
    file: UploadFile = File(...),
    apply: bool = Query(False, description="false = preview only (nothing is posted)"),
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
    user: dict = Depends(get_current_user),
    _admin: None = Depends(require_owner_or_admin),
):
    wb = load_workbook(BytesIO(file.file.read()), data_only=True)
    rows = read_sheet(wb, "Journal")
    if not rows:
        raise HTTPException(status_code=400, detail='No rows found on a sheet named "Journal" -- download the Journal template for the right layout.')

    accounts = fetch_all(lambda: supabase.table("chart_of_accounts").select("id, code, name").eq("company_id", company_id).order("id"))
    buildings = fetch_all(lambda: supabase.table("buildings").select("id, name").eq("company_id", company_id).order("id"))
    rooms = fetch_all(lambda: supabase.table("rooms").select("id, room_number, building_id").eq("company_id", company_id).order("id"))
    tenants = fetch_all(lambda: supabase.table("tenants").select("id, cnic, full_name").eq("company_id", company_id).order("id"))
    leases = fetch_all(lambda: supabase.table("leases").select("id, room_id, tenant_id").eq("company_id", company_id).eq("status", "active").order("id"))
    manual_entries = fetch_all(
        lambda: supabase.table("journal_entries").select("id, entry_date, description, status")
        .eq("company_id", company_id).eq("source_type", "manual_adjustment").order("id")
    )

    account_by_code = {str(a["code"]).strip(): a for a in accounts}
    building_by_name = {str(b["name"]).strip().lower(): b for b in buildings}
    room_by_key = {(r["building_id"], str(r["room_number"]).strip().lower()): r for r in rooms}
    room_by_id = {r["id"]: r for r in rooms}
    tenant_by_cnic = {re.sub(r"\D", "", str(t.get("cnic") or "")): t for t in tenants}
    tenant_by_id = {t["id"]: t for t in tenants}
    tenant_by_room: Dict[str, List[str]] = {}
    for l in leases:
        tenant_by_room.setdefault(l["room_id"], []).append(l["tenant_id"])
    posted_keys = {
        (str(e["entry_date"])[:10], str(e.get("description") or "").strip().lower())
        for e in manual_entries if e.get("status") == "posted"
    }

    # Overlap check: existing posted manual lines per (room, account). Best
    # effort -- if it can't run, the rest still works and we say so.
    existing_manual: Dict[tuple, str] = {}
    overlap_note = ""
    try:
        posted_ids = {e["id"]: str(e.get("description") or "") for e in manual_entries if e.get("status") == "posted"}
        lines_existing = fetch_all(
            lambda: supabase.table("journal_lines").select("id, journal_entry_id, account_id, room_id")
            .eq("company_id", company_id).order("id")
        )
        for ln in lines_existing:
            if ln.get("room_id") and ln["journal_entry_id"] in posted_ids:
                existing_manual.setdefault((ln["room_id"], ln["account_id"]), posted_ids[ln["journal_entry_id"]])
    except Exception:
        overlap_note = "Overlap check against existing manual entries could not run - review opening balances manually."

    # ---- group rows into entries -------------------------------------------
    entries: Dict[str, Dict[str, Any]] = {}
    order: List[str] = []
    report: List[Dict[str, Any]] = []
    for i, row in enumerate(rows, start=2):
        no = cell_str(row.get("entry_no"))
        if not no:
            report.append({"row": i, "status": "error", "detail": "entry_no is required on every row."})
            continue
        if no not in entries:
            entries[no] = {"no": no, "first_row": i, "date_val": row.get("entry_date"), "description": cell_str(row.get("description")), "rows": [], "errors": []}
            order.append(no)
        entries[no]["rows"].append((i, row))

    plans: List[Dict[str, Any]] = []
    seen_keys = set()
    for no in order:
        e = entries[no]
        errs: List[str] = []
        try:
            entry_date = parse_journal_date(e["date_val"])
        except ValueError as ex:
            entry_date = None
            errs.append(f"row {e['first_row']}: {ex}")
        if not e["description"]:
            errs.append(f"row {e['first_row']}: description is required on the first row of the entry.")

        lines: List[Dict[str, Any]] = []
        notes: List[str] = []
        for i, row in e["rows"]:
            try:
                if entry_date is not None:
                    try:
                        if parse_journal_date(row.get("entry_date")) != entry_date:
                            raise ValueError("entry_date differs from the entry's first row.")
                    except ValueError as ex:
                        raise ValueError(str(ex))
                code = cell_str(row.get("account_code"))
                account = account_by_code.get(code)
                if not account:
                    raise ValueError(f'account_code "{code}" is not in your Chart of Accounts.')
                debit = parse_amount(row.get("debit"), "debit")
                credit = parse_amount(row.get("credit"), "credit")
                if (debit > 0) == (credit > 0):
                    raise ValueError("fill exactly one of debit or credit (a positive amount).")

                building_name = cell_str(row.get("building_name"))
                room_number = cell_str(row.get("room_number"))
                cnic_digits = re.sub(r"\D", "", cell_str(row.get("tenant_cnic")))
                building = None
                room = None
                tenant_id = None
                if building_name:
                    building = building_by_name.get(building_name.lower())
                    if not building:
                        raise ValueError(f'no building named "{building_name}".')
                if room_number:
                    if not building:
                        raise ValueError("building_name is required when room_number is given.")
                    room = room_by_key.get((building["id"], room_number.lower()))
                    if not room:
                        raise ValueError(f'no room "{room_number}" in "{building_name}".')
                if cnic_digits:
                    t = tenant_by_cnic.get(cnic_digits)
                    if not t:
                        raise ValueError(f"no tenant with CNIC {row.get('tenant_cnic')}.")
                    tenant_id = t["id"]
                elif room:
                    holders = tenant_by_room.get(room["id"], [])
                    if len(holders) == 1:
                        tenant_id = holders[0]
                    elif len(holders) > 1:
                        raise ValueError(f"room {room_number} has more than one active lease - give tenant_cnic.")
                if code in ("1100", "2100"):
                    if not room:
                        raise ValueError(f"lines on {code} must name a building and room so the balance lands on the right tenant.")
                    if not tenant_id:
                        raise ValueError(f"room {room_number} has no active lease - give tenant_cnic so the {code} balance is tagged to a tenant.")
                if room and (room["id"], account["id"]) in existing_manual:
                    notes.append(f'room {room_number} already has a posted manual line on {code} ("{existing_manual[(room["id"], account["id"])]}")')

                lines.append({
                    "account_id": account["id"],
                    "direction": "debit" if debit > 0 else "credit",
                    "amount": round(debit if debit > 0 else credit, 2),
                    "building_id": building["id"] if building else None,
                    "room_id": room["id"] if room else None,
                    "tenant_id": tenant_id,
                })
            except ValueError as ex:
                errs.append(f"row {i}: {ex}")

        total_dr = round(sum(l["amount"] for l in lines if l["direction"] == "debit"), 2)
        total_cr = round(sum(l["amount"] for l in lines if l["direction"] == "credit"), 2)
        if not errs:
            if len(lines) < 2:
                errs.append("an entry needs at least two lines.")
            elif total_dr != total_cr:
                errs.append(f"does not balance: debit {total_dr:,.2f} vs credit {total_cr:,.2f} (difference {abs(total_dr - total_cr):,.2f}).")
            elif total_dr == 0:
                errs.append("total amount is zero.")

        title = f'Entry {no}' + (f' ({entry_date}, "{e["description"]}")' if entry_date and e["description"] else "")
        if errs:
            for msg in errs:
                report.append({"row": e["first_row"], "status": "error", "detail": f"{title}: {msg}"})
            report.append({"row": e["first_row"], "status": "error", "detail": f"{title}: NOT posted - fix the rows above and upload again."})
            continue

        key = (str(entry_date), e["description"].strip().lower())
        if key in posted_keys:
            report.append({"row": e["first_row"], "status": "skipped", "detail": f"{title}: already posted (same date and description) - skipped."})
            continue
        if key in seen_keys:
            report.append({"row": e["first_row"], "status": "skipped", "detail": f"{title}: same date and description as an earlier entry in this file - skipped."})
            continue
        seen_keys.add(key)
        plans.append({"no": no, "row": e["first_row"], "date": entry_date, "description": e["description"], "lines": lines, "total": total_dr, "title": title, "notes": notes})

    warnings = [overlap_note] if overlap_note else []

    def describe(p, verb):
        extra = (" | CHECK: " + "; ".join(p["notes"][:3]) + (f" (+{len(p['notes']) - 3} more)" if len(p["notes"]) > 3 else "")) if p["notes"] else ""
        return f'{p["title"]}: {verb} {len(p["lines"])} lines, debit = credit = Rs {p["total"]:,.2f}{extra}'

    if not apply:
        for p in plans:
            report.append({"row": p["row"], "status": "created", "detail": describe(p, "will post")})
        report.sort(key=lambda r: r["row"])
        return {"report": report, "applied": False, "to_post": len(plans), "posted": 0, "warnings": warnings}

    posted = 0
    for p in plans:
        try:
            jl: List[JournalLine] = [dict(l) for l in p["lines"]]  # type: ignore
            entry = post_journal_entry(
                supabase,
                company_id=company_id,
                entry_date=str(p["date"]),
                source_type="manual_adjustment",
                source_id=None,
                description=p["description"],
                lines=jl,
                created_by=user["user_id"],
            )
            count = supabase.table("journal_lines").select("id", count="exact").eq("journal_entry_id", entry["id"]).execute().count
            if count is not None and count != len(p["lines"]):
                report.append({"row": p["row"], "status": "error", "detail": f'{p["title"]}: posted but only {count} of {len(p["lines"])} lines were saved - open the Journal screen and check this entry before doing anything else.'})
                continue
            write_audit_log(supabase, company_id, user["user_id"], "create", "journal_entries", entry["id"], None, {"source": "journal_import", "lines": len(p["lines"]), "total": p["total"]})
            posted += 1
            report.append({"row": p["row"], "status": "created", "detail": describe(p, "posted")})
        except UnbalancedJournalEntry as ex:
            report.append({"row": p["row"], "status": "error", "detail": f'{p["title"]}: {ex}'})
        except Exception as ex:
            report.append({"row": p["row"], "status": "error", "detail": f'{p["title"]}: could not post - {ex}'})

    report.sort(key=lambda r: r["row"])
    return {"report": report, "applied": True, "to_post": len(plans), "posted": posted, "warnings": warnings}
