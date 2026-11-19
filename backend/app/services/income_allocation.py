"""
Line-item-level receipt allocation -- explains HOW a payment's cash (and,
separately, any discount) maps onto an invoice's individual income heads
(Rent, Parking, Internet, Commission, etc.), for the "Receipts by Head"
report and its bank/cash drill-down.

This sits ALONGSIDE the double-entry ledger, not inside it: the journal
entry for a payment (Dr Bank/Cash / Cr Accounts Receivable, posted in
payments.py) is completely unaffected by anything here and stays the
source of truth for the books. payment_allocations is a reporting
sub-ledger that explains which specific line item(s) a given payment's
money actually paid off -- so every rupee received is traceable back to a
head, and every head's total in the report is traceable back to specific
bank/cash receipts.

Allocation order when a payment doesn't cover an invoice in full (the
rule as specified):
  1. One-time charges first (e.g. a signing Commission) -- smallest
     amount first among those.
  2. Then recurring charges -- smallest amount first, largest last.
Cash is allocated through this order first; then, separately, whatever
discount was applied goes through the SAME order against whatever
balance cash didn't already cover -- so a line item's true remaining
balance (used to decide where the NEXT payment's cash should land)
always accounts for money that already left via a discount, not just
cash.

Deliberately best-effort at the call site (see payments.py): a failure
here must never block or roll back an actual payment/receipt, the same
principle generic.py's write_audit_log already follows for the audit
trail. If this ever fails silently, the fix is to re-run the
/reports/income-by-head/backfill endpoint, which is idempotent.
"""

from typing import Dict, List, Optional

from supabase import Client


def _one_time_labels_for_lease(supabase: Client, lease_id: Optional[str]) -> set:
    """
    Labels on this lease that are (or ever were) a one-time charge -- e.g.
    'Commission'. Best-effort: if a label was EVER marked one_time on this
    lease, it's treated as one_time for allocation priority, since in
    practice a label doesn't flip back and forth between recurring and
    one-time.
    """
    if not lease_id:
        return set()
    rows = (
        supabase.table("lease_charges")
        .select("label")
        .eq("lease_id", lease_id)
        .eq("recurrence", "one_time")
        .execute()
        .data
    )
    return {r["label"] for r in rows}


def _line_items_sorted_for_allocation(supabase: Client, invoice_id: str, lease_id: Optional[str]) -> List[dict]:
    """Invoice's line items, ordered one-time-first then smallest-amount-first
    (ties on equal amounts broken by id, for a stable order) -- the priority
    a partial payment fills
    them in."""
    items = (
        supabase.table("invoice_line_items")
        .select("id, label, amount")
        .eq("invoice_id", invoice_id)
        .execute()
        .data
    )
    one_time_labels = _one_time_labels_for_lease(supabase, lease_id)
    for it in items:
        it["_is_one_time"] = it["label"] in one_time_labels
    items.sort(
        key=lambda it: (
            0 if it["_is_one_time"] else 1,
            float(it["amount"]),
            it["id"],
        )
    )
    return items


def allocated_payment_ids(supabase: Client, payment_ids: List[str]) -> set:
    """
    Which of these payments already have at least one allocation row.

    Reads page by page: the API returns at most 1,000 rows per request and a
    payment has several allocation rows (one per income head), so a single
    unpaged read silently misses payments once a period is busy -- which made
    the report split the same payment again every time it was opened.
    """
    found: set = set()
    ids = [i for i in dict.fromkeys(payment_ids) if i]
    for i in range(0, len(ids), 100):
        chunk = ids[i : i + 100]
        start = 0
        while True:
            rows = (
                supabase.table("payment_allocations")
                .select("payment_id")
                .in_("payment_id", chunk)
                .order("id")
                .range(start, start + 999)
                .execute()
                .data
                or []
            )
            found |= {r["payment_id"] for r in rows}
            if len(rows) < 1000:
                break
            start += 1000
    return found


def _already_allocated_by_item(supabase: Client, item_ids: List[str]) -> Dict[str, float]:
    if not item_ids:
        return {}
    rows = (
        supabase.table("payment_allocations")
        .select("invoice_line_item_id, amount")
        .in_("invoice_line_item_id", item_ids)
        .execute()
        .data
    )
    out: Dict[str, float] = {}
    for r in rows:
        out[r["invoice_line_item_id"]] = out.get(r["invoice_line_item_id"], 0.0) + float(r["amount"])
    return out


