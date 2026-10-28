"""
Shared invoice math, used by BOTH:
  - invoices.py's monthly generation (creating a brand new invoice)
  - leases.py's charge add/edit/end endpoints (patching an invoice that's
    still a draft, i.e. no payment has been recorded against it yet)

Pulling this into one place means both paths always prorate and total a
month's charges the exact same way -- there's no risk of the "add a
charge" path drifting out of sync with what monthly generation would have
produced anyway.
"""
from datetime import date, timedelta
from typing import Optional

from supabase import Client

from app.core.labels import get_unit
from app.services.ledger import get_account_for_charge_label, get_account_id, post_journal_entry, reverse_journal_entry
from app.services.utility_bills import apply_utility_overrides, fetch_bills

# An invoice can be recalculated only while nobody has paid against it:
# draft = not sent yet, sent = sent to the tenant (e.g. on WhatsApp).
EDITABLE_INVOICE_STATUSES = ("draft", "sent")


def current_charges_with_earliest_start(supabase: Client, lease_id: str) -> list[dict]:
    """
    The single rule for "editing a charge replaces it" -- whether that's
    the amount, the print-on-PDF setting, or anything else about it, and
    however many times it's been edited: ONE row per label, using
    whatever is CURRENTLY ACTIVE for it (its latest amount, recurrence,
    show_on_invoice), applied for the WHOLE time that label has been part
    of the lease -- not just from the moment of the latest edit onward.

    Concretely: effective_from is pulled back to the EARLIEST date that
    label has ever been active on this lease, using its most recent
    values otherwise. A charge with no editing history just uses its own
    actual date, so a facility added mid-lease is still correctly
    prorated for only the days it's actually applied -- this only changes
    how an EDIT to an existing charge is treated, not a genuinely new
    addition.

    A charge that's been ended entirely (no currently-open version left)
    is simply not included -- it no longer applies, full stop.

    This never touches an already-generated invoice -- it only changes
    what a FRESH generation, or a manual recalculation of the current
    month, computes from this point forward.
    """
    all_charges = supabase.table("lease_charges").select("*").eq("lease_id", lease_id).execute().data
    return merge_current_charges(all_charges)


def merge_current_charges(all_charges: list[dict]) -> list[dict]:
    """Pure half of current_charges_with_earliest_start (no DB access), so
    the bulk invoice generator can apply the exact same rule to charges it
    already fetched for many leases at once."""
    active_by_label: dict = {}
    earliest_by_label: dict = {}
    for c in all_charges:
        label = c["label"]
        ef = str(c["effective_from"])
        if label not in earliest_by_label or ef < earliest_by_label[label]:
            earliest_by_label[label] = ef
        if c.get("effective_to") is None:
            active_by_label[label] = c

    result = []
    for label, charge in active_by_label.items():
        merged = dict(charge)
        merged["effective_from"] = earliest_by_label[label]
        result.append(merged)
    return result


