"""
Generic printable voucher for a single journal entry -- the fallback
"source document" for any ledger line whose source type doesn't have its
own bespoke PDF (payment/receipt, expense, salary payment, owner payout,
manual adjustment). Invoices and security deposits use their own existing
documents instead (see financials.py's /source-document resolver); this
covers everything else with one consistent, professional document rather
than five separate bespoke templates.

Mirrors invoice_pdf.py / deposit_receipt_pdf.py's structure and visual
style (same letterhead band, same colour palette) so every printable
document in the app feels like part of one family.
"""

import io
import urllib.request

from fastapi import HTTPException
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from supabase import Client

SOURCE_TYPE_LABELS = {
    "payment": "Payment Receipt",
    "receipt": "Payment Receipt",
    "expense": "Expense Voucher",
    "salary_payment": "Salary Payment Voucher",
    "owner_payout": "Owner Payout Voucher",
    "manual_adjustment": "Journal Voucher",
    "security_deposit": "Security Deposit Voucher",
    "security_deposit_payment": "Security Deposit Voucher",
    "security_deposit_refund": "Security Deposit Refund Voucher",
}


def fetch_voucher_context(supabase: Client, journal_entry_id: str) -> dict:
    """Fetches everything needed to render a voucher: the journal entry
    itself, every line on it (with account/building/room/owner/tenant
    names resolved), and the company (letterhead)."""
    entry = supabase.table("journal_entries").select("*").eq("id", journal_entry_id).single().execute()
    if not entry.data:
        raise HTTPException(status_code=404, detail="Journal entry not found")
    entry = entry.data

    lines = (
        supabase.table("journal_lines")
        .select("*")
        .eq("journal_entry_id", journal_entry_id)
        .order("created_at")
        .execute()
        .data
    )

    account_ids = list({l["account_id"] for l in lines if l.get("account_id")})
    building_ids = list({l["building_id"] for l in lines if l.get("building_id")})
    room_ids = list({l["room_id"] for l in lines if l.get("room_id")})
    owner_ids = list({l["owner_id"] for l in lines if l.get("owner_id")})
    tenant_ids = list({l["tenant_id"] for l in lines if l.get("tenant_id")})

    accounts_by_id = {}
    if account_ids:
        fetched = supabase.table("chart_of_accounts").select("id, code, name").in_("id", account_ids).execute().data
        accounts_by_id = {a["id"]: a for a in fetched}

    buildings_by_id = {}
    if building_ids:
        fetched = supabase.table("buildings").select("id, name").in_("id", building_ids).execute().data
        buildings_by_id = {b["id"]: b for b in fetched}

    rooms_by_id = {}
    if room_ids:
        fetched = supabase.table("rooms").select("id, room_number").in_("id", room_ids).execute().data
        rooms_by_id = {r["id"]: r for r in fetched}

    owners_by_id = {}
    if owner_ids:
        fetched = supabase.table("owners").select("id, name").in_("id", owner_ids).execute().data
        owners_by_id = {o["id"]: o for o in fetched}

    tenants_by_id = {}
    if tenant_ids:
        fetched = supabase.table("tenants").select("id, full_name").in_("id", tenant_ids).execute().data
        tenants_by_id = {t["id"]: t for t in fetched}

    for l in lines:
        l["account"] = accounts_by_id.get(l.get("account_id"))
        l["building"] = buildings_by_id.get(l.get("building_id"))
        l["room"] = rooms_by_id.get(l.get("room_id"))
        l["owner"] = owners_by_id.get(l.get("owner_id"))
        l["tenant"] = tenants_by_id.get(l.get("tenant_id"))

    company = supabase.table("companies").select("*").eq("id", entry["company_id"]).single().execute().data

    return {"entry": entry, "lines": lines, "company": company}


