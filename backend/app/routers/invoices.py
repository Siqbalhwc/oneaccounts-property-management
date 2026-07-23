from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from supabase import Client

from app.core.deps import get_current_company_id, get_supabase

router = APIRouter(prefix="/invoices", tags=["Invoices"])


class GenerateRequest(BaseModel):
    month: date  # any date within the target month, e.g. 2026-07-15
    building_id: Optional[str] = None  # optional filter
    due_in_days: int = 7


@router.get("/")
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
    import io
    import urllib.request

    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas
    from fastapi.responses import StreamingResponse

    invoice = supabase.table("invoices").select("*").eq("id", invoice_id).single().execute()
    if not invoice.data:
        raise HTTPException(status_code=404, detail="Invoice not found")
    invoice = invoice.data

    line_items = (
        supabase.table("invoice_line_items")
        .select("*")
        .eq("invoice_id", invoice_id)
        .execute()
        .data
    )

    lease = (
        supabase.table("leases").select("*").eq("id", invoice["lease_id"]).single().execute().data
    )
    tenant = (
        supabase.table("tenants").select("*").eq("id", lease["tenant_id"]).single().execute().data
    )
    room = supabase.table("rooms").select("*").eq("id", lease["room_id"]).single().execute().data
    building = (
        supabase.table("buildings")
        .select("*")
        .eq("id", room["building_id"])
        .single()
        .execute()
        .data
    )
    company = (
        supabase.table("companies")
        .select("*")
        .eq("id", invoice["company_id"])
        .single()
        .execute()
        .data
    )

    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4
    y = height - 25 * mm

    # Letterhead: logo (if present) + company name/address/phone
    if company.get("logo_url"):
        try:
            with urllib.request.urlopen(company["logo_url"], timeout=5) as resp:
                logo_bytes = io.BytesIO(resp.read())
            c.drawImage(
                ImageReader(logo_bytes),
                20 * mm,
                y - 10 * mm,
                width=25 * mm,
                height=25 * mm,
                preserveAspectRatio=True,
                mask="auto",
            )
        except Exception:
            pass  # logo fetch failed -- fall back to text-only letterhead

    c.setFont("Helvetica-Bold", 16)
    c.drawString(50 * mm, y, company.get("name") or "")
    c.setFont("Helvetica", 9)
    if company.get("address"):
        y -= 6 * mm
        c.drawString(50 * mm, y, company["address"])
    if company.get("phone"):
        y -= 5 * mm
        c.drawString(50 * mm, y, company["phone"])

    y -= 15 * mm
    c.setFont("Helvetica-Bold", 14)
    c.drawString(20 * mm, y, "INVOICE")
    c.setFont("Helvetica", 10)
    c.drawRightString(width - 20 * mm, y, f"Status: {invoice['status'].upper()}")

    y -= 8 * mm
    c.setFont("Helvetica", 10)
    c.drawString(20 * mm, y, f"Invoice month: {invoice['invoice_month']}")
    c.drawRightString(width - 20 * mm, y, f"Due date: {invoice['due_date']}")

    y -= 12 * mm
    c.setFont("Helvetica-Bold", 11)
    c.drawString(20 * mm, y, "Billed to")
    y -= 6 * mm
    c.setFont("Helvetica", 10)
    c.drawString(20 * mm, y, tenant.get("full_name") or "")
    y -= 5 * mm
    c.drawString(20 * mm, y, f"CNIC: {tenant.get('cnic') or ''}")
    y -= 5 * mm
    c.drawString(20 * mm, y, f"{building.get('name') or ''} — Room {room.get('room_number') or ''}")

    y -= 14 * mm
    c.setFont("Helvetica-Bold", 10)
    c.drawString(20 * mm, y, "Description")
    c.drawRightString(width - 20 * mm, y, "Amount")
    y -= 3 * mm
    c.line(20 * mm, y, width - 20 * mm, y)

    c.setFont("Helvetica", 10)
    for item in line_items:
        # Supabase/PostgREST returns `numeric` columns as strings (to avoid
        # floating-point precision loss), not JSON numbers -- cast explicitly.
        amount = float(item["amount"])
        y -= 7 * mm
        c.drawString(20 * mm, y, item["label"])
        c.drawRightString(width - 20 * mm, y, f"Rs {amount:,.0f}")

    y -= 4 * mm
    c.line(20 * mm, y, width - 20 * mm, y)
    y -= 8 * mm
    c.setFont("Helvetica-Bold", 11)
    c.drawString(20 * mm, y, "Total")
    c.drawRightString(width - 20 * mm, y, f"Rs {float(invoice['total_amount']):,.0f}")

    y -= 20 * mm
    c.setFont("Helvetica-Oblique", 8)
    c.drawString(20 * mm, y, "Thank you for your prompt payment.")

    c.save()
    buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="invoice_{invoice["invoice_month"]}.pdf"'
        },
    )
