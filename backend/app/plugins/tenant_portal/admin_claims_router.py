"""Owner/admin side of payment claims: see them, approve (posts a normal receipt) or reject.

Approving does NOT use its own accounting code. It calls the very same record_receipt() that the
"Receive payment" screen uses, as the approving staff member, so the receipt, journal entry,
invoice statuses and income-by-head split are exactly what you would get entering it by hand."""

import logging
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from supabase import Client

from app.core.deps import get_current_user, get_service_client, get_supabase
from app.crud.generic import write_audit_log

from . import service as svc
from .admin_router import portal_admin
from .claims_common import CLAIMS, invoice_balances, is_stale, marker

logger = logging.getLogger("app.tenant_portal")
router = APIRouter(prefix="/tenant-portal", tags=["Tenant Portal (admin)"])


@router.get("/payment-claims")
def list_claims(status: str = "pending", company_id: str = Depends(portal_admin)):
    c = get_service_client()
    q = c.table(CLAIMS).select("*").eq("company_id", company_id).order("created_at", desc=True).limit(200)
    if status == "pending":
        q = q.in_("status", ["pending", "processing"])
    elif status != "all":
        q = q.eq("status", status)
    rows = q.execute().data
    tenant_ids = sorted({r["tenant_id"] for r in rows})
    tenants = {t["id"]: t["full_name"] for t in (c.table("tenants").select("id, full_name").eq("company_id", company_id).in_("id", tenant_ids).execute().data if tenant_ids else [])}
    all_ids = sorted({i for r in rows for i in (r.get("invoice_ids") or [])})
    invoices, balances = invoice_balances(c, company_id, all_ids)
    for r in rows:
        r["tenant_name"] = tenants.get(r["tenant_id"])
        r["invoices"] = [
            {"id": i, "invoice_month": invoices[i]["invoice_month"], "total": float(invoices[i]["total_amount"]), "balance_now": max(balances[i], 0.0)}
            for i in (r.get("invoice_ids") or []) if i in invoices
        ]
    accounts = c.table("chart_of_accounts").select("id, code, name").eq("company_id", company_id).eq("is_cash_or_bank", True).order("code").execute().data
    return {"claims": rows, "accounts": accounts}


class ApproveBody(BaseModel):
    account_id: str
    amount: Optional[float] = None
    receipt_date: Optional[date] = None
    notes: Optional[str] = None


def _revert(c, company_id: str, claim_id: str) -> None:
    c.table(CLAIMS).update({"status": "pending", "updated_at": svc.now_iso()}).eq("company_id", company_id).eq("id", claim_id).eq("status", "processing").execute()


def _recover_stale(c, company_id: str, claim: dict) -> dict:
    """A claim stuck in 'processing' means a previous approval was cut off. If its receipt was already
    posted (found by the marker in the payment notes) finish the bookkeeping instead of posting twice;
    otherwise put it back to pending so it can be approved again."""
    found = c.table("payments").select("receipt_group_id, amount").eq("company_id", company_id).ilike("notes", f"%{marker(claim['id'])}%").execute().data
    if found:
        fix = {"status": "approved", "receipt_group_id": found[0].get("receipt_group_id"), "approved_amount": round(sum(float(p["amount"]) for p in found), 2), "reviewed_at": svc.now_iso(), "updated_at": svc.now_iso()}
        c.table(CLAIMS).update(fix).eq("company_id", company_id).eq("id", claim["id"]).execute()
        raise HTTPException(status_code=409, detail="This payment had already been posted. It is now marked approved.")
    _revert(c, company_id, claim["id"])
    return {**claim, "status": "pending"}


