from datetime import date
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from supabase import Client

from app.core.deps import get_current_company_id, get_supabase

router = APIRouter(prefix="/security-deposits", tags=["Security Deposits"])


class Deduction(BaseModel):
    reason: str
    amount: float


class RefundRequest(BaseModel):
    deductions: List[Deduction] = []
    refund_date: date | None = None


@router.get("/")
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
    return updated.data[0]
