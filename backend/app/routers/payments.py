from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException
from supabase import Client

from app.core.deps import get_current_company_id, get_supabase

router = APIRouter(prefix="/payments", tags=["Payments"])


@router.get("")
def list_payments(supabase: Client = Depends(get_supabase)):
    return supabase.table("payments").select("*").order("payment_date", desc=True).execute().data


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
    payment = supabase.table("payments").insert(payload).execute().data[0]

    invoice_id = payload.get("invoice_id")
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

    return payment
