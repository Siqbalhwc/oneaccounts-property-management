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

All the arithmetic lives here, server-side, on purpose -- the settlement
page just displays whatever this returns and sends back the user's
choices (move-out date, discount, deduction lines). Nothing is
recalculated in the browser.
"""

from datetime import date
from typing import Optional, TypedDict

from fastapi import HTTPException
from supabase import Client

from app.services.invoicing import (
    compute_prorated_charges,
    current_charges_with_earliest_start,
    post_invoice_journal,
)
from app.services.ledger import (
    get_account_id,
    post_journal_entry,
    resolve_room_owner,
    reverse_journal_entry,
)


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
            prior_month_lines.append({"invoice_month": str(inv_month), "balance": balance})

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
    final_period_total = round(sum(c["amount"] for c in final_period_charges), 2)

    already_billed_this_month = float(move_out_month_invoice["total_amount"]) if move_out_month_invoice else 0.0
    already_paid_this_month = round(_invoice_balance(supabase, move_out_month_invoice) * -1 + already_billed_this_month, 2) if move_out_month_invoice else 0.0
    # ^ amount actually paid so far toward the move-out month's invoice, if one exists

    total_owed_by_tenant = round(outstanding_prior + final_period_total - already_paid_this_month, 2)

    deposit_agreed = float(deposit["amount_received"]) if deposit else 0.0
    deposit_paid = _deposit_paid(supabase, deposit["id"] if deposit else None)

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
            .execute()
            .data
        )
        for entry in live_entries:
            reverse_journal_entry(supabase, company_id, entry["id"], reason="Lease closed — final period recalculated")

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

    # --- Discount: reduces what the tenant owes. Dr [chosen account] / Cr
    # Accounts Receivable -- a write-off, not cash moving. ---
    if discount_amount and discount_amount > 0:
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

        ar_id = get_account_id(supabase, company_id, "1100")
        tags = {"building_id": building_id, "room_id": lease["room_id"], "owner_id": owner_id, "tenant_id": tenant_id, "lease_id": lease_id}
        post_journal_entry(
            supabase,
            company_id=company_id,
            entry_date=str(move_out_date),
            source_type="manual_adjustment",
            source_id=None,
            description=f"Move-out discount — {tenant_name}, Room {room_label}" + (f" ({discount_reason})" if discount_reason else ""),
            lines=[
                {"account_id": discount_account_id, "direction": "debit", "amount": discount_amount, **tags},
                {"account_id": ar_id, "direction": "credit", "amount": discount_amount, **tags},
            ],
            created_by=created_by,
        )
        total_owed_by_tenant = round(total_owed_by_tenant - discount_amount, 2)

    # --- Security deposit: itemized deductions (each to its own account),
    # then refund whatever's left after both deductions AND outstanding
    # rent are cleared. ---
    ctx = _fetch_lease_context(supabase, lease_id)
    deposit = ctx["deposit"]
    deposit_id = deposit["id"] if deposit else None
    deposit_paid = preview["deposit_paid"]

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
    rent_offset = min(max(total_owed_by_tenant, 0.0), max(deposit_paid - deductions_total, 0.0))

    net_amount = round(deposit_paid - deductions_total - total_owed_by_tenant, 2)
    # net_amount > 0  -> refund due to tenant
    # net_amount < 0  -> tenant still owes this amount (deposit didn't cover it)

    if deposit_id and (deductions_total > 0 or rent_offset > 0 or net_amount > 0):
        deposits_held_id = get_account_id(supabase, company_id, "2100")
        bank_id = get_account_id(supabase, company_id, "1000")
        ar_id = get_account_id(supabase, company_id, "1100")
        tags = {"building_id": building_id, "room_id": lease["room_id"], "owner_id": owner_id, "tenant_id": tenant_id, "lease_id": lease_id}

        lines = [{"account_id": deposits_held_id, "direction": "debit", "amount": deposit_paid, **tags}]

        # Group deduction amounts by account (falling back to Other Income
        # for any deduction that didn't specify one), one credit line per
        # account rather than one line per deduction.
        by_account: dict[str, float] = {}
        for d in deductions:
            amt = float(d["amount"])
            if amt <= 0:
                continue
            acct = d.get("account_id") or get_account_id(supabase, company_id, "4100")
            by_account[acct] = by_account.get(acct, 0.0) + amt
        for acct_id, amt in by_account.items():
            lines.append({"account_id": acct_id, "direction": "credit", "amount": round(amt, 2), **tags})

        if rent_offset > 0:
            lines.append({"account_id": ar_id, "direction": "credit", "amount": round(rent_offset, 2), **tags})

        refund_amount = max(deposit_paid - deductions_total - rent_offset, 0.0)
        if refund_amount > 0.01:
            lines.append({"account_id": bank_id, "direction": "credit", "amount": round(refund_amount, 2), **tags})

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
            entry_date=str(refund_date or move_out_date),
            source_type="security_deposit_refund",
            source_id=deposit_id,
            description=f"Security deposit settled at move-out — {tenant_name}",
            lines=lines,
            created_by=created_by,
        )
        supabase.table("security_deposits").update(
            {
                "amount_refunded": refund_amount,
                "date_refunded": str(refund_date or move_out_date),
                "status": status,
            }
        ).eq("id", deposit_id).execute()

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
    }
    saved = supabase.table("lease_settlements").insert(settlement_row).execute().data[0]
    return saved