@router.post("/payment-claims/{claim_id}/approve")
def approve_claim(
    claim_id: str,
    body: ApproveBody,
    company_id: str = Depends(portal_admin),
    supabase: Client = Depends(get_supabase),
    user: dict = Depends(get_current_user),
):
    # imported here so this plug-in module loads even before payments is imported elsewhere
    from app.routers.payments import ReceiptRequest, record_receipt

    c = get_service_client()
    rows = c.table(CLAIMS).select("*").eq("company_id", company_id).eq("id", claim_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Payment not found.")
    claim = rows[0]
    if claim["status"] == "processing":
        if not is_stale(claim.get("updated_at")):
            raise HTTPException(status_code=409, detail="This payment is being processed right now. Please wait a moment.")
        claim = _recover_stale(c, company_id, claim)
    if claim["status"] != "pending":
        raise HTTPException(status_code=409, detail=f"This payment was already {claim['status']}.")

    # Lock it: only one approval can ever take the claim from pending to processing.
    locked = c.table(CLAIMS).update({"status": "processing", "updated_at": svc.now_iso()}).eq("company_id", company_id).eq("id", claim_id).eq("status", "pending").execute().data
    if not locked:
        raise HTTPException(status_code=409, detail="This payment was just handled by someone else.")

    try:
        acct = c.table("chart_of_accounts").select("id, is_cash_or_bank").eq("company_id", company_id).eq("id", body.account_id).execute().data
        if not acct or not acct[0].get("is_cash_or_bank"):
            raise HTTPException(status_code=400, detail="Please choose the Bank or Cash account the money was received in.")

        invoices, balances = invoice_balances(c, company_id, claim.get("invoice_ids") or [])
        open_ids = [i for i, inv in invoices.items() if inv["status"] != "cancelled" and balances[i] > 0.01 and inv["lease_id"] == claim["lease_id"]]
        owed = round(sum(balances[i] for i in open_ids), 2)
        amount = round(float(body.amount if body.amount is not None else claim["amount"]), 2)
        if amount <= 0:
            raise HTTPException(status_code=400, detail="Enter the amount actually received.")
        if not open_ids or amount > owed + 0.01:
            raise HTTPException(status_code=400, detail=f"These invoices now only owe Rs {owed:,.2f} (some may have been paid since). Lower the amount, or reject this claim. Nothing was posted.")

        detail = [f"Tenant portal claim [{marker(claim_id)}]"]
        if claim.get("reference"):
            detail.append(f"Ref {claim['reference']}")
        if claim.get("paid_to"):
            detail.append(f"Paid to {claim['paid_to']}")
        if (body.notes or "").strip():
            detail.append(body.notes.strip()[:200])
        receipt = record_receipt(
            payload=ReceiptRequest(
                lease_id=claim["lease_id"], account_id=body.account_id, receipt_date=body.receipt_date or date.fromisoformat(str(claim["payment_date"])),
                payment_method=claim["payment_method"], amount_received=amount, invoice_ids=open_ids, notes=" · ".join(detail),
            ),
            supabase=supabase, user=user, company_id=company_id,
        )
    except HTTPException:
        _revert(c, company_id, claim_id)
        raise
    except Exception:
        logger.exception("Approving portal claim %s failed", claim_id)
        _revert(c, company_id, claim_id)
        raise HTTPException(status_code=500, detail="Couldn't post this payment. Nothing was saved. Please try again.")

    c.table(CLAIMS).update({
        "status": "approved", "approved_amount": amount, "approved_account_id": body.account_id, "receipt_group_id": receipt["receipt_group_id"],
        "reviewed_by": user["user_id"], "reviewed_at": svc.now_iso(), "updated_at": svc.now_iso(),
    }).eq("company_id", company_id).eq("id", claim_id).execute()
    write_audit_log(supabase, company_id, user["user_id"], "portal_claim_approved", CLAIMS, claim_id)
    return {"status": "approved", "receipt_group_id": receipt["receipt_group_id"], "advance_amount": receipt.get("advance_amount", 0)}


class RejectBody(BaseModel):
    reason: str


@router.post("/payment-claims/{claim_id}/reject")
def reject_claim(
    claim_id: str,
    body: RejectBody,
    company_id: str = Depends(portal_admin),
    supabase: Client = Depends(get_supabase),
    user: dict = Depends(get_current_user),
):
    reason = (body.reason or "").strip()
    if len(reason) < 3:
        raise HTTPException(status_code=400, detail="Please give the tenant a short reason.")
    res = (
        get_service_client().table(CLAIMS)
        .update({"status": "rejected", "reject_reason": reason[:300], "reviewed_by": user["user_id"], "reviewed_at": svc.now_iso(), "updated_at": svc.now_iso()})
        .eq("company_id", company_id).eq("id", claim_id).eq("status", "pending").execute().data
    )
    if not res:
        raise HTTPException(status_code=409, detail="This payment was already handled (or no longer exists).")
    write_audit_log(supabase, company_id, user["user_id"], "portal_claim_rejected", CLAIMS, claim_id)
    return {"status": "rejected"}
