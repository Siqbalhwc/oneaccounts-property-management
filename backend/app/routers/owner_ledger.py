from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from supabase import Client

from app.core.deps import get_current_company_id, get_supabase

router = APIRouter(prefix="/owner-ledger", tags=["Owner Ledger"])


class ComputeRequest(BaseModel):
    building_id: str
    month: date  # any date within the target month


class PayRequest(BaseModel):
    amount_paid: float
    paid_date: Optional[date] = None


@router.get("")
def list_ledger(supabase: Client = Depends(get_supabase)):
    return supabase.table("owner_ledger").select("*").order("ledger_month", desc=True).execute().data


@router.post("/compute", status_code=201)
def compute_ledger(
    payload: ComputeRequest,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    """
    Computes (or recomputes) a building's owner ledger for a given month:
    total collected from tenants (via paid/partial invoices whose lease's
    room belongs to this building) minus total expenses logged against the
    building that month. Upserts into owner_ledger.
    """
    ledger_month = payload.month.replace(day=1)
    next_month = (
        date(ledger_month.year + 1, 1, 1)
        if ledger_month.month == 12
        else date(ledger_month.year, ledger_month.month + 1, 1)
    )

    room_ids = [
        r["id"]
        for r in supabase.table("rooms")
        .select("id")
        .eq("building_id", payload.building_id)
        .execute()
        .data
    ]
    lease_ids = [
        l["id"]
        for l in supabase.table("leases")
        .select("id")
        .in_("room_id", room_ids)
        .execute()
        .data
    ] if room_ids else []

    total_collected = 0.0
    if lease_ids:
        invoices = (
            supabase.table("invoices")
            .select("total_amount, invoice_month, status")
            .in_("lease_id", lease_ids)
            .gte("invoice_month", str(ledger_month))
            .lt("invoice_month", str(next_month))
            .in_("status", ["paid", "partial"])
            .execute()
            .data
        )
        total_collected = sum(float(i["total_amount"]) for i in invoices)

    expenses = (
        supabase.table("expenses")
        .select("amount")
        .eq("building_id", payload.building_id)
        .gte("expense_date", str(ledger_month))
        .lt("expense_date", str(next_month))
        .execute()
        .data
    )
    total_expenses = sum(float(e["amount"]) for e in expenses)
    amount_payable = total_collected - total_expenses

    existing = (
        supabase.table("owner_ledger")
        .select("id")
        .eq("building_id", payload.building_id)
        .eq("ledger_month", str(ledger_month))
        .execute()
        .data
    )

    row = {
        "company_id": company_id,
        "building_id": payload.building_id,
        "ledger_month": str(ledger_month),
        "total_collected": total_collected,
        "total_expenses": total_expenses,
        "amount_payable": amount_payable,
    }

    if existing:
        result = (
            supabase.table("owner_ledger")
            .update(row)
            .eq("id", existing[0]["id"])
            .execute()
        )
    else:
        result = supabase.table("owner_ledger").insert(row).execute()

    return result.data[0]


@router.post("/{ledger_id}/pay")
def pay_owner(
    ledger_id: str,
    payload: PayRequest,
    supabase: Client = Depends(get_supabase),
):
    ledger = supabase.table("owner_ledger").select("*").eq("id", ledger_id).single().execute()
    if not ledger.data:
        raise HTTPException(status_code=404, detail="Ledger entry not found")

    status = "paid" if payload.amount_paid >= float(ledger.data["amount_payable"]) else "partial"
    result = (
        supabase.table("owner_ledger")
        .update(
            {
                "amount_paid": payload.amount_paid,
                "paid_date": str(payload.paid_date or date.today()),
                "status": status,
            }
        )
        .eq("id", ledger_id)
        .execute()
    )
    return result.data[0]
