from datetime import date, timedelta
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from supabase import Client

from app.core.deps import get_current_company_id, get_current_user, get_supabase, require_owner_or_admin
from app.services.income_allocation import allocate_payment_to_line_items
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


# ============================================================================
# Receipts by Head -- how much cash/bank was actually RECEIVED against each
# income head (Rent, Parking, Internet, a one-time Commission, etc.) that
# appears on tenants' invoices. Backed by payment_allocations (see
# app/services/income_allocation.py and 012_schema_patch_028), which is
# written automatically every time a payment/receipt is recorded against an
# invoice -- this report and its drill-down are just a read over that data,
# so a rupee here is always traceable back to one specific bank/cash receipt.
# ============================================================================

# Known default heads shown in a sensible, familiar order first; any other
# (custom) label a company has used is appended after these, alphabetically.
_HEAD_PRIORITY = [
    "Rent", "Electricity", "Water", "Gas", "Parking", "Internet",
    "Service", "Commission", "Other",
]


def _label_sort_key(label: str):
    try:
        return (0, _HEAD_PRIORITY.index(label))
    except ValueError:
        return (1, label.lower())


def _resolve_cash_bank_account_ids_for_sources(supabase: Client, source_ids: List[str]) -> Dict[str, str]:
    """
    For historical payments recorded before payments.account_id existed
    (i.e. it's null on the row), reads the actual bank/cash account off the
    journal entry that posted the receipt/payment instead -- the debit line
    whose account is flagged is_cash_or_bank. source_ids are each payment's
    receipt_group_id (if it has one) or its own id otherwise, matching
    post_journal_entry's source_id for 'receipt' and 'payment' entries.
    Returns {source_id: account_id} -- only for sources it could resolve.
    """
    source_ids = [s for s in set(source_ids) if s]
    if not source_ids:
        return {}
    entries = (
        supabase.table("journal_entries")
        .select("id, source_id")
        .in_("source_type", ["receipt", "payment"])
        .in_("source_id", source_ids)
        .execute()
        .data
    )
    if not entries:
        return {}
    entry_source_by_id = {e["id"]: e["source_id"] for e in entries}
    entry_ids = list(entry_source_by_id.keys())

    lines = (
        supabase.table("journal_lines")
        .select("journal_entry_id, account_id, direction")
        .in_("journal_entry_id", entry_ids)
        .eq("direction", "debit")
        .execute()
        .data
    )
    account_ids = list({l["account_id"] for l in lines})
    if not account_ids:
        return {}
    cash_accounts = {
        a["id"]
        for a in supabase.table("chart_of_accounts")
        .select("id")
        .in_("id", account_ids)
        .eq("is_cash_or_bank", True)
        .execute()
        .data
    }

    result: Dict[str, str] = {}
    for l in lines:
        source_id = entry_source_by_id.get(l["journal_entry_id"])
        if source_id and source_id not in result and l["account_id"] in cash_accounts:
            result[source_id] = l["account_id"]
    return result


