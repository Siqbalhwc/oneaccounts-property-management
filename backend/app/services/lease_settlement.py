"""
Lease closing / settlement.

Computes, then (on confirm) posts, everything involved in ending a lease:
  - any unpaid balance on invoices from before the move-out month
  - the final, prorated period from the move-out month up to the actual
    move-out date (reusing the exact same proration math invoicing.py
    already uses for every other invoice, via compute_prorated_charges)
  - the security deposit: what was agreed, what was actually paid, any
    itemized deductions (each tagged to its own account), and the net
    refund (or shortfall) after deducting outstanding rent/discounts
  - an optional discount against what the tenant owes, posted to
    whichever account the user picks

Balances that were loaded through the books rather than through invoices
(an opening receivable, an opening security deposit, a receipt taken against
an opening balance) are read from the tenant's ledger, so the figures here
agree with the Receivable ledger and the room-wise report. Invoice-based
logic below is unchanged; the ledger only adds what invoices cannot see.

All the arithmetic lives here, server-side, on purpose -- the settlement
page just displays whatever this returns and sends back the user's
choices (move-out date, discount, deduction lines). Nothing is
recalculated in the browser.
"""

import logging
import uuid
from datetime import date, timedelta
from typing import Optional, TypedDict

from fastapi import HTTPException
from supabase import Client

from app.core.labels import get_unit
from app.services.invoicing import (
    compute_prorated_charges,
    current_charges_with_earliest_start,
    post_invoice_journal,
)
from app.services.ledger import (
    get_account_id,
    get_tenant_account_balance_as_of,
    post_journal_entry,
    resolve_room_owner,
    reverse_journal_entry,
)
from app.services.income_allocation import allocate_payment_to_line_items
from app.services.utility_bills import apply_utility_overrides, fetch_bills

logger = logging.getLogger("app.lease_settlement")

# Far-future "as of" date: the settlement looks at everything the books hold
# for the tenant, exactly like the invoice-based side looks at every invoice.
LEDGER_AS_OF = "2100-01-01"
INVOICES_SETTLED_FALLBACK = "Invoices settled"
IN_CHUNK = 100


class DeductionInput(TypedDict, total=False):
    reason: str
    amount: float
    account_id: Optional[str]


def _fetch_lease_context(supabase: Client, lease_id: str) -> dict:
    lease = supabase.table("leases").select("*").eq("id", lease_id).single().execute()
    if not lease.data:
        raise HTTPException(status_code=404, detail="Lease not found")
    lease = lease.data

    tenant = supabase.table("tenants").select("*").eq("id", lease["tenant_id"]).single().execute().data
    room = supabase.table("rooms").select("*").eq("id", lease["room_id"]).single().execute().data
    building = (
        supabase.table("buildings").select("*").eq("id", room["building_id"]).single().execute().data
        if room else None
    )
    deposit_rows = (
        supabase.table("security_deposits").select("*").eq("lease_id", lease_id).execute().data
    )
    deposit = deposit_rows[0] if deposit_rows else None

    return {"lease": lease, "tenant": tenant, "room": room, "building": building, "deposit": deposit}


def _invoice_balance(supabase: Client, invoice: dict) -> float:
    payments = (
        supabase.table("payments").select("amount").eq("invoice_id", invoice["id"]).execute().data
    )
    paid = sum(float(p["amount"]) for p in payments)
    return float(invoice["total_amount"]) - paid


def _deposit_paid(supabase: Client, deposit_id: Optional[str]) -> float:
    if not deposit_id:
        return 0.0
    payments = (
        supabase.table("security_deposit_payments")
        .select("amount")
        .eq("security_deposit_id", deposit_id)
        .execute()
        .data
    )
    return sum(float(p["amount"]) for p in payments)


def _covers_month(lease_start: date, lease_end: date, month_start: date) -> bool:
    """True when the lease is in force for at least one day of the month."""
    next_month = date(
        month_start.year + (1 if month_start.month == 12 else 0),
        1 if month_start.month == 12 else month_start.month + 1,
        1,
    )
    return max(lease_start, month_start) <= min(lease_end, next_month - timedelta(days=1))