def compute_prorated_charges(
    charges: list[dict],
    lease_start: date,
    lease_end: date,
    invoice_month: date,
    is_first_invoice: bool,
) -> list[dict]:
    """
    Given a lease's charge rows (each with label/amount/recurrence, and
    optionally show_on_invoice/id) plus the lease's own start/end dates,
    works out what should actually be billed for invoice_month --
    prorating any charge that doesn't cover the full month, and (after the
    first invoice) dropping one_time charges since those only ever bill
    once, at signing.

    Returns a list of dicts: {label, amount, show_on_invoice} -- one per
    distinct charge label, ready to become invoice_line_items rows. Same
    labels are merged into a single summed line (see grouping note below).
    """
    next_month = (
        date(invoice_month.year + 1, 1, 1)
        if invoice_month.month == 12
        else date(invoice_month.year, invoice_month.month + 1, 1)
    )
    month_last_day = next_month - timedelta(days=1)
    overlap_start = max(lease_start, invoice_month)
    overlap_end = min(lease_end, month_last_day)
    if overlap_end < overlap_start:
        return []

    days_in_month = (next_month - invoice_month).days
    days_active = (overlap_end - overlap_start).days + 1
    is_full_month = days_active >= days_in_month
    factor = days_active / days_in_month

    active_charges = charges if is_first_invoice else [c for c in charges if c.get("recurrence", "recurring") != "one_time"]

    result = []
    for c in active_charges:
        # A charge that started or ended partway through this same month
        # (e.g. parking added on the 20th) gets its OWN, narrower overlap
        # window layered on top of the lease-wide one, so it's only billed
        # for the days it was actually in effect.
        charge_start = date.fromisoformat(str(c["effective_from"])) if c.get("effective_from") else lease_start
        charge_end = date.fromisoformat(str(c["effective_to"])) if c.get("effective_to") else lease_end
        c_overlap_start = max(overlap_start, charge_start)
        c_overlap_end = min(overlap_end, charge_end)
        if c_overlap_end < c_overlap_start:
            continue  # this charge wasn't in effect at all during the billed period

        amount = float(c["amount"])
        if c.get("recurrence", "recurring") == "one_time" or (is_full_month and c_overlap_start == overlap_start and c_overlap_end == overlap_end):
            final_amount = amount
        else:
            c_days_active = (c_overlap_end - c_overlap_start).days + 1
            final_amount = round(amount * (c_days_active / days_in_month), 2)

        result.append({
            "charge_id": c.get("id"),
            "label": c["label"],
            "amount": final_amount,
            "show_on_invoice": c.get("show_on_invoice", True),
            "effective_from": str(c["effective_from"]) if c.get("effective_from") else None,
        })

    # Group same-label entries into ONE invoice line, summing their
    # amounts. Without this, editing an amount mid-month (which closes
    # the old charge row and opens a new one, both dated within the same
    # month) produces two separate rows with the same label -- correct in
    # total, but confusing to read as "Internet" appearing twice.
    #
    # For show_on_invoice specifically: use whichever segment started
    # MOST RECENTLY, not "show it if ANY segment wanted it shown". A
    # charge edited mid-month to turn printing off should actually turn
    # off -- an earlier segment from before the edit still being checked
    # shouldn't keep overriding that back to visible forever.
    grouped: dict[str, dict] = {}
    for r in result:
        if r["label"] not in grouped:
            grouped[r["label"]] = {"label": r["label"], "amount": 0.0, "show_on_invoice": r["show_on_invoice"], "_latest_effective_from": r["effective_from"]}
        grouped[r["label"]]["amount"] += r["amount"]
        if (r["effective_from"] or "") >= (grouped[r["label"]]["_latest_effective_from"] or ""):
            grouped[r["label"]]["show_on_invoice"] = r["show_on_invoice"]
            grouped[r["label"]]["_latest_effective_from"] = r["effective_from"]
    for label, g in grouped.items():
        g["amount"] = round(g["amount"], 2)
        g.pop("_latest_effective_from", None)
    return list(grouped.values())


