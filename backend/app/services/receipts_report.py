"""
Receipts by Head -- the complete report.

PART 1 -- cash / bank receipts. Every rupee that actually hit a cash or bank
account in the period, tenant by tenant, split into:
  * one column per income head (from payment_allocations, as before)
  * Security                    -- security deposit payments received
  * Advance / opening balance   -- receipts with no invoice (paid against an
                                   opening balance, or received in advance)
  * Other receipts              -- cash/bank debits that are not tenant
                                   receipts at all (e.g. a manual journal
                                   entry), on one row of their own
The grand total is checked against the cash/bank accounts in the books
(journal) for the same period -- see "reconciliation" in the result. It works
the same for a month or for a single day.

PART 2 -- settled at final settlement (non-cash). When a lease is closed the
invoice dues and the settlement charges are cleared out of the security
deposit; no cash moves except the refund. These lines are reported separately
so Part 1 can stay an exact match for the cash/bank books, while the invoice
receipt, the charges (e.g. 1,000 electricity) and the refund paid are all still
visible. Read from settlement_allocations (written when a lease is closed);
settlements closed before that table existed are rebuilt from their journal
entry, with the invoice portion as a single "Invoices settled" figure.

Read-only. Every query goes through the caller's own RLS-scoped client, so it
can only ever see the caller's own company's rows.
"""

import logging
from collections import defaultdict
from datetime import date
from typing import Callable, Dict, List, Optional

from supabase import Client

logger = logging.getLogger("app.receipts_report")

SECURITY_LABEL = "Security"
ADVANCE_LABEL = "Advance / opening balance"
OTHER_LABEL = "Other receipts"
SPECIAL_LABELS = [SECURITY_LABEL, ADVANCE_LABEL, OTHER_LABEL]

INVOICES_SETTLED_LABEL = "Invoices settled"
SETTLEMENT_DESCRIPTION_PREFIX = "Security deposit settled at move-out"
RECEIPT_SOURCES = ("receipt", "payment")
SECURITY_SOURCE = "security_deposit_payment"

PAGE = 1000
CHUNK = 150


def fetch_all(make_query: Callable[[], object]) -> List[dict]:
    """Reads every row of a query, page by page (the API caps one response at
    1000 rows, so a bare .execute() silently truncates a busy month)."""
    out: List[dict] = []
    start = 0
    while True:
        rows = make_query().range(start, start + PAGE - 1).execute().data or []
        out.extend(rows)
        if len(rows) < PAGE:
            return out
        start += PAGE


def _in_chunks(supabase: Client, table: str, select: str, column: str, values: List[str], extra=None) -> List[dict]:
    out: List[dict] = []
    values = list(dict.fromkeys(v for v in values if v))
    for i in range(0, len(values), CHUNK):
        chunk = values[i : i + CHUNK]

        def make(chunk=chunk):
            q = supabase.table(table).select(select).in_(column, chunk)
            if extra:
                q = extra(q)
            return q

        out.extend(fetch_all(make))
    return out


def _cash_bank_accounts(supabase: Client) -> Dict[str, dict]:
    rows = supabase.table("chart_of_accounts").select("id, code, name, is_cash_or_bank").eq("is_cash_or_bank", True).execute().data
    return {r["id"]: r for r in rows}


def _books_cash_debits(
    supabase: Client, date_from: date, date_to: date, building_id: Optional[str], cash_ids: List[str]
) -> List[dict]:
    """
    Every debit to a cash/bank account dated in the period, from ORIGINAL
    posted entries (an entry that was later reversed is status 'reversed', and
    a reversal entry itself is never counted as a receipt). Each item:
    {entry_id, source_type, source_id, description, entry_date, account_id, amount}.
    """
    if not cash_ids:
        return []
    entries = fetch_all(
        lambda: supabase.table("journal_entries")
        .select("id, source_type, source_id, description, entry_date")
        .gte("entry_date", str(date_from))
        .lte("entry_date", str(date_to))
        .eq("status", "posted")
        .is_("reversal_of", "null")
        .order("id")
    )
    by_id = {e["id"]: e for e in entries}
    out: List[dict] = []

    def extra(q):
        q = q.eq("direction", "debit").in_("account_id", cash_ids)
        if building_id:
            q = q.eq("building_id", building_id)
        return q.order("id")

    lines = _in_chunks(supabase, "journal_lines", "id, journal_entry_id, account_id, amount", "journal_entry_id", list(by_id.keys()), extra)
    for l in lines:
        e = by_id.get(l["journal_entry_id"])
        if not e:
            continue
        out.append(
            {
                "entry_id": e["id"],
                "source_type": e["source_type"],
                "source_id": e.get("source_id"),
                "description": e.get("description"),
                "entry_date": str(e["entry_date"]),
                "account_id": l["account_id"],
                "amount": round(float(l["amount"]), 2),
            }
        )
    return out


