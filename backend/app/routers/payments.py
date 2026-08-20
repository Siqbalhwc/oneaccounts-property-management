from datetime import date
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException
from supabase import Client

from app.core.deps import get_current_company_id, get_supabase
from app.services.ledger import get_account_id, post_journal_entry, resolve_room_owner

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

    # Dr Bank / Cr Accounts Receivable -- the actual cash coming in. This
    # does NOT touch Rent Income or Due to Owners again -- that was already
    # credited when the invoice was generated. This entry just clears the
    # receivable.
    bank_id = get_account_id(supabase, company_id, "1000")
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
                "account_id": bank_id, "direction": "debit", "amount": float(payload["amount"]),
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
