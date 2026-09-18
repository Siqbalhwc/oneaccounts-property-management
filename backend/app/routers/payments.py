import logging
import uuid
from datetime import date
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from supabase import Client

from app.core.deps import get_current_company_id, get_current_user, get_service_client, get_supabase
from app.services.income_allocation import allocate_payment_to_line_items
from app.services.ledger import (
    UnbalancedJournalEntry,
    get_account_id,
    get_tenant_account_balance_as_of,
    post_journal_entry,
    resolve_room_owner,
)

router = APIRouter(prefix="/payments", tags=["Payments"])
logger = logging.getLogger("app.payments")


@router.get("")
def list_payments(
    date_from: Optional[date] = Query(None, description="Only payments on/after this date"),
    date_to: Optional[date] = Query(None, description="Only payments on/before this date"),
    supabase: Client = Depends(get_supabase),
):
    """
    Optional date_from/date_to narrow the result by payment_date -- purely
    additive: omitting both returns exactly what this endpoint always
    returned (every payment), so existing callers (Reports page, etc.) are
    unaffected. Added so the Dashboard can request a recent window instead
    of the company's entire payment history every time it loads.
    """
    query = supabase.table("payments").select("*")
    if date_from:
        query = query.gte("payment_date", str(date_from))
    if date_to:
        query = query.lte("payment_date", str(date_to))
    return query.order("payment_date", desc=True).execute().data


