from datetime import date, timedelta
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from supabase import Client

from app.core.deps import get_current_company_id, get_supabase
from app.services.ledger import get_account_id, get_tenant_account_balance_as_of

router = APIRouter(prefix="/reports", tags=["Reports"])


@router.get("/pnl")
def monthly_pnl(
    month: Optional[date] = Query(None, description="Any date within the target month"),
    supabase: Client = Depends(get_supabase),
):
    """
    Monthly profit & loss: income (payments received) minus expenses minus
    staff salaries. Backed by the v_monthly_pnl view (see schema.sql).
    """
    query = supabase.table("v_monthly_pnl").select("*")
    if month:
        target_month = month.replace(day=1)
        query = query.eq("month", str(target_month))
    data = query.execute().data

    for row in data:
        row["total_income"] = float(row["total_income"])
        row["total_expenses"] = float(row["total_expenses"])
        row["total_salaries"] = float(row["total_salaries"])
        row["net_profit"] = row["total_income"] - row["total_expenses"] - row["total_salaries"]
    return data


@router.get("/collection-vs-expense")
def collection_vs_expense(
    building_id: Optional[str] = None,
    month: Optional[date] = None,
    supabase: Client = Depends(get_supabase),
):
    """
    Compares what was billed to tenants (e.g. 'Water Bill' line items) against
    actual expenses logged in the matching category, per building/month.
    Backed by v_collection_vs_expense view (see schema.sql).
    """
    query = supabase.table("v_collection_vs_expense").select("*")
    if building_id:
        query = query.eq("building_id", building_id)
    if month:
        query = query.eq("month", str(month.replace(day=1)))
    billed = query.execute().data

    exp_query = supabase.table("expenses").select(
        "amount, building_id, expense_date, expense_categories(name)"
    )
    if building_id:
        exp_query = exp_query.eq("building_id", building_id)
    actual_expenses = exp_query.execute().data

    return {"billed_to_tenants": billed, "actual_expenses_logged": actual_expenses}


