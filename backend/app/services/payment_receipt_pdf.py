"""
Printable acknowledgement-of-receipt for a payment. Mirrors
deposit_receipt_pdf.py / invoice_pdf.py's structure and visual style (same
letterhead band, same colour palette) so it feels like part of the same
document family.

Built around receipt_group_id, not a single payment row -- POST
/payments/receipt (the "Receive Payment" screen) can settle several
invoices, an opening balance, a discount, and an advance all in ONE
receipt, creating several rows in `payments` that share one
receipt_group_id. This renders all of them as line items on one document,
the same way a tenant would expect one receipt for one visit to the office
-- not one PDF per invoice it happened to touch.

Also accepts a plain payment id (no receipt_group_id) as a fallback, for
rows created by the older/simpler POST /payments endpoint, which never set
one.
"""

import io
import urllib.request

from fastapi import HTTPException
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from supabase import Client

LEDGER = (0.184, 0.310, 0.239)
BRASS = (0.784, 0.608, 0.361)
INK = (0.122, 0.176, 0.141)
PAPER = (0.953, 0.949, 0.902)


def fetch_receipt_context(supabase: Client, receipt_id: str) -> dict:
    """
    Fetches everything needed to render a receipt. `receipt_id` is tried
    first as a receipt_group_id (the normal case, from the Receive Payment
    screen); if nothing matches, it's tried as a plain payment id instead
    (covers payments recorded via the older, simpler POST /payments,
    before receipt_group_id existed).
    """
    payments = (
        supabase.table("payments")
        .select("*")
        .eq("receipt_group_id", receipt_id)
        .order("created_at")
        .execute()
        .data
    )
    if not payments:
        single = supabase.table("payments").select("*").eq("id", receipt_id).single().execute()
        if not single.data:
            raise HTTPException(status_code=404, detail="Payment or receipt not found")
        payments = [single.data]

    company_id = payments[0]["company_id"]
    tenant_id = payments[0]["tenant_id"]

    tenant = supabase.table("tenants").select("*").eq("id", tenant_id).single().execute().data
    company = supabase.table("companies").select("*").eq("id", company_id).single().execute().data

    # Resolve room/building via whichever payment IS tied to an invoice --
    # an opening-balance or advance row in the same receipt has no
    # invoice_id of its own to resolve from.
    invoice_ids = [p["invoice_id"] for p in payments if p.get("invoice_id")]
    invoices_by_id = {}
    room = building = None
    if invoice_ids:
        fetched_invoices = supabase.table("invoices").select("*").in_("id", invoice_ids).execute().data
        invoices_by_id = {i["id"]: i for i in fetched_invoices}
        lease = (
            supabase.table("leases")
            .select("*")
            .eq("id", fetched_invoices[0]["lease_id"])
            .single()
            .execute()
            .data
        )
        if lease:
            room = supabase.table("rooms").select("*").eq("id", lease["room_id"]).single().execute().data
            if room:
                building = (
                    supabase.table("buildings").select("*").eq("id", room["building_id"]).single().execute().data
                )
    else:
        # Every row in this receipt was opening-balance/advance (no invoice
        # touched at all) -- fall back to the tenant's active lease purely
        # for a room/building label on the receipt.
        active_lease = (
            supabase.table("leases")
            .select("room_id")
            .eq("tenant_id", tenant_id)
            .eq("status", "active")
            .execute()
            .data
        )
        if active_lease:
            room = supabase.table("rooms").select("*").eq("id", active_lease[0]["room_id"]).single().execute().data
            if room:
                building = (
                    supabase.table("buildings").select("*").eq("id", room["building_id"]).single().execute().data
                )

    discount_account_ids = list({p["discount_account_id"] for p in payments if p.get("discount_account_id")})
    accounts_by_id = {}
    if discount_account_ids:
        fetched_accounts = (
            supabase.table("chart_of_accounts").select("id, code, name").in_("id", discount_account_ids).execute().data
        )
        accounts_by_id = {a["id"]: a for a in fetched_accounts}

    line_items = []
    for p in payments:
        cash = float(p["amount"])
        discount = float(p.get("discount_amount") or 0)
        notes = p.get("notes") or ""
        if p.get("invoice_id") and p["invoice_id"] in invoices_by_id:
            label = f"Invoice — {invoices_by_id[p['invoice_id']]['invoice_month']}"
        elif "applied to opening balance" in notes.lower():
            label = "Applied to opening balance"
        elif "advance" in notes.lower():
            label = "Advance (credit on account)"
        else:
            label = "Payment"
        line_items.append({"label": label, "cash": cash, "discount": discount})

    total_cash = round(sum(li["cash"] for li in line_items), 2)
    total_discount = round(sum(li["discount"] for li in line_items), 2)

    return {
        "receipt_id": receipt_id,
        "payments": payments,
        "line_items": line_items,
        "total_cash": total_cash,
        "total_discount": total_discount,
        "total_settled": round(total_cash + total_discount, 2),
        "payment_date": payments[0]["payment_date"],
        "payment_method": payments[0].get("payment_method"),
        "tenant": tenant,
        "room": room,
        "building": building,
        "company": company,
    }


