"""
Per-room / per-invoice owner settlement tracking.

Every journal line on a transfers_to_owner account that is tagged to an
owner is a "settlement unit":
  * credit                       -> owed to the owner (rent when it comes
                                    from an invoice, otherwise 'other_credit')
  * debit that is not a payout   -> an expense/charge against the owner
                                    (Expenses page OR manual journal entry)
                                    that can be netted off a payout
  * debit from an owner payout   -> money already paid out

owner_payout_allocations records how much of each unit a payout settled, so
a unit's open balance = its amount - sum(allocations). The math lives in the
pure function build_settlement() so it can be tested without a database.
"""

from collections import defaultdict
from typing import Optional

from supabase import Client

EPS = 0.005
CHUNK = 150


def _fetch_all(build_query) -> list:
    """PostgREST returns at most 1000 rows per request; page through."""
    rows: list = []
    start = 0
    while True:
        batch = build_query().range(start, start + 999).execute().data or []
        rows.extend(batch)
        if len(batch) < 1000:
            return rows
        start += 1000


def _in_chunks(supabase: Client, table: str, cols: str, column: str, ids: list) -> list:
    out: list = []
    for i in range(0, len(ids), CHUNK):
        out.extend(supabase.table(table).select(cols).in_(column, ids[i : i + CHUNK]).execute().data or [])
    return out


def build_settlement(lines: list, entries: dict, allocations: list) -> dict:
    """
    lines:       journal_lines rows (id, journal_entry_id, direction, amount, building_id, room_id, tenant_id)
    entries:     {entry_id: journal_entries row (entry_date, description, source_type, source_id, status, reversal_of)}
    allocations: owner_payout_allocations rows
    Returns {"units": [...], "unapplied_payments": float, "ledger_balance": float}
    """

    def is_live(entry_id: Optional[str]) -> bool:
        e = entries.get(entry_id)
        return bool(e) and e.get("status") != "reversed" and not e.get("reversal_of")

    # Allocations whose payout was later reversed no longer count.
    live_allocs = [a for a in allocations if a.get("payout_entry_id") is None or is_live(a["payout_entry_id"])]

    allocated_by_line: dict[str, float] = defaultdict(float)
    new_payout_entries: set[str] = set()
    legacy_cover: dict[str, float] = defaultdict(float)
    for a in live_allocs:
        allocated_by_line[a["source_line_id"]] += float(a["amount"])
        if a.get("payout_entry_id"):
            if a.get("is_legacy_apply"):
                legacy_cover[a["payout_entry_id"]] += float(a["amount"]) if a["kind"] != "expense" else 0.0
            else:
                new_payout_entries.add(a["payout_entry_id"])

    units, unapplied, ledger_balance = [], 0.0, 0.0
    unapplied_entries: list[dict] = []
    for l in lines:
        if not is_live(l["journal_entry_id"]):
            continue
        e = entries[l["journal_entry_id"]]
        amt = round(float(l["amount"]), 2)
        ledger_balance += amt if l["direction"] == "credit" else -amt

        if l["direction"] == "credit":
            kind = "rent" if e.get("source_type") == "invoice" else "other_credit"
        elif e.get("source_type") != "owner_payout":
            # Any debit that isn't a payout is a charge against the owner --
            # an expense posted via the Expenses page ('expense'), or one
            # posted by hand through a journal entry ('manual_adjustment').
            kind = "expense"
        else:
            # An earlier payout/adjustment: fully covered if made through the
            # new allocated flow; otherwise only what "apply earlier payouts"
            # has matched so far counts as covered.
            if l["journal_entry_id"] in new_payout_entries:
                continue
            uncovered = max(0.0, amt - legacy_cover.get(l["journal_entry_id"], 0.0))
            unapplied += uncovered
            if uncovered > EPS:
                unapplied_entries.append(
                    {"entry_id": l["journal_entry_id"], "source_type": e.get("source_type"),
                     "entry_date": e.get("entry_date"), "uncovered": round(uncovered, 2)}
                )
            continue

        settled = round(allocated_by_line.get(l["id"], 0.0), 2)
        units.append(
            {
                "line_id": l["id"],
                "kind": kind,
                "entry_id": l["journal_entry_id"],
                "entry_date": e.get("entry_date"),
                "description": e.get("description"),
                "invoice_id": e.get("source_id") if e.get("source_type") == "invoice" else None,
                "building_id": l.get("building_id"),
                "room_id": l.get("room_id"),
                "tenant_id": l.get("tenant_id"),
                "amount": amt,
                "settled": settled,
                "remaining": round(max(0.0, amt - settled), 2),
            }
        )
    for u in units:
        u["status"] = "settled" if u["remaining"] <= EPS else ("partial" if u["settled"] > EPS else "pending")
    units.sort(key=lambda u: (u["entry_date"] or "", u["line_id"]))
    return {"units": units, "unapplied_payments": round(unapplied, 2), "unapplied_entries": unapplied_entries, "ledger_balance": round(ledger_balance, 2)}


