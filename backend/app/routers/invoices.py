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

    # Brand colors (same palette as the app)
    LEDGER = (0.184, 0.310, 0.239)   # #2F4F3D
    BRASS = (0.784, 0.608, 0.361)    # #C89B5C
    INK = (0.122, 0.176, 0.141)      # #1F2D24
    PAPER = (0.953, 0.949, 0.902)    # #F3F1E6
    STATUS_COLORS = {
        "paid": (0.184, 0.310, 0.239),
        "sent": (0.722, 0.525, 0.180),
        "draft": (0.722, 0.525, 0.180),
        "partial": (0.722, 0.525, 0.180),
        "overdue": (0.651, 0.239, 0.251),
        "cancelled": (0.337, 0.373, 0.353),
    }

    # --- Header band ---
    band_height = 38 * mm
    c.setFillColorRGB(*LEDGER)
    c.rect(0, height - band_height, width, band_height, fill=1, stroke=0)

    text_x = 20 * mm
    if company.get("logo_url"):
        try:
            with urllib.request.urlopen(company["logo_url"], timeout=5) as resp:
                logo_bytes = io.BytesIO(resp.read())
            logo_size = 22 * mm
            c.drawImage(
                ImageReader(logo_bytes),
                20 * mm,
                height - band_height / 2 - logo_size / 2,
                width=logo_size,
                height=logo_size,
                preserveAspectRatio=True,
                mask="auto",
            )
            text_x = 20 * mm + logo_size + 8 * mm
        except Exception:
            pass  # logo fetch failed -- fall back to text-only letterhead

    c.setFillColorRGB(1, 1, 1)
    c.setFont("Helvetica-Bold", 17)
    c.drawString(text_x, height - 16 * mm, company.get("name") or "")
    c.setFont("Helvetica", 9)
    c.setFillColorRGB(0.9, 0.92, 0.9)
    line_y = height - 23 * mm
    if company.get("address"):
        c.drawString(text_x, line_y, company["address"])
        line_y -= 5 * mm
    if company.get("phone"):
        c.drawString(text_x, line_y, company["phone"])

    # --- Invoice title + status badge ---
    y = height - band_height - 14 * mm
    c.setFillColorRGB(*INK)
    c.setFont("Helvetica-Bold", 15)
    c.drawString(20 * mm, y, "INVOICE")

    status = invoice["status"]
    status_color = STATUS_COLORS.get(status, (0.34, 0.37, 0.35))
    badge_text = status.upper()
    c.setFont("Helvetica-Bold", 9)
    badge_width = c.stringWidth(badge_text, "Helvetica-Bold", 9) + 10 * mm
    badge_x = width - 20 * mm - badge_width
    c.setFillColorRGB(*status_color)
    c.roundRect(badge_x, y - 3 * mm, badge_width, 8 * mm, 1.5 * mm, fill=1, stroke=0)
    c.setFillColorRGB(1, 1, 1)
    c.drawCentredString(badge_x + badge_width / 2, y - 0.5 * mm, badge_text)

    # --- Brass accent rule (echoes the app's "ledger-rule" divider) ---
    y -= 10 * mm
    c.setStrokeColorRGB(*BRASS)
    c.setLineWidth(2)
    c.line(20 * mm, y, 20 * mm + 12 * mm, y)
    c.setStrokeColorRGB(0.86, 0.84, 0.77)
    c.setLineWidth(0.75)
    c.line(20 * mm + 12 * mm, y, width - 20 * mm, y)

    y -= 8 * mm
    c.setFillColorRGB(*INK)
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
    c.setFillColorRGB(0.3, 0.34, 0.32)
    c.drawString(20 * mm, y, f"CNIC: {tenant.get('cnic') or ''}")
    y -= 5 * mm
    c.drawString(20 * mm, y, f"{building.get('name') or ''} — Room {room.get('room_number') or ''}")
    c.setFillColorRGB(*INK)

    y -= 14 * mm
    c.setFont("Helvetica-Bold", 10)
    c.drawString(20 * mm, y, "Description")
    c.drawRightString(width - 20 * mm, y, "Amount")
    y -= 3 * mm
    c.setStrokeColorRGB(*INK)
    c.setLineWidth(0.75)
    c.line(20 * mm, y, width - 20 * mm, y)

    c.setFont("Helvetica", 10)
    for item in line_items:
        # Supabase/PostgREST returns `numeric` columns as strings (to avoid
        # floating-point precision loss), not JSON numbers -- cast explicitly.
        amount = float(item["amount"])
        y -= 7 * mm
        c.drawString(20 * mm, y, item["label"])
        c.drawRightString(width - 20 * mm, y, f"Rs {amount:,.0f}")

    y -= 5 * mm
    c.setStrokeColorRGB(*INK)
    c.line(20 * mm, y, width - 20 * mm, y)

    # --- Total, in a shaded band for emphasis ---
    y -= 12 * mm
    c.setFillColorRGB(*PAPER)
    c.rect(20 * mm, y - 3 * mm, width - 40 * mm, 11 * mm, fill=1, stroke=0)
    c.setFillColorRGB(*LEDGER)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(24 * mm, y, "Total")
    c.drawRightString(width - 24 * mm, y, f"Rs {float(invoice['total_amount']):,.0f}")

    y -= 20 * mm
    c.setFillColorRGB(0.4, 0.43, 0.41)
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
