"""
Centralized double-entry journal posting.

Every money-moving endpoint (invoices, payments, expenses, owner payouts,
salary payments, deposits) calls into this instead of writing to
journal_entries/journal_lines directly, so the "debits must equal credits"
invariant and the dimension-tagging rules (building/room/owner/tenant) live
in exactly one place -- not copy-pasted into five routers where they could
drift out of sync with each other.
"""

from typing import Optional, TypedDict
from supabase import Client


class UnbalancedJournalEntry(Exception):
    """Raised when a caller tries to post an entry where debits != credits.
    This is a hard stop, not a warning -- an unbalanced entry means either
    this code has a bug or bad data got in, and letting it through would
    silently corrupt every report built on top of the ledger."""
    pass


class JournalLine(TypedDict, total=False):
    account_id: str
    direction: str  # "debit" | "credit"
    amount: float
    building_id: Optional[str]
    room_id: Optional[str]
    owner_id: Optional[str]
    tenant_id: Optional[str]
    lease_id: Optional[str]


def get_account_id(supabase: Client, company_id: str, code: str) -> str:
    """Looks up a system account by its fixed code (e.g. '1000' for Bank)."""
    res = (
        supabase.table("chart_of_accounts")
        .select("id")
        .eq("company_id", company_id)
        .eq("code", code)
        .single()
        .execute()
    )
    if not res.data:
        raise ValueError(
            f"Chart of accounts is missing required system account '{code}' "
            f"for this company. Was schema_patch_009 run?"
        )
    return res.data["id"]


def get_account_for_charge_label(supabase: Client, company_id: str, label: str) -> dict:
    """
    Returns {id, transfers_to_owner} for the account a lease-charge label
    should post to. Falls back to 'Other Income' (4100, company-retained)
    for any label nobody's explicitly mapped yet -- an unmapped label just
    means it hasn't been configured, not that the invoice should fail.
    """
    mapping = (
        supabase.table("charge_type_accounts")
        .select("account_id")
        .eq("company_id", company_id)
        .eq("label", label)
        .execute()
        .data
    )
    account_id = mapping[0]["account_id"] if mapping else get_account_id(supabase, company_id, "4100")

    account = (
        supabase.table("chart_of_accounts")
        .select("id, transfers_to_owner")
        .eq("id", account_id)
        .single()
        .execute()
        .data
    )
    return account


def get_tenant_account_balance(
    supabase: Client,
    account_id: str,
    tenant_id: str,
    as_of_date: str,
) -> float:
    """
    A tenant's running balance in one account (e.g. Accounts Receivable) as
    of a given date, inclusive of that date. Wraps the same general_ledger()
    SQL function the General Ledger page/report already calls, so "balance
    as of a date" is computed exactly one way everywhere in this system --
    never a second, slightly-different version living here.

    Returns 0.0 if there's no activity for this tenant on this account up
    to that date (a brand-new tenant, or a genuinely zero balance) rather
    than raising -- an empty ledger is a valid, common case, not an error.
    """
    rows = (
        supabase.rpc(
            "general_ledger",
            {
                "p_account_id": account_id,
                "p_date_from": None,
                "p_date_to": as_of_date,
                "p_owner_id": None,
                "p_tenant_id": tenant_id,
            },
        )
        .execute()
        .data
    )
    if not rows:
        return 0.0
    return float(rows[-1]["running_balance"])


def resolve_room_owner(supabase: Client, room_id: str) -> Optional[str]:
    """Effective owner_id for a room: its own owner_id if set, else its building's."""
    room = (
        supabase.table("rooms")
        .select("owner_id, building_id")
        .eq("id", room_id)
        .single()
        .execute()
        .data
    )
    if not room:
        return None
    if room.get("owner_id"):
        return room["owner_id"]
    building = (
        supabase.table("buildings")
        .select("owner_id")
        .eq("id", room["building_id"])
        .single()
        .execute()
        .data
    )
    return building.get("owner_id") if building else None


