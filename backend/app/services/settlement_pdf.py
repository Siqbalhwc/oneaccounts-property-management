"""
Printable lease-closing settlement statement. Same letterhead band and
color palette as invoice_pdf.py / deposit_receipt_pdf.py, so all three feel
like one system.

Always regenerated from the SAVED lease_settlements row, not recalculated
against today's books -- so it matches exactly what was agreed and posted
at move-out time, even if the underlying invoices/deposit change later
(e.g. a subsequent unrelated reversal elsewhere).
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
RED = (0.651, 0.239, 0.251)


def fetch_settlement_context(supabase: Client, settlement_id: str) -> dict:
    settlement = supabase.table("lease_settlements").select("*").eq("id", settlement_id).single().execute()
    if not settlement.data:
        raise HTTPException(status_code=404, detail="Settlement not found")
    settlement = settlement.data

    lease = supabase.table("leases").select("*").eq("id", settlement["lease_id"]).single().execute().data
    tenant = supabase.table("tenants").select("*").eq("id", lease["tenant_id"]).single().execute().data
    room = supabase.table("rooms").select("*").eq("id", lease["room_id"]).single().execute().data
    building = (
        supabase.table("buildings").select("*").eq("id", room["building_id"]).single().execute().data
        if room else None
    )
    company = supabase.table("companies").select("*").eq("id", settlement["company_id"]).single().execute().data

    deductions = []
    if settlement.get("deposit_id"):
        deductions = (
            supabase.table("security_deposit_deductions")
            .select("*")
            .eq("security_deposit_id", settlement["deposit_id"])
            .execute()
            .data
        )

    return {
        "settlement": settlement,
        "lease": lease,
        "tenant": tenant,
        "room": room,
        "building": building,
        "company": company,
        "deductions": deductions,
    }


def _letterhead(c: canvas.Canvas, width: float, height: float, company: dict, title: str) -> float:
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
    c.drawString(20 * mm, y, title)

    y -= 10 * mm
    c.setStrokeColorRGB(*BRASS)
    c.setLineWidth(2)
    c.line(20 * mm, y, 20 * mm + 12 * mm, y)
    c.setStrokeColorRGB(0.86, 0.84, 0.77)
    c.setLineWidth(0.75)
    c.line(20 * mm + 12 * mm, y, width - 20 * mm, y)
    return y


def render_settlement_pdf(ctx: dict) -> bytes:
    settlement = ctx["settlement"]
    tenant, room, building, company = ctx["tenant"], ctx["room"], ctx["building"], ctx["company"]
    deductions = ctx["deductions"]
    show_detail = settlement.get("show_full_detail_on_pdf", True)
    net_amount = float(settlement["net_amount"])
    is_refund = net_amount >= 0

    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4

    y = _letterhead(c, width, height, company, "LEASE SETTLEMENT STATEMENT")

    y -= 8 * mm
    c.setFillColorRGB(*INK)
    c.setFont("Helvetica", 10)
    c.drawString(20 * mm, y, f"Move-out date: {settlement['move_out_date']}")

    y -= 12 * mm
    c.setFont("Helvetica-Bold", 11)
    c.drawString(20 * mm, y, "Tenant")
    y -= 6 * mm
    c.setFont("Helvetica", 10)
    c.drawString(20 * mm, y, tenant.get("full_name") or "")
    y -= 5 * mm
    c.setFillColorRGB(0.3, 0.34, 0.32)
    c.drawString(20 * mm, y, f"CNIC: {tenant.get('cnic') or ''}")
    y -= 5 * mm
    c.drawString(
        20 * mm, y,
        f"{building.get('name') if building else ''} — Room {room.get('room_number') if room else ''}",
    )
    c.setFillColorRGB(*INK)

    if show_detail:
        y -= 14 * mm
        c.setFont("Helvetica-Bold", 11)
        c.drawString(20 * mm, y, "Rent & bills")
        y -= 7 * mm
        c.setFont("Helvetica", 10)
        c.drawString(20 * mm, y, "Outstanding from previous months")
        c.drawRightString(width - 20 * mm, y, f"Rs {float(settlement['outstanding_prior_amount']):,.0f}")

        final_charges = settlement.get("final_period_charges") or []
        if final_charges:
            y -= 7 * mm
            c.setFont("Helvetica-Oblique", 9)
            c.setFillColorRGB(0.3, 0.34, 0.32)
            c.drawString(20 * mm, y, "Final period (prorated to move-out date)")
            c.setFillColorRGB(*INK)
            for item in final_charges:
                y -= 5.5 * mm
                c.setFont("Helvetica", 9)
                c.drawString(24 * mm, y, item["label"])
                c.drawRightString(width - 20 * mm, y, f"Rs {float(item['amount']):,.0f}")
        y -= 7 * mm
        c.setFont("Helvetica", 10)
        c.drawString(20 * mm, y, "Final period subtotal")
        c.drawRightString(width - 20 * mm, y, f"Rs {float(settlement['final_period_total']):,.0f}")

        if float(settlement.get("discount_amount") or 0) > 0:
            y -= 7 * mm
            c.setFillColorRGB(0.184, 0.4, 0.239)
            c.drawString(20 * mm, y, f"Discount{' — ' + settlement['discount_reason'] if settlement.get('discount_reason') else ''}")
            c.drawRightString(width - 20 * mm, y, f"- Rs {float(settlement['discount_amount']):,.0f}")
            c.setFillColorRGB(*INK)

        y -= 8 * mm
        c.setStrokeColorRGB(*INK)
        c.setLineWidth(0.75)
        c.line(20 * mm, y, width - 20 * mm, y)
        y -= 7 * mm
        c.setFont("Helvetica-Bold", 10)
        c.drawString(20 * mm, y, "Total owed by tenant")
        c.drawRightString(width - 20 * mm, y, f"Rs {float(settlement['total_owed_by_tenant']):,.0f}")

        y -= 14 * mm
        c.setFont("Helvetica-Bold", 11)
        c.drawString(20 * mm, y, "Security deposit")
        y -= 7 * mm
        c.setFont("Helvetica", 10)
        c.drawString(20 * mm, y, "Deposit paid")
        c.drawRightString(width - 20 * mm, y, f"Rs {float(settlement['deposit_paid']):,.0f}")

        if deductions:
            for d in deductions:
                y -= 6 * mm
                c.setFont("Helvetica", 9)
                c.drawString(24 * mm, y, f"Deduction — {d['reason']}")
                c.drawRightString(width - 20 * mm, y, f"- Rs {float(d['amount']):,.0f}")
        y -= 8 * mm
        c.setStrokeColorRGB(*INK)
        c.line(20 * mm, y, width - 20 * mm, y)

    y -= 16 * mm
    c.setFillColorRGB(*(LEDGER if is_refund else RED))
    c.rect(20 * mm, y - 4 * mm, width - 40 * mm, 14 * mm, fill=1, stroke=0)
    c.setFillColorRGB(1, 1, 1)
    c.setFont("Helvetica-Bold", 13)
    label = "Net refund to tenant" if is_refund else "Net amount still owed by tenant"
    c.drawString(24 * mm, y, label)
    c.drawRightString(width - 24 * mm, y, f"Rs {abs(net_amount):,.0f}")

    y -= 24 * mm
    c.setFillColorRGB(0.3, 0.34, 0.32)
    c.setFont("Helvetica", 9)
    c.drawString(20 * mm, y, "This statement reflects the lease as closed on the move-out date above.")

    y -= 20 * mm
    c.setStrokeColorRGB(0.6, 0.6, 0.6)
    c.setLineWidth(0.5)
    c.line(20 * mm, y, 80 * mm, y)
    c.setFillColorRGB(0.4, 0.43, 0.41)
    c.setFont("Helvetica", 8)
    c.drawString(20 * mm, y - 5 * mm, "Authorized signature")

    c.save()
    buffer.seek(0)
    return buffer.read()