@router.post("", status_code=201)
def record_payment(
    payload: Dict[str, Any],
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    """
    Records a payment against an invoice. If the payment covers the invoice's
    full total_amount, auto-marks the invoice paid; otherwise marks partial.
    Expected payload: {invoice_id, tenant_id, amount, payment_date, payment_method, notes}
    """
    payload["company_id"] = company_id

    account_id = payload.get("account_id")
    if not account_id:
        raise HTTPException(
            status_code=400,
            detail="Select which account this payment was received into (Bank, Cash, etc.).",
        )
    account = (
        supabase.table("chart_of_accounts")
        .select("id")
        .eq("id", account_id)
        .eq("company_id", company_id)
        .single()
        .execute()
    )
    if not account.data:
        raise HTTPException(status_code=404, detail="Account not found")

    payment = supabase.table("payments").insert(payload).execute().data[0]

    invoice_id = payload.get("invoice_id")
    building_id, room_id, owner_id, lease_id = None, None, None, None
    tenant_id = payload.get("tenant_id")

    if invoice_id:
        invoice = (
            supabase.table("invoices").select("*").eq("id", invoice_id).single().execute()
        )
        if invoice.data:
            all_payments = (
                supabase.table("payments")
                .select("amount")
                .eq("invoice_id", invoice_id)
                .execute()
                .data
            )
            total_paid = sum(float(p["amount"]) for p in all_payments)
            new_status = (
                "paid" if total_paid >= float(invoice.data["total_amount"]) else "partial"
            )
            supabase.table("invoices").update({"status": new_status}).eq(
                "id", invoice_id
            ).execute()

            # Resolve the same building/room/owner/tenant tags the original
            # invoice posted with, so the payment lines up with it in
            # drill-down reports instead of floating untagged.
            lease_id = invoice.data["lease_id"]
            lease = (
                supabase.table("leases")
                .select("room_id, tenant_id")
                .eq("id", invoice.data["lease_id"])
                .single()
                .execute()
                .data
            )
            if lease:
                room_id = lease["room_id"]
                tenant_id = lease["tenant_id"]
                room = supabase.table("rooms").select("building_id").eq("id", room_id).single().execute().data
                building_id = room["building_id"] if room else None
                owner_id = resolve_room_owner(supabase, room_id)

            # Best-effort, reporting-only: explains which of the invoice's
            # income heads (Rent/Parking/Internet/etc.) this cash actually
            # paid off, for the "Receipts by Head" report. Never allowed to
            # block or roll back the payment itself -- same principle as
            # write_audit_log in generic.py. If this ever fails, re-running
            # POST /reports/income-by-head/backfill fixes it retroactively.
            try:
                allocate_payment_to_line_items(
                    supabase,
                    company_id=company_id,
                    payment_id=payment["id"],
                    invoice_id=invoice_id,
                    tenant_id=tenant_id,
                    lease_id=lease_id,
                    cash_amount=float(payload["amount"]),
                )
            except Exception:
                logger.exception("Income-head allocation failed for payment_id=%s invoice_id=%s", payment["id"], invoice_id)
    elif tenant_id:
        # No invoice given (e.g. an advance/on-account payment) -- best-effort
        # resolve tags via the tenant's current active lease, so this entry
        # still carries room/building/owner tags for financial-statement
        # drill-down instead of floating completely untagged. If the tenant
        # has no active lease, it genuinely can't be tagged and stays blank.
        active_lease = (
            supabase.table("leases")
            .select("id, room_id")
            .eq("tenant_id", tenant_id)
            .eq("status", "active")
            .execute()
            .data
        )
        if active_lease:
            lease_id = active_lease[0]["id"]
            room_id = active_lease[0]["room_id"]
            room = supabase.table("rooms").select("building_id").eq("id", room_id).single().execute().data
            building_id = room["building_id"] if room else None
            owner_id = resolve_room_owner(supabase, room_id)

    # Dr [account tenant actually paid into] / Cr Accounts Receivable -- the
    # actual cash coming in. This does NOT touch Rent Income or Due to
    # Owners again -- that was already credited when the invoice was
    # generated. This entry just clears the receivable. Never assumes a
    # fixed account: different companies use different Bank/Cash accounts,
    # so the caller always picks the real one the money landed in.
    ar_id = get_account_id(supabase, company_id, "1100")
    tenant_name = "Tenant"
    if tenant_id:
        tenant = supabase.table("tenants").select("full_name").eq("id", tenant_id).single().execute().data
        tenant_name = tenant["full_name"] if tenant else "Tenant"
    post_journal_entry(
        supabase,
        company_id=company_id,
        entry_date=str(payload.get("payment_date") or date.today()),
        source_type="payment",
        source_id=payment["id"],
        description=f"Payment received — {tenant_name}",
        lines=[
            {
                "account_id": account_id, "direction": "debit", "amount": float(payload["amount"]),
                "building_id": building_id, "room_id": room_id, "owner_id": owner_id,
                "tenant_id": tenant_id, "lease_id": lease_id,
            },
            {
                "account_id": ar_id, "direction": "credit", "amount": float(payload["amount"]),
                "building_id": building_id, "room_id": room_id, "owner_id": owner_id,
                "tenant_id": tenant_id, "lease_id": lease_id,
            },
        ],
    )

    return payment


@router.get("/receipt/{receipt_id}/pdf")
def receipt_pdf(receipt_id: str, supabase: Client = Depends(get_supabase)):
    """
    Authenticated download of a payment receipt. `receipt_id` is the
    receipt_group_id returned by POST /payments/receipt (covers every
    invoice/opening-balance/advance line that receipt touched, as one
    document) -- or, as a fallback, a plain payment id for rows created via
    the older POST /payments endpoint. Same pattern as invoices.py's
    /invoices/{id}/pdf.
    """
    from fastapi.responses import StreamingResponse
    import io

    from app.services.payment_receipt_pdf import fetch_receipt_context, render_receipt_pdf

    ctx = fetch_receipt_context(supabase, receipt_id)
    pdf_bytes = render_receipt_pdf(ctx)

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="receipt_{receipt_id[:8]}.pdf"'},
    )


@router.get("/receipt/{receipt_id}/pdf/view")
def receipt_pdf_public(receipt_id: str, service_client=Depends(get_service_client)):
    """
    Public, unauthenticated receipt viewer -- for a WhatsApp "here's your
    receipt" link, same security model as invoices.py's /invoices/{id}/view
    (an unguessable UUID in the URL is the protection, no login step).
    """
    from fastapi.responses import StreamingResponse
    import io

    from app.services.payment_receipt_pdf import fetch_receipt_context, render_receipt_pdf

    ctx = fetch_receipt_context(service_client, receipt_id)
    pdf_bytes = render_receipt_pdf(ctx)

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="receipt_{receipt_id[:8]}.pdf"'},
    )


# ---------------------------------------------------------------------------
# Receipts -- receive a payment against one or more of a lease's outstanding
# invoices at once, with an optional discount, and automatically carry any
# amount received beyond what's owed forward as an advance on the lease.
# ---------------------------------------------------------------------------
class ReceiptRequest(BaseModel):
    lease_id: str
    account_id: str  # which Bank/Cash account the money actually landed in
    receipt_date: date
    payment_method: str = "cash"  # 'cash' | 'bank_transfer' | 'cheque' | 'other'
    amount_received: float
    invoice_ids: List[str]  # the invoices ticked on screen; allocated oldest-month first regardless of list order
    apply_to_opening_balance: bool = False  # the "opening balance" checklist row -- amounts owed that aren't tied to any invoice (e.g. a manual receivable entry)
    discount_amount: float = 0
    discount_account_id: Optional[str] = None
    notes: Optional[str] = None