def render_receipt_pdf(ctx: dict) -> bytes:
    """Renders the branded payment receipt PDF (bytes). Pure function --
    no I/O beyond the logo fetch, same as the other document renderers."""
    tenant, room, building, company = ctx["tenant"], ctx["room"], ctx["building"], ctx["company"]
    line_items = ctx["line_items"]

    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4

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
    c.drawString(20 * mm, y, "PAYMENT RECEIPT")

    receipt_no = f"RCPT-{ctx['receipt_id'][:8].upper()}"
    c.setFont("Helvetica-Bold", 9)
    badge_width = c.stringWidth(receipt_no, "Helvetica-Bold", 9) + 10 * mm
    badge_x = width - 20 * mm - badge_width
    c.setFillColorRGB(*LEDGER)
    c.roundRect(badge_x, y - 3 * mm, badge_width, 8 * mm, 1.5 * mm, fill=1, stroke=0)
    c.setFillColorRGB(1, 1, 1)
    c.drawCentredString(badge_x + badge_width / 2, y - 0.5 * mm, receipt_no)

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
    c.drawString(20 * mm, y, f"Date received: {ctx['payment_date']}")
    method = (ctx.get("payment_method") or "—").replace("_", " ").title()
    c.drawRightString(width - 20 * mm, y, f"Method: {method}")

    y -= 12 * mm
    c.setFont("Helvetica-Bold", 11)
    c.drawString(20 * mm, y, "Received from")
    y -= 6 * mm
    c.setFont("Helvetica", 10)
    c.drawString(20 * mm, y, tenant.get("full_name") or "")
    y -= 5 * mm
    c.setFillColorRGB(0.3, 0.34, 0.32)
    c.drawString(20 * mm, y, f"CNIC: {tenant.get('cnic') or ''}")
    if room and building:
        y -= 5 * mm
        c.drawString(20 * mm, y, f"{building.get('name') or ''} — Room {room.get('room_number') or ''}")
    c.setFillColorRGB(*INK)

    y -= 14 * mm
    c.setFont("Helvetica-Bold", 10)
    c.drawString(20 * mm, y, "Description")
    c.drawRightString(width - 45 * mm, y, "Cash")
    c.drawRightString(width - 20 * mm, y, "Discount")
    y -= 3 * mm
    c.setStrokeColorRGB(*INK)
    c.setLineWidth(0.75)
    c.line(20 * mm, y, width - 20 * mm, y)

    c.setFont("Helvetica", 10)
    for li in line_items:
        y -= 7 * mm
        c.drawString(20 * mm, y, li["label"])
        c.drawRightString(width - 45 * mm, y, f"Rs {li['cash']:,.0f}")
        c.drawRightString(width - 20 * mm, y, f"Rs {li['discount']:,.0f}" if li["discount"] else "—")

    y -= 5 * mm
    c.setStrokeColorRGB(*INK)
    c.line(20 * mm, y, width - 20 * mm, y)

    y -= 12 * mm
    c.setFillColorRGB(*PAPER)
    c.rect(20 * mm, y - 3 * mm, width - 40 * mm, 11 * mm, fill=1, stroke=0)
    c.setFillColorRGB(*LEDGER)
    c.setFont("Helvetica-Bold", 12)
    total_label = "Total settled" if ctx["total_discount"] > 0 else "Total received"
    c.drawString(24 * mm, y, total_label)
    c.drawRightString(width - 24 * mm, y, f"Rs {ctx['total_settled']:,.0f}")

    if ctx["total_discount"] > 0:
        y -= 8 * mm
        c.setFillColorRGB(0.4, 0.43, 0.41)
        c.setFont("Helvetica-Oblique", 9)
        c.drawString(20 * mm, y, f"Of which Rs {ctx['total_discount']:,.0f} was a discount, not cash.")
        c.setFillColorRGB(*INK)

    y -= 20 * mm
    c.setFillColorRGB(0.4, 0.43, 0.41)
    c.setFont("Helvetica-Oblique", 8)
    c.drawString(20 * mm, y, "This receipt acknowledges the amount above as received in full.")

    c.save()
    buffer.seek(0)
    return buffer.read()