@router.get("/income-by-head")
def income_by_head(
    date_from: date = Query(..., description="Receipts on/after this date (payment_date)"),
    date_to: date = Query(..., description="Receipts on/before this date (payment_date)"),
    building_id: Optional[str] = Query(None, description="Optional -- limit to one building"),
    supabase: Client = Depends(get_supabase),
):
    """
    Sr | Tenant | Room/Apartment | <one column per income head> | Total --
    exactly the receipt amount actually collected against each head, for
    every invoice-tied payment dated within the period. Discounts are
    deliberately excluded (a discount isn't a receipt); advances/opening-
    balance payments (not tied to any invoice) are excluded too, since they
    have no head to attribute to yet.

    Every row/column figure here is a straight sum of payment_allocations
    rows -- literally the same rows the drill-down endpoint below lists one
    by one -- so this report is 100% reconcilable against the underlying
    bank/cash receipts by construction, not by a separate cross-check.
    `reconciliation` is included anyway as a live self-check: if it ever
    shows a gap, it means some historical payments haven't been allocated
    yet -- run POST /income-by-head/backfill (owner/admin) to close it.
    """
    allocations = (
        supabase.table("payment_allocations")
        .select("amount, label, lease_id, tenant_id, payment_id, payments(payment_date)")
        .eq("allocation_type", "cash")
        .execute()
        .data
    )
    allocations = [
        a for a in allocations
        if a.get("payments") and date_from <= date.fromisoformat(str(a["payments"]["payment_date"])) <= date_to
    ]

    lease_ids = list({a["lease_id"] for a in allocations if a.get("lease_id")})
    leases = (
        {l["id"]: l for l in supabase.table("leases").select("id, room_id, tenant_id").in_("id", lease_ids).execute().data}
        if lease_ids
        else {}
    )
    room_ids = list({l["room_id"] for l in leases.values() if l.get("room_id")})
    rooms = (
        {r["id"]: r for r in supabase.table("rooms").select("id, room_number, building_id").in_("id", room_ids).execute().data}
        if room_ids
        else {}
    )
    building_ids = list({r["building_id"] for r in rooms.values() if r.get("building_id")})
    buildings = (
        {b["id"]: b["name"] for b in supabase.table("buildings").select("id, name").in_("id", building_ids).execute().data}
        if building_ids
        else {}
    )
    tenant_ids = list({a["tenant_id"] for a in allocations if a.get("tenant_id")})
    tenants = (
        {t["id"]: t["full_name"] for t in supabase.table("tenants").select("id, full_name").in_("id", tenant_ids).execute().data}
        if tenant_ids
        else {}
    )

    # Group by lease_id (falls back to tenant_id for the rare payment with
    # no lease tag) -- this is the same grain a room's invoice was actually
    # issued against, so heads for two different leases in the same room
    # over time are never blended into one row.
    grouped: Dict[str, dict] = {}
    for a in allocations:
        key = a.get("lease_id") or f"tenant:{a.get('tenant_id')}"
        lease = leases.get(a.get("lease_id")) if a.get("lease_id") else None
        room = rooms.get(lease["room_id"]) if lease else None
        row = grouped.setdefault(
            key,
            {
                "lease_id": a.get("lease_id"),
                "tenant_id": a.get("tenant_id") or (lease["tenant_id"] if lease else None),
                "room_id": lease["room_id"] if lease else None,
                "building_id": room["building_id"] if room else None,
                "heads": {},
                "total": 0.0,
            },
        )
        row["heads"][a["label"]] = round(row["heads"].get(a["label"], 0.0) + float(a["amount"]), 2)
        row["total"] = round(row["total"] + float(a["amount"]), 2)

    rows = list(grouped.values())
    if building_id:
        rows = [r for r in rows if r["building_id"] == building_id]

    columns = sorted({label for r in rows for label in r["heads"].keys()}, key=_label_sort_key)

    out_rows = []
    for i, r in enumerate(sorted(
        rows,
        key=lambda r: (buildings.get(r["building_id"], "—"), rooms.get(r["room_id"], {}).get("room_number", "")),
    )):
        room = rooms.get(r["room_id"])
        out_rows.append(
            {
                "sr": i + 1,
                "lease_id": r["lease_id"],
                "tenant_id": r["tenant_id"],
                "tenant_name": tenants.get(r["tenant_id"], "—"),
                "room_id": r["room_id"],
                "room_label": f"{buildings.get(r['building_id'], '—')} — {room['room_number']}" if room else "—",
                "building_id": r["building_id"],
                "heads": {c: r["heads"].get(c, 0.0) for c in columns},
                "total": r["total"],
            }
        )

    totals = {c: round(sum(r["heads"][c] for r in out_rows), 2) for c in columns}
    grand_total = round(sum(r["total"] for r in out_rows), 2)

    # Independent cross-check: every invoice-tied cash payment in the same
    # window, summed straight off `payments` -- should always equal
    # grand_total above, since that's exactly the universe payment_allocations
    # is built from.
    all_payments = (
        supabase.table("payments")
        .select("amount, invoice_id, payment_date")
        .gte("payment_date", str(date_from))
        .lte("payment_date", str(date_to))
        .execute()
        .data
    )
    total_cash_receipts = round(sum(float(p["amount"]) for p in all_payments if p.get("invoice_id")), 2)

    return {
        "columns": columns,
        "rows": out_rows,
        "totals": totals,
        "grand_total": grand_total,
        "reconciliation": {
            "allocated_total": grand_total,
            "invoice_tied_cash_receipts_total": total_cash_receipts,
            "matches": abs(grand_total - total_cash_receipts) < 0.01,
            "note": (
                "If this doesn't match, some receipts in this period haven't been split by head yet -- "
                "run POST /reports/income-by-head/backfill once (owner/admin) to fix it retroactively."
            ),
        },
    }