def post_invoice_journal(supabase: Client, company_id: str, invoice: dict, lease: dict, prorated_charges: list[dict], entry_date: date):
    """Posts (or re-posts, after a resync) the Dr A/R / Cr income-accounts
    journal entry for one invoice, tagged with building/room/owner/tenant/
    lease exactly like every other journal entry in this system."""
    total = sum(c["amount"] for c in prorated_charges)
    ar_account_id = get_account_id(supabase, company_id, "1100")

    room = supabase.table("rooms").select("id, room_number, building_id, owner_id").eq("id", lease["room_id"]).single().execute().data
    building_id = room["building_id"] if room else None
    room_owner_id = resolve_room_owner_safe(supabase, lease["room_id"])
    tenant = supabase.table("tenants").select("full_name").eq("id", lease["tenant_id"]).single().execute().data
    tenant_name = tenant["full_name"] if tenant else "Tenant"
    room_label = room.get("room_number", "room") if room else "room"
    invoice_month = date.fromisoformat(str(invoice["invoice_month"]))

    credit_by_account: dict[str, dict] = {}
    for c in prorated_charges:
        account = get_account_for_charge_label(supabase, company_id, c["label"])
        acct_id = account["id"]
        if acct_id not in credit_by_account:
            credit_by_account[acct_id] = {"amount": 0.0}
        credit_by_account[acct_id]["amount"] += float(c["amount"])

    journal_lines = [
        {
            "account_id": ar_account_id, "direction": "debit", "amount": total,
            "building_id": building_id, "room_id": lease["room_id"], "owner_id": room_owner_id,
            "tenant_id": lease["tenant_id"], "lease_id": lease["id"],
        }
    ]
    for acct_id, info in credit_by_account.items():
        journal_lines.append(
            {
                "account_id": acct_id, "direction": "credit", "amount": info["amount"],
                "building_id": building_id, "room_id": lease["room_id"],
                "owner_id": room_owner_id,
                "tenant_id": lease["tenant_id"], "lease_id": lease["id"],
            }
        )

    post_journal_entry(
        supabase, company_id=company_id, entry_date=str(entry_date), source_type="invoice",
        source_id=invoice["id"],
        description=f"Rent invoice — {tenant_name}, {get_unit(supabase, company_id)['singular']} {room_label} — {invoice_month.strftime('%B %Y')}",
        lines=journal_lines,
    )
    return total


def resolve_room_owner_safe(supabase: Client, room_id: str) -> Optional[str]:
    from app.services.ledger import resolve_room_owner
    return resolve_room_owner(supabase, room_id)


def _recalculate_invoice(
    supabase: Client,
    company_id: str,
    lease: dict,
    invoice: dict,
    month_start: date,
    entry_date: date,
    reason: str,
    date_from_original: bool = False,
) -> dict:
    """
    The shared recalculation used by BOTH the lease-charge-edit path
    (resync_current_month_invoice) and the utility-bill path
    (resync_invoice_for_month): recompute the invoice from the lease's
    charges as they now stand, apply any uploaded utility bills for that
    month on top, reverse every live journal entry for the invoice, replace
    its line items and post the corrected entry.

    entry_date dates BOTH the reversal and the new entry. The utility path
    passes the invoice's own month so receivable stays in the right period.

    date_from_original=True (used by the charge-edit path) ignores entry_date
    whenever the invoice already has live entries: each old entry is reversed
    on its OWN original date, and the corrected entry is posted on that same
    date. So an October invoice that was posted on 1 October is never
    reversed/re-posted "today" -- receivable as of ANY date stays right.
    entry_date is only the fallback when there is no live entry to copy from.
    """
    charges = current_charges_with_earliest_start(supabase, lease["id"])

    prior_invoices = (
        supabase.table("invoices")
        .select("id")
        .eq("lease_id", lease["id"])
        .lt("invoice_month", str(month_start))
        .execute()
        .data
    )
    is_first_invoice = len(prior_invoices) == 0

    lease_start = date.fromisoformat(str(lease["start_date"]))
    lease_end = date.fromisoformat(str(lease["end_date"]))
    prorated = compute_prorated_charges(charges, lease_start, lease_end, month_start, is_first_invoice)
    if prorated:
        bills = fetch_bills(supabase, [lease["id"]], month_start).get(lease["id"], [])
        if bills:
            prorated = apply_utility_overrides(prorated, bills)

    # Reverse every currently-live ORIGINAL journal entry for this invoice
    # before re-posting. "Original" means an entry that is not itself a
    # reversal (reversal_of is empty): a reversal entry is the equal-and-
    # opposite that already cancels its original, so reversing it again
    # would simply put the cancelled amount back into the ledger (the
    # ledger sums every entry, reversals included). Reversing only the
    # originals gives a clean zero starting point no matter how many times
    # this runs. Entries are never edited in place anywhere in this
    # system, only reversed (see reference doc).
    live_entries = (
        supabase.table("journal_entries")
        .select("id, entry_date")
        .eq("source_type", "invoice")
        .eq("source_id", invoice["id"])
        .eq("status", "posted")
        .is_("reversal_of", "null")
        .execute()
        .data
    )
    repost_date = entry_date
    if date_from_original and live_entries:
        repost_date = min(date.fromisoformat(str(e["entry_date"])) for e in live_entries)
    for entry in live_entries:
        reverse_date = str(entry["entry_date"]) if date_from_original else str(entry_date)
        reverse_journal_entry(supabase, company_id, entry["id"], reason=reason, entry_date=reverse_date)

    supabase.table("invoice_line_items").delete().eq("invoice_id", invoice["id"]).execute()
    if prorated:
        supabase.table("invoice_line_items").insert(
            [
                {
                    "company_id": company_id,
                    "invoice_id": invoice["id"],
                    "label": c["label"],
                    "amount": c["amount"],
                    "show_on_invoice": c["show_on_invoice"],
                }
                for c in prorated
            ]
        ).execute()

    new_total = post_invoice_journal(supabase, company_id, invoice, lease, prorated, entry_date=repost_date) if prorated else 0.0

    updated = (
        supabase.table("invoices")
        .update({"total_amount": new_total})
        .eq("id", invoice["id"])
        .execute()
        .data[0]
    )
    return updated