def load_owner_settlement(supabase: Client, company_id: str, owner_id: str) -> dict:
    """Loads everything for one owner and returns the enriched settlement view."""
    owner_accounts = (
        supabase.table("chart_of_accounts")
        .select("id")
        .eq("company_id", company_id)
        .eq("transfers_to_owner", True)
        .execute()
        .data
    )
    account_ids = [a["id"] for a in owner_accounts]
    empty = {
        "units": [], "rooms": [], "unapplied_payments": 0.0, "unapplied_entries": [], "ledger_balance": 0.0,
        "totals": {"rent_payable": 0.0, "expenses_open": 0.0, "net_payable": 0.0,
                   "rent_settled": 0.0, "rooms_payable": 0, "rooms_settled": 0},
    }
    if not account_ids:
        return empty

    lines = _fetch_all(
        lambda: supabase.table("journal_lines")
        .select("id, journal_entry_id, direction, amount, building_id, room_id, tenant_id")
        .in_("account_id", account_ids)
        .eq("owner_id", owner_id)
        .order("created_at")
        .order("id")
    )
    allocations = _fetch_all(
        lambda: supabase.table("owner_payout_allocations").select("*").eq("owner_id", owner_id).order("id")
    )
    if not lines and not allocations:
        return empty

    entry_ids = list({l["journal_entry_id"] for l in lines} | {a["payout_entry_id"] for a in allocations if a.get("payout_entry_id")})
    entries = {
        e["id"]: e
        for e in _in_chunks(
            supabase, "journal_entries",
            "id, entry_date, description, source_type, source_id, status, reversal_of", "id", entry_ids,
        )
    }

    result = build_settlement(lines, entries, allocations)
    units = result["units"]

    # ---- enrich with names / invoice info -------------------------------
    def names(table, col, ids):
        ids = [i for i in set(ids) if i]
        return {r["id"]: r for r in _in_chunks(supabase, table, f"id, {col}", "id", ids)} if ids else {}

    buildings = names("buildings", "name", [u["building_id"] for u in units])
    rooms = names("rooms", "room_number", [u["room_id"] for u in units])
    tenants = names("tenants", "full_name", [u["tenant_id"] for u in units])
    invoice_ids = [u["invoice_id"] for u in units if u["invoice_id"]]
    invoices = (
        {i["id"]: i for i in _in_chunks(supabase, "invoices", "id, invoice_month, status, total_amount, due_date", "id", list(set(invoice_ids)))}
        if invoice_ids else {}
    )

    for u in units:
        inv = invoices.get(u["invoice_id"]) if u["invoice_id"] else None
        u["building_name"] = (buildings.get(u["building_id"]) or {}).get("name")
        u["room_number"] = (rooms.get(u["room_id"]) or {}).get("room_number")
        u["tenant_name"] = (tenants.get(u["tenant_id"]) or {}).get("full_name")
        u["invoice_month"] = inv["invoice_month"] if inv else None
        u["invoice_status"] = inv["status"] if inv else None
        u["invoice_total"] = float(inv["total_amount"]) if inv else None

    # ---- per-room rollup -----------------------------------------------
    by_room: dict[str, dict] = {}
    for u in units:
        key = u["room_id"] or f"none:{u['building_id']}"
        r = by_room.setdefault(
            key,
            {
                "room_id": u["room_id"], "building_id": u["building_id"],
                "building_name": u["building_name"], "room_number": u["room_number"] or "—",
                "rent_billed": 0.0, "rent_paid": 0.0, "rent_open": 0.0,
                "expenses_total": 0.0, "expenses_netted": 0.0, "expenses_open": 0.0,
            },
        )
        if u["kind"] == "expense":
            r["expenses_total"] += u["amount"]
            r["expenses_netted"] += u["settled"]
            r["expenses_open"] += u["remaining"]
        else:
            r["rent_billed"] += u["amount"]
            r["rent_paid"] += u["settled"]
            r["rent_open"] += u["remaining"]
    room_rows = []
    for r in by_room.values():
        for k in list(r.keys()):
            if isinstance(r[k], float):
                r[k] = round(r[k], 2)
        r["balance"] = round(r["rent_open"] - r["expenses_open"], 2)
        r["status"] = "payable" if r["rent_open"] > EPS else ("expenses_due" if r["expenses_open"] > EPS else "settled")
        room_rows.append(r)
    room_rows.sort(key=lambda r: (r["status"] == "settled", r["building_name"] or "", r["room_number"]))

    rent_payable = round(sum(u["remaining"] for u in units if u["kind"] != "expense"), 2)
    rent_settled = round(sum(u["settled"] for u in units if u["kind"] != "expense"), 2)
    exp_open = round(sum(u["remaining"] for u in units if u["kind"] == "expense"), 2)
    return {
        "units": units,
        "rooms": room_rows,
        "unapplied_payments": result["unapplied_payments"],
        "unapplied_entries": result["unapplied_entries"],
        "ledger_balance": result["ledger_balance"],
        "totals": {
            "rent_payable": rent_payable,
            "rent_settled": rent_settled,
            "expenses_open": exp_open,
            "net_payable": round(rent_payable - exp_open - result["unapplied_payments"], 2),
            "rooms_payable": sum(1 for r in room_rows if r["status"] != "settled"),
            "rooms_settled": sum(1 for r in room_rows if r["status"] == "settled"),
        },
    }