def _pick_lease_for_tenant(leases: List[dict]) -> Optional[str]:
    """Active lease if there is one, else the most recently started."""
    if not leases:
        return None
    active = [l for l in leases if l.get("status") == "active"]
    pool = active or leases
    return max(pool, key=lambda l: str(l.get("start_date") or ""))["id"]


def _lookups(supabase: Client, lease_ids: List[str], tenant_ids: List[str]):
    leases = {l["id"]: l for l in _in_chunks(supabase, "leases", "id, room_id, tenant_id", "id", lease_ids)}
    room_ids = [l["room_id"] for l in leases.values() if l.get("room_id")]
    rooms = {r["id"]: r for r in _in_chunks(supabase, "rooms", "id, room_number, building_id", "id", room_ids)}
    building_ids = [r["building_id"] for r in rooms.values() if r.get("building_id")]
    buildings = {b["id"]: b["name"] for b in _in_chunks(supabase, "buildings", "id, name", "id", building_ids)}
    all_tenant_ids = list(set(tenant_ids) | {l["tenant_id"] for l in leases.values() if l.get("tenant_id")})
    tenants = {t["id"]: t["full_name"] for t in _in_chunks(supabase, "tenants", "id, full_name", "id", all_tenant_ids)}
    return leases, rooms, buildings, tenants


