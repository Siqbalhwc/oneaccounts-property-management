"""
Receipts by Head -- the complete cash report, ONE table.

Every rupee that moved through cash or bank in the period, tenant by tenant:

  received (left of Total)
    * one column per GL account / charge head (Rent, Electricity Recovery
      Income, ...) -- charge names are matched ignoring capital letters and
      spacing and shown under the one name of their GL account
    * Security                    -- security deposit payments received
    * Receipts not against an invoice -- bank/cash receipts with no invoice
    * Other receipts              -- cash/bank debits that are not tenant
                                     receipts at all (e.g. a manual journal)
  Total received
  Paid against security            -- the security deposit paid out (a refund,
                                     or a final settlement)
  Net cash                         -- Total received minus Paid against security

A final settlement is treated exactly as the money it represents: the dues
the tenant owed (rent, charges) are RECEIPTS, the deposit is a PAYMENT out, and
the system nets them into one entry. Example: deposit 20,000, rent 10,000,
charge 1,000 -> received 11,000, paid against security 20,000, net cash
(9,000) = the 9,000 actually refunded.

Net cash is checked against the cash/bank accounts in the books for the same
dates ("reconciliation"). Works the same for a month or a single day.

Read-only. Every query goes through the caller's own RLS-scoped client, so it
can only ever see the caller's own company's rows.
"""

import logging
from collections import defaultdict
from datetime import date
from typing import Callable, Dict, List, Optional

from supabase import Client

from app.services.charge_heads import ChargeHeads

logger = logging.getLogger("app.receipts_report")

SECURITY_LABEL = "Security"
ADVANCE_LABEL = "Receipts not against an invoice"
OTHER_LABEL = "Other receipts"
SPECIAL_LABELS = [SECURITY_LABEL, ADVANCE_LABEL, OTHER_LABEL]
PAID_KEY = "__paid_against_security__"
PAID_LABEL = "Paid against security"

INVOICES_SETTLED_LABEL = "Invoices settled (earlier)"
SETTLEMENT_DESCRIPTION_PREFIX = "Security deposit settled at move-out"
# A settlement entry (source "security_deposit_refund") can debit a bank/cash
# account (money received at settlement) and credit one (the refund paid).
RECEIPT_SOURCES = ("receipt", "payment", "security_deposit_refund")
SECURITY_SOURCE = "security_deposit_payment"
REFUND_SOURCE = "security_deposit_refund"
# Entries typed in by hand on the Journal page. A cash/bank debit in one of
# these is classified by what it was credited to (see _classify_manual_receipts)
# instead of being dumped under "Other receipts".
MANUAL_SOURCE = "manual_adjustment"
SECURITY_DEPOSITS_CODE = "2100"

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


def cap_allocations_to_receipts(allocations: List[dict], cash_by_payment: Dict[str, float]) -> tuple:
    """
    A payment can never have more cash split across heads than it actually
    received. Rows are counted oldest first; anything beyond the payment's
    amount (an accidental repeat of the same split) is left out, and a row
    that straddles the limit is trimmed. Returns (kept_rows, excess_ignored).
    """
    ordered = sorted(allocations, key=lambda a: (str(a.get("created_at") or ""), str(a.get("id") or "")))
    left = {k: round(float(v or 0), 2) for k, v in cash_by_payment.items()}
    kept: List[dict] = []
    excess = 0.0
    for a in ordered:
        pid = a.get("payment_id")
        amt = round(float(a.get("amount") or 0), 2)
        room = max(left.get(pid, 0.0), 0.0)
        take = round(min(amt, room), 2)
        if take > 0.004:
            kept.append({**a, "amount": take})
            left[pid] = round(room - take, 2)
        excess += amt - take
    return kept, round(excess, 2)


def _cash_bank_accounts(supabase: Client) -> Dict[str, dict]:
    rows = supabase.table("chart_of_accounts").select("id, code, name, is_cash_or_bank").eq("is_cash_or_bank", True).execute().data
    return {r["id"]: r for r in rows}