def allocate_payment_to_line_items(
    supabase: Client,
    company_id: str,
    payment_id: str,
    invoice_id: str,
    tenant_id: Optional[str],
    lease_id: Optional[str],
    cash_amount: float,
    discount_amount: float = 0.0,
) -> List[dict]:
    """
    Splits ONE payment's cash_amount (and, separately, discount_amount)
    across this invoice's line items, one-time/smallest-first, and writes
    one payment_allocations row per (line item, type) actually touched.

    A payment that already has allocation rows is never split again (this
    function returns [] for it), whoever calls it and however often.

    Any leftover after every line item is fully covered (should only ever
    happen from floating-point rounding, since callers never let
    cash_amount + discount_amount exceed the invoice's remaining balance)
    is swept onto the LAST (largest) line item, so what's allocated always
    exactly equals cash_amount + discount_amount -- the report can never
    silently lose or gain a rupee against what was actually received.
    """
    cash_amount = round(float(cash_amount or 0), 2)
    discount_amount = round(float(discount_amount or 0), 2)
    if cash_amount <= 0 and discount_amount <= 0:
        return []

    # A payment is split once, ever. Whoever calls this (live receipt, report
    # self-heal, backfill, settlement) a payment that already has rows is left
    # exactly as it is, so a repeated call can never double the report.
    if allocated_payment_ids(supabase, [payment_id]):
        return []

    items = _line_items_sorted_for_allocation(supabase, invoice_id, lease_id)
    if not items:
        return []
    item_ids = [it["id"] for it in items]
    already = _already_allocated_by_item(supabase, item_ids)

    rows_to_insert: List[dict] = []

    def _item_remaining(item: dict) -> float:
        item_total = float(item["amount"])
        used = already.get(item["id"], 0.0) + sum(
            r["amount"] for r in rows_to_insert if r["invoice_line_item_id"] == item["id"]
        )
        return round(item_total - used, 2)

    def _sweep(amount: float, alloc_type: str) -> None:
        remaining = round(amount, 2)
        if remaining <= 0:
            return
        for it in items:
            if remaining <= 0.005:
                break
            item_remaining = _item_remaining(it)
            if item_remaining <= 0.005:
                continue
            take = round(min(remaining, item_remaining), 2)
            if take <= 0:
                continue
            rows_to_insert.append(
                {
                    "company_id": company_id,
                    "payment_id": payment_id,
                    "invoice_id": invoice_id,
                    "invoice_line_item_id": it["id"],
                    "label": it["label"],
                    "tenant_id": tenant_id,
                    "lease_id": lease_id,
                    "allocation_type": alloc_type,
                    "amount": take,
                }
            )
            remaining = round(remaining - take, 2)
        if remaining > 0.005 and items:
            # Rounding-only safety net -- top up the last (largest) item,
            # guaranteeing this payment's full amount is always accounted for.
            last = items[-1]
            existing = next(
                (r for r in rows_to_insert if r["invoice_line_item_id"] == last["id"] and r["allocation_type"] == alloc_type),
                None,
            )
            if existing:
                existing["amount"] = round(existing["amount"] + remaining, 2)
            else:
                rows_to_insert.append(
                    {
                        "company_id": company_id,
                        "payment_id": payment_id,
                        "invoice_id": invoice_id,
                        "invoice_line_item_id": last["id"],
                        "label": last["label"],
                        "tenant_id": tenant_id,
                        "lease_id": lease_id,
                        "allocation_type": alloc_type,
                        "amount": remaining,
                    }
                )

    _sweep(cash_amount, "cash")
    _sweep(discount_amount, "discount")

    if rows_to_insert:
        supabase.table("payment_allocations").insert(rows_to_insert).execute()
    return rows_to_insert


def split_invoice_balance_by_head(
    supabase: Client,
    invoice_id: str,
    lease_id: Optional[str],
    already_settled: float,
    amount: float,
) -> List[dict]:
    """
    Read-only. Says which income heads an amount settled against an invoice
    (for example out of the security deposit at final settlement) covers.

    Uses the SAME order a payment fills an invoice in (one-time charges first,
    then smallest to largest), after first skipping what was already settled
    (paid) on the invoice, so the split matches how a receipt would have been
    allocated. Returns [{"label", "amount"}, ...] adding up to `amount`
    exactly; any rounding leftover goes on the last (largest) line.
    """
    amount = round(float(amount or 0), 2)
    if amount <= 0:
        return []
    items = _line_items_sorted_for_allocation(supabase, invoice_id, lease_id)
    if not items:
        return []
    skip = round(max(float(already_settled or 0), 0.0), 2)
    out: Dict[str, float] = {}
    remaining = amount
    for it in items:
        item_total = round(float(it["amount"]), 2)
        covered_before = min(skip, item_total)
        skip = round(skip - covered_before, 2)
        open_amount = round(item_total - covered_before, 2)
        if open_amount <= 0.005 or remaining <= 0.005:
            continue
        take = round(min(remaining, open_amount), 2)
        out[it["label"]] = round(out.get(it["label"], 0.0) + take, 2)
        remaining = round(remaining - take, 2)
    if remaining > 0.005:
        last = items[-1]["label"]
        out[last] = round(out.get(last, 0.0) + remaining, 2)
    return [{"label": k, "amount": v} for k, v in out.items()]
