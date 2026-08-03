from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from supabase import Client

from app.core.deps import get_current_company_id, get_service_client, get_supabase

router = APIRouter(prefix="/invoices", tags=["Invoices"])


class GenerateRequest(BaseModel):
    month: date  # any date within the target month, e.g. 2026-07-15
    building_id: Optional[str] = None  # optional filter
    due_in_days: int = 7


@router.get("")
def list_invoices(supabase: Client = Depends(get_supabase)):
    return supabase.table("invoices").select("*").order("invoice_month", desc=True).execute().data


@router.get("/{invoice_id}")
def get_invoice(invoice_id: str, supabase: Client = Depends(get_supabase)):
    inv = supabase.table("invoices").select("*").eq("id", invoice_id).single().execute()
    if not inv.data:
        raise HTTPException(status_code=404, detail="Invoice not found")
    items = (
        supabase.table("invoice_line_items")
        .select("*")
        .eq("invoice_id", invoice_id)
        .execute()
    )
    return {**inv.data, "line_items": items.data}


@router.post("/generate", status_code=201)
def generate_monthly_invoices(
    payload: GenerateRequest,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    """
    Generates one invoice per active lease for the given month, snapshotting
    each lease's currently-active charges as invoice_line_items.
    Skips leases that already have an invoice for that month.

    Run this via a monthly cron (Supabase pg_cron or a scheduled job hitting
    this endpoint) once you wire up WhatsApp sending.
    """
    invoice_month = payload.month.replace(day=1)
    due_date = invoice_month + timedelta(days=payload.due_in_days)

    leases_query = supabase.table("leases").select("*").eq("status", "active")
    leases = leases_query.execute().data

    if payload.building_id:
        room_ids = [
            r["id"]
            for r in supabase.table("rooms")
            .select("id")
            .eq("building_id", payload.building_id)
            .execute()
            .data
        ]
        leases = [l for l in leases if l["room_id"] in room_ids]

    created, skipped = [], []

    for lease in leases:
        existing = (
            supabase.table("invoices")
            .select("id")
            .eq("lease_id", lease["id"])
            .eq("invoice_month", str(invoice_month))
            .execute()
        )
        if existing.data:
            skipped.append(lease["id"])
            continue

        charges = (
            supabase.table("lease_charges")
            .select("*")
            .eq("lease_id", lease["id"])
            .is_("effective_to", "null")
            .execute()
            .data
        )
        if not charges:
            skipped.append(lease["id"])
            continue

        total = sum(float(c["amount"]) for c in charges)

        inv = (
            supabase.table("invoices")
            .insert(
                {
                    "company_id": company_id,
                    "lease_id": lease["id"],
                    "invoice_month": str(invoice_month),
                    "due_date": str(due_date),
                    "total_amount": total,
                    "status": "draft",
                }
            )
            .execute()
            .data[0]
        )

        line_items = [
            {
                "company_id": company_id,
                "invoice_id": inv["id"],
                "label": c["label"],
                "amount": c["amount"],
            }
            for c in charges
        ]
        supabase.table("invoice_line_items").insert(line_items).execute()
        created.append(inv["id"])

    return {"created": created, "skipped_existing_or_no_charges": skipped}


@router.post("/{invoice_id}/mark-sent")
def mark_sent(invoice_id: str, supabase: Client = Depends(get_supabase)):
    """Call this once WhatsApp sending is wired up, right after a successful send."""
    from datetime import datetime

    res = (
        supabase.table("invoices")
        .update({"status": "sent", "sent_via_whatsapp_at": datetime.utcnow().isoformat()})
        .eq("id", invoice_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return res.data[0]


@router.post("/{invoice_id}/mark-paid")
def mark_paid(invoice_id: str, supabase: Client = Depends(get_supabase)):
    res = supabase.table("invoices").update({"status": "paid"}).eq("id", invoice_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return res.data[0]


@router.get("/{invoice_id}/pdf")
def invoice_pdf(invoice_id: str, supabase: Client = Depends(get_supabase)):
    """
    Generates a printable/downloadable PDF for one invoice, with the
    company's own name/address/logo as the letterhead. Built on the fly
    with reportlab (pure Python, no system dependencies -- works fine on
    Vercel's serverless Python runtime).
    """
    from fastapi.responses import StreamingResponse
    import io

    from app.services.invoice_pdf import fetch_invoice_context, render_invoice_pdf

    ctx = fetch_invoice_context(supabase, invoice_id)
    pdf_bytes = render_invoice_pdf(ctx)

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="invoice_{ctx["invoice"]["invoice_month"]}.pdf"'
        },
    )


def normalize_pakistani_phone(phone: str) -> str:
    """
    Converts a locally-formatted Pakistani number (e.g. "0300-1234567") into
    the international digits-only format wa.me requires (e.g. "923001234567").
    Already-international numbers (92... or +92...) pass through unchanged.
    """
    digits = "".join(ch for ch in phone if ch.isdigit())
    if digits.startswith("0092"):
        digits = digits[2:]
    if digits.startswith("92"):
        return digits
    if digits.startswith("0"):
        return "92" + digits[1:]
    return digits  # already looks international, or malformed -- pass through as-is


@router.post("/{invoice_id}/whatsapp-link")
def get_whatsapp_link(
    invoice_id: str,
    supabase: Client = Depends(get_supabase),
    service_client=Depends(get_service_client),
):
    """
    Generates the invoice PDF, uploads it to private Supabase Storage, and
    returns a wa.me click-to-chat link with a pre-filled message (including a
    signed, time-limited download link to the PDF). Opening the link lets the
    person send it themselves via the WhatsApp app or WhatsApp Web -- exactly
    like OneAccounts' existing WhatsApp buttons, just applied to invoices.

    This does NOT send anything automatically; WhatsApp's rules require the
    human to press Send. Requires a private Storage bucket named "invoices"
    to already exist in Supabase (Storage -> New bucket -> "invoices", leave
    Public OFF).
    """
    from app.services.invoice_pdf import fetch_invoice_context, render_invoice_pdf

    ctx = fetch_invoice_context(supabase, invoice_id)
    invoice, tenant, room, building, company = (
        ctx["invoice"], ctx["tenant"], ctx["room"], ctx["building"], ctx["company"]
    )

    if not tenant.get("phone"):
        raise HTTPException(status_code=400, detail="This tenant has no phone number on file.")

    pdf_bytes = render_invoice_pdf(ctx)

    storage_path = f"{invoice['company_id']}/{invoice_id}.pdf"
    try:
        service_client.storage.from_("invoices").upload(
            storage_path,
            pdf_bytes,
            {"content-type": "application/pdf", "upsert": "true"},
        )
        signed = service_client.storage.from_("invoices").create_signed_url(
            storage_path, 60 * 60 * 24 * 7  # valid 7 days
        )
        pdf_url = signed.get("signedURL") or signed.get("signed_url")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not prepare the invoice PDF: {e}")

    message = (
        f"Hi {tenant.get('full_name') or ''}, your rent invoice for "
        f"{invoice['invoice_month']} ({building.get('name') or ''} - Room "
        f"{room.get('room_number') or ''}) is Rs {float(invoice['total_amount']):,.0f}, "
        f"due on {invoice['due_date']}.\n\nView/download invoice: {pdf_url}\n\n"
        f"Thank you — {company.get('name') or ''}"
    )

    import urllib.parse

    phone = normalize_pakistani_phone(tenant["phone"])
    whatsapp_url = f"https://wa.me/{phone}?text={urllib.parse.quote(message)}"

    return {"whatsapp_url": whatsapp_url, "phone": phone, "message_preview": message}