def build_receipts_report(
    supabase: Client,
    date_from: date,
    date_to: date,
    building_id: Optional[str],
    label_sort_key: Callable[[str], tuple],
) -> dict:
    # ------------------------------------------------------------------ Part 1
    payments = fetch_all(
        lambda: supabase.table("payments")
        .select("id, invoice_id, tenant_id, amount, discount_amount, payment_date, account_id")
        .gte("payment_date", str(date_from))
        .lte("payment_date", str(date_to))
        .order("id")
    )
    tied = [p for p in payments if p.get("invoice_id")]
    untied = [p for p in payments if not p.get("invoice_id") and float(p.get("amount") or 0) > 0.004]

    allocations = _in_chunks(
        supabase,
        "payment_allocations",
        "amount, label, lease_id, tenant_id, payment_id",
        "payment_id",
        [p["id"] for p in tied],
        lambda q: q.eq("allocation_type", "cash").order("id"),
    )

    sd_payments = fetch_all(
        lambda: supabase.table("security_deposit_payments")
        .select("id, security_deposit_id, amount, account_id, payment_date")
        .gte("payment_date", str(date_from))
        .lte("payment_date", str(date_to))
        .order("id")
    )
    deposits = {
        d["id"]: d
        for d in _in_chunks(supabase, "security_deposits", "id, lease_id", "id", [p["security_deposit_id"] for p in sd_payments])
    }

    # A receipt with no invoice only knows its tenant; attach it to that
    # tenant's lease (active first) so it lands on the same row as the rest.
    untied_tenant_ids = list({p["tenant_id"] for p in untied if p.get("tenant_id")})
    tenant_leases: Dict[str, List[dict]] = defaultdict(list)
    for l in _in_chunks(supabase, "leases", "id, tenant_id, status, start_date", "tenant_id", untied_tenant_ids):
        tenant_leases[l["tenant_id"]].append(l)

    lease_ids = {a["lease_id"] for a in allocations if a.get("lease_id")}
    lease_ids |= {d["lease_id"] for d in deposits.values() if d.get("lease_id")}
    untied_lease: Dict[str, Optional[str]] = {}
    for t_id in untied_tenant_ids:
        untied_lease[t_id] = _pick_lease_for_tenant(tenant_leases.get(t_id, []))
        if untied_lease[t_id]:
            lease_ids.add(untied_lease[t_id])

    # Settlement (Part 2) needs the same lookups, so gather its data first.
    settlement_data = _load_settlement_data(supabase, date_from, date_to, building_id)
    lease_ids |= {k for k in settlement_data["lease_ids"] if k}
    tenant_ids_all = [a["tenant_id"] for a in allocations if a.get("tenant_id")] + untied_tenant_ids + [
        t for t in settlement_data["tenant_ids"] if t
    ]
    leases, rooms, buildings, tenants = _lookups(supabase, list(lease_ids), tenant_ids_all)

    grouped: Dict[str, dict] = {}

    def add(lease_id: Optional[str], tenant_id: Optional[str], label: str, amount: float) -> None:
        key = lease_id or f"tenant:{tenant_id}"
        lease = leases.get(lease_id) if lease_id else None
        room = rooms.get(lease["room_id"]) if lease else None
        row = grouped.setdefault(
            key,
            {
                "lease_id": lease_id,
                "tenant_id": tenant_id or (lease["tenant_id"] if lease else None),
                "room_id": lease["room_id"] if lease else None,
                "building_id": room["building_id"] if room else None,
                "heads": {},
                "total": 0.0,
            },
        )
        row["heads"][label] = round(row["heads"].get(label, 0.0) + amount, 2)
        row["total"] = round(row["total"] + amount, 2)

    for a in allocations:
        add(a.get("lease_id"), a.get("tenant_id"), a["label"], float(a["amount"]))
    for p in sd_payments:
        dep = deposits.get(p["security_deposit_id"])
        lid = dep["lease_id"] if dep else None
        add(lid, leases[lid]["tenant_id"] if lid in leases else None, SECURITY_LABEL, float(p["amount"]))
    for p in untied:
        lid = untied_lease.get(p.get("tenant_id"))
        add(lid, p.get("tenant_id"), ADVANCE_LABEL, float(p["amount"]))

    rows = list(grouped.values())
    if building_id:
        rows = [r for r in rows if r["building_id"] == building_id]

    # -------- books: every cash/bank debit in the period, by source
    cash_accounts = _cash_bank_accounts(supabase)
    books = _books_cash_debits(supabase, date_from, date_to, building_id, list(cash_accounts.keys()))
    books_by_source: Dict[str, float] = defaultdict(float)
    for b in books:
        books_by_source[b["source_type"]] += b["amount"]
    books_receipts = round(sum(books_by_source.get(s, 0.0) for s in RECEIPT_SOURCES), 2)
    books_security = round(books_by_source.get(SECURITY_SOURCE, 0.0), 2)
    other_entries = [b for b in books if b["source_type"] not in RECEIPT_SOURCES and b["source_type"] != SECURITY_SOURCE]
    books_other = round(sum(b["amount"] for b in other_entries), 2)

    all_columns_used = {label for r in rows for label in r["heads"].keys()}
    head_columns = sorted([c for c in all_columns_used if c not in SPECIAL_LABELS], key=label_sort_key)

    other_row = None
    if abs(books_other) > 0.004:
        other_row = {
            "lease_id": None,
            "tenant_id": None,
            "room_id": None,
            "building_id": None,
            "heads": {OTHER_LABEL: books_other},
            "total": books_other,
            "is_other": True,
        }

    rows_sorted = sorted(
        rows,
        key=lambda r: (buildings.get(r["building_id"], "—"), rooms.get(r["room_id"], {}).get("room_number", "")),
    )
    if other_row:
        rows_sorted.append(other_row)

    columns = head_columns + [c for c in SPECIAL_LABELS if c in {l for r in rows_sorted for l in r["heads"]}]

    out_rows = []
    for i, r in enumerate(rows_sorted):
        if r.get("is_other"):
            out_rows.append(
                {
                    "sr": i + 1,
                    "lease_id": None,
                    "tenant_id": None,
                    "tenant_name": "Other receipts (not from a tenant)",
                    "room_id": None,
                    "room_label": "—",
                    "building_id": None,
                    "heads": {c: r["heads"].get(c, 0.0) for c in columns},
                    "total": r["total"],
                    "is_other": True,
                }
            )
            continue
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
                "is_other": False,
            }
        )

    totals = {c: round(sum(r["heads"][c] for r in out_rows), 2) for c in columns}
    grand_total = round(sum(r["total"] for r in out_rows), 2)

    report_receipts = round(
        sum(float(a["amount"]) for a in allocations if _row_visible(a.get("lease_id"), leases, rooms, building_id))
        + sum(float(p["amount"]) for p in untied if _row_visible(untied_lease.get(p.get("tenant_id")), leases, rooms, building_id)),
        2,
    )
    report_security = round(
        sum(
            float(p["amount"])
            for p in sd_payments
            if _row_visible((deposits.get(p["security_deposit_id"]) or {}).get("lease_id"), leases, rooms, building_id)
        ),
        2,
    )
    books_total = round(books_receipts + books_security + books_other, 2)
    gap = round(books_total - grand_total, 2)

    unsplit = round(sum(float(p["amount"]) for p in tied) - sum(float(a["amount"]) for a in allocations), 2)

    reconciliation = {
        "books_total": books_total,
        "report_total": grand_total,
        "gap": gap,
        "matches": abs(gap) < 0.01,
        "by_source": [
            {"source": "Tenant receipts (incl. advance / opening balance)", "books": books_receipts, "report": report_receipts},
            {"source": "Security deposits received", "books": books_security, "report": report_security},
            {"source": "Other cash/bank receipts (journal)", "books": books_other, "report": books_other},
        ],
        "unsplit_invoice_receipts": unsplit if abs(unsplit) > 0.01 and not building_id else 0.0,
        "note": (
            "Compared with every debit to a cash or bank account in the books for the same dates. "
            "A difference usually means a receipt whose payment date and journal date fall in different periods, "
            "or a receipt that has not been split by head yet."
        ),
    }

    settlement = _build_settlement_part(settlement_data, leases, rooms, buildings, tenants, cash_accounts, building_id, label_sort_key)

    return {
        "columns": columns,
        "rows": out_rows,
        "totals": totals,
        "grand_total": grand_total,
        "settlement": settlement,
        "reconciliation": reconciliation,
    }


