"""
Lease reversal -- undoes invoices (and, optionally, a whole lease) that were
created in error, WITHOUT deleting anything.

Same rule as everywhere else in this ledger: posted journal entries are never
edited or deleted, only reversed with an equal-and-opposite entry
(reverse_journal_entry). Each reversal is dated the SAME day as the entry it
cancels, so the pair nets to zero in every period -- a balance "as of" any
date, before or after, never sees half of a reversed pair.

Two modes:
  * "before_date" -- reverses + cancels the lease's invoices for months
    BEFORE a given date. The lease itself stays active. This is the fix for a
    lease entered with an old start date, whose first invoice was auto-created
    for a month that is already covered by opening balances.
  * "full" -- reverses + cancels every invoice, reverses the security-deposit
    entry made at lease creation, then ends the lease (terminated, room freed).
    The lease is ended on its START date -- not today -- so it never counts as
    having been in force for any period.

Safety rules (enforced here, not in the UI):
  * Nothing is reversed for an invoice that already has a payment against it.
    In "full" mode, any payment or deposit receipt blocks the whole lease.
  * Manual journal entries (e.g. opening balances) are NEVER reversed here,
    even if tagged to the lease -- they can be shared across many leases.
  * Every query is filtered by company_id, on top of RLS.
  * Re-running is safe: already-reversed entries and already-cancelled
    invoices are skipped.
"""
from collections import defaultdict
from datetime import date
from typing import Dict, Iterable, List, Optional

from supabase import Client

from app.crud.generic import write_audit_log
from app.services.ledger import reverse_journal_entry

_CHUNK = 80  # ids per IN (...) query, keeps the request URL short


def _chunks(items: List[str], n: int = _CHUNK) -> Iterable[List[str]]:
    for i in range(0, len(items), n):
        yield items[i : i + n]


def _fetch_in(supabase: Client, table: str, columns: str, column: str, ids: List[str], company_id: Optional[str] = None, extra=None) -> List[dict]:
    rows: List[dict] = []
    for part in _chunks(ids):
        q = supabase.table(table).select(columns).in_(column, part)
        if company_id:
            q = q.eq("company_id", company_id)
        if extra:
            q = extra(q)
        rows.extend(q.execute().data or [])
    return rows


def build_reversal_plans(
    supabase: Client,
    company_id: str,
    leases: List[dict],
    mode: str,
    before_date: Optional[date],
) -> List[dict]:
    """
    Read-only. Works out, for each lease, exactly what a reversal WOULD do:
    which invoices get cancelled, which journal entries get reversed, and
    anything that blocks it. Same function is used for the preview and for
    the real run, so what is previewed is exactly what is executed.
    """
    lease_ids = [l["id"] for l in leases]
    if not lease_ids:
        return []

    inv_extra = lambda q: q.neq("status", "cancelled")
    if mode == "before_date" and before_date:
        inv_extra = lambda q: q.neq("status", "cancelled").lt("invoice_month", str(before_date))
    invoices = _fetch_in(
        supabase, "invoices", "id, lease_id, invoice_month, total_amount, status",
        "lease_id", lease_ids, company_id, inv_extra,
    )
    invoice_ids = [i["id"] for i in invoices]

    payments = _fetch_in(supabase, "payments", "id, invoice_id", "invoice_id", invoice_ids, company_id) if invoice_ids else []
    invoice_ids_with_payment = {p["invoice_id"] for p in payments}

    invoice_entries = (
        _fetch_in(
            supabase, "journal_entries", "id, entry_date, source_type, source_id, description, status, reversal_of",
            "source_id", invoice_ids, company_id, lambda q: q.eq("source_type", "invoice"),
        )
        if invoice_ids else []
    )
    live_entries_by_invoice: Dict[str, List[dict]] = defaultdict(list)
    for e in invoice_entries:
        if e["status"] == "posted" and not e.get("reversal_of"):
            live_entries_by_invoice[e["source_id"]].append(e)

    deposit_by_lease: Dict[str, dict] = {}
    deposit_payment_leases: set = set()
    deposit_entries_by_lease: Dict[str, List[dict]] = defaultdict(list)
    manual_by_lease: Dict[str, List[dict]] = defaultdict(list)
    if mode == "full":
        deposits = _fetch_in(supabase, "security_deposits", "id, lease_id", "lease_id", lease_ids, company_id)
        deposit_by_lease = {d["lease_id"]: d for d in deposits}
        if deposits:
            dep_pay = _fetch_in(supabase, "security_deposit_payments", "id, security_deposit_id", "security_deposit_id", [d["id"] for d in deposits], company_id)
            paid_deposit_ids = {p["security_deposit_id"] for p in dep_pay}
            deposit_payment_leases = {d["lease_id"] for d in deposits if d["id"] in paid_deposit_ids}
        for e in _fetch_in(
            supabase, "journal_entries", "id, entry_date, source_type, source_id, description, status, reversal_of",
            "source_id", lease_ids, company_id, lambda q: q.eq("source_type", "security_deposit"),
        ):
            if e["status"] == "posted" and not e.get("reversal_of"):
                deposit_entries_by_lease[e["source_id"]].append(e)

        lines = _fetch_in(supabase, "journal_lines", "journal_entry_id, lease_id", "lease_id", lease_ids, company_id)
        entry_lease_pairs = {(l["journal_entry_id"], l["lease_id"]) for l in lines}
        entry_ids = list({p[0] for p in entry_lease_pairs})
        if entry_ids:
            auto_ids = {e["id"] for es in live_entries_by_invoice.values() for e in es} | {e["id"] for es in deposit_entries_by_lease.values() for e in es}
            manual = _fetch_in(
                supabase, "journal_entries", "id, entry_date, source_type, description, status, reversal_of",
                "id", entry_ids, company_id,
            )
            manual_by_id = {
                m["id"]: m for m in manual
                if m["status"] == "posted" and not m.get("reversal_of") and m["id"] not in auto_ids
                and m["source_type"] not in ("invoice", "security_deposit")
            }
            for entry_id, lease_id in entry_lease_pairs:
                if entry_id in manual_by_id:
                    manual_by_lease[lease_id].append(manual_by_id[entry_id])

    plans: List[dict] = []
    for lease in leases:
        lid = lease["id"]
        lease_invoices = [i for i in invoices if i["lease_id"] == lid]
        blocked: List[str] = []
        skipped: List[dict] = []
        to_cancel: List[dict] = []

        for inv in lease_invoices:
            if inv["id"] in invoice_ids_with_payment:
                skipped.append({"id": inv["id"], "invoice_month": inv["invoice_month"], "reason": "Has a payment recorded against it -- reverse the receipt first"})
            else:
                to_cancel.append(inv)

        if mode == "full":
            if str(lease.get("termination_reason") or "").startswith("Reversed"):
                blocked.append("This lease was already reversed.")
            if skipped:
                blocked.append("Payments have been received against this lease's invoices -- reverse those receipts first.")
            if lid in deposit_payment_leases:
                blocked.append("Security deposit money has been received on this lease -- reverse that receipt first.")

        entries: List[dict] = []
        if not blocked:
            for inv in to_cancel:
                entries.extend(live_entries_by_invoice.get(inv["id"], []))
            if mode == "full":
                entries.extend(deposit_entries_by_lease.get(lid, []))

        plans.append(
            {
                "lease_id": lid,
                "room_id": lease.get("room_id"),
                "start_date": lease.get("start_date"),
                "mode": mode,
                "blocked": blocked,
                "invoices": [] if blocked else to_cancel,
                "entries": entries,
                "skipped_invoices": skipped,
                "manual_entries_to_review": manual_by_lease.get(lid, []),
            }
        )
    return plans


