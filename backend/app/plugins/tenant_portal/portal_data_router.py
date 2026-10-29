"""What a tenant can SEE and ASK for: their invoices, their ledger, change requests.

Everything is read-only apart from a change request (a message to the office -- it never
touches an invoice or the books). Every query is scoped to the company_id and tenant_id
inside the verified portal token, never to anything sent by the browser.

The tenant ledger is produced by the database function portal_tenant_ledger(), a copy of the
admin general_ledger() with the company passed in explicitly (that function reads the logged-in
STAFF user, which a tenant is not). Same maths, same ordering, same opening-balance rule."""

import io
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.core.deps import get_service_client
from app.services.invoice_pdf import fetch_invoice_context, render_invoice_pdf
from app.services.ledger import get_account_id

from . import service as svc
from .portal_router import portal_ready, require_permission

router = APIRouter(prefix="/portal", tags=["Tenant Portal"])

REQUESTS = "tenant_portal_requests"
FAR_FUTURE = "2100-01-01"
MAX_OPEN_REQUESTS = 20


def _chunks(items: list, n: int = 150):
    for i in range(0, len(items), n):
        yield items[i:i + n]


def invoice_status(db_status: str, due_date: Optional[str], today: date) -> str:
    """Tenant-facing status. 'paid' and 'partial' come from the system exactly as staff see them;
    unpaid invoices are Due or Overdue depending on the due date."""
    if db_status == "paid":
        return "paid"
    if db_status == "partial":
        return "partial"
    try:
        if due_date and date.fromisoformat(str(due_date)[:10]) < today:
            return "overdue"
    except ValueError:
        pass
    return "due"


def _owned_invoice(c, ctx: dict, invoice_id: str) -> dict:
    """The invoice, but only if it belongs to this tenant (through one of their leases)."""
    rows = c.table("invoices").select("id, lease_id, total_amount, status").eq("id", invoice_id).eq("company_id", ctx["company_id"]).execute().data
    if rows:
        lease = c.table("leases").select("id").eq("id", rows[0]["lease_id"]).eq("company_id", ctx["company_id"]).eq("tenant_id", ctx["tenant_id"]).execute().data
        if lease:
            return rows[0]
    raise HTTPException(status_code=404, detail="Invoice not found.")


def _tenant_invoices(c, ctx: dict, limit: int, offset: int) -> list[dict]:
    cid, tid = ctx["company_id"], ctx["tenant_id"]
    leases = c.table("leases").select("id, room_id").eq("company_id", cid).eq("tenant_id", tid).execute().data
    if not leases:
        return []
    room_of_lease = {l["id"]: l["room_id"] for l in leases}
    found: list[dict] = []
    for chunk in _chunks(list(room_of_lease)):
        found += (
            c.table("invoices").select("id, lease_id, invoice_month, due_date, total_amount, status")
            .eq("company_id", cid).in_("lease_id", chunk).neq("status", "cancelled").execute().data
        )
    found.sort(key=lambda r: (r["invoice_month"], r["id"]), reverse=True)
    page = found[offset:offset + limit]
    if not page:
        return []
    ids = [r["id"] for r in page]

    items: dict[str, list] = {}
    paid: dict[str, float] = {}
    requests: dict[str, dict] = {}
    for chunk in _chunks(ids):
        for it in c.table("invoice_line_items").select("invoice_id, label, amount").eq("company_id", cid).in_("invoice_id", chunk).execute().data:
            items.setdefault(it["invoice_id"], []).append({"label": it["label"], "amount": float(it["amount"])})
        for p in c.table("payments").select("invoice_id, amount").eq("company_id", cid).eq("tenant_id", tid).in_("invoice_id", chunk).execute().data:
            paid[p["invoice_id"]] = paid.get(p["invoice_id"], 0.0) + float(p["amount"])
        for rq in (
            c.table(REQUESTS).select("invoice_id, status, message, admin_reply, created_at")
            .eq("company_id", cid).eq("tenant_id", tid).eq("kind", "invoice_change").in_("invoice_id", chunk)
            .order("created_at", desc=True).execute().data
        ):
            requests.setdefault(rq["invoice_id"], rq)  # newest first -> keeps the latest

    room_ids = sorted({room_of_lease[r["lease_id"]] for r in page if room_of_lease.get(r["lease_id"])})
    rooms: dict[str, dict] = {}
    for chunk in _chunks(room_ids):
        for rm in c.table("rooms").select("id, room_number, building:buildings(name)").eq("company_id", cid).in_("id", chunk).execute().data:
            rooms[rm["id"]] = {"number": rm["room_number"], "building": (rm.get("building") or {}).get("name")}

    today = date.today()
    out = []
    for r in page:
        total = float(r["total_amount"])
        paid_amt = round(paid.get(r["id"], 0.0), 2)
        status = invoice_status(r["status"], r.get("due_date"), today)
        balance = 0.0 if status == "paid" else max(round(total - paid_amt, 2), 0.0)
        rq = requests.get(r["id"])
        out.append({
            "id": r["id"], "invoice_month": r["invoice_month"], "due_date": r.get("due_date"),
            "total": total, "paid": paid_amt, "balance": balance, "status": status,
            "items": items.get(r["id"], []),
            "room": rooms.get(room_of_lease.get(r["lease_id"]) or "", None),
            "request": ({"status": rq["status"], "message": rq["message"], "reply": rq.get("admin_reply"), "created_at": rq["created_at"]} if rq else None),
            "can_request_change": status != "paid" and not (rq and rq["status"] == "open"),
        })
    return out


@router.get("/invoices")
def my_invoices(
    limit: int = Query(24, ge=1, le=120),
    offset: int = Query(0, ge=0),
    ctx: dict = Depends(require_permission("view_invoices")),
):
    return {"invoices": _tenant_invoices(get_service_client(), ctx, limit, offset)}