def _row_visible(lease_id: Optional[str], leases: dict, rooms: dict, building_id: Optional[str]) -> bool:
    if not building_id:
        return True
    lease = leases.get(lease_id) if lease_id else None
    room = rooms.get(lease["room_id"]) if lease else None
    return bool(room and room.get("building_id") == building_id)


# ------------------------------------------------------------------ Part 2
def _load_settlement_data(supabase: Client, date_from: date, date_to: date, building_id: Optional[str]) -> dict:
    """Settlement lines for the period: from settlement_allocations where they
    exist, otherwise rebuilt from the settlement's journal entry."""
    table_rows: List[dict] = []
    try:
        table_rows = fetch_all(
            lambda: supabase.table("settlement_allocations")
            .select("id, settlement_id, lease_id, tenant_id, settled_on, kind, label, amount, account_id")
            .gte("settled_on", str(date_from))
            .lte("settled_on", str(date_to))
            .order("id")
        )
    except Exception:
        # Migration 022 not run yet -- everything falls back to the journal.
        logger.exception("settlement_allocations unavailable; rebuilding settlements from the journal")
        table_rows = []

    covered = {(r["lease_id"], str(r["settled_on"])) for r in table_rows if r.get("lease_id")}

    entries = fetch_all(
        lambda: supabase.table("journal_entries")
        .select("id, entry_date, description")
        .eq("source_type", "security_deposit_refund")
        .eq("status", "posted")
        .is_("reversal_of", "null")
        .ilike("description", f"{SETTLEMENT_DESCRIPTION_PREFIX}%")
        .gte("entry_date", str(date_from))
        .lte("entry_date", str(date_to))
        .order("id")
    )
    fallback_rows: List[dict] = []
    if entries:
        entry_by_id = {e["id"]: e for e in entries}
        lines = _in_chunks(
            supabase,
            "journal_lines",
            "journal_entry_id, account_id, direction, amount, lease_id, tenant_id",
            "journal_entry_id",
            list(entry_by_id.keys()),
        )
        acc_ids = list({l["account_id"] for l in lines})
        accounts = {a["id"]: a for a in _in_chunks(supabase, "chart_of_accounts", "id, code, name, is_cash_or_bank", "id", acc_ids)}
        for l in lines:
            e = entry_by_id[l["journal_entry_id"]]
            if (l.get("lease_id"), str(e["entry_date"])) in covered or not l.get("lease_id"):
                continue
            acct = accounts.get(l["account_id"], {})
            amount = round(float(l["amount"]), 2)
            base = {
                "lease_id": l["lease_id"],
                "tenant_id": l.get("tenant_id"),
                "settled_on": str(e["entry_date"]),
                "account_id": l["account_id"],
                "from_journal": True,
            }
            if l["direction"] == "credit" and acct.get("is_cash_or_bank"):
                fallback_rows.append({**base, "kind": "refund_paid", "label": "Refund paid", "amount": amount})
            elif l["direction"] == "credit" and acct.get("code") == "1100":
                fallback_rows.append({**base, "kind": "invoice_settled", "label": INVOICES_SETTLED_LABEL, "amount": amount})
            elif l["direction"] == "credit":
                fallback_rows.append({**base, "kind": "charge", "label": acct.get("name") or "Charge", "amount": amount})

    all_rows = table_rows + fallback_rows
    return {
        "rows": all_rows,
        "lease_ids": {r["lease_id"] for r in all_rows if r.get("lease_id")},
        "tenant_ids": {r["tenant_id"] for r in all_rows if r.get("tenant_id")},
    }