@router.get("/income-by-head/drilldown")
def income_by_head_drilldown(
    label: str = Query(..., description="The income head to drill into, e.g. 'Rent'"),
    date_from: date = Query(...),
    date_to: date = Query(...),
    lease_id: Optional[str] = Query(None),
    tenant_id: Optional[str] = Query(None),
    supabase: Client = Depends(get_supabase),
):
    """
    Every individual bank/cash receipt that makes up one cell of the
    Receipts-by-Head report -- pass either lease_id or tenant_id (whichever
    the report row carried) plus the head and the same date range. Returns
    one row per payment_allocations entry, each tagged with the actual
    account it was received into, so a click on any total in the report
    shows exactly which receipt(s) -- and which bank/cash account(s) --
    made it up.
    """
    if not lease_id and not tenant_id:
        return {"receipts": [], "total": 0.0}

    query = (
        supabase.table("payment_allocations")
        .select(
            "amount, payment_id, invoice_id, "
            "payments(payment_date, payment_method, account_id, receipt_group_id, notes), "
            "invoices(invoice_number, invoice_month)"
        )
        .eq("allocation_type", "cash")
        .eq("label", label)
    )
    query = query.eq("lease_id", lease_id) if lease_id else query.eq("tenant_id", tenant_id)
    allocations = query.execute().data

    allocations = [
        a for a in allocations
        if a.get("payments") and date_from <= date.fromisoformat(str(a["payments"]["payment_date"])) <= date_to
    ]

    # Resolve the bank/cash account for every receipt: straight off the
    # payment row where available, otherwise (older receipts) off the
    # journal entry -- see _resolve_cash_bank_account_ids_for_sources.
    missing_sources = [
        (a["payments"].get("receipt_group_id") or a["payment_id"])
        for a in allocations
        if not a["payments"].get("account_id")
    ]
    fallback_accounts = _resolve_cash_bank_account_ids_for_sources(supabase, missing_sources)

    account_ids = {a["payments"]["account_id"] for a in allocations if a["payments"].get("account_id")}
    account_ids |= set(fallback_accounts.values())
    accounts = (
        {acc["id"]: acc for acc in supabase.table("chart_of_accounts").select("id, code, name").in_("id", list(account_ids)).execute().data}
        if account_ids
        else {}
    )

    receipts = []
    for a in allocations:
        p = a["payments"]
        account_id = p.get("account_id") or fallback_accounts.get(p.get("receipt_group_id") or a["payment_id"])
        account = accounts.get(account_id) if account_id else None
        inv = a.get("invoices") or {}
        receipts.append(
            {
                "payment_id": a["payment_id"],
                "invoice_id": a["invoice_id"],
                "invoice_number": inv.get("invoice_number"),
                "invoice_month": inv.get("invoice_month"),
                "payment_date": str(p["payment_date"]),
                "payment_method": p.get("payment_method"),
                "account_id": account_id,
                "account_name": f"{account['code']} · {account['name']}" if account else "—",
                "notes": p.get("notes"),
                "amount": round(float(a["amount"]), 2),
            }
        )

    receipts.sort(key=lambda r: r["payment_date"])
    return {"receipts": receipts, "total": round(sum(r["amount"] for r in receipts), 2)}


@router.post("/income-by-head/backfill")
def backfill_income_by_head(
    supabase: Client = Depends(get_supabase),
    user: dict = Depends(get_current_user),
    company_id: str = Depends(get_current_company_id),
    _perm: None = Depends(require_owner_or_admin),
):
    """
    One-click, owner/admin-only, run-as-many-times-as-you-like: allocates
    every historical invoice-tied payment that doesn't have a
    payment_allocations row yet, using the exact same
    allocate_payment_to_line_items() function live receipts use -- so a
    backfilled receipt and a freshly-received one are always split
    identically. Processed oldest-first so that, on an invoice with several
    partial payments, each one sees the correct already-allocated balance
    left by the payment before it.

    Only ever touches this company's own data (every query below goes
    through the caller's own RLS-scoped Supabase client, same as every
    other endpoint in this app).
    """
    all_payments = (
        supabase.table("payments")
        .select("id, invoice_id, tenant_id, amount, discount_amount, payment_date, created_at")
        .not_.is_("invoice_id", "null")
        .order("payment_date")
        .order("created_at")
        .execute()
        .data
    )
    if not all_payments:
        return {"payments_processed": 0, "payments_already_allocated": 0, "payments_skipped_no_line_items": 0}

    payment_ids = [p["id"] for p in all_payments]
    already_allocated_payment_ids = set()
    # Chunk the IN() list defensively -- fine at this app's scale either way.
    for i in range(0, len(payment_ids), 500):
        chunk = payment_ids[i : i + 500]
        rows = supabase.table("payment_allocations").select("payment_id").in_("payment_id", chunk).execute().data
        already_allocated_payment_ids |= {r["payment_id"] for r in rows}

    invoice_ids = list({p["invoice_id"] for p in all_payments})
    invoices = (
        {inv["id"]: inv for inv in supabase.table("invoices").select("id, lease_id").in_("id", invoice_ids).execute().data}
        if invoice_ids
        else {}
    )

    processed, skipped_no_line_items = 0, 0
    for p in all_payments:
        if p["id"] in already_allocated_payment_ids:
            continue
        invoice = invoices.get(p["invoice_id"])
        lease_id = invoice.get("lease_id") if invoice else None
        result = allocate_payment_to_line_items(
            supabase,
            company_id=company_id,
            payment_id=p["id"],
            invoice_id=p["invoice_id"],
            tenant_id=p.get("tenant_id"),
            lease_id=lease_id,
            cash_amount=float(p.get("amount") or 0),
            discount_amount=float(p.get("discount_amount") or 0),
        )
        if result:
            processed += 1
        else:
            skipped_no_line_items += 1

    return {
        "payments_processed": processed,
        "payments_already_allocated": len(already_allocated_payment_ids),
        "payments_skipped_no_line_items": skipped_no_line_items,
    }