def _tenant_ledger_position(supabase: Client, company_id: str, lease_id: str, tenant_id: str) -> dict:
    """
    What the books hold for this tenant that the invoice-based figures cannot
    see. Read-only. Always filtered by company and tenant.

      receivable_other  Receivable (1100) balance in the ledger, minus what the
                        invoices table says is still unpaid (invoiced minus
                        paid, across all of the tenant's non-cancelled
                        invoices). That difference is the opening balance,
                        receipts against it and any other entry made through
                        the books. Zero when everything went through invoices.
      deposit_ledger    Security Deposits Held (2100) balance for the tenant.

    The ledger is tenant-wide, not lease-wide (a manually posted opening
    balance carries a tenant tag but no lease tag). If the tenant has another
    ACTIVE lease, closing this one must not sweep up that lease's balances, so
    in that case nothing is added and a note explains why.
    """
    other_active = (
        supabase.table("leases")
        .select("id")
        .eq("company_id", company_id)
        .eq("tenant_id", tenant_id)
        .eq("status", "active")
        .neq("id", lease_id)
        .execute()
        .data
    )
    if other_active:
        return {
            "applied": False,
            "note": (
                "This tenant has another active lease, so balances entered through the books "
                "(opening receivable, opening security) are not included here. Close the settlement "
                "after reviewing the tenant's ledger."
            ),
            "receivable_other": 0.0,
            "deposit_ledger": 0.0,
        }

    ar_id = get_account_id(supabase, company_id, "1100")
    dep_id = get_account_id(supabase, company_id, "2100")
    ar_ledger = get_tenant_account_balance_as_of(supabase, company_id, ar_id, tenant_id, LEDGER_AS_OF)
    dep_ledger = 0.0 - get_tenant_account_balance_as_of(supabase, company_id, dep_id, tenant_id, LEDGER_AS_OF)

    lease_ids = [
        r["id"]
        for r in supabase.table("leases").select("id").eq("company_id", company_id).eq("tenant_id", tenant_id).execute().data
    ]
    invoiced = 0.0
    invoice_ids: list[str] = []
    for i in range(0, len(lease_ids), IN_CHUNK):
        rows = (
            supabase.table("invoices")
            .select("id, total_amount")
            .eq("company_id", company_id)
            .in_("lease_id", lease_ids[i : i + IN_CHUNK])
            .neq("status", "cancelled")
            .execute()
            .data
        )
        for r in rows:
            invoiced += float(r["total_amount"])
            invoice_ids.append(r["id"])
    paid = 0.0
    for i in range(0, len(invoice_ids), IN_CHUNK):
        rows = (
            supabase.table("payments")
            .select("amount")
            .in_("invoice_id", invoice_ids[i : i + IN_CHUNK])
            .execute()
            .data
        )
        paid += sum(float(r["amount"]) for r in rows)

    return {
        "applied": True,
        "note": None,
        "receivable_other": round(ar_ledger - (invoiced - paid), 2),
        "deposit_ledger": round(dep_ledger, 2) + 0.0,
    }


