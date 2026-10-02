from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from supabase import Client

from app.core.config import settings
from app.core.deps import get_current_company_id, get_service_client, get_supabase
from app.services.invoice_batch import count_invoice_numbers, generate_batch, plan_generation
from app.services.invoicing import compute_prorated_charges, current_charges_with_earliest_start, post_invoice_journal
from app.services.phone import normalize_to_whatsapp

router = APIRouter(prefix="/invoices", tags=["Invoices"])


class GenerateRequest(BaseModel):
    month: date  # any date within the target month, e.g. 2026-07-15
    building_id: Optional[str] = None  # optional filter
    due_in_days: int = 7


class BatchRequest(BaseModel):
    month: date
    lease_ids: list[str]
    due_in_days: int = 7


@router.get("")
def list_invoices(
    date_from: Optional[date] = Query(None, description="Only invoices with invoice_month on/after this date"),
    date_to: Optional[date] = Query(None, description="Only invoices with invoice_month on/before this date"),
    exclude_paid: Optional[bool] = Query(
        None, description="If true, only returns invoices not yet fully settled (excludes 'paid' and 'cancelled')"
    ),
    lease_id: Optional[str] = Query(None, description="Only invoices for this lease"),
    supabase: Client = Depends(get_supabase),
):
    """
    All filters are purely additive -- omitting them returns exactly what
    this endpoint always returned (every invoice), so existing callers
    (Invoices page, Reports page) are unaffected. date_from/date_to/
    exclude_paid were added so the Dashboard can ask for a recent window
    PLUS any still-unpaid invoice regardless of age, instead of pulling the
    company's entire invoice history every load. lease_id was added for the
    Receive Payment page, which needs one lease's invoices only.
    """
    query = supabase.table("invoices").select("*")
    if date_from:
        query = query.gte("invoice_month", str(date_from))
    if date_to:
        query = query.lte("invoice_month", str(date_to))
    if exclude_paid:
        query = query.not_.in_("status", ["paid", "cancelled"])
    if lease_id:
        query = query.eq("lease_id", lease_id)
    return query.order("created_at", desc=True).execute().data


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


def generate_invoice_number(supabase: Client, company_id: str, entry_date: date) -> str:
    """
    Builds the next sequential invoice number for this company, in the
    filing format IN/YYYYMMDD/001 -- the exact date is always shown, but
    the 001/002/... sequence resets each CALENDAR MONTH (not each day), so
    numbers stay in one continuous run across every day of a given month
    and only reset back to 001 on the 1st of the next month.
    Counts by prefix rather than a separate counter table -- consistent
    with the rest of this codebase's non-transactional, "good enough for
    this scale" approach (see known open item #1 in the reference doc);
    since invoices are generated one at a time in a synchronous loop
    (never in parallel), each count reflects everything inserted just
    before it.
    """
    next_seq = count_invoice_numbers(supabase, company_id, entry_date) + 1
    return f"IN/{entry_date.strftime('%Y%m%d')}/{next_seq:03d}"