def execute_reversal_plan(
    supabase: Client,
    company_id: str,
    user_id: str,
    plan: dict,
    reason: str,
) -> dict:
    """
    Carries out one lease's plan. Entries are reversed first and an invoice is
    only cancelled once ALL of its entries were reversed, so a failure partway
    never leaves an invoice cancelled while its entry is still live.
    """
    errors: List[str] = []
    reversed_ids: List[str] = []
    failed_invoice_ids: set = set()

    for entry in plan["entries"]:
        try:
            reverse_journal_entry(
                supabase, company_id, entry["id"], reason=reason, entry_date=str(entry["entry_date"]),
            )
            reversed_ids.append(entry["id"])
        except Exception as exc:
            errors.append(f"Entry {entry['id']}: {exc}")
            if entry.get("source_type") == "invoice":
                failed_invoice_ids.add(entry["source_id"])

    cancelled_ids: List[str] = []
    for inv in plan["invoices"]:
        if inv["id"] in failed_invoice_ids:
            continue
        try:
            supabase.table("invoices").update({"status": "cancelled"}).eq("id", inv["id"]).eq("company_id", company_id).execute()
            cancelled_ids.append(inv["id"])
            write_audit_log(
                supabase, company_id, user_id, "reverse", "invoices", inv["id"],
                before={"status": inv["status"], "total_amount": inv["total_amount"], "invoice_month": inv["invoice_month"]},
                after={"status": "cancelled", "reason": reason},
            )
        except Exception as exc:
            errors.append(f"Invoice {inv['id']}: {exc}")

    lease_ended = False
    if plan["mode"] == "full" and not errors:
        try:
            ended_on = str(plan.get("start_date") or date.today())
            supabase.table("leases").update(
                {"status": "terminated", "terminated_at": ended_on, "termination_reason": f"Reversed -- {reason}"}
            ).eq("id", plan["lease_id"]).eq("company_id", company_id).execute()
            other_active = (
                supabase.table("leases").select("id")
                .eq("company_id", company_id).eq("room_id", plan["room_id"]).eq("status", "active")
                .neq("id", plan["lease_id"]).execute().data
            )
            if not other_active:
                supabase.table("rooms").update({"status": "vacant"}).eq("id", plan["room_id"]).eq("company_id", company_id).execute()
            write_audit_log(
                supabase, company_id, user_id, "reverse", "leases", plan["lease_id"],
                before={"status": "active"}, after={"status": "terminated", "reason": f"Reversed -- {reason}"},
            )
            lease_ended = True
        except Exception as exc:
            errors.append(f"Lease: {exc}")

    return {
        "lease_id": plan["lease_id"],
        "entries_reversed": len(reversed_ids),
        "invoices_cancelled": len(cancelled_ids),
        "lease_ended": lease_ended,
        "errors": errors,
    }


def summarize_plan(plan: dict) -> dict:
    """Small, UI-friendly view of a plan (no internal fields)."""
    return {
        "lease_id": plan["lease_id"],
        "room_id": plan["room_id"],
        "blocked": plan["blocked"],
        "invoices": [
            {"id": i["id"], "invoice_month": i["invoice_month"], "total_amount": float(i["total_amount"]), "status": i["status"]}
            for i in plan["invoices"]
        ],
        "entries": [
            {"id": e["id"], "entry_date": e["entry_date"], "source_type": e["source_type"], "description": e.get("description")}
            for e in plan["entries"]
        ],
        "skipped_invoices": plan["skipped_invoices"],
        "manual_entries_to_review": [
            {"id": m["id"], "entry_date": m["entry_date"], "description": m.get("description")}
            for m in plan["manual_entries_to_review"]
        ],
    }
