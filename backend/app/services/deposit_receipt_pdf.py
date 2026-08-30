"""
Printable acknowledgement-of-receipt for a security deposit. Mirrors
invoice_pdf.py's structure and visual style (same letterhead band, same
color palette) so the two documents feel like part of one system, but kept
as its own file since it's a different document type with its own layout.
"""

import io
import urllib.request

from fastapi import HTTPException
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from supabase import Client


def fetch_deposit_context(supabase: Client, deposit_id: str) -> dict:
    """Fetches everything needed to render a deposit receipt: the deposit
    itself, every payment recorded toward it so far, the lease/tenant/
    room/building it belongs to, and the company (letterhead)."""
    deposit = supabase.table("security_deposits").select("*").eq("id", deposit_id).single().execute()
    if not deposit.data:
        raise HTTPException(status_code=404, detail="Deposit not found")
    deposit = deposit.data

    lease = supabase.table("leases").select("*").eq("id", deposit["lease_id"]).single().execute().data
    tenant = supabase.table("tenants").select("*").eq("id", lease["tenant_id"]).single().execute().data
    room = supabase.table("rooms").select("*").eq("id", lease["room_id"]).single().execute().data
    building = (
        supabase.table("buildings").select("*").eq("id", room["building_id"]).single().execute().data
    )
    company = (
        supabase.table("companies").select("*").eq("id", deposit["company_id"]).single().execute().data
    )

    payments = (
        supabase.table("security_deposit_payments")
        .select("*")
        .eq("security_deposit_id", deposit_id)
        .order("payment_date")
        .order("created_at")
        .execute()
        .data
    )
    account_ids = list({p["account_id"] for p in payments})
    accounts_by_id = {}
    if account_ids:
        fetched = supabase.table("chart_of_accounts").select("*").in_("id", account_ids).execute().data
        accounts_by_id = {a["id"]: a for a in fetched}
    for p in payments:
        p["account"] = accounts_by_id.get(p["account_id"])

    total_paid = sum(float(p["amount"]) for p in payments)

    return {
        "deposit": deposit,
        "payments": payments,
        "total_paid": total_paid,
        "amount_pending": max(float(deposit["amount_received"]) - total_paid, 0.0),
        "lease": lease,
        "tenant": tenant,
        "room": room,
        "building": building,
        "company": company,
    }


def render_deposit_receipt_pdf(ctx: dict) -> bytes:
    """Renders the branded security-deposit-receipt PDF (bytes) from a
    context dict built by fetch_deposit_context(). Pure function -- no I/O
    beyond the logo fetch."""
    deposit = ctx["deposit"]
    payments, total_paid, amount_pending = ctx["payments"], ctx["total_paid"], ctx["amount_pending"]
    tenant, room, building, company = ctx["tenant"], ctx["room"], ctx["building"], ctx["company"]
    is_fully_paid = amount_pending <= 0.01

    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4

    LEDGER = (0.184, 0.310, 0.239)
    BRASS = (0.784, 0.608, 0.361)
    INK = (0.122, 0.176, 0.141)
    PAPER = (0.953, 0.949, 0.902)

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
    c.drawString(20 * mm, y, "SECURITY DEPOSIT RECEIPT")

    badge_text = "FULLY RECEIVED" if is_fully_paid else "PARTIALLY RECEIVED"
    c.setFont("Helvetica-Bold", 9)
    badge_width = c.stringWidth(badge_text, "Helvetica-Bold", 9) + 10 * mm
    badge_x = width - 20 * mm - badge_width
    c.setFillColorRGB(*LEDGER)
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
    latest_date = payments[-1]["payment_date"] if payments else deposit.get("date_received")
    c.drawString(20 * mm, y, f"Latest payment: {latest_date}")

    y -= 12 * mm
    c.setFont("Helvetica-Bold", 11)
    c.drawString(20 * mm, y, "Received from")
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
    c.setFillColorRGB(*PAPER)
    c.rect(20 * mm, y - 3 * mm, width - 40 * mm, 11 * mm, fill=1, stroke=0)
    c.setFillColorRGB(*LEDGER)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(24 * mm, y, "Security deposit agreed")
    c.drawRightString(width - 24 * mm, y, f"Rs {float(deposit['amount_received']):,.0f}")

    y -= 14 * mm
    c.setFillColorRGB(*INK)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(20 * mm, y, "Payments received")
    y -= 6 * mm
    c.setFont("Helvetica", 9)
    for p in payments:
        acct = p.get("account")
        acct_label = f"{acct.get('code', '')} · {acct.get('name', '')}" if acct else ""
        c.drawString(20 * mm, y, f"{p['payment_date']} — {acct_label}")
        c.drawRightString(width - 20 * mm, y, f"Rs {float(p['amount']):,.0f}")
        y -= 5 * mm

    y -= 3 * mm
    c.setFont("Helvetica-Bold", 10)
    c.drawString(20 * mm, y, "Total received")
    c.drawRightString(width - 20 * mm, y, f"Rs {total_paid:,.0f}")
    if not is_fully_paid:
        y -= 6 * mm
        c.setFillColorRGB(0.55, 0.25, 0.1)
        c.drawString(20 * mm, y, "Still pending")
        c.drawRightString(width - 20 * mm, y, f"Rs {amount_pending:,.0f}")
        c.setFillColorRGB(*INK)

    y -= 12 * mm

    c.setFillColorRGB(0.3, 0.34, 0.32)
    c.setFont("Helvetica", 9)
    c.drawString(
        20 * mm,
        y,
        "This deposit is refundable, subject to deductions for damages or unpaid",
    )
    y -= 4.5 * mm
    c.drawString(20 * mm, y, "dues, upon lawful termination of the lease.")

    y -= 24 * mm
    c.setStrokeColorRGB(0.6, 0.6, 0.6)
    c.setLineWidth(0.5)
    c.line(20 * mm, y, 80 * mm, y)
    c.setFillColorRGB(0.4, 0.43, 0.41)
    c.setFont("Helvetica", 8)
    c.drawString(20 * mm, y - 5 * mm, "Authorized signature")

    c.save()
    buffer.seek(0)
    return buffer.read()