def _build_settlement_part(
    data: dict, leases: dict, rooms: dict, buildings: dict, tenants: dict, cash_accounts: dict,
    building_id: Optional[str], label_sort_key: Callable[[str], tuple],
) -> dict:
    grouped: Dict[str, dict] = {}
    for r in data["rows"]:
        lease_id = r.get("lease_id")
        if not _row_visible(lease_id, leases, rooms, building_id):
            continue
        key = f"{lease_id}|{r['settled_on']}"
        lease = leases.get(lease_id)
        room = rooms.get(lease["room_id"]) if lease else None
        row = grouped.setdefault(
            key,
            {
                "lease_id": lease_id,
                "tenant_id": r.get("tenant_id") or (lease["tenant_id"] if lease else None),
                "room_id": lease["room_id"] if lease else None,
                "building_id": room["building_id"] if room else None,
                "settled_on": r["settled_on"],
                "heads": {},
                "settled_total": 0.0,
                "refund_paid": 0.0,
                "refund_account": None,
            },
        )
        amount = float(r["amount"])
        if r["kind"] == "refund_paid":
            row["refund_paid"] = round(row["refund_paid"] + amount, 2)
            acc = cash_accounts.get(r.get("account_id"))
            if acc:
                row["refund_account"] = f"{acc['code']} · {acc['name']}"
        else:
            row["heads"][r["label"]] = round(row["heads"].get(r["label"], 0.0) + amount, 2)
            row["settled_total"] = round(row["settled_total"] + amount, 2)

    columns = sorted({l for r in grouped.values() for l in r["heads"]}, key=label_sort_key)
    ordered = sorted(
        grouped.values(),
        key=lambda r: (r["settled_on"], buildings.get(r["building_id"], "—"), rooms.get(r["room_id"], {}).get("room_number", "")),
    )
    out_rows = []
    for i, r in enumerate(ordered):
        room = rooms.get(r["room_id"])
        out_rows.append(
            {
                "sr": i + 1,
                "lease_id": r["lease_id"],
                "tenant_id": r["tenant_id"],
                "tenant_name": tenants.get(r["tenant_id"], "—"),
                "room_label": f"{buildings.get(r['building_id'], '—')} — {room['room_number']}" if room else "—",
                "settled_on": r["settled_on"],
                "heads": {c: r["heads"].get(c, 0.0) for c in columns},
                "settled_total": r["settled_total"],
                "refund_paid": r["refund_paid"],
                "refund_account": r["refund_account"],
                "deposit_released": round(r["settled_total"] + r["refund_paid"], 2),
            }
        )
    return {
        "columns": columns,
        "rows": out_rows,
        "totals": {c: round(sum(r["heads"][c] for r in out_rows), 2) for c in columns},
        "settled_total": round(sum(r["settled_total"] for r in out_rows), 2),
        "refund_total": round(sum(r["refund_paid"] for r in out_rows), 2),
        "deposit_released_total": round(sum(r["deposit_released"] for r in out_rows), 2),
    }


