"""Shared rules for payment claims (used by both the tenant side and the admin approval)."""

from datetime import datetime, timedelta, timezone
from typing import Optional

CLAIMS = "tenant_portal_payment_claims"
MARKER_PREFIX = "portal-claim:"
STALE_AFTER = timedelta(seconds=120)


def marker(claim_id: str) -> str:
    """Written into the receipt's notes so a claim that was posted but not finalised can be recognised."""
    return f"{MARKER_PREFIX}{claim_id}"


def invoice_balances(c, company_id: str, invoice_ids: list[str]) -> tuple[dict, dict]:
    """(invoices_by_id, balance_by_id): what each invoice still owes right now, worked out the same way
    record_receipt does (total less cash and discount already applied). Company-scoped."""
    if not invoice_ids:
        return {}, {}
    invoices = {
        r["id"]: r
        for r in c.table("invoices").select("id, lease_id, invoice_month, total_amount, status").eq("company_id", company_id).in_("id", invoice_ids).execute().data
    }
    settled: dict[str, float] = {}
    for p in c.table("payments").select("invoice_id, amount, discount_amount").eq("company_id", company_id).in_("invoice_id", invoice_ids).execute().data:
        settled[p["invoice_id"]] = settled.get(p["invoice_id"], 0.0) + float(p["amount"]) + float(p.get("discount_amount") or 0)
    balances = {i: round(float(r["total_amount"]) - settled.get(i, 0.0), 2) for i, r in invoices.items()}
    return invoices, balances


def is_stale(updated_at: Optional[str]) -> bool:
    try:
        ts = datetime.fromisoformat(str(updated_at).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return True
    return datetime.now(timezone.utc) - ts > STALE_AFTER
