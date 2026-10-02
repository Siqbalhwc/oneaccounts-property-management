"""
Bulk, time-budgeted invoice generation.

WHY THIS EXISTS
The original POST /invoices/generate looped over every active lease inside a
single HTTP request, doing ~12-15 sequential Supabase round trips per lease.
One building fit inside Vercel's function time limit; "all buildings" did
not, so the function was killed mid-run and the browser saw "Failed to
fetch" (a killed function sends no CORS headers). At thousands of leases no
single request can ever be fast enough -- so generation is now split into:

  1. plan_generation()   -- which leases still need an invoice this month
  2. generate_batch()    -- process a small slice of them (the frontend calls
                            this repeatedly, with progress + automatic retry)

Both are IDEMPOTENT: a lease that already has an invoice for the month is
skipped, so re-running (after a network drop, a closed tab, anything) simply
continues where it stopped and can never create duplicates.

SPEED
generate_batch() prefetches everything it needs for a whole slice of leases
in a handful of queries (leases, charges, rooms, buildings, tenants, chart
of accounts) and writes with 4 bulk inserts per slice (invoices, line items,
journal entries, journal lines) instead of ~4 inserts + ~8 lookups per lease.
The invoicing/proration/journal RULES are unchanged -- this file reuses
compute_prorated_charges() and merge_current_charges() from invoicing.py.

SAFETY
If any bulk write fails, everything that slice wrote is cleaned up and each
lease is retried individually through the original one-at-a-time path, so one
bad lease is reported in `failed` instead of failing (or half-writing) the
rest.
"""

import time
from collections import defaultdict
from datetime import date
from typing import Callable, Iterable, Optional

from supabase import Client

from app.services.invoicing import compute_prorated_charges, merge_current_charges
from app.services.ledger import UnbalancedJournalEntry

PAGE_SIZE = 1000        # PostgREST silently caps any read at 1000 rows
IN_CHUNK = 100          # max ids per .in_() filter (keeps URL length safe)
SUB_BATCH = 25          # leases written together in one bulk write
DEFAULT_TIME_BUDGET = 20.0  # seconds; Vercel kills the function at 30


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------
def fetch_all(make_query: Callable) -> list[dict]:
    """
    Reads EVERY row of a query, page by page. A plain .execute() returns at
    most 1000 rows with no error, which would silently drop leases/invoices
    beyond that. make_query() must return a fresh, deterministically
    ordered query builder each call.
    """
    rows: list[dict] = []
    start = 0
    while True:
        page = make_query().range(start, start + PAGE_SIZE - 1).execute().data
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            return rows
        start += PAGE_SIZE


def chunked(items: list, size: int) -> Iterable[list]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def fetch_in(supabase: Client, table: str, columns: str, column: str, ids: list[str], extra=None) -> list[dict]:
    """select <columns> from <table> where <column> in (ids) -- chunked + paginated."""
    out: list[dict] = []
    for chunk in chunked(list(ids), IN_CHUNK):
        def q(chunk=chunk):
            query = supabase.table(table).select(columns).in_(column, chunk)
            if extra:
                query = extra(query)
            return query.order("id")
        out.extend(fetch_all(q))
    return out


def next_month_start(d: date) -> date:
    return date(d.year + 1, 1, 1) if d.month == 12 else date(d.year, d.month + 1, 1)


def count_invoice_numbers(supabase: Client, company_id: str, entry_date: date) -> int:
    """How many invoice numbers this company already has in entry_date's
    month. Uses an exact COUNT -- the old approach fetched the rows and took
    len(), which silently stops at 1000 and would start repeating numbers."""
    prefix = f"IN/{entry_date.strftime('%Y%m')}"
    res = (
        supabase.table("invoices")
        .select("id", count="exact")
        .eq("company_id", company_id)
        .like("invoice_number", f"{prefix}%")
        .limit(1)
        .execute()
    )
    return int(res.count or 0)