# ---------------------------------------------------------------- Drill-down
def drilldown_special(
    supabase: Client,
    label: str,
    date_from: date,
    date_to: date,
    lease_id: Optional[str],
    tenant_id: Optional[str],
) -> dict:
    """Receipts behind a Security / Advance / Other cell. Same shape the
    head drill-down returns, so the page renders them identically."""
    cash_accounts = _cash_bank_accounts(supabase)

    def account_name(account_id: Optional[str]) -> str:
        a = cash_accounts.get(account_id) if account_id else None
        return f"{a['code']} · {a['name']}" if a else "—"

    receipts: List[dict] = []
    if label == SECURITY_LABEL and lease_id:
        deposit_ids = [d["id"] for d in supabase.table("security_deposits").select("id").eq("lease_id", lease_id).execute().data]
        rows = _in_chunks(
            supabase, "security_deposit_payments", "id, amount, account_id, payment_date", "security_deposit_id", deposit_ids,
            lambda q: q.gte("payment_date", str(date_from)).lte("payment_date", str(date_to)),
        )
        for p in rows:
            receipts.append(
                {
                    "payment_id": p["id"], "invoice_id": None, "invoice_number": None, "invoice_month": None,
                    "payment_date": str(p["payment_date"]), "payment_method": "security deposit",
                    "account_id": p.get("account_id"), "account_name": account_name(p.get("account_id")),
                    "notes": "Security deposit received", "amount": round(float(p["amount"]), 2),
                }
            )
    elif label == ADVANCE_LABEL and (tenant_id or lease_id):
        t_id = tenant_id
        if not t_id and lease_id:
            lease = supabase.table("leases").select("tenant_id").eq("id", lease_id).execute().data
            t_id = lease[0]["tenant_id"] if lease else None
        if t_id:
            rows = fetch_all(
                lambda: supabase.table("payments")
                .select("id, amount, account_id, payment_date, payment_method, notes")
                .eq("tenant_id", t_id)
                .is_("invoice_id", "null")
                .gte("payment_date", str(date_from))
                .lte("payment_date", str(date_to))
                .order("id")
            )
            for p in rows:
                if float(p["amount"]) <= 0.004:
                    continue
                receipts.append(
                    {
                        "payment_id": p["id"], "invoice_id": None, "invoice_number": None, "invoice_month": None,
                        "payment_date": str(p["payment_date"]), "payment_method": p.get("payment_method"),
                        "account_id": p.get("account_id"), "account_name": account_name(p.get("account_id")),
                        "notes": p.get("notes"), "amount": round(float(p["amount"]), 2),
                    }
                )
    elif label == OTHER_LABEL:
        books = _books_cash_debits(supabase, date_from, date_to, None, list(cash_accounts.keys()))
        for b in books:
            if b["source_type"] in RECEIPT_SOURCES or b["source_type"] == SECURITY_SOURCE:
                continue
            receipts.append(
                {
                    "payment_id": b["entry_id"], "invoice_id": None, "invoice_number": None, "invoice_month": None,
                    "payment_date": b["entry_date"], "payment_method": b["source_type"],
                    "account_id": b["account_id"], "account_name": account_name(b["account_id"]),
                    "notes": b.get("description"), "amount": b["amount"],
                }
            )
    receipts.sort(key=lambda r: r["payment_date"])
    return {"receipts": receipts, "total": round(sum(r["amount"] for r in receipts), 2)}


def drilldown_settlement(
    supabase: Client, label: str, date_from: date, date_to: date, lease_id: str
) -> dict:
    """The settlement lines behind one Part 2 cell (or 'Refund paid')."""
    data = _load_settlement_data(supabase, date_from, date_to, None)
    cash_accounts = _cash_bank_accounts(supabase)
    out: List[dict] = []
    for r in data["rows"]:
        if r.get("lease_id") != lease_id:
            continue
        is_refund = r["kind"] == "refund_paid"
        if (label == "Refund paid") != is_refund:
            continue
        if not is_refund and r["label"] != label:
            continue
        acc = cash_accounts.get(r.get("account_id"))
        out.append(
            {
                "payment_id": r.get("id") or f"{r['kind']}-{r['settled_on']}-{r['label']}",
                "invoice_id": None, "invoice_number": None, "invoice_month": None,
                "payment_date": str(r["settled_on"]),
                "payment_method": "refund paid" if is_refund else "settled from security deposit",
                "account_id": r.get("account_id"),
                "account_name": f"{acc['code']} · {acc['name']}" if acc else "Security deposit (non-cash)",
                "notes": "Final settlement",
                "amount": round(float(r["amount"]), 2),
            }
        )
    out.sort(key=lambda r: r["payment_date"])
    return {"receipts": out, "total": round(sum(r["amount"] for r in out), 2)}