@router.get("/room-wise")
def room_wise_receivables(
    period_start: date = Query(
        ...,
        description="Start of the selected period (inclusive). Everything before this date rolls up into 'opening balance'.",
    ),
    period_end: date = Query(..., description="End of the selected period (inclusive)."),
    building_id: Optional[str] = Query(None, description="Optional -- limit to one building."),
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    """
    Per-room receivables report:
      Room | Tenant | Security (received/not) | Opening balance |
      Invoiced (period) | Received (period) | Receivable total

    Opening balance and Receivable total both come straight from the ledger
    (get_tenant_account_balance_as_of against Accounts Receivable, account
    1100) for the room's CURRENT tenant -- the exact same source the
    invoice PDF's "Opening balance" line and the Receive Payment screen's
    running balance already use (see leases.py's /receivable-summary).
    That means this report always reconciles with those instead of
    drifting from a second, independently-computed total: opening balance
    is the AR balance as of the day before period_start, and receivable
    total is the AR balance as of period_end.

    Invoiced/Received (period) are read directly off invoices/payments for
    the current tenant's lease(s) on this room -- a diagnostic breakdown of
    what moved during the period, not the source of truth for the totals
    above (a discount or a manual journal adjustment can move the ledger
    balance without appearing in either column, by design).

    "Tenant" and "Security received" reflect the room's CURRENT tenant
    (active lease, or the most recently started one if vacant) -- a room
    that has changed hands shows today's occupant, not its full history.
    Any balance still owed by a PREVIOUS tenant stays with that tenant, not
    the room, matching how /leases/{id}/receivable-summary already treats
    it (flagged there as a known simplification).

    Performance note: this calls the ledger twice per occupied room (RPC
    round trips), same cost per-lease as the Receive Payment screen already
    pays per-lease -- fine at normal portfolio sizes, but worth batching
    into one SQL function later if this is ever run against hundreds of
    rooms at once.
    """
    rooms_query = supabase.table("rooms").select("id, room_number, building_id, status")
    if building_id:
        rooms_query = rooms_query.eq("building_id", building_id)
    rooms = rooms_query.execute().data
    if not rooms:
        return []

    room_ids = [r["id"] for r in rooms]
    buildings = {b["id"]: b["name"] for b in supabase.table("buildings").select("id, name").execute().data}

    leases = (
        supabase.table("leases")
        .select("id, room_id, tenant_id, status, start_date")
        .in_("room_id", room_ids)
        .execute()
        .data
    )
    leases_by_room: Dict[str, List[dict]] = {}
    for l in leases:
        leases_by_room.setdefault(l["room_id"], []).append(l)

    tenant_ids = list({l["tenant_id"] for l in leases})
    tenants = (
        {
            t["id"]: t["full_name"]
            for t in supabase.table("tenants").select("id, full_name").in_("id", tenant_ids).execute().data
        }
        if tenant_ids
        else {}
    )

    lease_ids = [l["id"] for l in leases]
    invoices = (
        supabase.table("invoices")
        .select("id, lease_id, invoice_month, due_date, total_amount, status")
        .in_("lease_id", lease_ids)
        .neq("status", "cancelled")
        .execute()
        .data
        if lease_ids
        else []
    )
    invoices_by_lease: Dict[str, List[dict]] = {}
    for i in invoices:
        invoices_by_lease.setdefault(i["lease_id"], []).append(i)
    invoice_ids = [i["id"] for i in invoices]

    payments = (
        supabase.table("payments")
        .select("id, invoice_id, amount, discount_amount, payment_date, payment_method")
        .in_("invoice_id", invoice_ids)
        .execute()
        .data
        if invoice_ids
        else []
    )
    payments_by_invoice: Dict[str, List[dict]] = {}
    for p in payments:
        if p.get("invoice_id"):
            payments_by_invoice.setdefault(p["invoice_id"], []).append(p)

    # Security deposits: "received" = at least one installment has actually
    # been paid (amount_received on the deposit row is the AGREED amount,
    # not what's been collected -- see security_deposit_payments).
    security_deposits = (
        supabase.table("security_deposits").select("id, lease_id").in_("lease_id", lease_ids).execute().data
        if lease_ids
        else []
    )
    deposit_by_lease = {d["lease_id"]: d["id"] for d in security_deposits}
    deposit_ids = list(deposit_by_lease.values())
    deposit_payments = (
        supabase.table("security_deposit_payments")
        .select("security_deposit_id, amount")
        .in_("security_deposit_id", deposit_ids)
        .execute()
        .data
        if deposit_ids
        else []
    )
    paid_by_deposit: Dict[str, float] = {}
    for dp in deposit_payments:
        paid_by_deposit[dp["security_deposit_id"]] = paid_by_deposit.get(
            dp["security_deposit_id"], 0.0
        ) + float(dp["amount"])

    try:
        ar_account_id = get_account_id(supabase, company_id, "1100")
    except ValueError:
        ar_account_id = None  # chart of accounts isn't fully set up for this company yet

    balance_before = period_start - timedelta(days=1)

    rows = []
    for room in rooms:
        room_leases = leases_by_room.get(room["id"], [])
        active_lease = next((l for l in room_leases if l["status"] == "active"), None)
        current_lease = active_lease or (
            sorted(room_leases, key=lambda l: l["start_date"], reverse=True)[0] if room_leases else None
        )

        tenant_name = tenants.get(current_lease["tenant_id"]) if current_lease else None

        deposit_id = deposit_by_lease.get(current_lease["id"]) if current_lease else None
        security_received = bool(deposit_id) and paid_by_deposit.get(deposit_id, 0.0) > 0

        opening_balance = 0.0
        receivable_total = 0.0
        if current_lease and ar_account_id:
            opening_balance = round(
                get_tenant_account_balance_as_of(
                    supabase, company_id, ar_account_id, current_lease["tenant_id"], str(balance_before)
                ),
                2,
            )
            receivable_total = round(
                get_tenant_account_balance_as_of(
                    supabase, company_id, ar_account_id, current_lease["tenant_id"], str(period_end)
                ),
                2,
            )

        period_invoiced = 0.0
        period_received = 0.0
        if current_lease:
            for inv in invoices_by_lease.get(current_lease["id"], []):
                inv_month = date.fromisoformat(str(inv["invoice_month"]))
                if period_start <= inv_month <= period_end:
                    period_invoiced += float(inv["total_amount"])
                for pay in payments_by_invoice.get(inv["id"], []):
                    pay_date = date.fromisoformat(str(pay["payment_date"]))
                    if period_start <= pay_date <= period_end:
                        period_received += float(pay["amount"]) + float(pay.get("discount_amount") or 0)

        # "Current invoice" for the drill-down (report row -> current
        # invoice + its payments -> full invoice detail): the most recently
        # dated invoice for this lease, independent of the report's own
        # period filter, so the drill-down always reflects the latest bill
        # even when looking at an older period.
        current_invoice = None
        if current_lease:
            lease_invoices = invoices_by_lease.get(current_lease["id"], [])
            if lease_invoices:
                current_invoice = sorted(
                    lease_invoices, key=lambda i: str(i["invoice_month"]), reverse=True
                )[0]

        current_invoice_payments: List[dict] = []
        current_invoice_received = 0.0
        if current_invoice:
            for pay in payments_by_invoice.get(current_invoice["id"], []):
                current_invoice_payments.append(
                    {
                        "id": pay["id"],
                        "amount": float(pay["amount"]),
                        "discount_amount": float(pay.get("discount_amount") or 0),
                        "payment_date": str(pay["payment_date"]),
                        "payment_method": pay.get("payment_method"),
                    }
                )
                current_invoice_received += float(pay["amount"]) + float(pay.get("discount_amount") or 0)

        rows.append(
            {
                "room_id": room["id"],
                "room_number": room["room_number"],
                "building_id": room["building_id"],
                "building_name": buildings.get(room["building_id"], "—"),
                "tenant_name": tenant_name,
                "security_received": security_received,
                "opening_balance": opening_balance,
                "invoiced_period": round(period_invoiced, 2),
                "received_period": round(period_received, 2),
                "receivable_total": receivable_total,
                "current_lease_id": current_lease["id"] if current_lease else None,
                "current_invoice_id": current_invoice["id"] if current_invoice else None,
                "current_invoice_month": str(current_invoice["invoice_month"]) if current_invoice else None,
                "current_invoice_due_date": str(current_invoice["due_date"]) if current_invoice else None,
                "current_invoice_status": current_invoice["status"] if current_invoice else None,
                "current_invoice_total": round(float(current_invoice["total_amount"]), 2)
                if current_invoice
                else None,
                "current_invoice_received": round(current_invoice_received, 2) if current_invoice else None,
                "current_invoice_payments": current_invoice_payments,
            }
        )

    rows.sort(key=lambda r: (r["building_name"], r["room_number"]))
    return rows