# ---------------------------------------------------------------------------
# Step 1: plan
# ---------------------------------------------------------------------------
def plan_generation(supabase: Client, invoice_month: date, building_id: Optional[str] = None) -> dict:
    """
    Returns the ids of active leases (optionally within one building) that do
    NOT yet have an invoice for invoice_month. Leases that turn out to have
    nothing billable (no charges / lease doesn't overlap the month) are still
    listed here; generate_batch() reports those as skipped.
    """
    leases = fetch_all(lambda: supabase.table("leases").select("id, room_id").eq("status", "active").order("id"))

    if building_id:
        room_ids = {
            r["id"]
            for r in fetch_all(lambda: supabase.table("rooms").select("id").eq("building_id", building_id).order("id"))
        }
        leases = [l for l in leases if l["room_id"] in room_ids]

    invoiced = {
        r["lease_id"]
        for r in fetch_all(
            lambda: supabase.table("invoices").select("id, lease_id").eq("invoice_month", str(invoice_month)).order("id")
        )
    }
    todo = [l["id"] for l in leases if l["id"] not in invoiced]
    already = sum(1 for l in leases if l["id"] in invoiced)
    return {"lease_ids": todo, "total_active": len(leases), "already_invoiced": already}


# ---------------------------------------------------------------------------
# Step 2: generate a batch
# ---------------------------------------------------------------------------
def _load_reference_data(supabase: Client, company_id: str) -> dict:
    """Chart-of-accounts lookups needed by every invoice -- loaded once per
    request instead of once per charge line."""
    accounts = fetch_all(
        lambda: supabase.table("chart_of_accounts").select("id, code").eq("company_id", company_id).order("id")
    )
    by_code = {a["code"]: a["id"] for a in accounts}
    if "1100" not in by_code:
        raise ValueError("Chart of accounts is missing required system account '1100' (Accounts Receivable).")
    if "4100" not in by_code:
        raise ValueError("Chart of accounts is missing required system account '4100' (Other Income).")
    mappings = fetch_all(
        lambda: supabase.table("charge_type_accounts").select("id, label, account_id").eq("company_id", company_id).order("id")
    )
    return {
        "ar_id": by_code["1100"],
        "other_income_id": by_code["4100"],
        "label_to_account": {m["label"]: m["account_id"] for m in mappings},
    }


def _cleanup(supabase: Client, invoice_ids: list[str]) -> None:
    """Best-effort removal of everything written for these invoices, so a
    failed slice never leaves an invoice with no journal entry behind
    (which a retry would then wrongly skip as 'already invoiced')."""
    if not invoice_ids:
        return
    for chunk in chunked(invoice_ids, IN_CHUNK):
        try:
            entries = (
                supabase.table("journal_entries")
                .select("id")
                .eq("source_type", "invoice")
                .in_("source_id", chunk)
                .execute()
                .data
            )
            entry_ids = [e["id"] for e in entries]
            for ec in chunked(entry_ids, IN_CHUNK):
                supabase.table("journal_lines").delete().in_("journal_entry_id", ec).execute()
                supabase.table("journal_entries").delete().in_("id", ec).execute()
            supabase.table("invoice_line_items").delete().in_("invoice_id", chunk).execute()
            supabase.table("invoices").delete().in_("id", chunk).execute()
        except Exception:
            pass


