"""
Invoices vs receipts, one row per lease (apartment/shop + tenant), one
column per month, for the latest N months.

  invoiced  total of the (non-cancelled) invoices whose invoice_month falls
            in that month -- what was BILLED for the month.
  received  cash that actually landed in a bank/cash account that month from
            tenant receipts/payments, read from the journal (same source and
            same definition as the dashboard's "Collected" card) -- what was
            RECEIVED in the month, whichever month it was billed for.
"""

import re
from typing import Optional

from supabase import Client

from app.services.invoice_batch import fetch_all, fetch_in
from app.services.ledger_summary import (
    COLLECTION_SOURCE_TYPES,
    _signed,
    add_months,
    fetch_lines,
    load_accounts,
    month_end,
    month_key,
    month_start,
)
from datetime import date


def _natural_key(text: str):
    return [int(p) if p.isdigit() else p.lower() for p in re.split(r"(\d+)", text or "")]


def build_comparison(
    supabase: Client,
    company_id: str,
    end_month: date,
    months: int = 6,
    building_id: Optional[str] = None,
) -> dict:
    end_first = month_start(end_month)
    month_firsts = [add_months(end_first, -i) for i in range(months - 1, -1, -1)]
    start, end = month_firsts[0], month_end(end_first)
    keys = [month_key(m) for m in month_firsts]

    invoices = fetch_all(
        lambda: supabase.table("invoices")
        .select("id, lease_id, invoice_month, total_amount, status")
        .eq("company_id", company_id)
        .gte("invoice_month", str(start))
        .lte("invoice_month", str(end))
        .neq("status", "cancelled")
        .order("id")
    )

    accounts = load_accounts(supabase, company_id)
    receipt_lines = (
        [
            l
            for l in fetch_lines(
                supabase, company_id, start, end, accounts["cash_bank"],
                "line_id, entry_date, account_id, direction, amount, source_type, lease_id, tenant_id",
            )
            if l.get("source_type") in COLLECTION_SOURCE_TYPES
        ]
        if accounts["cash_bank"]
        else []
    )

    # ---- Resolve lease -> tenant / apartment / building labels -----------
    lease_ids = sorted({i["lease_id"] for i in invoices if i.get("lease_id")} | {l["lease_id"] for l in receipt_lines if l.get("lease_id")})
    leases = {r["id"]: r for r in fetch_in(supabase, "leases", "id, tenant_id, room_id", "id", lease_ids)} if lease_ids else {}

    orphan_tenant_ids = sorted({l["tenant_id"] for l in receipt_lines if not l.get("lease_id") and l.get("tenant_id")})
    tenant_ids = sorted({x["tenant_id"] for x in leases.values() if x.get("tenant_id")} | set(orphan_tenant_ids))
    tenants = {r["id"]: r for r in fetch_in(supabase, "tenants", "id, full_name", "id", tenant_ids)} if tenant_ids else {}

    room_ids = sorted({x["room_id"] for x in leases.values() if x.get("room_id")})
    rooms = {r["id"]: r for r in fetch_in(supabase, "rooms", "id, room_number, building_id", "id", room_ids)} if room_ids else {}

    building_ids = sorted({r["building_id"] for r in rooms.values() if r.get("building_id")})
    buildings = {r["id"]: r for r in fetch_in(supabase, "buildings", "id, name", "id", building_ids)} if building_ids else {}

    rows: dict[str, dict] = {}

    def row_for(lease_id: Optional[str], tenant_id: Optional[str]) -> dict:
        key = f"lease:{lease_id}" if lease_id else f"tenant:{tenant_id}"
        if key not in rows:
            lease = leases.get(lease_id or "", {})
            room = rooms.get(lease.get("room_id") or "", {})
            building = buildings.get(room.get("building_id") or "", {})
            t_id = lease.get("tenant_id") or tenant_id
            rows[key] = {
                "key": key,
                "lease_id": lease_id,
                "tenant_id": t_id,
                "tenant_name": (tenants.get(t_id or "") or {}).get("full_name") or "Unassigned",
                "building_id": room.get("building_id"),
                "building_name": building.get("name") or "—",
                "room_number": room.get("room_number") or "—",
                "invoiced": {k: 0.0 for k in keys},
                "received": {k: 0.0 for k in keys},
            }
        return rows[key]

    for inv in invoices:
        k = str(inv["invoice_month"])[:7]
        if k in keys:
            row_for(inv.get("lease_id"), None)["invoiced"][k] += float(inv["total_amount"] or 0)

    for l in receipt_lines:
        k = str(l["entry_date"])[:7]
        if k in keys:
            row_for(l.get("lease_id"), l.get("tenant_id"))["received"][k] += _signed(l)

    result_rows = list(rows.values())
    if building_id:
        result_rows = [r for r in result_rows if r["building_id"] == building_id]
    result_rows = [
        r
        for r in result_rows
        if any(abs(v) >= 0.005 for v in r["invoiced"].values()) or any(abs(v) >= 0.005 for v in r["received"].values())
    ]
    result_rows.sort(key=lambda r: (_natural_key(r["building_name"]), _natural_key(r["room_number"]), r["tenant_name"].lower()))

    for r in result_rows:
        r["invoiced"] = {k: round(v, 2) for k, v in r["invoiced"].items()}
        r["received"] = {k: round(v, 2) for k, v in r["received"].items()}

    totals = {
        "invoiced": {k: round(sum(r["invoiced"][k] for r in result_rows), 2) for k in keys},
        "received": {k: round(sum(r["received"][k] for r in result_rows), 2) for k in keys},
    }
    return {"months": keys, "rows": result_rows, "totals": totals}
