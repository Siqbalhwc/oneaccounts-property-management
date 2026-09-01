from datetime import date
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from supabase import Client

from app.core.deps import get_current_company_id, get_supabase
from app.services.ledger import get_account_id, post_journal_entry, resolve_room_owner

router = APIRouter(prefix="/security-deposits", tags=["Security Deposits"])


class Deduction(BaseModel):
    reason: str
    amount: float


class RefundRequest(BaseModel):
    deductions: List[Deduction] = []
    refund_date: date | None = None


class DepositPaymentCreate(BaseModel):
    amount: float
    account_id: str  # which asset account (Bank, Cash, ...) actually received the money
    payment_date: date | None = None


def _total_paid(supabase: Client, deposit_id: str) -> float:
    rows = (
        supabase.table("security_deposit_payments")
        .select("amount")
        .eq("security_deposit_id", deposit_id)
        .execute()
        .data
    )
    return sum(float(r["amount"]) for r in rows)


def _with_paid_totals(supabase: Client, deposits: list) -> list:
    """Attaches amount_paid/amount_pending to each deposit row in ONE extra
    query (not one per deposit) -- fetches every payment for the given
    deposits at once and sums them in Python."""
    if not deposits:
        return deposits
    deposit_ids = [d["id"] for d in deposits]
    payments = (
        supabase.table("security_deposit_payments")
        .select("security_deposit_id, amount")
        .in_("security_deposit_id", deposit_ids)
        .execute()
        .data
    )
    paid_by_deposit: dict = {}
    for p in payments:
        paid_by_deposit[p["security_deposit_id"]] = paid_by_deposit.get(p["security_deposit_id"], 0.0) + float(p["amount"])
    for d in deposits:
        paid = paid_by_deposit.get(d["id"], 0.0)
        d["amount_paid"] = paid
        d["amount_pending"] = max(float(d["amount_received"]) - paid, 0.0)
    return deposits


@router.get("")
def list_deposits(supabase: Client = Depends(get_supabase)):
    deposits = supabase.table("security_deposits").select("*").execute().data
    return _with_paid_totals(supabase, deposits)


