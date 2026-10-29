"""Tenant side of "I have paid": send a payment claim, see its status, cancel it while pending,
and see/download receipts. A claim is only a MESSAGE to the office -- it never touches the books.
Only an owner/admin approving it (see admin_claims_router.py) posts a receipt."""

import io
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.core.deps import get_service_client
from app.services.payment_receipt_pdf import fetch_receipt_context, render_receipt_pdf

from . import service as svc
from .claims_common import CLAIMS, invoice_balances
from .portal_data_router import _chunks
from .portal_router import portal_ready, require_permission

router = APIRouter(prefix="/portal", tags=["Tenant Portal"])

METHODS = ("cash", "bank_transfer")
MAX_PENDING = 10
MAX_INVOICES = 24
MAX_AGE_DAYS = 120


class ClaimBody(BaseModel):
    invoice_ids: list[str]
    amount: float
    payment_method: str
    paid_to: Optional[str] = None
    payment_date: date
    reference: Optional[str] = None
    note: Optional[str] = None


def _clean(value: Optional[str], limit: int) -> Optional[str]:
    v = (value or "").strip()
    return v[:limit] or None


@router.post("/payment-claims", status_code=201)
def create_claim(body: ClaimBody, ctx: dict = Depends(require_permission("submit_payment"))):
    c = get_service_client()
    cid, tid = ctx["company_id"], ctx["tenant_id"]

    ids = list(dict.fromkeys(body.invoice_ids or []))
    if not ids or len(ids) > MAX_INVOICES:
        raise HTTPException(status_code=400, detail="Please choose the invoice(s) you are paying.")
    if body.payment_method not in METHODS:
        raise HTTPException(status_code=400, detail="Please choose Cash or Bank transfer.")
    amount = round(float(body.amount or 0), 2)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Please enter the amount you paid.")
    today = date.today()
    if body.payment_date > today or body.payment_date < today - timedelta(days=MAX_AGE_DAYS):
        raise HTTPException(status_code=400, detail="Please enter the date you actually paid (not in the future, and within the last 4 months).")
    paid_to = _clean(body.paid_to, 80)
    if body.payment_method == "bank_transfer" and (not paid_to or len(paid_to) < 3):
        raise HTTPException(status_code=400, detail="Please enter the bank account number you paid into.")
    reference = _clean(body.reference, 60)
    note = _clean(body.note, 300)

    leases = {l["id"] for l in c.table("leases").select("id").eq("company_id", cid).eq("tenant_id", tid).execute().data}
    invoices, balances = invoice_balances(c, cid, ids)
    if len(invoices) != len(ids) or any(i["lease_id"] not in leases for i in invoices.values()):
        raise HTTPException(status_code=404, detail="One of the invoices wasn't found.")
    if len({i["lease_id"] for i in invoices.values()}) != 1:
        raise HTTPException(status_code=400, detail="Please send a separate payment for each agreement.")
    if any(i["status"] in ("paid", "cancelled") or balances[i["id"]] <= 0.01 for i in invoices.values()):
        raise HTTPException(status_code=400, detail="One of the invoices is already paid.")

    mine = c.table(CLAIMS).select("id, invoice_ids, amount, payment_date, reference, status").eq("company_id", cid).eq("tenant_id", tid).in_("status", ["pending", "processing"]).execute().data
    if len(mine) >= MAX_PENDING:
        raise HTTPException(status_code=429, detail="You have several payments waiting for approval. Please wait for the office to confirm them.")
    if any(set(ids) & set(m.get("invoice_ids") or []) for m in mine):
        raise HTTPException(status_code=409, detail="One of these invoices already has a payment waiting for the office to confirm.")
    if any(abs(float(m["amount"]) - amount) < 0.005 and str(m["payment_date"]) == str(body.payment_date) and (m.get("reference") or None) == reference for m in mine):
        raise HTTPException(status_code=409, detail="You already sent this payment.")

    owed = round(sum(max(balances[i], 0) for i in ids), 2)
    if amount > owed + 0.01:
        raise HTTPException(status_code=400, detail=f"The amount can't be more than what these invoices owe (Rs {owed:,.2f}). To pay in advance, please contact your property office.")

    row = {
        "company_id": cid, "tenant_id": tid, "lease_id": next(iter(invoices.values()))["lease_id"], "invoice_ids": ids,
        "amount": amount, "payment_method": body.payment_method, "paid_to": paid_to,
        "payment_date": str(body.payment_date), "reference": reference, "note": note,
    }
    return {"id": c.table(CLAIMS).insert(row).execute().data[0]["id"]}


