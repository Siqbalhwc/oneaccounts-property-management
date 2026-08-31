"""
Shared invoice PDF builder. Extracted so both the direct-download endpoint
and the WhatsApp-link endpoint (which uploads the PDF to storage) generate
byte-for-byte the same document from one place, instead of two copies
drifting apart over time.
"""

import io
import urllib.request

from fastapi import HTTPException
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from supabase import Client


def fetch_invoice_context(supabase: Client, invoice_id: str) -> dict:
    """Fetches everything needed to render an invoice: the invoice itself,
    its line items, and the tenant/room/building/company it belongs to.
    Also fetches the lease's security deposit (if any) and whether this is
    the lease's first invoice -- the first invoice shows the deposit as an
    informational line (amount + received/pending status), matching what
    the lease creation screen already showed at signing. The deposit stays
    outside invoice_line_items/total_amount on purpose: it's tracked and
    settled through its own separate flow (security_deposits.py), not
    through invoice payments."""
    invoice = supabase.table("invoices").select("*").eq("id", invoice_id).single().execute()
    if not invoice.data:
        raise HTTPException(status_code=404, detail="Invoice not found")
    invoice = invoice.data

    line_items = (
        supabase.table("invoice_line_items").select("*").eq("invoice_id", invoice_id).execute().data
    )
    lease = supabase.table("leases").select("*").eq("id", invoice["lease_id"]).single().execute().data
    tenant = supabase.table("tenants").select("*").eq("id", lease["tenant_id"]).single().execute().data
    room = supabase.table("rooms").select("*").eq("id", lease["room_id"]).single().execute().data
    building = (
        supabase.table("buildings").select("*").eq("id", room["building_id"]).single().execute().data
    )
    company = (
        supabase.table("companies").select("*").eq("id", invoice["company_id"]).single().execute().data
    )

    deposit_rows = (
        supabase.table("security_deposits").select("*").eq("lease_id", lease["id"]).execute().data
    )
    deposit = deposit_rows[0] if deposit_rows else None

    lease_invoices = (
        supabase.table("invoices")
        .select("id, created_at")
        .eq("lease_id", lease["id"])
        .order("created_at")
        .execute()
        .data
    )
    is_first_invoice = bool(lease_invoices) and lease_invoices[0]["id"] == invoice["id"]

    return {
        "invoice": invoice,
        "line_items": line_items,
        "lease": lease,
        "tenant": tenant,
        "room": room,
        "building": building,
        "company": company,
        "deposit": deposit,
        "is_first_invoice": is_first_invoice,
    }