def _books_cash_lines(
    supabase: Client, date_from: date, date_to: date, building_id: Optional[str], cash_ids: List[str], direction: str = "debit"
) -> List[dict]:
    """
    Every debit (or credit) to a cash/bank account dated in the period, from
    ORIGINAL posted entries (an entry that was later reversed is status
    'reversed', and a reversal entry itself is never counted). Each item:
    {entry_id, source_type, source_id, description, entry_date, account_id,
     amount, lease_id, tenant_id}.
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
        q = q.eq("direction", direction).in_("account_id", cash_ids)
        if building_id:
            q = q.eq("building_id", building_id)
        return q.order("id")

    lines = _in_chunks(
        supabase, "journal_lines", "id, journal_entry_id, account_id, amount, lease_id, tenant_id", "journal_entry_id", list(by_id.keys()), extra
    )
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
                "lease_id": l.get("lease_id"),
                "tenant_id": l.get("tenant_id"),
            }
        )
    return out


def _books_cash_debits(
    supabase: Client, date_from: date, date_to: date, building_id: Optional[str], cash_ids: List[str]
) -> List[dict]:
    return _books_cash_lines(supabase, date_from, date_to, building_id, cash_ids, "debit")


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


def _classify_manual_receipts(supabase: Client, books_in: List[dict], heads: ChargeHeads):
    """
    Money received through a MANUAL journal entry (source 'manual_adjustment':
    Dr Bank/Cash, Cr something) used to land under "Other receipts" no matter
    what it was credited to -- so a security deposit keyed in by journal, even
    with the right account (2100), tenant and building on its lines, showed as
    an unknown receipt instead of under Security.

    Here each cash/bank debit of a manual entry is split across the entry's
    non-cash credit lines, and each share is given a head by its account:
      * Security Deposits Held (2100)             -> "Security"
      * an income account / Due to Owners (2200)  -> that account's head
        (same name the invoice-based receipts use, e.g. Rent)
    Anything credited elsewhere (another bank account, a liability, a
    receivable, ...) stays under "Other receipts", exactly as before.

    Tenant / building come from the credit line (else the cash line); a line
    without a lease is attached to that tenant's lease (active first).

    Returns (items, leftover):
      items    -- [{entry_id, entry_date, description, account_id, label,
                    amount, tenant_id, lease_id, building_id}]
      leftover -- {(entry_id, cash_account_id): amount still unclassified}
    """
    manual = [b for b in books_in if b["source_type"] == MANUAL_SOURCE]
    if not manual:
        return [], {}

    entry_ids = list({b["entry_id"] for b in manual})
    lines = _in_chunks(
        supabase, "journal_lines", "journal_entry_id, account_id, direction, amount, building_id, tenant_id, lease_id",
        "journal_entry_id", entry_ids,
    )
    accounts = {
        a["id"]: a
        for a in _in_chunks(
            supabase, "chart_of_accounts", "id, code, name, account_type, transfers_to_owner, is_cash_or_bank",
            "id", list({l["account_id"] for l in lines}),
        )
    }
    credits_by_entry: Dict[str, List[dict]] = defaultdict(list)
    for l in lines:
        if l["direction"] == "credit" and not accounts.get(l["account_id"], {}).get("is_cash_or_bank"):
            credits_by_entry[l["journal_entry_id"]].append(l)

    def label_for(account: dict, account_id: str) -> Optional[str]:
        if account.get("code") == SECURITY_DEPOSITS_CODE:
            return SECURITY_LABEL
        if account.get("account_type") == "income" or account.get("transfers_to_owner"):
            return heads.heading_for_account(account_id)
        return None

    # Tenants that have no lease on the line: look their leases up once.
    need_lease = {
        (l.get("tenant_id") or b.get("tenant_id"))
        for b in manual
        for l in credits_by_entry.get(b["entry_id"], [])
        if not (l.get("lease_id") or b.get("lease_id")) and (l.get("tenant_id") or b.get("tenant_id"))
    }
    tenant_leases: Dict[str, List[dict]] = defaultdict(list)
    for lease in _in_chunks(supabase, "leases", "id, tenant_id, status, start_date", "tenant_id", list(need_lease)):
        tenant_leases[lease["tenant_id"]].append(lease)

    items: List[dict] = []
    leftover: Dict[tuple, float] = defaultdict(float)
    for b in manual:
        credits = credits_by_entry.get(b["entry_id"], [])
        credit_total = sum(float(l["amount"]) for l in credits)
        classified = 0.0
        if credit_total > 0.004:
            for l in credits:
                label = label_for(accounts.get(l["account_id"], {}), l["account_id"])
                if not label:
                    continue
                share = round(b["amount"] * float(l["amount"]) / credit_total, 2)
                if share <= 0.004:
                    continue
                tenant_id = l.get("tenant_id") or b.get("tenant_id")
                lease_id = l.get("lease_id") or b.get("lease_id") or (
                    _pick_lease_for_tenant(tenant_leases.get(tenant_id, [])) if tenant_id else None
                )
                items.append(
                    {"entry_id": b["entry_id"], "entry_date": b["entry_date"], "description": b.get("description"),
                     "account_id": b["account_id"], "label": label, "amount": share, "tenant_id": tenant_id,
                     "lease_id": lease_id, "building_id": l.get("building_id")}
                )
                classified += share
        remainder = round(b["amount"] - classified, 2)
        if remainder > 0.004:
            leftover[(b["entry_id"], b["account_id"])] += remainder
    return items, dict(leftover)


def _books_deposit_released(
    supabase: Client, date_from: date, date_to: date, building_id: Optional[str]
) -> List[dict]:
    """
    Every debit to Security Deposits Held (2100) from a security-deposit
    refund or final-settlement entry in the period: the deposit paid out.
    Each: {entry_id, description, entry_date, amount, lease_id, tenant_id}.
    """
    dep = supabase.table("chart_of_accounts").select("id").eq("code", "2100").execute().data
    if not dep:
        return []
    entries = fetch_all(
        lambda: supabase.table("journal_entries")
        .select("id, description, entry_date")
        .eq("source_type", REFUND_SOURCE)
        .eq("status", "posted")
        .is_("reversal_of", "null")
        .gte("entry_date", str(date_from))
        .lte("entry_date", str(date_to))
        .order("id")
    )
    by_id = {e["id"]: e for e in entries}

    def extra(q):
        q = q.eq("direction", "debit").eq("account_id", dep[0]["id"])
        if building_id:
            q = q.eq("building_id", building_id)
        return q.order("id")

    lines = _in_chunks(supabase, "journal_lines", "id, journal_entry_id, amount, lease_id, tenant_id", "journal_entry_id", list(by_id.keys()), extra)
    out = []
    for l in lines:
        e = by_id.get(l["journal_entry_id"])
        if e:
            out.append(
                {"entry_id": e["id"], "description": e.get("description"), "entry_date": str(e["entry_date"]),
                 "amount": round(float(l["amount"]), 2), "lease_id": l.get("lease_id"), "tenant_id": l.get("tenant_id")}
            )
    return out


def build_receipts_report(
    supabase: Client,
    date_from: date,
    date_to: date,
    building_id: Optional[str],
    label_sort_key: Callable[[str], tuple],
) -> dict:
    heads = ChargeHeads(supabase)

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
        "id, created_at, amount, label, lease_id, tenant_id, payment_id",
        "payment_id",
        [p["id"] for p in tied],
        lambda q: q.eq("allocation_type", "cash").order("id"),
    )
    allocations, duplicate_excess = cap_allocations_to_receipts(
        allocations, {p["id"]: float(p.get("amount") or 0) for p in tied}
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

    cash_accounts = _cash_bank_accounts(supabase)
    cash_ids = list(cash_accounts.keys())
    books_in = _books_cash_lines(supabase, date_from, date_to, building_id, cash_ids, "debit")
    books_out = [b for b in _books_cash_lines(supabase, date_from, date_to, building_id, cash_ids, "credit") if b["source_type"] == REFUND_SOURCE]
    released = _books_deposit_released(supabase, date_from, date_to, building_id)
    settlement_rows = [r for r in _load_settlement_data(supabase, date_from, date_to)["rows"] if r["kind"] in ("invoice_settled", "charge")]
    manual_items, manual_leftover = _classify_manual_receipts(supabase, books_in, heads)

    lease_ids |= {r["lease_id"] for r in released if r.get("lease_id")}
    lease_ids |= {r["lease_id"] for r in settlement_rows if r.get("lease_id")}
    lease_ids |= {m["lease_id"] for m in manual_items if m.get("lease_id")}
    tenant_ids_all = (
        [a["tenant_id"] for a in allocations if a.get("tenant_id")]
        + untied_tenant_ids
        + [r["tenant_id"] for r in released if r.get("tenant_id")]
        + [r["tenant_id"] for r in settlement_rows if r.get("tenant_id")]
        + [m["tenant_id"] for m in manual_items if m.get("tenant_id")]
    )
    leases, rooms, buildings, tenants = _lookups(supabase, list(lease_ids), tenant_ids_all)

    grouped: Dict[str, dict] = {}

    def add(lease_id: Optional[str], tenant_id: Optional[str], label: str, amount: float, building_hint: Optional[str] = None) -> None:
        key = lease_id or f"tenant:{tenant_id}"
        lease = leases.get(lease_id) if lease_id else None
        room = rooms.get(lease["room_id"]) if lease else None
        row = grouped.setdefault(
            key,
            {
                "lease_id": lease_id,
                "tenant_id": tenant_id or (lease["tenant_id"] if lease else None),
                "room_id": lease["room_id"] if lease else None,
                "building_id": room["building_id"] if room else building_hint,
                "heads": {},
                "total": 0.0,
                "paid": 0.0,
            },
        )
        if label == PAID_KEY:
            row["paid"] = round(row["paid"] + amount, 2)
            return
        row["heads"][label] = round(row["heads"].get(label, 0.0) + amount, 2)
        row["total"] = round(row["total"] + amount, 2)

    for a in allocations:
        add(a.get("lease_id"), a.get("tenant_id"), heads.heading_for_label(a["label"]), float(a["amount"]))
    for p in sd_payments:
        dep = deposits.get(p["security_deposit_id"])
        lid = dep["lease_id"] if dep else None
        add(lid, leases[lid]["tenant_id"] if lid in leases else None, SECURITY_LABEL, float(p["amount"]))
    for p in untied:
        lid = untied_lease.get(p.get("tenant_id"))
        add(lid, p.get("tenant_id"), ADVANCE_LABEL, float(p["amount"]))
    # Settlement charges (income taken from the deposit) and dues paid out of
    # the deposit by earlier-version settlements: receipts, shown by head.
    for r in settlement_rows:
        label = heads.heading_for_account(r["account_id"]) if (r["kind"] == "charge" and r.get("account_id")) else (
            heads.heading_for_label(r["label"]) if r["label"] != INVOICES_SETTLED_LABEL else INVOICES_SETTLED_LABEL
        )
        add(r.get("lease_id"), r.get("tenant_id"), label, float(r["amount"]))
    for r in released:
        add(r.get("lease_id"), r.get("tenant_id"), PAID_KEY, r["amount"])
    # Receipts keyed in by manual journal entry: shown under their proper head
    # (Security, Rent, ...) on the tenant's own row, not under "Other receipts".
    for m in manual_items:
        add(m.get("lease_id"), m.get("tenant_id"), m["label"], m["amount"], m.get("building_id"))

    rows = list(grouped.values())
    if building_id:
        rows = [r for r in rows if r["building_id"] == building_id]

    books_by_source: Dict[str, float] = defaultdict(float)
    for b in books_in:
        books_by_source[b["source_type"]] += b["amount"]
    other_entries = [
        b for b in books_in
        if b["source_type"] not in RECEIPT_SOURCES and b["source_type"] != SECURITY_SOURCE and b["source_type"] != MANUAL_SOURCE
    ]
    # Manual entries only keep the part that could not be given a head.
    books_other = round(sum(b["amount"] for b in other_entries) + sum(manual_leftover.values()), 2)

    all_columns_used = {label for r in rows for label in r["heads"].keys()}
    head_columns = sorted([c for c in all_columns_used if c not in SPECIAL_LABELS], key=label_sort_key)

    rows_sorted = sorted(
        rows,
        key=lambda r: (buildings.get(r["building_id"], "—"), rooms.get(r["room_id"], {}).get("room_number", "")),
    )
    if abs(books_other) > 0.004:
        rows_sorted.append(
            {"lease_id": None, "tenant_id": None, "room_id": None, "building_id": None,
             "heads": {OTHER_LABEL: books_other}, "total": books_other, "paid": 0.0, "is_other": True}
        )
    columns = head_columns + [c for c in SPECIAL_LABELS if c in {l for r in rows_sorted for l in r["heads"]}]

    out_rows = []
    for i, r in enumerate(rows_sorted):
        if r.get("is_other"):
            out_rows.append(
                {"sr": i + 1, "lease_id": None, "tenant_id": None, "tenant_name": "Other receipts (not from a tenant)",
                 "room_id": None, "room_label": "—", "building_id": None,
                 "heads": {c: r["heads"].get(c, 0.0) for c in columns}, "total": r["total"],
                 "paid_against_security": 0.0, "net": r["total"], "is_other": True}
            )
            continue
        room = rooms.get(r["room_id"])
        out_rows.append(
            {"sr": i + 1, "lease_id": r["lease_id"], "tenant_id": r["tenant_id"], "tenant_name": tenants.get(r["tenant_id"], "—"),
             "room_id": r["room_id"],
             "room_label": f"{buildings.get(r['building_id'], '—')} — {room['room_number']}" if room else "—",
             "building_id": r["building_id"], "heads": {c: r["heads"].get(c, 0.0) for c in columns}, "total": r["total"],
             "paid_against_security": r["paid"], "net": round(r["total"] - r["paid"], 2), "is_other": False}
        )

    totals = {c: round(sum(r["heads"][c] for r in out_rows), 2) for c in columns}
    grand_total = round(sum(r["total"] for r in out_rows), 2)
    paid_total = round(sum(r["paid_against_security"] for r in out_rows), 2)
    net_total = round(grand_total - paid_total, 2)

    # Net cash against the cash/bank books: money in minus the refunds paid out.
    books_in_total = round(sum(b["amount"] for b in books_in), 2)
    books_out_total = round(sum(b["amount"] for b in books_out), 2)
    books_net = round(books_in_total - books_out_total, 2)
    gap = round(books_net - net_total, 2)
    unsplit = round(sum(float(p["amount"]) for p in tied) - sum(float(a["amount"]) for a in allocations), 2)

    reconciliation = {
        "books_net": books_net,
        "report_net": net_total,
        "gap": gap,
        "matches": abs(gap) < 0.01,
        "by_source": [
            {"source": "Cash and bank received (books)", "amount": books_in_total},
            {"source": "Cash and bank paid out as refunds (books)", "amount": books_out_total},
            {"source": "Net cash (books)", "amount": books_net},
        ],
        "unsplit_invoice_receipts": unsplit if abs(unsplit) > 0.01 and not building_id else 0.0,
        "duplicate_allocation_excess_ignored": duplicate_excess,
        "note": (
            "Net cash is compared with every debit and refund credit on the cash and bank accounts in the books for the "
            "same dates. A difference usually means a receipt whose payment date and journal date fall in different "
            "periods, or a receipt that has not been split by head yet."
        ),
    }
    return {
        "columns": columns,
        "rows": out_rows,
        "totals": totals,
        "grand_total": grand_total,
        "paid_total": paid_total,
        "net_total": net_total,
        "reconciliation": reconciliation,
    }


def _row_visible(lease_id: Optional[str], leases: dict, rooms: dict, building_id: Optional[str]) -> bool:
    if not building_id:
        return True
    lease = leases.get(lease_id) if lease_id else None
    room = rooms.get(lease["room_id"]) if lease else None
    return bool(room and room.get("building_id") == building_id)


def _load_settlement_data(supabase: Client, date_from: date, date_to: date) -> dict:
    """
    Settlement lines for the period that are NOT already ordinary payments:
    the charges (income taken from the deposit) and, for settlements closed
    before dues paid out of the deposit were recorded as receipts, the dues
    cleared from the deposit. Read from settlement_allocations; settlements
    that pre-date that table are rebuilt from their journal entry.
    """
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
        logger.exception("settlement_allocations unavailable; rebuilding settlements from the journal")
        table_rows = []

    covered = {(r["lease_id"], str(r["settled_on"])) for r in table_rows if r.get("lease_id")}

    entries = fetch_all(
        lambda: supabase.table("journal_entries")
        .select("id, entry_date, description")
        .eq("source_type", REFUND_SOURCE)
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
            supabase, "journal_lines", "journal_entry_id, account_id, direction, amount, lease_id, tenant_id", "journal_entry_id", list(entry_by_id.keys())
        )
        acc_ids = list({l["account_id"] for l in lines})
        accounts = {a["id"]: a for a in _in_chunks(supabase, "chart_of_accounts", "id, code, name, is_cash_or_bank", "id", acc_ids)}
        ar_credit: Dict[str, float] = defaultdict(float)
        other_debits: Dict[str, float] = defaultdict(float)
        bases: Dict[str, dict] = {}
        for l in lines:
            e = entry_by_id[l["journal_entry_id"]]
            if (l.get("lease_id"), str(e["entry_date"])) in covered or not l.get("lease_id"):
                continue
            acct = accounts.get(l["account_id"], {})
            amount = round(float(l["amount"]), 2)
            eid = e["id"]
            bases.setdefault(eid, {"lease_id": l["lease_id"], "tenant_id": l.get("tenant_id"), "settled_on": str(e["entry_date"]), "from_journal": True})
            base = {**bases[eid], "account_id": l["account_id"]}
            if l["direction"] == "debit":
                if acct.get("code") != "2100":
                    other_debits[eid] += amount
            elif acct.get("is_cash_or_bank"):
                continue
            elif acct.get("code") == "1100":
                ar_credit[eid] += amount
            else:
                fallback_rows.append({**base, "kind": "charge", "label": acct.get("name") or "Charge", "amount": amount})
        for eid, total in ar_credit.items():
            cleared = round(total - other_debits.get(eid, 0.0), 2)
            if cleared > 0.005:
                fallback_rows.append(
                    {**bases[eid], "account_id": None, "kind": "invoice_settled", "label": INVOICES_SETTLED_LABEL, "amount": cleared}
                )

    all_rows = table_rows + fallback_rows
    return {
        "rows": all_rows,
        "lease_ids": {r["lease_id"] for r in all_rows if r.get("lease_id")},
        "tenant_ids": {r["tenant_id"] for r in all_rows if r.get("tenant_id")},
    }


# ---------------------------------------------------------------- Drill-down
def _receipt_item(payment_id, date_s, method, account_id, account_name, notes, amount, invoice=None):
    inv = invoice or {}
    return {
        "payment_id": payment_id, "invoice_id": inv.get("id"), "invoice_number": inv.get("invoice_number"),
        "invoice_month": inv.get("invoice_month"), "payment_date": str(date_s), "payment_method": method,
        "account_id": account_id, "account_name": account_name, "notes": notes, "amount": round(float(amount), 2),
    }


def drilldown_special(
    supabase: Client,
    label: str,
    date_from: date,
    date_to: date,
    lease_id: Optional[str],
    tenant_id: Optional[str],
) -> dict:
    """Receipts behind a Security / Advance / Other / Paid-against-security
    cell. Same shape the head drill-down returns, so the page renders them
    identically."""
    cash_accounts = _cash_bank_accounts(supabase)

    def account_name(account_id: Optional[str]) -> str:
        a = cash_accounts.get(account_id) if account_id else None
        return f"{a['code']} · {a['name']}" if a else "—"

    receipts: List[dict] = []
    if label == SECURITY_LABEL and (lease_id or tenant_id):
        if lease_id:
            deposit_ids = [d["id"] for d in supabase.table("security_deposits").select("id").eq("lease_id", lease_id).execute().data]
            rows = _in_chunks(
                supabase, "security_deposit_payments", "id, amount, account_id, payment_date", "security_deposit_id", deposit_ids,
                lambda q: q.gte("payment_date", str(date_from)).lte("payment_date", str(date_to)),
            )
            for p in rows:
                receipts.append(_receipt_item(p["id"], p["payment_date"], "security deposit", p.get("account_id"), account_name(p.get("account_id")), "Security deposit received", p["amount"]))
        receipts.extend(drilldown_manual_lines(supabase, label, date_from, date_to, lease_id, tenant_id, ChargeHeads(supabase)))
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
                if float(p["amount"]) > 0.004:
                    receipts.append(_receipt_item(p["id"], p["payment_date"], p.get("payment_method"), p.get("account_id"), account_name(p.get("account_id")), p.get("notes"), p["amount"]))
    elif label == PAID_LABEL and (lease_id or tenant_id):
        for r in _books_deposit_released(supabase, date_from, date_to, None):
            if (lease_id and r.get("lease_id") != lease_id) or (not lease_id and r.get("tenant_id") != tenant_id):
                continue
            receipts.append(_receipt_item(r["entry_id"], r["entry_date"], "security deposit paid out", None, "Security Deposits Held", r.get("description"), r["amount"]))
    elif label == OTHER_LABEL:
        books_in = _books_cash_debits(supabase, date_from, date_to, None, list(cash_accounts.keys()))
        _, manual_leftover = _classify_manual_receipts(supabase, books_in, ChargeHeads(supabase))
        for b in books_in:
            if b["source_type"] in RECEIPT_SOURCES or b["source_type"] == SECURITY_SOURCE:
                continue
            amount = b["amount"]
            if b["source_type"] == MANUAL_SOURCE:
                # Only the part of a manual entry that has no head of its own.
                amount = round(manual_leftover.pop((b["entry_id"], b["account_id"]), 0.0), 2)
                if amount <= 0.004:
                    continue
            receipts.append(_receipt_item(b["entry_id"], b["entry_date"], b["source_type"], b["account_id"], account_name(b["account_id"]), b.get("description"), amount))
    receipts.sort(key=lambda r: r["payment_date"])
    return {"receipts": receipts, "total": round(sum(r["amount"] for r in receipts), 2)}


def drilldown_manual_lines(
    supabase: Client, heading: str, date_from: date, date_to: date, lease_id: Optional[str], tenant_id: Optional[str], heads: ChargeHeads
) -> List[dict]:
    """Receipts keyed in by manual journal entry that the report shows under
    this head for this lease/tenant, listed beside the ordinary receipts."""
    cash_accounts = _cash_bank_accounts(supabase)
    books_in = _books_cash_debits(supabase, date_from, date_to, None, list(cash_accounts.keys()))
    items, _ = _classify_manual_receipts(supabase, books_in, heads)
    out: List[dict] = []
    for m in items:
        if m["label"] != heading:
            continue
        if lease_id:
            if m.get("lease_id") != lease_id:
                continue
        elif m.get("tenant_id") != tenant_id:
            continue
        acct = cash_accounts.get(m["account_id"])
        out.append(
            _receipt_item(m["entry_id"], m["entry_date"], "journal entry", m["account_id"],
                          f"{acct['code']} · {acct['name']}" if acct else "—", m.get("description"), m["amount"])
        )
    return out


def drilldown_settlement_lines(
    supabase: Client, heading: str, date_from: date, date_to: date, lease_id: Optional[str], tenant_id: Optional[str], heads: ChargeHeads
) -> List[dict]:
    """Settlement charges (and older dues-cleared-from-deposit lines) behind
    a head cell, shown beside the ordinary receipts for that head."""
    out: List[dict] = []
    for r in _load_settlement_data(supabase, date_from, date_to)["rows"]:
        if r["kind"] not in ("invoice_settled", "charge"):
            continue
        if (lease_id and r.get("lease_id") != lease_id) or (not lease_id and tenant_id and r.get("tenant_id") != tenant_id):
            continue
        label = heads.heading_for_account(r["account_id"]) if (r["kind"] == "charge" and r.get("account_id")) else (
            heads.heading_for_label(r["label"]) if r["label"] != INVOICES_SETTLED_LABEL else INVOICES_SETTLED_LABEL
        )
        if label != heading:
            continue
        out.append(_receipt_item(r.get("id") or f"{r['kind']}-{r['settled_on']}-{r['label']}", r["settled_on"],
                                 "settled against security deposit", None, "Security deposit (netted in the settlement entry)",
                                 "Final settlement", r["amount"]))
    return out
