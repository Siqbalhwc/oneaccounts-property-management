import uuid
from datetime import date
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from supabase import Client

from app.core.deps import get_current_company_id, get_current_user, get_supabase
from app.services.ledger import get_account_id, get_lease_receivable_balance, post_journal_entry, resolve_room_owner

router = APIRouter(prefix="/payments", tags=["Payments"])


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

    account = (
        supabase.table("chart_of_accounts")
        .select("id")
        .eq("id", payload.account_id)
        .eq("company_id", company_id)
        .single()
        .execute()
    )
    if not account.data:
        raise HTTPException(status_code=404, detail="Account not found")

    if payload.discount_account_id:
        discount_account = (
            supabase.table("chart_of_accounts")
            .select("id")
            .eq("id", payload.discount_account_id)
            .eq("company_id", company_id)
            .single()
            .execute()
        )
        if not discount_account.data:
            raise HTTPException(status_code=404, detail="Discount account not found")

    lease = supabase.table("leases").select("id, tenant_id, room_id").eq("id", payload.lease_id).single().execute()
    if not lease.data:
        raise HTTPException(status_code=404, detail="Lease not found")
    tenant_id = lease.data["tenant_id"]
    room_id = lease.data["room_id"]
    room = supabase.table("rooms").select("building_id").eq("id", room_id).single().execute().data
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
    balances: Dict[str, float] = {}
    for inv in invoices:
        prior_payments = (
            supabase.table("payments")
            .select("amount, discount_amount")
            .eq("invoice_id", inv["id"])
            .execute()
            .data
        )
        settled = sum(float(p["amount"]) + float(p.get("discount_amount") or 0) for p in prior_payments)
        balances[inv["id"]] = round(float(inv["total_amount"]) - settled, 2)

    # Opening balance -- amounts owed that aren't tied to any specific
    # invoice (most commonly a manual journal entry posted through the
    # Journal Entry form, tagged to this tenant/lease -- see
    # /leases/{id}/receivable-summary, which computes it the same way).
    # Recomputed fresh here from the ledger rather than trusting whatever
    # the frontend sent, exactly like every amount below it. Only ever
    # used if the box was actually ticked on screen.
    opening_balance = 0.0
    if payload.apply_to_opening_balance:
        all_invoices_for_lease = (
            supabase.table("invoices")
            .select("id, total_amount")
            .eq("lease_id", payload.lease_id)
            .neq("status", "cancelled")
            .execute()
            .data
        )
        tied_balance_total = 0.0
        for inv in all_invoices_for_lease:
            prior = (
                supabase.table("payments")
                .select("amount, discount_amount")
                .eq("invoice_id", inv["id"])
                .execute()
                .data
            )
            settled = sum(float(p["amount"]) + float(p.get("discount_amount") or 0) for p in prior)
            bal = round(float(inv["total_amount"]) - settled, 2)
            if bal > 0.01:
                tied_balance_total += bal
        running_balance_now = get_lease_receivable_balance(supabase, company_id, payload.lease_id)
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

    if opening_balance_cash > 0.01 or opening_balance_discount > 0.01:
        row = {
            "company_id": company_id,
            "invoice_id": None,
            "tenant_id": tenant_id,
            "amount": round(opening_balance_cash, 2),
            "discount_amount": round(opening_balance_discount, 2),
            "discount_account_id": payload.discount_account_id if opening_balance_discount > 0 else None,
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
            "payment_date": str(payload.receipt_date),
            "payment_method": payload.payment_method,
            "notes": payload.notes,
            "receipt_group_id": receipt_group_id,
        }
        created_payments.append(supabase.table("payments").insert(row).execute().data[0])

        all_payments = (
            supabase.table("payments").select("amount, discount_amount").eq("invoice_id", inv["id"]).execute().data
        )
        total_settled = sum(float(p["amount"]) + float(p.get("discount_amount") or 0) for p in all_payments)
        new_status = "paid" if total_settled >= float(inv["total_amount"]) - 0.01 else "partial"
        supabase.table("invoices").update({"status": new_status}).eq("id", inv["id"]).execute()

    if advance_amount > 0.01:
        row = {
            "company_id": company_id,
            "invoice_id": None,
            "tenant_id": tenant_id,
            "amount": advance_amount,
            "discount_amount": 0,
            "payment_date": str(payload.receipt_date),
            "payment_method": payload.payment_method,
            "notes": (payload.notes or "") + " (advance -- exceeds current balance owed)",
            "receipt_group_id": receipt_group_id,
        }
        created_payments.append(supabase.table("payments").insert(row).execute().data[0])

    tenant = supabase.table("tenants").select("full_name").eq("id", tenant_id).single().execute().data
    tenant_name = tenant["full_name"] if tenant else "Tenant"

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

    return {
        "receipt_group_id": receipt_group_id,
        "payments": created_payments,
        "advance_amount": advance_amount,
        "journal_entry_id": entry["id"],
        "running_balance": get_lease_receivable_balance(supabase, company_id, payload.lease_id),
    }
