"""
Bill-basis charges (electricity, water, gas -- anything whose amount changes
every month) that arrive from an Excel upload.

WHY THIS IS A SEPARATE TABLE (utility_bills) AND NOT lease_charges
lease_charges is versioned and prorated by day: editing a charge closes one
row and opens another. A monthly meter bill is a one-month fact, not a change
to the lease, so storing it there would rewrite lease history every month and
fight the proration rules. utility_bills holds one row per
lease + month + utility, and nothing about the lease itself changes.

THE ONE RULE EVERY INVOICE PATH FOLLOWS
When an invoice for (lease, month) is built -- bulk generation, single
generation, lease-creation first invoice, a charge-edit recalculation, or a
utility upload -- the lease's prorated charge lines are computed exactly as
before, then apply_utility_overrides() is applied on top:
  * a bill for a utility the lease already charges REPLACES that line's
    amount (never prorated; the bill is the bill);
  * a bill for a utility the lease does not charge is ADDED as a new line;
  * a bill of 0 removes that line for the month;
  * no bill for the month -> the lease amount stays, exactly as today.

This module has no dependency on invoicing.py or invoice_batch.py (they both
import it), so there is no circular import.
"""

from collections import defaultdict
from datetime import date
from typing import Optional

from supabase import Client

# Words that make no difference to WHICH utility a label is, so
# "Electricity", "Electricity bill" and "Electricity Bill" are one utility.
NOISE_WORDS = {"bill", "bills"}

# The utilities the Excel template pre-fills for each lease. Anything else can
# still be uploaded by typing a row by hand.
UTILITY_KEYS = {"electricity", "electric", "water", "gas"}

FETCH_CHUNK = 50  # leases per query; 50 leases x a few bills stays far below PostgREST's 1000-row cap


def label_key(label) -> str:
    """Case/spacing-insensitive identity of a charge label, ignoring 'bill'."""
    words = [w for w in " ".join(str(label or "").split()).lower().split(" ") if w]
    core = [w for w in words if w not in NOISE_WORDS]
    return " ".join(core or words)


def is_utility_label(label) -> bool:
    return label_key(label) in UTILITY_KEYS


def apply_utility_overrides(lines: list[dict], bills: list[dict]) -> list[dict]:
    """
    lines: prorated invoice lines  [{label, amount, show_on_invoice}, ...]
    bills: [{label, label_key?, amount}, ...] for the same lease and month.
    Returns a NEW list; the inputs are not modified. Pure function.
    """
    result = [dict(l) for l in lines]
    drop: set[int] = set()
    for bill in bills:
        key = bill.get("label_key") or label_key(bill["label"])
        amount = round(float(bill["amount"]), 2)
        matches = [i for i, l in enumerate(result) if i not in drop and label_key(l["label"]) == key]
        if matches:
            first = matches[0]
            result[first]["amount"] = amount
            for extra in matches[1:]:
                drop.add(extra)  # two lines for one utility (e.g. "Gas" + "Gas Bill"): the bill is the total
            if amount <= 0:
                drop.add(first)
        elif amount > 0:
            result.append({"label": bill["label"], "amount": amount, "show_on_invoice": True})
    return [l for i, l in enumerate(result) if i not in drop]


def _table_missing(error: Exception) -> bool:
    text = str(error)
    return "utility_bills" in text and (
        "does not exist" in text or "PGRST205" in text or "schema cache" in text or "42P01" in text
    )


def fetch_bills(supabase: Client, lease_ids: list[str], bill_month: date) -> dict[str, list[dict]]:
    """
    {lease_id: [{label, label_key, amount}, ...]} for one month.
    Runs through the caller's own RLS-scoped client, so it can only ever see
    the caller's own company's bills. If the utility_bills table has not been
    created yet (SQL migration not run), returns {} so invoicing keeps working
    exactly as before; any other error is raised rather than hidden, because
    silently ignoring a real failure would produce wrong invoices.
    """
    out: dict[str, list[dict]] = defaultdict(list)
    ids = list(dict.fromkeys(lease_ids))
    for i in range(0, len(ids), FETCH_CHUNK):
        chunk = ids[i : i + FETCH_CHUNK]
        try:
            rows = (
                supabase.table("utility_bills")
                .select("lease_id, label, label_key, amount")
                .eq("bill_month", str(bill_month))
                .in_("lease_id", chunk)
                .execute()
                .data
            )
        except Exception as e:
            if _table_missing(e):
                return {}
            raise
        for r in rows:
            out[r["lease_id"]].append(r)
    return out