def compute_settlement_preview(supabase: Client, company_id: str, lease_id: str, move_out_date: date) -> dict:
    """
    Read-only. Safe to call as often as the user changes the move-out date
    on screen -- writes nothing.
    """
    ctx = _fetch_lease_context(supabase, lease_id)
    lease, tenant, room, building, deposit = ctx["lease"], ctx["tenant"], ctx["room"], ctx["building"], ctx["deposit"]

    lease_start = date.fromisoformat(str(lease["start_date"]))
    move_out_month = move_out_date.replace(day=1)

    invoices = (
        supabase.table("invoices")
        .select("*")
        .eq("lease_id", lease_id)
        .neq("status", "cancelled")
        .order("invoice_month")
        .execute()
        .data
    )

    outstanding_prior = 0.0
    prior_month_lines = []
    move_out_month_invoice = None
    latest_invoiced_month: Optional[date] = None
    prior_invoice_count = 0

    for inv in invoices:
        inv_month = date.fromisoformat(str(inv["invoice_month"]))
        if inv_month == move_out_month:
            move_out_month_invoice = inv
            continue
        if inv_month > move_out_month:
            # An invoice already exists for a month after the tenant is
            # leaving (unusual, but possible if generation ran ahead of
            # schedule) -- whatever's unpaid on it isn't really owed, so
            # it's excluded rather than added to outstanding. Flagged so
            # a human notices and can void/adjust it separately.
            continue
        prior_invoice_count += 1
        balance = round(_invoice_balance(supabase, inv), 2)
        latest_invoiced_month = inv_month if latest_invoiced_month is None else max(latest_invoiced_month, inv_month)
        if abs(balance) > 0.01:
            outstanding_prior += balance
            prior_month_lines.append(
                {"invoice_month": str(inv_month), "balance": balance, "invoice_id": inv["id"], "invoice_total": float(inv["total_amount"])}
            )

    # "First invoice ever" means no invoice existed BEFORE the move-out
    # month -- not "no invoices at all", since the move-out month may
    # already have its own (about-to-be-corrected) invoice. Using the
    # wrong definition here would wrongly zero out one-time charges (or
    # wrongly re-include them) when correcting an existing invoice.
    is_first_invoice_ever = prior_invoice_count == 0

    # Any fully-skipped months between the last invoice and the move-out
    # month (generation simply never ran for them) still get billed in
    # full here, using the normal proration function -- these are wholly
    # in the past so there's no partial-period math needed, just the
    # regular monthly charge set.
    charges = current_charges_with_earliest_start(supabase, lease_id)
    gap_month_lines = []
    if latest_invoiced_month is not None:
        cursor = date(latest_invoiced_month.year + (1 if latest_invoiced_month.month == 12 else 0),
                       1 if latest_invoiced_month.month == 12 else latest_invoiced_month.month + 1, 1)
        while cursor < move_out_month:
            gap_charges = compute_prorated_charges(charges, lease_start, move_out_date, cursor, is_first_invoice=False)
            gap_bills = fetch_bills(supabase, [lease_id], cursor).get(lease_id, [])
            if gap_bills and (gap_charges or _covers_month(lease_start, move_out_date, cursor)):
                gap_charges = apply_utility_overrides(gap_charges, gap_bills)
            gap_total = round(sum(c["amount"] for c in gap_charges), 2)
            if gap_total > 0:
                outstanding_prior += gap_total
                gap_month_lines.append({"invoice_month": str(cursor), "amount": gap_total, "note": "not yet invoiced"})
            cursor = date(cursor.year + (1 if cursor.month == 12 else 0), 1 if cursor.month == 12 else cursor.month + 1, 1)
    outstanding_prior = round(outstanding_prior, 2)

    # The move-out month itself, prorated through move_out_date -- this is
    # the "days from last bill to last date" the tenant asked about. If an
    # invoice already exists for this month, this is what it SHOULD be
    # once corrected for the actual move-out date (the difference is
    # applied when finalizing, not here).
    final_period_charges = compute_prorated_charges(
        charges, lease_start, move_out_date, move_out_month, is_first_invoice=is_first_invoice_ever
    )
    # Imported utility bills (electricity, gas, water) for the move-out month
    # replace or add to the lease's own lines, exactly as on every other
    # invoice path -- the bill is the bill, never prorated.
    final_bills = fetch_bills(supabase, [lease_id], move_out_month).get(lease_id, [])
    if final_bills and (final_period_charges or _covers_month(lease_start, move_out_date, move_out_month)):
        final_period_charges = apply_utility_overrides(final_period_charges, final_bills)
    final_period_total = round(sum(c["amount"] for c in final_period_charges), 2)

    already_billed_this_month = float(move_out_month_invoice["total_amount"]) if move_out_month_invoice else 0.0
    already_paid_this_month = round(_invoice_balance(supabase, move_out_month_invoice) * -1 + already_billed_this_month, 2) if move_out_month_invoice else 0.0
    # ^ amount actually paid so far toward the move-out month's invoice, if one exists

    ledger = _tenant_ledger_position(supabase, company_id, lease_id, lease["tenant_id"])
    ledger_other_receivable = ledger["receivable_other"]

    total_owed_by_tenant = round(
        outstanding_prior + final_period_total - already_paid_this_month + ledger_other_receivable, 2
    )

    deposit_agreed = float(deposit["amount_received"]) if deposit else 0.0
    deposit_paid_in_records = _deposit_paid(supabase, deposit["id"] if deposit else None)
    # When the ledger applies, "actually paid" is what the books hold in
    # Security Deposits Held for this tenant -- it includes payments recorded
    # through the deposit screen AND any opening deposit entered by journal.
    deposit_paid = max(ledger["deposit_ledger"], 0.0) if ledger["applied"] else deposit_paid_in_records

    return {
        "lease": lease,
        "tenant": tenant,
        "room": room,
        "building": building,
        "move_out_date": str(move_out_date),
        "outstanding_prior_amount": outstanding_prior,
        "outstanding_prior_detail": prior_month_lines,
        "unbilled_gap_months": gap_month_lines,
        "final_period_charges": final_period_charges,
        "final_period_total": final_period_total,
        "final_period_already_billed": already_billed_this_month,
        "final_period_already_paid": already_paid_this_month,
        "move_out_month_has_existing_invoice": move_out_month_invoice is not None,
        "total_owed_by_tenant": total_owed_by_tenant,
        "deposit_agreed": deposit_agreed,
        "deposit_paid": deposit_paid,
        "deposit_paid_in_records": deposit_paid_in_records,
        "deposit_from_ledger_extra": round(max(deposit_paid - deposit_paid_in_records, 0.0), 2),
        "ledger_applied": ledger["applied"],
        "ledger_note": ledger["note"],
        "ledger_other_receivable": ledger_other_receivable,
        "net_before_discount_and_deductions": round(deposit_paid - total_owed_by_tenant, 2),
    }