def render_voucher_pdf(ctx: dict) -> bytes:
    """Renders the branded journal voucher PDF (bytes) from a context dict
    built by fetch_voucher_context(). Pure function -- no I/O beyond the
    logo fetch."""
    entry, lines, company = ctx["entry"], ctx["lines"], ctx["company"]
    is_reversed = entry.get("status") == "reversed"
    title = SOURCE_TYPE_LABELS.get(entry.get("source_type"), "Journal Voucher").upper()

    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4

    LEDGER = (0.184, 0.310, 0.239)
    BRASS = (0.784, 0.608, 0.361)
    INK = (0.122, 0.176, 0.141)
    PAPER = (0.953, 0.949, 0.902)
    STAMP_RED = (0.545, 0.227, 0.227)

    band_height = 38 * mm
    c.setFillColorRGB(*LEDGER)
    c.rect(0, height - band_height, width, band_height, fill=1, stroke=0)

    text_x = 20 * mm
    if company and company.get("logo_url"):
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
    c.drawString(text_x, height - 16 * mm, (company or {}).get("name") or "")
    c.setFont("Helvetica", 9)
    c.setFillColorRGB(0.9, 0.92, 0.9)
    line_y = height - 23 * mm
    if company and company.get("address"):
        c.drawString(text_x, line_y, company["address"])
        line_y -= 5 * mm
    if company and company.get("phone"):
        c.drawString(text_x, line_y, company["phone"])

    y = height - band_height - 14 * mm
    c.setFillColorRGB(*INK)
    c.setFont("Helvetica-Bold", 15)
    c.drawString(20 * mm, y, title)

    if is_reversed:
        badge_text = "REVERSED"
        c.setFont("Helvetica-Bold", 9)
        badge_width = c.stringWidth(badge_text, "Helvetica-Bold", 9) + 10 * mm
        badge_x = width - 20 * mm - badge_width
        c.setFillColorRGB(*STAMP_RED)
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
    c.drawString(20 * mm, y, f"Date: {entry.get('entry_date')}")

    y -= 6 * mm
    c.setFillColorRGB(0.3, 0.34, 0.32)
    c.setFont("Helvetica", 9)
    c.drawString(20 * mm, y, entry.get("description") or "")

    # Table header
    y -= 12 * mm
    c.setFillColorRGB(*PAPER)
    c.rect(20 * mm, y - 2 * mm, width - 40 * mm, 8 * mm, fill=1, stroke=0)
    c.setFillColorRGB(*LEDGER)
    c.setFont("Helvetica-Bold", 8.5)
    c.drawString(22 * mm, y, "ACCOUNT")
    c.drawString(95 * mm, y, "TAG")
    c.drawRightString(width - 60 * mm, y, "DEBIT")
    c.drawRightString(width - 20 * mm, y, "CREDIT")

    y -= 10 * mm
    c.setFont("Helvetica", 9.5)
    total_debit = 0.0
    total_credit = 0.0
    for l in lines:
        acct = l.get("account") or {}
        acct_label = f"{acct.get('code', '')} · {acct.get('name', '')}".strip(" ·")

        tag_bits = []
        if l.get("building"):
            tag_bits.append(l["building"]["name"])
        if l.get("room"):
            tag_bits.append(f"Apt {l['room']['room_number']}")
        if l.get("owner"):
            tag_bits.append(l["owner"]["name"])
        if l.get("tenant"):
            tag_bits.append(l["tenant"]["full_name"])
        tag_label = ", ".join(tag_bits)

        c.setFillColorRGB(*INK)
        c.drawString(22 * mm, y, acct_label[:38])
        c.setFillColorRGB(0.4, 0.43, 0.41)
        c.setFont("Helvetica", 8.5)
        c.drawString(95 * mm, y, tag_label[:30])
        c.setFont("Helvetica", 9.5)
        c.setFillColorRGB(*INK)

        amount = float(l.get("amount") or 0)
        if l.get("direction") == "debit":
            c.drawRightString(width - 60 * mm, y, f"Rs {amount:,.0f}")
            total_debit += amount
        else:
            c.drawRightString(width - 20 * mm, y, f"Rs {amount:,.0f}")
            total_credit += amount

        y -= 6.5 * mm

    y -= 2 * mm
    c.setStrokeColorRGB(*INK)
    c.setLineWidth(0.75)
    c.line(20 * mm, y, width - 20 * mm, y)

    y -= 8 * mm
    c.setFont("Helvetica-Bold", 10)
    c.drawString(22 * mm, y, "Total")
    c.drawRightString(width - 60 * mm, y, f"Rs {total_debit:,.0f}")
    c.drawRightString(width - 20 * mm, y, f"Rs {total_credit:,.0f}")

    y -= 20 * mm
    c.setStrokeColorRGB(0.6, 0.6, 0.6)
    c.setLineWidth(0.5)
    c.line(20 * mm, y, 80 * mm, y)
    c.setFillColorRGB(0.4, 0.43, 0.41)
    c.setFont("Helvetica", 8)
    c.drawString(20 * mm, y - 5 * mm, "Authorized signature")

    y -= 16 * mm
    c.setFont("Helvetica-Oblique", 7.5)
    c.setFillColorRGB(0.5, 0.53, 0.51)
    c.drawString(20 * mm, y, "System-generated voucher from the accounting ledger.")

    c.save()
    buffer.seek(0)
    return buffer.read()