def render_invoice_pdf(ctx: dict) -> bytes:
    """Renders the branded invoice PDF (bytes) from a context dict built by
    fetch_invoice_context(). Pure function -- no I/O beyond the logo fetch."""
    invoice, line_items = ctx["invoice"], ctx["line_items"]
    tenant, room, building, company = ctx["tenant"], ctx["room"], ctx["building"], ctx["company"]
    deposit, is_first_invoice = ctx.get("deposit"), ctx.get("is_first_invoice")

    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4

    LEDGER = (0.184, 0.310, 0.239)
    BRASS = (0.784, 0.608, 0.361)
    INK = (0.122, 0.176, 0.141)
    PAPER = (0.953, 0.949, 0.902)
    STATUS_COLORS = {
        "paid": (0.184, 0.310, 0.239),
        "sent": (0.722, 0.525, 0.180),
        "draft": (0.722, 0.525, 0.180),
        "partial": (0.722, 0.525, 0.180),
        "overdue": (0.651, 0.239, 0.251),
        "cancelled": (0.337, 0.373, 0.353),
    }

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
            pass

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
    if invoice.get("invoice_number"):
        c.drawString(20 * mm, y, f"Invoice #: {invoice['invoice_number']}")
        y -= 6 * mm
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
    # Charges hidden from print (e.g. a facility rolled quietly into the
    # headline rent) still count fully toward the total -- but simply
    # skipping their rows would leave the printed lines not adding up to
    # that total, which looks broken on a real invoice. So for DISPLAY
    # ONLY, their amounts are folded into the Rent line's printed figure
    # (never into the stored invoice_line_items, the ledger, or the
    # total -- those stay exactly as they already were). If there's no
    # Rent line to fold into for some reason, the largest visible line
    # absorbs it instead, so the printed page still sums correctly no
    # matter what.
    hidden_total = sum(float(item["amount"]) for item in line_items if item.get("show_on_invoice", True) is False)
    visible_items = [item for item in line_items if item.get("show_on_invoice", True) is not False]
    fold_into = next((item for item in visible_items if item["label"].strip().lower() == "rent"), None)
    if fold_into is None and visible_items:
        fold_into = max(visible_items, key=lambda item: float(item["amount"]))

    for item in visible_items:
        amount = float(item["amount"])
        if hidden_total and fold_into is not None and item is fold_into:
            amount += hidden_total
        y -= 7 * mm
        c.drawString(20 * mm, y, item["label"])
        c.drawRightString(width - 20 * mm, y, f"Rs {amount:,.0f}")

    y -= 5 * mm
    c.setStrokeColorRGB(*INK)
    c.line(20 * mm, y, width - 20 * mm, y)

    y -= 12 * mm
    c.setFillColorRGB(*PAPER)
    c.rect(20 * mm, y - 3 * mm, width - 40 * mm, 11 * mm, fill=1, stroke=0)
    c.setFillColorRGB(*LEDGER)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(24 * mm, y, "Total")
    c.drawRightString(width - 24 * mm, y, f"Rs {float(invoice['total_amount']):,.0f}")

    # Security deposit -- shown for information only on the first invoice.
    # It is NOT part of the invoice total above and is not settled by
    # paying this invoice: it's tracked and receipted through its own
    # separate flow, so a tenant/owner always knows its true status.
    if is_first_invoice and deposit and float(deposit.get("amount_received") or 0) > 0:
        received = bool(deposit.get("is_received"))
        y -= 12 * mm
        c.setStrokeColorRGB(0.86, 0.84, 0.77)
        c.setLineWidth(0.75)
        c.line(20 * mm, y, width - 20 * mm, y)
        y -= 7 * mm
        c.setFillColorRGB(*INK)
        c.setFont("Helvetica", 10)
        c.drawString(20 * mm, y, "Security deposit (refundable, held separately)")
        c.drawRightString(width - 20 * mm, y, f"Rs {float(deposit['amount_received']):,.0f}")

        y -= 6 * mm
        status_text = "RECEIVED" if received else "PENDING"
        status_color = LEDGER if received else (0.722, 0.525, 0.180)
        c.setFont("Helvetica-Bold", 8)
        badge_width = c.stringWidth(status_text, "Helvetica-Bold", 8) + 8 * mm
        c.setFillColorRGB(*status_color)
        c.roundRect(20 * mm, y - 2.5 * mm, badge_width, 6.5 * mm, 1.2 * mm, fill=1, stroke=0)
        c.setFillColorRGB(1, 1, 1)
        c.drawCentredString(20 * mm + badge_width / 2, y - 0.2 * mm, status_text)

        c.setFillColorRGB(0.4, 0.43, 0.41)
        c.setFont("Helvetica", 9)
        combined = float(invoice["total_amount"]) + float(deposit["amount_received"])
        note = f"Total due at signing (bill + deposit): Rs {combined:,.0f}" if not received else "Deposit already collected — see your security deposit receipt."
        c.drawString(20 * mm + badge_width + 4 * mm, y, note)

    y -= 20 * mm
    c.setFillColorRGB(0.4, 0.43, 0.41)
    c.setFont("Helvetica-Oblique", 8)
    c.drawString(20 * mm, y, "Thank you for your prompt payment.")

    c.save()
    buffer.seek(0)
    return buffer.read()