def _get_caller_role(supabase: Client, user_id: str) -> Optional[str]:
    profile = supabase.table("profiles").select("role").eq("id", user_id).single().execute()
    return profile.data["role"] if profile.data else None


@router.post("/receipt", status_code=201)
def record_receipt(
    payload: ReceiptRequest,
    supabase: Client = Depends(get_supabase),
    user: dict = Depends(get_current_user),
    company_id: str = Depends(get_current_company_id),
):
    """
    Records ONE receipt that can settle several of a lease's outstanding
    invoices at once (oldest first), with an optional discount to whatever
    GL account the caller picks. The rule enforced here, in order:

      1. Discount is owner/admin only -- checked server-side, not just
         hidden in the UI, since the UI is never the real security boundary
         in this codebase.
      2. amount_received + discount_amount can NEVER exceed the combined
         balance of the ticked invoices. Cash is applied first (oldest
         invoice to newest); the discount only ever fills whatever gap is
         left after that -- it can't create a negative on an invoice.
      3. If the amount received is MORE than the ticked invoices need, the
         extra is never allowed into the discount -- it's recorded as a
         separate advance payment (no invoice attached, tagged to the
         lease/tenant), which is exactly what makes the lease's running
         balance (see get_lease_receivable_balance) go negative -- a real,
         ledger-backed credit, not a UI label.

    Posts exactly one journal entry for the whole receipt:
      Dr [account_id]         amount_received
      Dr [discount_account_id] discount_amount   (only if discount_amount > 0)
      Cr Accounts Receivable   amount_received + discount_amount
    """
    if payload.amount_received < 0 or payload.discount_amount < 0:
        raise HTTPException(status_code=400, detail="Amounts can't be negative.")
    if not payload.invoice_ids and payload.amount_received <= 0:
        raise HTTPException(status_code=400, detail="Enter an amount received, or tick at least one invoice.")

    if payload.discount_amount > 0:
        role = _get_caller_role(supabase, user["user_id"])
        if role not in ("owner", "admin"):
            raise HTTPException(status_code=403, detail="Only an owner or admin can apply a discount.")
        if not payload.discount_account_id:
            raise HTTPException(status_code=400, detail="Select which account the discount should be charged to.")

    # NOTE on the try/except blocks below: supabase-py's .single() raises an
    # exception itself when a lookup finds zero rows -- it does NOT just
    # return an object with data=None. That meant the "if not X.data: raise
    # HTTPException(404, ...)" lines that already existed here were dead
    # code; a missing row crashed straight past them as an unhandled 500
    # with no CORS headers, which is what the browser was showing as a bare
    # "Failed to fetch" with nothing recorded. Wrapping each lookup makes
    # the ALREADY-INTENDED clean error message actually reachable. No
    # validation rule, amount, or money calculation below is touched.
    try:
        account = (
            supabase.table("chart_of_accounts")
            .select("id")
            .eq("id", payload.account_id)
            .eq("company_id", company_id)
            .single()
            .execute()
        )
    except Exception:
        account = None
    if not account or not account.data:
        raise HTTPException(status_code=404, detail="Account not found")

    if payload.discount_account_id:
        try:
            discount_account = (
                supabase.table("chart_of_accounts")
                .select("id")
                .eq("id", payload.discount_account_id)
                .eq("company_id", company_id)
                .single()
                .execute()
            )
        except Exception:
            discount_account = None
        if not discount_account or not discount_account.data:
            raise HTTPException(status_code=404, detail="Discount account not found")

    try:
        lease = (
            supabase.table("leases")
            .select("id, tenant_id, room_id")
            .eq("id", payload.lease_id)
            .single()
            .execute()
        )
    except Exception:
        lease = None
    if not lease or not lease.data:
        raise HTTPException(status_code=404, detail="Lease not found")
    tenant_id = lease.data["tenant_id"]
    room_id = lease.data["room_id"]

    # Room lookup stays soft-fail on purpose (matching the original code's
    # own "if room else None" fallback) -- a receipt should never be
    # blocked just because the building/room tag for reporting couldn't be
    # read. Every live lease currently has a room_id (verified), so this is
    # a safety net for an edge case, not the expected path.
    try:
        room = supabase.table("rooms").select("building_id").eq("id", room_id).single().execute().data
    except Exception:
        room = None
    building_id = room["building_id"] if room else None
    owner_id = resolve_room_owner(supabase, room_id)

    # Fetch the ticked invoices and each one's current remaining balance,
    # sorted oldest month first -- this order is what "apply oldest first"
    # actually means, regardless of what order they were ticked in.
    invoices = (
        supabase.table("invoices")
        .select("*")
        .in_("id", payload.invoice_ids)
        .eq("lease_id", payload.lease_id)
        .order("invoice_month")
        .execute()
        .data
        if payload.invoice_ids
        else []
    )

    # Every non-cancelled invoice on this lease (not just the ticked ones)
    # and every payment against any of them, fetched in TWO queries total
    # -- reused below both for the ticked invoices' balances and for the
    # opening-balance calculation. Previously this was one extra query PER
    # invoice (here, and again in the opening-balance block below) -- on a
    # lease with a year or more of invoice history, that's 20-30+
    # sequential round-trips on a single request. On Vercel's serverless
    # cold starts that's exactly what was showing up as "Failed to fetch"
    # in the browser even though the receipt had already been recorded
    # successfully server-side a few calls earlier (the same class of bug
    # already fixed once in security_deposits.py -- see its comment).
    all_invoices_for_lease = (
        supabase.table("invoices")
        .select("id, total_amount")
        .eq("lease_id", payload.lease_id)
        .neq("status", "cancelled")
        .execute()
        .data
    )
    all_invoice_ids = [inv["id"] for inv in all_invoices_for_lease]
    settled_by_invoice: Dict[str, float] = {}
    if all_invoice_ids:
        all_prior_payments = (
            supabase.table("payments")
            .select("invoice_id, amount, discount_amount")
            .in_("invoice_id", all_invoice_ids)
            .execute()
            .data
        )
        for p in all_prior_payments:
            settled_by_invoice[p["invoice_id"]] = settled_by_invoice.get(p["invoice_id"], 0.0) + float(
                p["amount"]
            ) + float(p.get("discount_amount") or 0)

    balances: Dict[str, float] = {}
    for inv in invoices:
        settled = settled_by_invoice.get(inv["id"], 0.0)
        balances[inv["id"]] = round(float(inv["total_amount"]) - settled, 2)

    # Opening balance -- amounts owed that aren't tied to any specific
    # invoice (most commonly a manual journal entry posted through the
    # Journal Entry form, tagged to this tenant/lease -- see
    # /leases/{id}/receivable-summary, which computes it the same way).
    # Recomputed fresh here from the ledger rather than trusting whatever
    # the frontend sent, exactly like every amount below it. Only ever
    # used if the box was actually ticked on screen. Reuses the batched
    # invoice/payment data fetched above -- no extra per-invoice queries.
    opening_balance = 0.0
    if payload.apply_to_opening_balance:
        tied_balance_total = 0.0
        for inv in all_invoices_for_lease:
            settled = settled_by_invoice.get(inv["id"], 0.0)
            bal = round(float(inv["total_amount"]) - settled, 2)
            if bal > 0.01:
                tied_balance_total += bal
        # Tenant-wide (not lease_id-scoped) so this always reconciles with
        # /leases/{id}/receivable-summary and the invoice PDF's "Opening
        # balance" -- see the comment on that endpoint for why.
        try:
            ar_account_id = get_account_id(supabase, company_id, "1100")
            running_balance_now = get_tenant_account_balance_as_of(
                supabase, company_id, ar_account_id, tenant_id, str(date.today())
            )
        except ValueError:
            running_balance_now = 0.0
        opening_balance = max(round(running_balance_now - tied_balance_total, 2), 0.0)

    ticked_total = round(sum(max(b, 0) for b in balances.values()) + opening_balance, 2)

    if payload.discount_amount > 0 and (payload.amount_received + payload.discount_amount) > ticked_total + 0.01:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Amount received plus discount (Rs {payload.amount_received + payload.discount_amount:,.2f}) "
                f"can't exceed the ticked invoices' total balance (Rs {ticked_total:,.2f})."
            ),
        )

    # Pass 1: apply cash. The opening balance is inherently the OLDEST debt
    # on the lease (it predates every invoice-tied balance below), so it's
    # settled first, then invoices oldest month to newest.
    cash_remaining = payload.amount_received
    discount_remaining = payload.discount_amount

    opening_balance_cash = min(cash_remaining, opening_balance) if opening_balance > 0 else 0.0
    cash_remaining -= opening_balance_cash
    opening_balance -= opening_balance_cash

    cash_alloc: Dict[str, float] = {}
    for inv in invoices:
        if cash_remaining <= 0:
            break
        take = min(cash_remaining, max(balances[inv["id"]], 0))
        if take > 0:
            cash_alloc[inv["id"]] = take
            balances[inv["id"]] -= take
            cash_remaining -= take

    # Pass 2: apply whatever discount is left to close the remaining gaps --
    # opening balance first, then oldest invoice to newest. Guaranteed not
    # to exceed each balance by the check above.
    opening_balance_discount = min(discount_remaining, opening_balance) if opening_balance > 0 else 0.0
    discount_remaining -= opening_balance_discount
    opening_balance -= opening_balance_discount

    discount_alloc: Dict[str, float] = {}
    for inv in invoices:
        if discount_remaining <= 0:
            break
        take = min(discount_remaining, max(balances[inv["id"]], 0))
        if take > 0:
            discount_alloc[inv["id"]] = take
            balances[inv["id"]] -= take
            discount_remaining -= take

    advance_amount = round(cash_remaining, 2)  # cash left over after opening balance + every ticked invoice is fully covered

    receipt_group_id = str(uuid.uuid4())
    created_payments = []
    # Remembers each invoice's status BEFORE this receipt touches it, so
    # that if the journal-posting step below fails for any reason, we can
    # put every invoice back exactly how it was (see the rollback block
    # after post_journal_entry) instead of leaving a payment recorded with
    # no ledger entry behind it.
    original_invoice_status: Dict[str, str] = {}

    if opening_balance_cash > 0.01 or opening_balance_discount > 0.01:
        row = {
            "company_id": company_id,
            "invoice_id": None,
            "tenant_id": tenant_id,
            "amount": round(opening_balance_cash, 2),
            "discount_amount": round(opening_balance_discount, 2),
            "discount_account_id": payload.discount_account_id if opening_balance_discount > 0 else None,
            "account_id": payload.account_id,
            "payment_date": str(payload.receipt_date),
            "payment_method": payload.payment_method,
            "notes": ((payload.notes or "") + " (applied to opening balance)").strip(),
            "receipt_group_id": receipt_group_id,
        }
        created_payments.append(supabase.table("payments").insert(row).execute().data[0])

    for inv in invoices:
        c = round(cash_alloc.get(inv["id"], 0), 2)
        d = round(discount_alloc.get(inv["id"], 0), 2)
        if c == 0 and d == 0:
            continue
        row = {
            "company_id": company_id,
            "invoice_id": inv["id"],
            "tenant_id": tenant_id,
            "amount": c,
            "discount_amount": d,
            "discount_account_id": payload.discount_account_id if d > 0 else None,
            "account_id": payload.account_id,
            "payment_date": str(payload.receipt_date),
            "payment_method": payload.payment_method,
            "notes": payload.notes,
            "receipt_group_id": receipt_group_id,
        }
        new_payment_row = supabase.table("payments").insert(row).execute().data[0]
        created_payments.append(new_payment_row)

        # Best-effort, reporting-only allocation across this invoice's
        # income heads -- see the comment on the single-invoice /payments
        # endpoint above for why this is never allowed to block the
        # receipt itself.
        try:
            allocate_payment_to_line_items(
                supabase,
                company_id=company_id,
                payment_id=new_payment_row["id"],
                invoice_id=inv["id"],
                tenant_id=tenant_id,
                lease_id=payload.lease_id,
                cash_amount=c,
                discount_amount=d,
            )
        except Exception:
            logger.exception(
                "Income-head allocation failed for payment_id=%s invoice_id=%s", new_payment_row["id"], inv["id"]
            )

        all_payments = (
            supabase.table("payments").select("amount, discount_amount").eq("invoice_id", inv["id"]).execute().data
        )
        total_settled = sum(float(p["amount"]) + float(p.get("discount_amount") or 0) for p in all_payments)
        new_status = "paid" if total_settled >= float(inv["total_amount"]) - 0.01 else "partial"
        if inv["id"] not in original_invoice_status:
            original_invoice_status[inv["id"]] = inv["status"]
        supabase.table("invoices").update({"status": new_status}).eq("id", inv["id"]).execute()

    if advance_amount > 0.01:
        row = {
            "company_id": company_id,
            "invoice_id": None,
            "tenant_id": tenant_id,
            "amount": advance_amount,
            "discount_amount": 0,
            "account_id": payload.account_id,
            "payment_date": str(payload.receipt_date),
            "payment_method": payload.payment_method,
            "notes": (payload.notes or "") + " (advance -- exceeds current balance owed)",
            "receipt_group_id": receipt_group_id,
        }
        created_payments.append(supabase.table("payments").insert(row).execute().data[0])

    try:
        tenant = supabase.table("tenants").select("full_name").eq("id", tenant_id).single().execute().data
    except Exception:
        tenant = None
    tenant_name = tenant["full_name"] if tenant else "Tenant"

    # Everything from here down either succeeds completely, or is rolled
    # back completely -- a receipt is never left half-recorded (a payment
    # row with no journal entry behind it). This does NOT change what a
    # successful receipt looks like or any amount/allocation logic above;
    # it only adds a clean-up path for the failure case, which previously
    # crashed uncaught and left whatever had already been inserted sitting
    # in the database with no ledger entry to back it.
    try:
        ar_id = get_account_id(supabase, company_id, "1100")
        lines = [
            {
                "account_id": payload.account_id, "direction": "debit", "amount": round(payload.amount_received, 2),
                "building_id": building_id, "room_id": room_id, "owner_id": owner_id,
                "tenant_id": tenant_id, "lease_id": payload.lease_id,
            },
        ]
        if payload.discount_amount > 0:
            lines.append({
                "account_id": payload.discount_account_id, "direction": "debit", "amount": round(payload.discount_amount, 2),
                "building_id": building_id, "room_id": room_id, "owner_id": owner_id,
                "tenant_id": tenant_id, "lease_id": payload.lease_id,
            })
        lines.append({
            "account_id": ar_id, "direction": "credit",
            "amount": round(payload.amount_received + payload.discount_amount, 2),
            "building_id": building_id, "room_id": room_id, "owner_id": owner_id,
            "tenant_id": tenant_id, "lease_id": payload.lease_id,
        })

        entry = post_journal_entry(
            supabase,
            company_id=company_id,
            entry_date=str(payload.receipt_date),
            source_type="receipt",
            source_id=receipt_group_id,
            description=f"Receipt — {tenant_name}" + (" (with discount)" if payload.discount_amount > 0 else ""),
            lines=lines,
            created_by=user["user_id"],
        )
    except Exception as exc:
        # Logged BEFORE the generic message is returned, so the real cause
        # (the actual database/library error, with full traceback) is
        # visible in Vercel's Runtime Logs even though the person using the
        # app only ever sees the safe, generic message below.
        logger.exception(
            "Receipt posting failed for lease_id=%s company_id=%s amount_received=%s discount_amount=%s",
            payload.lease_id, company_id, payload.amount_received, payload.discount_amount,
        )
        for p in created_payments:
            try:
                supabase.table("payments").delete().eq("id", p["id"]).execute()
            except Exception:
                pass
        for inv_id, prior_status in original_invoice_status.items():
            try:
                supabase.table("invoices").update({"status": prior_status}).eq("id", inv_id).execute()
            except Exception:
                pass
        if isinstance(exc, UnbalancedJournalEntry):
            raise HTTPException(
                status_code=400,
                detail="This receipt doesn't balance -- please check the amount and try again. Nothing was saved.",
            )
        raise HTTPException(
            status_code=500,
            detail="Could not post this receipt to the ledger. Nothing was saved -- please try again.",
        )

    # The receipt is already fully committed by this point -- this is only
    # a number for the response/confirmation screen. Any failure here (e.g.
    # a transient read) must never look like the receipt itself failed.
    try:
        ar_account_id_final = get_account_id(supabase, company_id, "1100")
        final_running_balance = get_tenant_account_balance_as_of(
            supabase, company_id, ar_account_id_final, tenant_id, str(date.today())
        )
    except Exception:
        final_running_balance = 0.0

    return {
        "receipt_group_id": receipt_group_id,
        "payments": created_payments,
        "advance_amount": advance_amount,
        "journal_entry_id": entry["id"],
        "running_balance": final_running_balance,
    }
