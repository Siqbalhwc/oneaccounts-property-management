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


class ReceiveRequest(BaseModel):
    account_id: str  # which asset account (Bank, Cash, ...) actually received the money
    received_date: date | None = None


@router.get("")
def list_deposits(supabase: Client = Depends(get_supabase)):
    return supabase.table("security_deposits").select("*").execute().data


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
    return res.data


@router.post("/{deposit_id}/receive")
def receive_deposit(
    deposit_id: str,
    payload: ReceiveRequest,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    """
    Records that a security deposit -- which wasn't collected at lease
    signing -- has now actually been received, and posts the corresponding
    journal entry (Dr [chosen account] / Cr Security Deposits Held). This is
    the counterpart to leases.py's at-signing posting: exactly one of the
    two ever fires for a given deposit, so it's never posted twice.
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
    if deposit.data["is_received"]:
        raise HTTPException(status_code=400, detail="This deposit is already marked as received.")
    amount = float(deposit.data["amount_received"])
    if amount <= 0:
        raise HTTPException(status_code=400, detail="This deposit has no amount to receive.")

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

    received_date = payload.received_date or date.today()

    lease_id = deposit.data["lease_id"]
    lease = (
        supabase.table("leases")
        .select("tenant_id, room_id")
        .eq("id", lease_id)
        .single()
        .execute()
        .data
    )
    building_id, room_id, owner_id, tenant_id, tenant_name, room_label = None, None, None, None, "Tenant", "room"
    if lease:
        tenant_id, room_id = lease["tenant_id"], lease["room_id"]
        room = supabase.table("rooms").select("room_number, building_id").eq("id", room_id).single().execute().data
        building_id = room["building_id"] if room else None
        room_label = room.get("room_number", "room") if room else "room"
        owner_id = resolve_room_owner(supabase, room_id)
        tenant = supabase.table("tenants").select("full_name").eq("id", tenant_id).single().execute().data
        tenant_name = tenant["full_name"] if tenant else "Tenant"

    deposits_held_id = get_account_id(supabase, company_id, "2100")
    tags = {"building_id": building_id, "room_id": room_id, "owner_id": owner_id, "tenant_id": tenant_id, "lease_id": lease_id}

    post_journal_entry(
        supabase,
        company_id=company_id,
        entry_date=str(received_date),
        source_type="security_deposit",
        source_id=lease_id,
        description=f"Security deposit — {tenant_name}, Room {room_label}",
        lines=[
            {"account_id": payload.account_id, "direction": "debit", "amount": amount, **tags},
            {"account_id": deposits_held_id, "direction": "credit", "amount": amount, **tags},
        ],
    )

    updated = (
        supabase.table("security_deposits")
        .update(
            {
                "is_received": True,
                "received_account_id": payload.account_id,
                "date_received": str(received_date),
            }
        )
        .eq("id", deposit_id)
        .execute()
    )
    return updated.data[0]


@router.get("/{deposit_id}/receipt-pdf")
def deposit_receipt_pdf(deposit_id: str, supabase: Client = Depends(get_supabase)):
    """
    Printable acknowledgement-of-receipt PDF for a security deposit -- only
    available once the deposit is actually marked as received (there's
    nothing to acknowledge receiving otherwise).
    """
    from fastapi.responses import StreamingResponse
    import io

    from app.services.deposit_receipt_pdf import fetch_deposit_context, render_deposit_receipt_pdf

    ctx = fetch_deposit_context(supabase, deposit_id)
    if not ctx["deposit"]["is_received"]:
        raise HTTPException(status_code=400, detail="This deposit hasn't been marked as received yet.")
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

    total_deductions = sum(d.amount for d in payload.deductions)
    amount_refunded = deposit.data["amount_received"] - total_deductions
    if amount_refunded < 0:
        raise HTTPException(
            status_code=400, detail="Deductions exceed the deposit amount held"
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

    # Dr Security Deposits Held (clears the full liability) /
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
        {"account_id": deposits_held_id, "direction": "debit", "amount": float(deposit.data["amount_received"]), **tags},
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