@router.get("/{deposit_id}")
def get_deposit(deposit_id: str, supabase: Client = Depends(get_supabase)):
    res = (
        supabase.table("security_deposits")
        .select("*")
        .eq("id", deposit_id)
        .single()
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Deposit not found")
    return _with_paid_totals(supabase, [res.data])[0]


@router.get("/{deposit_id}/payments")
def list_deposit_payments(deposit_id: str, supabase: Client = Depends(get_supabase)):
    """Every payment recorded toward this deposit so far, oldest first --
    a tenant may pay a deposit in one go or across several installments."""
    return (
        supabase.table("security_deposit_payments")
        .select("*")
        .eq("security_deposit_id", deposit_id)
        .order("payment_date")
        .order("created_at")
        .execute()
        .data
    )


@router.post("/{deposit_id}/payments", status_code=201)
def record_deposit_payment(
    deposit_id: str,
    payload: DepositPaymentCreate,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    """
    Records ONE payment toward a security deposit -- callable as many times
    as needed, so a tenant can pay the deposit in full in one go, or in
    several partial installments over time. Posts a journal entry for
    exactly this payment's amount (Dr [chosen account] / Cr Security
    Deposits Held) -- never for the deposit's full agreed amount, since
    that may not be what actually came in yet.

    Blocks any payment that would push the running total past the amount
    agreed in the lease -- a security deposit should never be overpaid.
    """
    deposit = (
        supabase.table("security_deposits")
        .select("*")
        .eq("id", deposit_id)
        .single()
        .execute()
    )
    if not deposit.data:
        raise HTTPException(status_code=404, detail="Deposit not found")

    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Payment amount must be greater than zero.")

    agreed_amount = float(deposit.data["amount_received"])
    already_paid = _total_paid(supabase, deposit_id)
    remaining = agreed_amount - already_paid
    if payload.amount > remaining + 0.01:  # small epsilon for float rounding
        raise HTTPException(
            status_code=400,
            detail=(
                f"This would exceed the agreed deposit amount of Rs {agreed_amount:,.0f}. "
                f"Rs {remaining:,.0f} is still pending — enter that amount or less."
            ),
        )

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

    payment_date = payload.payment_date or date.today()

    # Single embedded query instead of four sequential round-trips (lease,
    # then room, then room's building for owner fallback, then tenant).
    # Each extra round-trip to PostgREST here was pure added latency on
    # Vercel's serverless function -- with enough of them stacked up
    # (this endpoint used to make ~14 sequential calls), the response
    # could arrive after the browser had already given up, showing
    # "Failed to fetch" even though the payment + journal entry had
    # already committed successfully a few calls earlier. This is the fix
    # for that: fewer round-trips, and no more calls after the write that
    # could fail and turn a successful save into a reported error.
    lease_id = deposit.data["lease_id"]
    lease = (
        supabase.table("leases")
        .select("tenant_id, room_id, tenants(full_name), rooms(room_number, building_id, owner_id, buildings(owner_id))")
        .eq("id", lease_id)
        .single()
        .execute()
        .data
    )
    building_id, room_id, owner_id, tenant_id, tenant_name, room_label = None, None, None, None, "Tenant", "room"
    if lease:
        tenant_id, room_id = lease["tenant_id"], lease["room_id"]
        tenant = lease.get("tenants")
        tenant_name = (tenant.get("full_name") if tenant else None) or "Tenant"
        room = lease.get("rooms")
        if room:
            building_id = room.get("building_id")
            room_label = room.get("room_number") or "room"
            building = room.get("buildings")
            owner_id = room.get("owner_id") or (building.get("owner_id") if building else None)

    payment = (
        supabase.table("security_deposit_payments")
        .insert(
            {
                "company_id": company_id,
                "security_deposit_id": deposit_id,
                "amount": payload.amount,
                "account_id": payload.account_id,
                "payment_date": str(payment_date),
            }
        )
        .execute()
        .data[0]
    )

    deposits_held_id = get_account_id(supabase, company_id, "2100")
    tags = {"building_id": building_id, "room_id": room_id, "owner_id": owner_id, "tenant_id": tenant_id, "lease_id": lease_id}

    new_total_paid = already_paid + payload.amount
    is_first_or_final = new_total_paid >= agreed_amount - 0.01
    label = "in full" if (is_first_or_final and already_paid == 0) else ("final instalment" if is_first_or_final else "instalment")

    post_journal_entry(
        supabase,
        company_id=company_id,
        entry_date=str(payment_date),
        source_type="security_deposit_payment",
        source_id=payment["id"],
        description=f"Security deposit ({label}) — {tenant_name}, Room {room_label}",
        lines=[
            {"account_id": payload.account_id, "direction": "debit", "amount": payload.amount, **tags},
            {"account_id": deposits_held_id, "direction": "credit", "amount": payload.amount, **tags},
        ],
    )

    # is_received / received_account_id / date_received are kept for
    # backward compatibility with anything still reading them (the deposit
    # receipt PDF, older records) -- now representing "fully settled as of
    # this payment", updated only once the running total reaches the
    # agreed amount. amount_paid (below) is the real source of truth from
    # here on.
    update_fields = {}
    if is_first_or_final:
        update_fields = {
            "is_received": True,
            "received_account_id": payload.account_id,
            "date_received": str(payment_date),
        }
    if update_fields:
        try:
            supabase.table("security_deposits").update(update_fields).eq("id", deposit_id).execute()
        except Exception:
            # The payment + journal entry are already safely posted above --
            # this flag update is best-effort so a hiccup here never turns
            # an already-successful save into a reported failure. Worst
            # case, is_received/date_received catch up on the next payment
            # or the next full page load (amount_paid/amount_pending below
            # are computed fresh from security_deposit_payments every time,
            # so the pending amount is correct either way).
            pass

    # Built from data already in hand -- no extra round-trip needed, and
    # one less thing that could fail after the real work is already done.
    updated_deposit = {**deposit.data, **update_fields}
    updated_deposit["amount_paid"] = new_total_paid
    updated_deposit["amount_pending"] = max(agreed_amount - new_total_paid, 0.0)

    return {"payment": payment, "deposit": updated_deposit}


@router.get("/{deposit_id}/receipt-pdf")
def deposit_receipt_pdf(deposit_id: str, supabase: Client = Depends(get_supabase)):
    """
    Printable receipt PDF for a security deposit, reflecting everything
    paid toward it so far (whether that's the full amount in one go, or
    several instalments) -- available as soon as at least one payment has
    been recorded, even if the deposit isn't fully paid yet.
    """
    from fastapi.responses import StreamingResponse
    import io

    from app.services.deposit_receipt_pdf import fetch_deposit_context, render_deposit_receipt_pdf

    ctx = fetch_deposit_context(supabase, deposit_id)
    if not ctx["payments"]:
        raise HTTPException(status_code=400, detail="No payment has been recorded against this deposit yet.")
    pdf_bytes = render_deposit_receipt_pdf(ctx)

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="security_deposit_receipt_{deposit_id}.pdf"'},
    )


@router.post("/{deposit_id}/refund")
def refund_deposit(
    deposit_id: str,
    payload: RefundRequest,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    """
    Refunds a security deposit, minus any itemized deductions
    (damages, unpaid dues, etc.). Automatically computes the net refund.

    Refunds whatever was ACTUALLY paid so far (sum of
    security_deposit_payments), not the full agreed amount -- so a tenant
    who only ever paid part of the deposit before leaving gets refunded
    correctly against what they really put in, never more.
    """
    deposit = (
        supabase.table("security_deposits")
        .select("*")
        .eq("id", deposit_id)
        .single()
        .execute()
    )
    if not deposit.data:
        raise HTTPException(status_code=404, detail="Deposit not found")

    total_received = _total_paid(supabase, deposit_id)
    if total_received <= 0:
        raise HTTPException(status_code=400, detail="No payment has been recorded against this deposit yet, so there's nothing to refund.")

    total_deductions = sum(d.amount for d in payload.deductions)
    amount_refunded = total_received - total_deductions
    if amount_refunded < 0:
        raise HTTPException(
            status_code=400, detail="Deductions exceed the amount actually held for this deposit."
        )

    if payload.deductions:
        rows = [
            {
                "company_id": company_id,
                "security_deposit_id": deposit_id,
                "reason": d.reason,
                "amount": d.amount,
            }
            for d in payload.deductions
        ]
        supabase.table("security_deposit_deductions").insert(rows).execute()

    refund_date = payload.refund_date or date.today()
    status = "partially_refunded" if total_deductions > 0 else "refunded"

    updated = (
        supabase.table("security_deposits")
        .update(
            {
                "amount_refunded": amount_refunded,
                "date_refunded": str(refund_date),
                "status": status,
            }
        )
        .eq("id", deposit_id)
        .execute()
    )

    # Dr Security Deposits Held (clears exactly what was actually held) /
    # Cr Bank (actual cash going out) + Cr Other Income (any deductions --
    # damages/unpaid dues retained by the company, not the owner).
    lease_id = deposit.data["lease_id"]
    lease = (
        supabase.table("leases")
        .select("tenant_id, room_id")
        .eq("id", lease_id)
        .single()
        .execute()
        .data
    )
    building_id, room_id, owner_id, tenant_id, tenant_name = None, None, None, None, "Tenant"
    if lease:
        tenant_id, room_id = lease["tenant_id"], lease["room_id"]
        room = supabase.table("rooms").select("building_id").eq("id", room_id).single().execute().data
        building_id = room["building_id"] if room else None
        owner_id = resolve_room_owner(supabase, room_id)
        tenant = supabase.table("tenants").select("full_name").eq("id", tenant_id).single().execute().data
        tenant_name = tenant["full_name"] if tenant else "Tenant"

    deposits_held_id = get_account_id(supabase, company_id, "2100")
    bank_id = get_account_id(supabase, company_id, "1000")
    tags = {"building_id": building_id, "room_id": room_id, "owner_id": owner_id, "tenant_id": tenant_id, "lease_id": lease_id}

    lines = [
        {"account_id": deposits_held_id, "direction": "debit", "amount": total_received, **tags},
    ]
    if amount_refunded > 0:
        lines.append({"account_id": bank_id, "direction": "credit", "amount": amount_refunded, **tags})
    if total_deductions > 0:
        other_income_id = get_account_id(supabase, company_id, "4100")
        lines.append({"account_id": other_income_id, "direction": "credit", "amount": total_deductions, **tags})

    post_journal_entry(
        supabase,
        company_id=company_id,
        entry_date=str(refund_date),
        source_type="security_deposit_refund",
        source_id=deposit_id,
        description=f"Security deposit refund — {tenant_name}",
        lines=lines,
    )

    return updated.data[0]