@router.get("/payment-claims")
def my_claims(ctx: dict = Depends(portal_ready)):
    c = get_service_client()
    rows = (
        c.table(CLAIMS).select("id, invoice_ids, amount, payment_method, paid_to, payment_date, reference, note, status, reject_reason, approved_amount, receipt_group_id, created_at")
        .eq("company_id", ctx["company_id"]).eq("tenant_id", ctx["tenant_id"]).order("created_at", desc=True).limit(50).execute().data
    )
    months: dict[str, str] = {}
    want = sorted({i for r in rows for i in (r.get("invoice_ids") or [])})
    for chunk in _chunks(want):
        for inv in c.table("invoices").select("id, invoice_month").eq("company_id", ctx["company_id"]).in_("id", chunk).execute().data:
            months[inv["id"]] = inv["invoice_month"]
    for r in rows:
        r["invoice_months"] = [months[i] for i in (r.get("invoice_ids") or []) if i in months]
        r["status"] = "pending" if r["status"] == "processing" else r["status"]  # the tenant never needs to see "processing"
        r.pop("invoice_ids", None)
    return {"claims": rows}


@router.post("/payment-claims/{claim_id}/cancel")
def cancel_claim(claim_id: str, ctx: dict = Depends(require_permission("submit_payment"))):
    res = (
        get_service_client().table(CLAIMS).update({"status": "cancelled", "updated_at": svc.now_iso()})
        .eq("company_id", ctx["company_id"]).eq("tenant_id", ctx["tenant_id"]).eq("id", claim_id).eq("status", "pending").execute().data
    )
    if not res:
        raise HTTPException(status_code=409, detail="This payment can't be cancelled any more (the office may already be handling it).")
    return {"ok": True}


# ---------------------------------------------------------------- receipts
@router.get("/receipts")
def my_receipts(ctx: dict = Depends(require_permission("download_receipts"))):
    c = get_service_client()
    cid, tid = ctx["company_id"], ctx["tenant_id"]
    rows = (
        c.table("payments").select("id, receipt_group_id, payment_date, amount, payment_method, invoice_id")
        .eq("company_id", cid).eq("tenant_id", tid).order("payment_date", desc=True).limit(600).execute().data
    )
    groups: dict[str, dict] = {}
    for r in rows:
        key = r.get("receipt_group_id") or r["id"]
        g = groups.setdefault(key, {"receipt_id": key, "date": r["payment_date"], "amount": 0.0, "method": r["payment_method"], "invoice_ids": []})
        g["amount"] = round(g["amount"] + float(r["amount"]), 2)
        if r.get("invoice_id"):
            g["invoice_ids"].append(r["invoice_id"])
    out = [g for g in groups.values() if g["amount"] > 0][:60]
    months: dict[str, str] = {}
    for chunk in _chunks(sorted({i for g in out for i in g["invoice_ids"]})):
        for inv in c.table("invoices").select("id, invoice_month").eq("company_id", cid).in_("id", chunk).execute().data:
            months[inv["id"]] = inv["invoice_month"]
    for g in out:
        g["invoice_months"] = sorted({months[i] for i in g.pop("invoice_ids") if i in months})
    return {"receipts": out}


@router.get("/receipts/{receipt_id}/pdf")
def my_receipt_pdf(receipt_id: str, ctx: dict = Depends(require_permission("download_receipts"))):
    c = get_service_client()
    cid, tid = ctx["company_id"], ctx["tenant_id"]
    mine = c.table("payments").select("id").eq("company_id", cid).eq("tenant_id", tid).eq("receipt_group_id", receipt_id).limit(1).execute().data
    if not mine:
        mine = c.table("payments").select("id").eq("company_id", cid).eq("tenant_id", tid).eq("id", receipt_id).limit(1).execute().data
    if not mine:
        raise HTTPException(status_code=404, detail="Receipt not found.")
    try:
        pdf = render_receipt_pdf(fetch_receipt_context(c, receipt_id))
    except Exception:  # noqa: BLE001 -- never show a stack trace to a tenant
        raise HTTPException(status_code=500, detail="Couldn't prepare this receipt right now. Please try again later.")
    return StreamingResponse(io.BytesIO(pdf), media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="receipt_{receipt_id[:8]}.pdf"'})