def post_journal_entry(
    supabase: Client,
    company_id: str,
    entry_date: str,
    source_type: str,
    source_id: Optional[str],
    description: Optional[str],
    lines: list[JournalLine],
    created_by: Optional[str] = None,
) -> dict:
    """
    Writes one journal_entries row plus its journal_lines, after checking
    the entry actually balances. Raises UnbalancedJournalEntry rather than
    posting a broken entry.
    """
    total_debits = round(sum(l["amount"] for l in lines if l["direction"] == "debit"), 2)
    total_credits = round(sum(l["amount"] for l in lines if l["direction"] == "credit"), 2)
    if total_debits != total_credits:
        raise UnbalancedJournalEntry(
            f"{source_type} (source_id={source_id}) does not balance: "
            f"debits={total_debits} credits={total_credits}"
        )
    if total_debits == 0:
        raise UnbalancedJournalEntry(f"{source_type} (source_id={source_id}) has zero amount -- nothing to post")

    entry = (
        supabase.table("journal_entries")
        .insert(
            {
                "company_id": company_id,
                "entry_date": entry_date,
                "source_type": source_type,
                "source_id": source_id,
                "description": description,
                "created_by": created_by,
            }
        )
        .execute()
        .data[0]
    )

    line_rows = [
        {
            "company_id": company_id,
            "journal_entry_id": entry["id"],
            "account_id": l["account_id"],
            "direction": l["direction"],
            "amount": l["amount"],
            "building_id": l.get("building_id"),
            "room_id": l.get("room_id"),
            "owner_id": l.get("owner_id"),
            "tenant_id": l.get("tenant_id"),
            "lease_id": l.get("lease_id"),
        }
        for l in lines
    ]
    supabase.table("journal_lines").insert(line_rows).execute()

    return entry


def reverse_journal_entry(supabase: Client, company_id: str, entry_id: str, reason: Optional[str] = None) -> dict:
    """
    Posts an equal-and-opposite entry to cancel a mistaken one, rather than
    editing or deleting the original -- posted entries are never touched
    once written, only reversed. Marks both entries' status so the reversed
    one is excluded from reports going forward while the audit trail (who
    posted what, when) stays fully intact.

    The reversal's description is deliberately just "Reversal - <original
    description>", matching the format of every other entry -- WHY it was
    reversed (the `reason` argument) is stored in its own `reason` column
    instead of being appended to the description text. Previously `reason`
    was concatenated straight onto the description, which is why reversals
    used to read like a run-on sentence of tags and edit details instead of
    a clean one-liner.
    """
    original = supabase.table("journal_entries").select("*").eq("id", entry_id).single().execute()
    if not original.data:
        raise ValueError(f"Journal entry {entry_id} not found")
    if original.data["status"] == "reversed":
        raise ValueError(f"Journal entry {entry_id} was already reversed")

    original_lines = supabase.table("journal_lines").select("*").eq("journal_entry_id", entry_id).execute().data

    flipped_lines: list[JournalLine] = [
        {
            "account_id": l["account_id"],
            "direction": "credit" if l["direction"] == "debit" else "debit",
            "amount": float(l["amount"]),
            "building_id": l.get("building_id"),
            "room_id": l.get("room_id"),
            "owner_id": l.get("owner_id"),
            "tenant_id": l.get("tenant_id"),
            "lease_id": l.get("lease_id"),
        }
        for l in original_lines
    ]

    from datetime import date as _date

    original_description = original.data.get("description") or entry_id

    reversal = post_journal_entry(
        supabase,
        company_id=company_id,
        entry_date=str(_date.today()),
        source_type=original.data["source_type"],
        source_id=original.data["source_id"],
        description=f"Reversal - {original_description}",
        lines=flipped_lines,
    )

    reversal_updates = {"reversal_of": entry_id}
    if reason:
        reversal_updates["reason"] = reason
    supabase.table("journal_entries").update(reversal_updates).eq("id", reversal["id"]).execute()
    supabase.table("journal_entries").update({"status": "reversed", "reversed_by": reversal["id"]}).eq("id", entry_id).execute()

    return reversal