def _apply_final_period_invoice(
    supabase: Client, company_id: str, lease: dict, move_out_date: date,
    final_period_charges: list, move_out_month_invoice: Optional[dict],
) -> Optional[dict]:
    """
    Ensures the move-out month's invoice reflects the prorated final
    period, not a full month -- creating it if it doesn't exist yet, or
    reversing-and-reposting it (never editing in place, same rule as
    everywhere else in this ledger) if one was already generated for the
    full month before the move-out date was known.
    """
    move_out_month = move_out_date.replace(day=1)

    if move_out_month_invoice:
        live_entries = (
            supabase.table("journal_entries")
            .select("id")
            .eq("source_type", "invoice")
            .eq("source_id", move_out_month_invoice["id"])
            .eq("status", "posted")
            .is_("reversal_of", "null")
            .execute()
            .data
        )
        # Only ORIGINAL entries are reversed (a reversal entry already cancels
        # its original; reversing it again would put the cancelled amount back
        # into the ledger) -- the same rule invoicing.py follows.
        for entry in live_entries:
            # Dated the move-out date -- the same date the corrected invoice is
            # reposted on -- so the reversal and the repost always fall in the
            # same period (a reversal dated "today" left the original invoice
            # in its month and the cancellation in a later one).
            reverse_journal_entry(
                supabase, company_id, entry["id"],
                reason="Lease closed — final period recalculated", entry_date=str(move_out_date),
            )

        supabase.table("invoice_line_items").delete().eq("invoice_id", move_out_month_invoice["id"]).execute()
        if not final_period_charges:
            supabase.table("invoices").update({"status": "cancelled", "total_amount": 0}).eq(
                "id", move_out_month_invoice["id"]
            ).execute()
            return None

        supabase.table("invoice_line_items").insert(
            [
                {
                    "company_id": company_id,
                    "invoice_id": move_out_month_invoice["id"],
                    "label": c["label"],
                    "amount": c["amount"],
                    "show_on_invoice": c.get("show_on_invoice", True),
                }
                for c in final_period_charges
            ]
        ).execute()
        new_total = post_invoice_journal(
            supabase, company_id, move_out_month_invoice, lease, final_period_charges, entry_date=move_out_date
        )
        updated = (
            supabase.table("invoices")
            .update({"total_amount": new_total})
            .eq("id", move_out_month_invoice["id"])
            .execute()
            .data[0]
        )
        return updated

    if not final_period_charges:
        return None

    total = sum(c["amount"] for c in final_period_charges)
    invoice = (
        supabase.table("invoices")
        .insert(
            {
                "company_id": company_id,
                "lease_id": lease["id"],
                "invoice_month": str(move_out_month),
                "due_date": str(move_out_date),
                "total_amount": total,
                "status": "draft",
            }
        )
        .execute()
        .data[0]
    )
    supabase.table("invoice_line_items").insert(
        [
            {
                "company_id": company_id,
                "invoice_id": invoice["id"],
                "label": c["label"],
                "amount": c["amount"],
                "show_on_invoice": c.get("show_on_invoice", True),
            }
            for c in final_period_charges
        ]
    ).execute()
    post_invoice_journal(supabase, company_id, invoice, lease, final_period_charges, entry_date=move_out_date)
    return invoice


def _dues_segments(preview: dict, final_invoice: Optional[dict]) -> list[dict]:
    """
    What the tenant owed at settlement, in the order a receipt clears it:
    opening balance first, then invoices oldest to newest, then months that
    were never invoiced, then the corrected move-out month. Each segment:
    {kind: opening|invoice|gap, invoice_id, invoice_total, balance, label}.
    """
    segments: list[dict] = []
    opening = round(max(float(preview.get("ledger_other_receivable") or 0), 0.0), 2)
    if opening > 0.005:
        segments.append({"kind": "opening", "invoice_id": None, "invoice_total": 0.0, "balance": opening, "label": "Opening balance"})
    for prior in preview.get("outstanding_prior_detail", []):
        bal = round(float(prior["balance"]), 2)
        if bal > 0.005:
            segments.append(
                {"kind": "invoice", "invoice_id": prior["invoice_id"], "invoice_total": float(prior["invoice_total"]), "balance": bal, "label": prior["invoice_month"]}
            )
    for gap in preview.get("unbilled_gap_months", []):
        amt = round(float(gap["amount"]), 2)
        if amt > 0.005:
            segments.append({"kind": "gap", "invoice_id": None, "invoice_total": 0.0, "balance": amt, "label": "Unbilled months"})
    if final_invoice:
        final_owed = round(float(preview["final_period_total"]) - float(preview["final_period_already_paid"]), 2)
        if final_owed > 0.005:
            segments.append(
                {"kind": "invoice", "invoice_id": final_invoice["id"], "invoice_total": float(preview["final_period_total"]), "balance": final_owed, "label": "final month"}
            )
    return segments