@router.get("/invoices/{invoice_id}/pdf")
def my_invoice_pdf(invoice_id: str, ctx: dict = Depends(require_permission("view_invoices"))):
    c = get_service_client()
    _owned_invoice(c, ctx, invoice_id)
    try:
        pdf = render_invoice_pdf(fetch_invoice_context(c, invoice_id))
    except Exception:  # noqa: BLE001 -- never show a stack trace to a tenant
        raise HTTPException(status_code=500, detail="Couldn't prepare this invoice right now. Please try again later.")
    return StreamingResponse(io.BytesIO(pdf), media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="invoice_{invoice_id[:8]}.pdf"'})


class ChangeRequestBody(BaseModel):
    message: str


@router.post("/invoices/{invoice_id}/change-request", status_code=201)
def request_invoice_change(invoice_id: str, body: ChangeRequestBody, ctx: dict = Depends(require_permission("request_invoice_change"))):
    c = get_service_client()
    cid, tid = ctx["company_id"], ctx["tenant_id"]
    inv = _owned_invoice(c, ctx, invoice_id)
    if inv["status"] == "paid":
        raise HTTPException(status_code=400, detail="This invoice is already paid, so it can't be changed.")
    msg = (body.message or "").strip()
    if len(msg) < 3 or len(msg) > 500:
        raise HTTPException(status_code=400, detail="Please write a short note (3 to 500 characters) saying what should change.")
    open_rows = c.table(REQUESTS).select("id, invoice_id").eq("company_id", cid).eq("tenant_id", tid).eq("status", "open").execute().data
    if any(r.get("invoice_id") == invoice_id for r in open_rows):
        raise HTTPException(status_code=409, detail="You already have an open request for this invoice. The office will reply soon.")
    if len(open_rows) >= MAX_OPEN_REQUESTS:
        raise HTTPException(status_code=429, detail="You have many open requests. Please wait for the office to reply.")
    c.table(REQUESTS).insert({"company_id": cid, "tenant_id": tid, "kind": "invoice_change", "invoice_id": invoice_id, "message": msg}).execute()
    return {"ok": True}


def tenant_ledger(c, company_id: str, tenant_id: str, date_from: Optional[date], date_to: Optional[date]) -> dict:
    """Rows + closing balance, built the same way the admin ledger (financials.get_general_ledger) builds them."""
    try:
        ar_id = get_account_id(c, company_id, "1100")
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=503, detail="Your statement isn't available yet. Please contact your property office.")
    rows = c.rpc("portal_tenant_ledger", {
        "p_company_id": company_id, "p_tenant_id": tenant_id, "p_account_id": ar_id,
        "p_date_from": str(date_from) if date_from else None, "p_date_to": str(date_to) if date_to else None,
    }).execute().data or []
    opening = 0.0
    if date_from:
        opening = float(c.rpc("portal_tenant_ledger_opening", {
            "p_company_id": company_id, "p_tenant_id": tenant_id, "p_account_id": ar_id, "p_before": str(date_from),
        }).execute().data or 0)
    out = []
    if abs(opening) > 0.004:
        out.append({"date": str(date_from - timedelta(days=1)), "description": "Opening balance", "debit": 0.0, "credit": 0.0, "balance": round(opening, 2), "is_opening": True})
    for r in rows:
        amount = float(r["amount"])
        out.append({
            "date": r["entry_date"], "description": r.get("description"),
            "debit": amount if r["direction"] == "debit" else 0.0, "credit": amount if r["direction"] == "credit" else 0.0,
            "balance": round(float(r["running_balance"]) + (opening if abs(opening) > 0.004 else 0.0), 2), "is_opening": False,
        })
    closing = out[-1]["balance"] if out else 0.0
    return {"rows": out, "closing_balance": closing}


@router.get("/ledger")
def my_ledger(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    ctx: dict = Depends(require_permission("view_ledger")),
):
    return tenant_ledger(get_service_client(), ctx["company_id"], ctx["tenant_id"], date_from, date_to)


@router.get("/summary")
def my_summary(ctx: dict = Depends(portal_ready)):
    c = get_service_client()
    perms = ctx["permissions"]
    out: dict = {"balance": None, "unpaid_count": None, "overdue_count": None, "next_due": None}
    if perms.get("view_ledger"):
        try:
            ar_id = get_account_id(c, ctx["company_id"], "1100")
            out["balance"] = round(float(c.rpc("portal_tenant_ledger_opening", {
                "p_company_id": ctx["company_id"], "p_tenant_id": ctx["tenant_id"], "p_account_id": ar_id, "p_before": FAR_FUTURE,
            }).execute().data or 0), 2)
        except Exception:  # noqa: BLE001 -- the page still works without the headline figure
            out["balance"] = None
    if perms.get("view_invoices"):
        unpaid = [i for i in _tenant_invoices(c, ctx, 200, 0) if i["status"] != "paid"]
        out["unpaid_count"] = len(unpaid)
        out["overdue_count"] = sum(1 for i in unpaid if i["status"] == "overdue")
        dated = sorted((i for i in unpaid if i.get("due_date")), key=lambda i: i["due_date"])
        if dated:
            out["next_due"] = {"due_date": dated[0]["due_date"], "balance": dated[0]["balance"]}
    return out


@router.get("/requests")
def my_requests(ctx: dict = Depends(portal_ready)):
    c = get_service_client()
    rows = (
        c.table(REQUESTS).select("id, kind, invoice_id, message, status, admin_reply, created_at, resolved_at")
        .eq("company_id", ctx["company_id"]).eq("tenant_id", ctx["tenant_id"]).order("created_at", desc=True).limit(50).execute().data
    )
    return {"requests": rows}