def generate_invoice_for_lease(
    supabase: Client,
    company_id: str,
    lease: dict,
    invoice_month: date,
    due_date: date,
) -> Optional[dict]:
    """
    Creates ONE invoice for ONE lease/month -- the core logic shared by both
    the monthly batch endpoint below and lease creation (which auto-generates
    the very first invoice immediately at signing). Returns the created
    invoice dict, or None if skipped (already invoiced this month, no active
    charges, or the lease doesn't actually overlap this month at all).

    Proration and journal-posting math live in services/invoicing.py,
    shared with leases.py's charge add/edit/end endpoints (see
    resync_current_month_invoice there) -- so a lease's bill is always
    computed the exact same way, whether it's this month's fresh invoice
    or a running one being patched after a mid-month charge change.
    """
    existing = (
        supabase.table("invoices")
        .select("id")
        .eq("lease_id", lease["id"])
        .eq("invoice_month", str(invoice_month))
        .execute()
    )
    if existing.data:
        return None

    charges = current_charges_with_earliest_start(supabase, lease["id"])
    if not charges:
        return None

    prior_invoices = supabase.table("invoices").select("id").eq("lease_id", lease["id"]).execute().data
    is_first_invoice = len(prior_invoices) == 0

    lease_start = date.fromisoformat(str(lease["start_date"]))
    lease_end = date.fromisoformat(str(lease["end_date"]))
    prorated_charges = compute_prorated_charges(charges, lease_start, lease_end, invoice_month, is_first_invoice)
    if not prorated_charges:
        return None

    total = sum(c["amount"] for c in prorated_charges)
    invoice_number = generate_invoice_number(supabase, company_id, date.today())

    inv = (
        supabase.table("invoices")
        .insert(
            {
                "company_id": company_id,
                "lease_id": lease["id"],
                "invoice_number": invoice_number,
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
            "show_on_invoice": c["show_on_invoice"],
        }
        for c in prorated_charges
    ]
    supabase.table("invoice_line_items").insert(line_items).execute()

    post_invoice_journal(supabase, company_id, inv, lease, prorated_charges, entry_date=invoice_month)

    return inv


@router.post("/generate/plan")
def plan_monthly_invoices(
    payload: GenerateRequest,
    supabase: Client = Depends(get_supabase),
):
    """
    Step 1 of generating a month's invoices: which active leases (optionally
    within one building) still need an invoice. Cheap -- reads only. The
    frontend then sends these ids to /generate/batch in small slices.
    """
    return plan_generation(supabase, payload.month.replace(day=1), payload.building_id)


@router.post("/generate/batch", status_code=201)
def generate_invoice_batch(
    payload: BatchRequest,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    """
    Step 2: generates invoices for one slice of leases. Idempotent (leases
    already invoiced for the month are skipped), time-budgeted (anything not
    reached comes back in `remaining` to be sent again), and one bad lease
    is reported in `failed` instead of failing the rest.
    """
    if len(payload.lease_ids) > 200:
        raise HTTPException(status_code=400, detail="Send at most 200 lease ids per batch.")
    invoice_month = payload.month.replace(day=1)
    due_date = invoice_month + timedelta(days=payload.due_in_days)
    return generate_batch(supabase, company_id, payload.lease_ids, invoice_month, due_date)


@router.post("/generate", status_code=201)
def generate_monthly_invoices(
    payload: GenerateRequest,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    """
    Legacy single-call endpoint, kept so nothing that still calls it breaks.
    It now uses the same fast batch engine, but stops safely before the
    serverless time limit instead of being killed: if the company is too big
    to finish in one call, `remaining` lists the leases not yet done and
    calling it again continues from there. The Invoices page uses
    /generate/plan + /generate/batch instead, which loops automatically.
    """
    invoice_month = payload.month.replace(day=1)
    due_date = invoice_month + timedelta(days=payload.due_in_days)
    plan = plan_generation(supabase, invoice_month, payload.building_id)
    result = generate_batch(supabase, company_id, plan["lease_ids"], invoice_month, due_date)
    return {
        "created": result["created"],
        "skipped_existing_or_no_charges": result["skipped"],
        "already_invoiced_count": plan["already_invoiced"],
        "failed": result["failed"],
        "remaining": result["remaining"],
    }


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


@router.get("/{invoice_id}/receipt-pdf")
def invoice_receipt_pdf(invoice_id: str, supabase: Client = Depends(get_supabase)):
    """
    Printable payment receipt for this invoice -- moved here from the
    Journal page's generic "print/view document" button, which used to be
    the only way to reach a receipt and cluttered every journal line with
    a print icon regardless of source type.

    Mirrors security_deposits.py's /receipt-pdf: available as soon as at
    least one payment has been recorded against this invoice, whether
    that's the full amount or a partial instalment -- there is no
    "fully paid" gate here, same as the deposit receipt.

    A tenant's receipt can cover several invoices at once (the "Receive
    Payment" screen groups them under one receipt_group_id), so this looks
    up the MOST RECENT payment recorded against this specific invoice and
    prints that payment's whole receipt -- the same document the person
    would have gotten when the payment was originally recorded.
    """
    from fastapi.responses import StreamingResponse
    import io

    from app.services.payment_receipt_pdf import fetch_receipt_context, render_receipt_pdf

    payments = (
        supabase.table("payments")
        .select("id, receipt_group_id, created_at")
        .eq("invoice_id", invoice_id)
        .order("created_at", desc=True)
        .execute()
        .data
    )
    if not payments:
        raise HTTPException(status_code=400, detail="No payment has been recorded against this invoice yet.")

    latest = payments[0]
    receipt_id = latest.get("receipt_group_id") or latest["id"]

    ctx = fetch_receipt_context(supabase, receipt_id)
    pdf_bytes = render_receipt_pdf(ctx)

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="receipt_{invoice_id[:8]}.pdf"'},
    )


@router.get("/{invoice_id}/view")
def view_invoice_public(invoice_id: str, service_client=Depends(get_service_client)):
    """
    Public, unauthenticated invoice viewer -- this is what the short link in
    WhatsApp messages points to. Security here comes from the invoice_id
    itself being an unguessable random UUID, the same approach services like
    Stripe use for "view your invoice" links; there is no login step because
    a tenant clicking a link from WhatsApp has no session at all.
    """
    from fastapi.responses import StreamingResponse
    import io

    from app.services.invoice_pdf import fetch_invoice_context, render_invoice_pdf

    ctx = fetch_invoice_context(service_client, invoice_id)
    pdf_bytes = render_invoice_pdf(ctx)

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="invoice_{ctx["invoice"]["invoice_month"]}.pdf"'
        },
    )


@router.post("/{invoice_id}/whatsapp-link")
def get_whatsapp_link(invoice_id: str, supabase: Client = Depends(get_supabase)):
    """
    Returns a wa.me click-to-chat link with a pre-filled message, including a
    short link to view the invoice (the public /view endpoint above) instead
    of a long Supabase signed URL. Opening the link lets the person send it
    themselves via the WhatsApp app or WhatsApp Web -- exactly like
    OneAccounts' existing WhatsApp buttons, just applied to invoices. This
    does NOT send anything automatically; WhatsApp's rules require the human
    to press Send.
    """
    from app.services.invoice_pdf import fetch_invoice_context

    ctx = fetch_invoice_context(supabase, invoice_id)
    invoice, tenant, room, building, company = (
        ctx["invoice"], ctx["tenant"], ctx["room"], ctx["building"], ctx["company"]
    )

    if not tenant.get("phone"):
        raise HTTPException(status_code=400, detail="This tenant has no phone number on file.")

    pdf_url = f"{settings.backend_public_url}/api/invoices/{invoice_id}/view"

    message = (
        f"Hi {tenant.get('full_name') or ''}, your rent invoice "
        f"({invoice.get('invoice_number') or invoice['invoice_month']}) for "
        f"{invoice['invoice_month']} ({building.get('name') or ''} - Room "
        f"{room.get('room_number') or ''}) is Rs {float(invoice['total_amount']):,.0f}, "
        f"due on {invoice['due_date']}.\n\nView/download invoice: {pdf_url}\n\n"
        f"Thank you — {company.get('name') or ''}"
    )

    import urllib.parse

    phone = normalize_to_whatsapp(tenant["phone"])
    whatsapp_url = f"https://wa.me/{phone}?text={urllib.parse.quote(message)}"

    return {"whatsapp_url": whatsapp_url, "phone": phone, "message_preview": message}