def _generate_slice_bulk(
    supabase: Client,
    company_id: str,
    lease_ids: list[str],
    invoice_month: date,
    due_date: date,
    ref: dict,
    result: dict,
) -> None:
    """Fast path: prefetch for the whole slice, then 4 bulk inserts. Raises on
    any failure AFTER cleaning up whatever it wrote, so the caller can fall
    back to the one-at-a-time path."""
    leases = {
        l["id"]: l
        for l in fetch_in(supabase, "leases", "*", "id", lease_ids, extra=lambda q: q.eq("status", "active"))
    }
    inv_rows = fetch_in(supabase, "invoices", "id, lease_id, invoice_month", "lease_id", lease_ids)
    has_this_month = {r["lease_id"] for r in inv_rows if str(r["invoice_month"]) == str(invoice_month)}
    has_any = {r["lease_id"] for r in inv_rows}

    charges_by_lease: dict = defaultdict(list)
    for c in fetch_in(supabase, "lease_charges", "*", "lease_id", lease_ids):
        charges_by_lease[c["lease_id"]].append(c)

    room_ids = list({l["room_id"] for l in leases.values()})
    tenant_ids = list({l["tenant_id"] for l in leases.values()})
    rooms = {r["id"]: r for r in fetch_in(supabase, "rooms", "id, room_number, building_id, owner_id", "id", room_ids)}
    building_ids = list({r["building_id"] for r in rooms.values() if r.get("building_id")})
    buildings = {b["id"]: b for b in fetch_in(supabase, "buildings", "id, owner_id", "id", building_ids)}
    tenants = {t["id"]: t for t in fetch_in(supabase, "tenants", "id, full_name", "id", tenant_ids)}

    seq = count_invoice_numbers(supabase, company_id, date.today())

    invoice_rows: list[dict] = []
    planned: dict = {}  # lease_id -> {"prorated": [...], "total": float}
    for lid in lease_ids:
        lease = leases.get(lid)
        if lease is None or lid in has_this_month:
            result["skipped"].append(lid)
            continue
        charges = merge_current_charges(charges_by_lease.get(lid, []))
        if not charges:
            result["skipped"].append(lid)
            continue
        prorated = compute_prorated_charges(
            charges,
            date.fromisoformat(str(lease["start_date"])),
            date.fromisoformat(str(lease["end_date"])),
            invoice_month,
            is_first_invoice=lid not in has_any,
        )
        if not prorated:
            result["skipped"].append(lid)
            continue
        total = sum(c["amount"] for c in prorated)
        if round(total, 2) == 0:
            result["failed"].append({"lease_id": lid, "error": "Invoice total is zero — nothing to bill."})
            continue
        seq += 1
        planned[lid] = {"prorated": prorated, "total": total}
        invoice_rows.append(
            {
                "company_id": company_id,
                "lease_id": lid,
                "invoice_number": f"IN/{date.today().strftime('%Y%m%d')}/{seq:03d}",
                "invoice_month": str(invoice_month),
                "due_date": str(due_date),
                "total_amount": total,
                "status": "draft",
            }
        )

    if not invoice_rows:
        return

    created_invoice_ids: list[str] = []
    try:
        created = supabase.table("invoices").insert(invoice_rows).execute().data
        created_invoice_ids = [i["id"] for i in created]
        invoice_by_lease = {i["lease_id"]: i for i in created}

        line_items = [
            {
                "company_id": company_id,
                "invoice_id": invoice_by_lease[lid]["id"],
                "label": c["label"],
                "amount": c["amount"],
                "show_on_invoice": c["show_on_invoice"],
            }
            for lid, p in planned.items()
            for c in p["prorated"]
        ]
        supabase.table("invoice_line_items").insert(line_items).execute()

        entry_rows: list[dict] = []
        lines_by_invoice: dict = {}
        for lid, p in planned.items():
            lease, inv = leases[lid], invoice_by_lease[lid]
            room = rooms.get(lease["room_id"]) or {}
            building_id = room.get("building_id")
            owner_id = room.get("owner_id") or (buildings.get(building_id) or {}).get("owner_id")
            tenant_name = (tenants.get(lease["tenant_id"]) or {}).get("full_name") or "Tenant"
            room_label = room.get("room_number", "room")

            credit_by_account: dict = defaultdict(float)
            for c in p["prorated"]:
                acct = ref["label_to_account"].get(c["label"]) or ref["other_income_id"]
                credit_by_account[acct] += float(c["amount"])

            tags = {
                "building_id": building_id,
                "room_id": lease["room_id"],
                "owner_id": owner_id,
                "tenant_id": lease["tenant_id"],
                "lease_id": lid,
            }
            lines = [{"account_id": ref["ar_id"], "direction": "debit", "amount": p["total"], **tags}]
            lines += [{"account_id": a, "direction": "credit", "amount": amt, **tags} for a, amt in credit_by_account.items()]

            debits = round(sum(l["amount"] for l in lines if l["direction"] == "debit"), 2)
            credits = round(sum(l["amount"] for l in lines if l["direction"] == "credit"), 2)
            if debits != credits:
                raise UnbalancedJournalEntry(f"invoice {inv['id']} does not balance: debits={debits} credits={credits}")

            lines_by_invoice[inv["id"]] = lines
            entry_rows.append(
                {
                    "company_id": company_id,
                    "entry_date": str(invoice_month),
                    "source_type": "invoice",
                    "source_id": inv["id"],
                    "description": f"Rent invoice — {tenant_name}, Room {room_label} — {invoice_month.strftime('%B %Y')}",
                    "created_by": None,
                }
            )

        entries = supabase.table("journal_entries").insert(entry_rows).execute().data
        line_rows = [
            {
                "company_id": company_id,
                "journal_entry_id": e["id"],
                "account_id": l["account_id"],
                "direction": l["direction"],
                "amount": l["amount"],
                "building_id": l.get("building_id"),
                "room_id": l.get("room_id"),
                "owner_id": l.get("owner_id"),
                "tenant_id": l.get("tenant_id"),
                "lease_id": l.get("lease_id"),
            }
            for e in entries
            for l in lines_by_invoice[e["source_id"]]
        ]
        supabase.table("journal_lines").insert(line_rows).execute()
    except Exception:
        _cleanup(supabase, created_invoice_ids)
        raise

    result["created"].extend(created_invoice_ids)