def resync_current_month_invoice(supabase: Client, company_id: str, lease: dict) -> Optional[dict]:
    """
    Called right after a lease charge is added / ended / amount-changed.
    If this lease already has an invoice for the CURRENT calendar month
    and it's still a draft or sent (i.e. nobody has paid anything against it yet),
    fully recomputes that invoice from the lease's charges as they now
    stand -- deletes and reinserts its line items, reverses its old
    journal entry, and posts a fresh one for the corrected total.

    Deliberately does NOT touch an invoice that already has a payment
    recorded (status 'partial' or 'paid') -- reworking a bill someone has
    already started paying against is a judgement call for a human, not
    something to silently rewrite. In that case this returns None and the
    change only takes effect starting with the next invoice generated.

    Returns the updated invoice dict, or None if there was nothing to
    resync (no current-month invoice yet, or it's not editable anymore).
    """
    today = date.today()
    month_start = today.replace(day=1)

    invoice = (
        supabase.table("invoices")
        .select("*")
        .eq("lease_id", lease["id"])
        .eq("invoice_month", str(month_start))
        .execute()
        .data
    )
    if not invoice:
        return None
    invoice = invoice[0]
    # 'draft' = not yet sent; 'sent' = already sent to the tenant on WhatsApp.
    # Both still have NO payment against them, so both may be recalculated
    # (tenants often ask for a facility change after seeing the invoice).
    # 'partial' / 'paid' have a payment recorded -- don't touch those.
    if invoice["status"] not in EDITABLE_INVOICE_STATUSES:
        return None

    return _recalculate_invoice(
        supabase, company_id, lease, invoice, month_start, today, "Lease charges changed — invoice recalculated",
        date_from_original=True,
    )


def resync_invoice_for_month(supabase: Client, company_id: str, lease: dict, month_start: date) -> Optional[dict]:
    """
    Same recalculation, for ANY month (used after a utility bill upload,
    where the bill is usually for last month). Only a draft or sent invoice
    is touched; returns None when there is no invoice for that month or a
    payment has already been recorded against it.

    The reversal and the corrected entry are both dated the invoice's own
    month, so receivable, the ledger and the reports as-of any date stay
    correct for the period the invoice belongs to.
    """
    invoice = (
        supabase.table("invoices")
        .select("*")
        .eq("lease_id", lease["id"])
        .eq("invoice_month", str(month_start))
        .execute()
        .data
    )
    if not invoice:
        return None
    invoice = invoice[0]
    if invoice["status"] not in EDITABLE_INVOICE_STATUSES:
        return None
    return _recalculate_invoice(
        supabase, company_id, lease, invoice, month_start, month_start, "Utility bill updated — invoice recalculated"
    )