def _record_settlement_receipts(
    supabase: Client, company_id: str, lease_id: str, tenant_id: str,
    cash: float, offset: float, discount: float,
    cash_account: Optional[dict], offset_account_id: Optional[str],
    payment_date: str, preview: dict, final_invoice: Optional[dict],
) -> list[str]:
    """
    Records what settled the tenant's dues as ordinary receipts against the
    invoices, oldest dues first -- the same order Receive Payment uses:

      cash      money the tenant handed over now
      offset    dues paid out of the tenant's own security deposit
      discount  dues written off

    All three are real settlements of what the tenant owed (the deposit
    simply pays them), so the invoices show as paid, the receipt appears in
    Receipts by Head by income head, and the tenant's ledger and invoice
    balances agree. No journal entry is posted here: the single settlement
    entry already contains them. Runs after the books are posted, so a failure
    here cannot undo the closing -- but it is NEVER silent: the problems are
    returned and shown to the user, who is told to review the invoices.
    """
    problems: list[str] = []
    created = 0
    group_id = str(uuid.uuid4())
    cash_method = "cash" if "cash" in ((cash_account or {}).get("name") or "").lower() else "bank_transfer"
    left = {"cash": round(cash, 2), "offset": round(offset, 2), "discount": round(discount, 2)}
    touched_invoices: list[str] = []
    try:
        for seg in _dues_segments(preview, final_invoice):
            seg_left = seg["balance"]
            for kind in ("cash", "offset", "discount"):
                take = round(min(left[kind], seg_left), 2)
                if take <= 0.005:
                    continue
                if seg["kind"] != "invoice" and kind == "discount":
                    continue  # nothing to write a discount against on an opening / unbilled balance
                where = " (applied to opening balance)" if seg["kind"] == "opening" else " (applied to unbilled months)" if seg["kind"] == "gap" else ""
                if kind == "cash":
                    row = {"amount": take, "discount_amount": 0, "account_id": cash_account["id"], "payment_method": cash_method,
                           "notes": "Received at final settlement" + where}
                elif kind == "offset":
                    row = {"amount": take, "discount_amount": 0, "account_id": offset_account_id, "payment_method": "other",
                           "notes": "Paid out of security deposit at final settlement" + where}
                else:
                    row = {"amount": 0, "discount_amount": take, "account_id": None, "payment_method": "other",
                           "notes": "Discount at final settlement"}
                row.update({"company_id": company_id, "invoice_id": seg["invoice_id"], "tenant_id": tenant_id,
                            "payment_date": payment_date, "receipt_group_id": group_id})
                payment = supabase.table("payments").insert(row).execute().data[0]
                created += 1
                left[kind] = round(left[kind] - take, 2)
                seg_left = round(seg_left - take, 2)
                if seg["invoice_id"]:
                    try:
                        allocate_payment_to_line_items(
                            supabase, company_id, payment["id"], seg["invoice_id"], tenant_id, lease_id,
                            row["amount"], row["discount_amount"],
                        )
                    except Exception as exc:
                        logger.exception("allocation failed for settlement payment %s", payment["id"])
                        problems.append(f"Splitting a receipt by income head failed ({exc}).")
                    if seg["invoice_id"] not in touched_invoices:
                        touched_invoices.append(seg["invoice_id"])
        for invoice_id in touched_invoices:
            inv_rows = supabase.table("payments").select("amount, discount_amount").eq("invoice_id", invoice_id).execute().data
            settled = sum(float(p["amount"]) + float(p.get("discount_amount") or 0) for p in inv_rows)
            inv = supabase.table("invoices").select("total_amount").eq("id", invoice_id).single().execute().data
            new_status = "paid" if inv and settled >= float(inv["total_amount"]) - 0.01 else "partial"
            supabase.table("invoices").update({"status": new_status}).eq("id", invoice_id).execute()
        if left["cash"] > 0.005:
            # Cannot happen (received is capped at what is owed), but never
            # lose track of money that came in: keep it as an advance.
            supabase.table("payments").insert(
                {
                    "company_id": company_id, "invoice_id": None, "tenant_id": tenant_id, "amount": left["cash"],
                    "discount_amount": 0, "account_id": cash_account["id"], "payment_date": payment_date,
                    "payment_method": cash_method, "notes": "Received at final settlement (advance)", "receipt_group_id": group_id,
                }
            ).execute()
    except Exception as exc:
        logger.exception("could not record settlement receipts for lease %s", lease_id)
        problems.append(f"Recording the receipts against the invoices failed ({exc}).")
    if (cash + offset + discount) > 0.01 and created == 0 and not problems:
        problems.append("No receipt was recorded against the invoices (nothing was found to settle).")
    return problems


def _build_settlement_lines(
    deductions: list, refund_amount: float, refund_account: Optional[dict],
) -> list[dict]:
    """
    Reporting detail kept for each settlement: each settlement charge (income
    taken from the deposit, with its own GL account) and the refund paid out.
    The dues paid out of the deposit are NOT listed here -- they are recorded
    as ordinary receipts against the invoices (see _record_settlement_receipts),
    which is where Receipts by Head reads them from.
    """
    lines: list[dict] = []
    for d in deductions:
        amt = round(float(d["amount"]), 2)
        if amt > 0:
            lines.append({"kind": "charge", "label": d["reason"], "amount": amt, "account_id": d.get("account_id")})
    if refund_amount > 0.01 and refund_account:
        lines.append({"kind": "refund_paid", "label": "Refund paid", "amount": round(refund_amount, 2), "account_id": refund_account["id"]})
    return lines