def _generate_one_safely(
    supabase: Client, company_id: str, lease_id: str, invoice_month: date, due_date: date, result: dict
) -> None:
    """Slow, proven path (the original per-lease function) used only when a
    bulk write fails, so a single bad lease is isolated and reported."""
    from app.routers.invoices import generate_invoice_for_lease  # local import: avoids a circular import

    try:
        lease = supabase.table("leases").select("*").eq("id", lease_id).single().execute().data
        if not lease or lease.get("status") != "active":
            result["skipped"].append(lease_id)
            return
        inv = generate_invoice_for_lease(supabase, company_id, lease, invoice_month, due_date)
        (result["created"].append(inv["id"]) if inv else result["skipped"].append(lease_id))
    except Exception as e:
        # generate_invoice_for_lease inserts the invoice before posting its
        # journal entry; remove any half-written invoice so a retry starts clean.
        try:
            partial = (
                supabase.table("invoices").select("id").eq("lease_id", lease_id).eq("invoice_month", str(invoice_month)).execute().data
            )
            _cleanup(supabase, [p["id"] for p in partial])
        except Exception:
            pass
        message = getattr(e, "detail", None) or getattr(e, "message", None) or str(e)
        result["failed"].append({"lease_id": lease_id, "error": str(message)[:300]})


def generate_batch(
    supabase: Client,
    company_id: str,
    lease_ids: list[str],
    invoice_month: date,
    due_date: date,
    time_budget: float = DEFAULT_TIME_BUDGET,
) -> dict:
    """
    Generates invoices for lease_ids. Returns:
      created   -- new invoice ids
      skipped   -- lease ids with nothing to do (already invoiced / no charges / not active)
      failed    -- [{lease_id, error}] for leases that could not be invoiced
      remaining -- lease ids NOT attempted because the time budget ran out
                   (the caller should simply send these again)
    """
    started = time.monotonic()
    result: dict = {"created": [], "skipped": [], "failed": [], "remaining": []}
    ref = _load_reference_data(supabase, company_id)

    for chunk in chunked(list(lease_ids), SUB_BATCH):
        if time.monotonic() - started > time_budget:
            result["remaining"].extend(chunk)
            continue
        slice_result: dict = {"created": [], "skipped": [], "failed": []}
        try:
            _generate_slice_bulk(supabase, company_id, chunk, invoice_month, due_date, ref, slice_result)
        except Exception:
            # Bulk write failed (and was cleaned up) -- redo this slice one lease at a time.
            slice_result = {"created": [], "skipped": [], "failed": []}
            for lid in chunk:
                _generate_one_safely(supabase, company_id, lid, invoice_month, due_date, slice_result)
        for k in ("created", "skipped", "failed"):
            result[k].extend(slice_result[k])
    return result