def _save_settlement_lines(
    supabase: Client, company_id: str, settlement_id: str, lease_id: str, tenant_id: str, settled_on: str, lines: list[dict]
) -> None:
    """Best-effort, like the other reporting sub-ledgers: a failure here must
    never undo a lease closing that has already been posted. If it fails (or
    migration 022 has not been run), the report rebuilds this settlement from
    its journal entry instead."""
    if not lines:
        return
    try:
        supabase.table("settlement_allocations").insert(
            [
                {
                    "company_id": company_id,
                    "settlement_id": settlement_id,
                    "lease_id": lease_id,
                    "tenant_id": tenant_id,
                    "settled_on": settled_on,
                    "kind": l["kind"],
                    "label": l["label"],
                    "amount": l["amount"],
                    "account_id": l.get("account_id"),
                }
                for l in lines
            ]
        ).execute()
    except Exception:
        logger.exception("settlement_allocations insert failed for settlement %s", settlement_id)


def finalize_settlement(
    supabase: Client,
    company_id: str,
    lease_id: str,
    move_out_date: date,
    discount_amount: float,
    discount_account_id: Optional[str],
    discount_reason: Optional[str],
    deductions: list[DeductionInput],
    show_full_detail_on_pdf: bool,
    refund_date: Optional[date],
    reason: Optional[str],
    created_by: Optional[str],
    refund_account_id: Optional[str] = None,
    received_amount: float = 0.0,
    received_account_id: Optional[str] = None,
) -> dict:
    """
    Re-runs the same computation compute_settlement_preview() does --
    never trusts numbers the client may have shown the user a moment ago
    -- then posts everything: the corrected final-period invoice, the
    discount write-off (if any), the deposit deductions and refund, and
    finally updates the lease itself. Returns the saved lease_settlements
    row.
    """
    preview = compute_settlement_preview(supabase, company_id, lease_id, move_out_date)
    lease, tenant, room = preview["lease"], preview["tenant"], preview["room"]

    # If a refund will be paid out, the user must say which cash/bank account
    # it comes from -- checked BEFORE anything is written, so a missing or
    # invalid choice can never leave a half-closed lease behind.
    expected_deductions = round(sum(max(float(d["amount"]), 0.0) for d in deductions), 2)
    expected_owed = max(round(preview["total_owed_by_tenant"] - float(discount_amount or 0), 2), 0.0)
    expected_offset = min(expected_owed, max(preview["deposit_paid"] - expected_deductions, 0.0))
    expected_refund = round(max(preview["deposit_paid"] - expected_deductions - expected_offset, 0.0), 2)
    refund_account = None
    if expected_refund > 0.005:
        if not refund_account_id:
            raise HTTPException(status_code=400, detail="Select which cash or bank account the refund is paid from.")
        found = (
            supabase.table("chart_of_accounts")
            .select("id, code, name, is_cash_or_bank")
            .eq("id", refund_account_id)
            .eq("company_id", company_id)
            .execute()
            .data
        )
        if not found or not found[0].get("is_cash_or_bank"):
            raise HTTPException(status_code=400, detail="The refund must be paid from a cash or bank account.")
        refund_account = found[0]

    # Money the tenant hands over now because the deposit does not cover what
    # is owed. It can never exceed that shortfall, and it needs a cash/bank
    # account to land in. Also checked before anything is written.
    expected_shortfall = round(expected_owed - expected_offset, 2)
    received_amount = round(max(float(received_amount or 0), 0.0), 2)
    received_account = None
    if received_amount > 0.005:
        if received_amount > expected_shortfall + 0.01:
            raise HTTPException(
                status_code=400,
                detail=f"The amount received ({received_amount:,.0f}) can't be more than what is still owed after the deposit ({max(expected_shortfall, 0):,.0f}).",
            )
        if not received_account_id:
            raise HTTPException(status_code=400, detail="Select which cash or bank account the money is received into.")
        found_recv = (
            supabase.table("chart_of_accounts")
            .select("id, code, name, is_cash_or_bank")
            .eq("id", received_account_id)
            .eq("company_id", company_id)
            .execute()
            .data
        )
        if not found_recv or not found_recv[0].get("is_cash_or_bank"):
            raise HTTPException(status_code=400, detail="The money must be received into a cash or bank account.")
        received_account = found_recv[0]

    building_id = room["building_id"] if room else None
    owner_id = resolve_room_owner(supabase, lease["room_id"])
    tenant_id = lease["tenant_id"]
    tenant_name = tenant["full_name"] if tenant else "Tenant"
    room_label = room.get("room_number", "room") if room else "room"

    move_out_month = move_out_date.replace(day=1)
    existing_invoice_rows = (
        supabase.table("invoices")
        .select("*")
        .eq("lease_id", lease_id)
        .eq("invoice_month", str(move_out_month))
        .neq("status", "cancelled")
        .execute()
        .data
    )
    move_out_month_invoice = existing_invoice_rows[0] if existing_invoice_rows else None

    final_invoice = _apply_final_period_invoice(
        supabase, company_id, lease, move_out_date, preview["final_period_charges"], move_out_month_invoice
    )

    total_owed_by_tenant = preview["total_owed_by_tenant"]

    # --- Discount: reduces what the tenant owes. Written off, not cash moving.
    # It is posted inside the ONE combined settlement entry below
    # (Dr [chosen account] / Cr Accounts Receivable). ---
    discount = round(float(discount_amount or 0), 2)
    if discount > 0:
        if not discount_account_id:
            raise HTTPException(status_code=400, detail="Select which account the discount should be charged to.")
        account = (
            supabase.table("chart_of_accounts")
            .select("id")
            .eq("id", discount_account_id)
            .eq("company_id", company_id)
            .single()
            .execute()
        )
        if not account.data:
            raise HTTPException(status_code=404, detail="Discount account not found")
        total_owed_by_tenant = round(total_owed_by_tenant - discount, 2)

    # --- Security deposit: itemized deductions (each to its own account),
    # then refund whatever's left after both deductions AND outstanding
    # rent are cleared. ---
    ctx = _fetch_lease_context(supabase, lease_id)
    deposit = ctx["deposit"]
    deposit_id = deposit["id"] if deposit else None
    deposit_paid = preview["deposit_paid"]

    # A deposit that exists only in the books (entered by journal) with no
    # deposit record: create the record so deductions and the refund have
    # something to attach to. Its amount is exactly what the ledger holds.
    if deposit_id is None and deposit_paid > 0.01:
        created = (
            supabase.table("security_deposits")
            .insert(
                {
                    "company_id": company_id,
                    "lease_id": lease_id,
                    "amount_received": deposit_paid,
                    "date_received": str(lease["start_date"]),
                    "status": "held",
                    "is_received": True,
                }
            )
            .execute()
            .data[0]
        )
        deposit_id = created["id"]

    deductions_total = 0.0
    if deposit_id and deductions:
        rows = []
        for d in deductions:
            amt = float(d["amount"])
            if amt <= 0:
                continue
            deductions_total += amt
            rows.append(
                {
                    "company_id": company_id,
                    "security_deposit_id": deposit_id,
                    "reason": d["reason"],
                    "amount": amt,
                    "account_id": d.get("account_id"),
                }
            )
        if rows:
            supabase.table("security_deposit_deductions").insert(rows).execute()
    deductions_total = round(deductions_total, 2)

    # Whatever rent is still owed after the discount also comes out of the
    # deposit, exactly like a deduction -- credited to Accounts Receivable
    # instead of an income account, since this is clearing a real
    # receivable, not company income.
    rent_offset = round(min(max(total_owed_by_tenant, 0.0), max(deposit_paid - deductions_total, 0.0)), 2)
    shortfall = round(max(total_owed_by_tenant, 0.0) - rent_offset, 2)
    received = round(min(received_amount, max(shortfall, 0.0)), 2)

    refund_amount = round(max(deposit_paid - deductions_total - rent_offset, 0.0), 2)

    # net_amount > 0  -> refund due to tenant
    # net_amount < 0  -> tenant still owes this amount after the deposit and
    #                    after anything received now
    net_amount = round(deposit_paid - deductions_total - total_owed_by_tenant + received, 2)

    entry_date = str(refund_date or move_out_date)
    warnings: list[str] = []

    # ONE journal entry for the whole settlement:
    #   Dr [cash/bank]            money received now (deposit short of dues)
    #   Dr Security Deposits Held the whole deposit
    #   Dr [discount account]     discount (if any)
    #   Cr Accounts Receivable    everything cleared (offset + received + discount)
    #   Cr [charge accounts]      each deduction (if any)
    #   Cr [cash/bank]            refund (only when the deposit is more than dues)
    if deposit_paid > 0.01 or received > 0.01 or discount > 0.01:
        deposits_held_id = get_account_id(supabase, company_id, "2100")
        ar_id = get_account_id(supabase, company_id, "1100")
        tags = {"building_id": building_id, "room_id": lease["room_id"], "owner_id": owner_id, "tenant_id": tenant_id, "lease_id": lease_id}

        lines = []
        if received > 0.01:
            lines.append({"account_id": received_account["id"], "direction": "debit", "amount": received, **tags})
        if deposit_paid > 0.01:
            lines.append({"account_id": deposits_held_id, "direction": "debit", "amount": round(deposit_paid, 2), **tags})
        if discount > 0.01:
            lines.append({"account_id": discount_account_id, "direction": "debit", "amount": discount, **tags})

        ar_credit = round(rent_offset + received + discount, 2)
        if ar_credit > 0.01:
            lines.append({"account_id": ar_id, "direction": "credit", "amount": ar_credit, **tags})

        # Group deduction amounts by account (falling back to Other Income
        # for any deduction that didn't specify one), one credit line per
        # account rather than one line per deduction.
        by_account: dict[str, float] = {}
        if deposit_id:
            for d in deductions:
                amt = float(d["amount"])
                if amt <= 0:
                    continue
                acct = d.get("account_id") or get_account_id(supabase, company_id, "4100")
                by_account[acct] = by_account.get(acct, 0.0) + amt
        for acct_id, amt in by_account.items():
            lines.append({"account_id": acct_id, "direction": "credit", "amount": round(amt, 2), **tags})

        if refund_amount > 0.01:
            lines.append({"account_id": refund_account["id"], "direction": "credit", "amount": refund_amount, **tags})

        # Same convention the existing manual refund flow uses (see
        # security_deposits.py's refund_deposit): "refunded" only when
        # NOTHING was held back -- here that means no itemized deductions
        # AND no amount kept to cover outstanding rent. Any amount kept
        # back for either reason makes it "partially_refunded", even if
        # the cash refund happens to come out to zero (kept back for
        # dues, not literally deducted line by line).
        held_back = deductions_total + rent_offset
        status = "partially_refunded" if held_back > 0.01 else "refunded"
        post_journal_entry(
            supabase,
            company_id=company_id,
            entry_date=entry_date,
            source_type="security_deposit_refund",
            source_id=deposit_id,
            description=f"Security deposit settled at move-out — {tenant_name}",
            lines=lines,
            created_by=created_by,
        )
        if deposit_id:
            supabase.table("security_deposits").update(
                {
                    "amount_refunded": refund_amount,
                    "date_refunded": entry_date,
                    "status": status,
                }
            ).eq("id", deposit_id).execute()

        # The cash part is also recorded as ordinary payments against the
        # invoices (no second journal entry -- the bank debit is already in
        # the entry above), so those invoices show as paid and the receipt
        # appears in Receipts by Head by income head.
        # Cash received, dues paid out of the deposit, and any discount all
        # settled invoices -- record them as receipts so the invoices show as
        # paid and Receipts by Head shows them by income head.
        if received > 0.01 or rent_offset > 0.01 or discount > 0.01:
            warnings = _record_settlement_receipts(
                supabase, company_id, lease_id, tenant_id, received, rent_offset, discount,
                received_account, (refund_account or received_account or {}).get("id"),
                entry_date, preview, final_invoice,
            )

    # --- Close the lease itself ---
    supabase.table("leases").update(
        {
            "status": "terminated",
            "end_date": str(move_out_date),
            "terminated_at": str(date.today()),
            "termination_reason": reason or "Closed via settlement",
        }
    ).eq("id", lease_id).execute()
    supabase.table("rooms").update({"status": "vacant"}).eq("id", lease["room_id"]).execute()

    # --- Save the settlement record for the printable statement ---
    settlement_row = {
        "company_id": company_id,
        "lease_id": lease_id,
        "move_out_date": str(move_out_date),
        "outstanding_prior_amount": preview["outstanding_prior_amount"],
        "final_period_charges": preview["final_period_charges"],
        "final_period_total": preview["final_period_total"],
        "final_invoice_id": final_invoice["id"] if final_invoice else None,
        "total_owed_by_tenant": preview["total_owed_by_tenant"],
        "discount_amount": discount_amount or 0,
        "discount_account_id": discount_account_id,
        "discount_reason": discount_reason,
        "deposit_id": deposit_id,
        "deposit_agreed": preview["deposit_agreed"],
        "deposit_paid": deposit_paid,
        "deductions_total": deductions_total,
        "net_amount": net_amount,
        "show_full_detail_on_pdf": show_full_detail_on_pdf,
        "reason": reason,
        "created_by": created_by,
        "ledger_adjustments": {
            # What was actually received / refunded, and into / out of which
            # account -- printed on the statement.
            "received_amount": received,
            "received_account": f"{received_account['code']} · {received_account['name']}" if received_account else None,
            "refund_amount": refund_amount,
            "refund_account": f"{refund_account['code']} · {refund_account['name']}" if refund_account else None,
            "still_owed": round(max(shortfall - received, 0.0), 2),
            "applied": preview["ledger_applied"],
            "other_receivable": preview["ledger_other_receivable"],
            "deposit_paid_in_records": preview["deposit_paid_in_records"],
            "deposit_from_ledger_extra": preview["deposit_from_ledger_extra"],
        },
    }
    settlement_lines = _build_settlement_lines(deductions, refund_amount, refund_account)
    try:
        saved = supabase.table("lease_settlements").insert(settlement_row).execute().data[0]
    except Exception:
        # The ledger_adjustments column comes from migration 021. If it has not
        # been run yet, still save the settlement (the books are already posted
        # at this point) -- the printed statement just won't itemize the
        # opening-balance line until the migration is run.
        logger.exception("lease_settlements insert with ledger_adjustments failed; retrying without it")
        settlement_row.pop("ledger_adjustments", None)
        saved = supabase.table("lease_settlements").insert(settlement_row).execute().data[0]

    _save_settlement_lines(
        supabase, company_id, saved["id"], lease_id, tenant_id, entry_date, settlement_lines
    )
    saved["warnings"] = warnings
    return saved
