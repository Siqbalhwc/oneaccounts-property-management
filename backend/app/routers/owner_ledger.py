from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from supabase import Client

from app.core.deps import get_current_company_id, get_supabase
from app.services.ledger import get_account_id, post_journal_entry

router = APIRouter(prefix="/owner-ledger", tags=["Owner Ledger"])


class ComputeRequest(BaseModel):
    building_id: str
    month: date  # any date within the target month


class PayRequest(BaseModel):
    amount_paid: float
    paid_date: Optional[date] = None


@router.get("")
def list_ledger(supabase: Client = Depends(get_supabase)):
    return supabase.table("owner_ledger").select("*").order("ledger_month", desc=True).execute().data


@router.post("/compute", status_code=201)
def compute_ledger(
    payload: ComputeRequest,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    """
    Computes (or recomputes) a building's owner ledger for a given month.

    IMPORTANT: since rooms can now override their building's default owner
    (a building isn't guaranteed to have exactly one owner), this returns a
    LIST of rows -- one per owner who has rent activity in this building
    this month, plus always the building's own default owner (since
    building-wide expenses/salary allocation are attributed to them even in
    a month where their rooms happened to collect nothing).

    Rent collected is read from journal_lines (only the Rent Income
    account, tagged per-owner) rather than summing whole invoice totals --
    that's what makes it correct when a single invoice mixes rent with
    other non-owner charges like electricity recovery.
    """
    ledger_month = payload.month.replace(day=1)
    next_month = (
        date(ledger_month.year + 1, 1, 1)
        if ledger_month.month == 12
        else date(ledger_month.year, ledger_month.month + 1, 1)
    )

    room_ids = [
        r["id"]
        for r in supabase.table("rooms")
        .select("id")
        .eq("building_id", payload.building_id)
        .execute()
        .data
    ]
    lease_ids = [
        l["id"]
        for l in supabase.table("leases")
        .select("id")
        .in_("room_id", room_ids)
        .execute()
        .data
    ] if room_ids else []

    # --- Rent collected, split by owner, via the actual ledger -------------
    collected_by_owner: dict[str, float] = {}
    if lease_ids:
        paid_invoices = (
            supabase.table("invoices")
            .select("id")
            .in_("lease_id", lease_ids)
            .gte("invoice_month", str(ledger_month))
            .lt("invoice_month", str(next_month))
            .in_("status", ["paid", "partial"])
            .execute()
            .data
        )
        invoice_ids = [i["id"] for i in paid_invoices]

        if invoice_ids:
            # Rent (and anything else tagged owner-transferring) now credits
            # the Due to Owners LIABILITY directly at invoice time -- it was
            # never the company's own income. This account's own credits
            # ARE the owner's payable ledger now, so this query just reads
            # straight off it rather than an income account.
            owner_liability_account_id = get_account_id(supabase, company_id, "2200")
            entries = (
                supabase.table("journal_entries")
                .select("id")
                .eq("source_type", "invoice")
                .in_("source_id", invoice_ids)
                .execute()
                .data
            )
            entry_ids = [e["id"] for e in entries]
            if entry_ids:
                rent_lines = (
                    supabase.table("journal_lines")
                    .select("amount, owner_id")
                    .in_("journal_entry_id", entry_ids)
                    .eq("account_id", owner_liability_account_id)
                    .execute()
                    .data
                )
                for line in rent_lines:
                    if line.get("owner_id"):
                        collected_by_owner[line["owner_id"]] = (
                            collected_by_owner.get(line["owner_id"], 0.0) + float(line["amount"])
                        )

    # --- Building-wide expenses + allocated salary, attributed to the ------
    # --- building's own default owner (expenses aren't recorded per-room) --
    building = supabase.table("buildings").select("owner_id").eq("id", payload.building_id).single().execute().data
    building_owner_id = building.get("owner_id") if building else None

    expenses = (
        supabase.table("expenses")
        .select("amount")
        .eq("building_id", payload.building_id)
        .gte("expense_date", str(ledger_month))
        .lt("expense_date", str(next_month))
        .execute()
        .data
    )
    total_expenses = sum(float(e["amount"]) for e in expenses)

    allocations = (
        supabase.table("cost_allocations")
        .select("source_type, source_id, allocation_type, value")
        .eq("building_id", payload.building_id)
        .execute()
        .data
    )
    allocated_cost = 0.0
    for alloc in allocations:
        if alloc["source_type"] == "staff":
            payments_this_month = (
                supabase.table("salary_payments")
                .select("amount_paid")
                .eq("staff_id", alloc["source_id"])
                .gte("salary_month", str(ledger_month))
                .lt("salary_month", str(next_month))
                .execute()
                .data
            )
            base_amount = sum(float(p["amount_paid"]) for p in payments_this_month)
        else:  # 'expense' -- a recurring expense being split across buildings
            base_amount = float(
                (supabase.table("expenses").select("amount").eq("id", alloc["source_id"]).single().execute().data or {}).get("amount", 0)
            )
        if base_amount == 0:
            continue
        if alloc["allocation_type"] == "percentage":
            allocated_cost += base_amount * (float(alloc["value"]) / 100)
        else:  # fixed
            allocated_cost += min(float(alloc["value"]), base_amount)
    total_expenses += allocated_cost

    # Every owner who collected rent this month gets a row; the building's
    # own default owner always gets a row too (even at 0 collected) since
    # they're the one wearing the building's expenses/salary allocation.
    owner_ids = set(collected_by_owner.keys())
    if building_owner_id:
        owner_ids.add(building_owner_id)

    results = []
    for owner_id in owner_ids:
        owner_collected = collected_by_owner.get(owner_id, 0.0)
        owner_expenses = total_expenses if owner_id == building_owner_id else 0.0
        amount_payable = owner_collected - owner_expenses

        existing = (
            supabase.table("owner_ledger")
            .select("id")
            .eq("owner_id", owner_id)
            .eq("building_id", payload.building_id)
            .eq("ledger_month", str(ledger_month))
            .execute()
            .data
        )

        row = {
            "company_id": company_id,
            "owner_id": owner_id,
            "building_id": payload.building_id,
            "ledger_month": str(ledger_month),
            "total_collected": owner_collected,
            "total_expenses": owner_expenses,
            "amount_payable": amount_payable,
        }

        if existing:
            result = supabase.table("owner_ledger").update(row).eq("id", existing[0]["id"]).execute()
        else:
            result = supabase.table("owner_ledger").insert(row).execute()
        results.append(result.data[0])

    return results


@router.post("/{ledger_id}/pay")
def pay_owner(
    ledger_id: str,
    payload: PayRequest,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    ledger = supabase.table("owner_ledger").select("*").eq("id", ledger_id).single().execute()
    if not ledger.data:
        raise HTTPException(status_code=404, detail="Ledger entry not found")

    status = "paid" if payload.amount_paid >= float(ledger.data["amount_payable"]) else "partial"
    paid_date = payload.paid_date or date.today()
    result = (
        supabase.table("owner_ledger")
        .update(
            {
                "amount_paid": payload.amount_paid,
                "paid_date": str(paid_date),
                "status": status,
            }
        )
        .eq("id", ledger_id)
        .execute()
    )

    # Dr Due to Owners / Cr Bank -- the actual cash leaving for this payout.
    due_to_owners_id = get_account_id(supabase, company_id, "2200")
    bank_id = get_account_id(supabase, company_id, "1000")
    post_journal_entry(
        supabase,
        company_id=company_id,
        entry_date=str(paid_date),
        source_type="owner_payout",
        source_id=ledger_id,
        description=f"Owner payout - {ledger.data['ledger_month']}",
        lines=[
            {
                "account_id": due_to_owners_id,
                "direction": "debit",
                "amount": payload.amount_paid,
                "building_id": ledger.data["building_id"],
                "owner_id": ledger.data.get("owner_id"),
            },
            {
                "account_id": bank_id,
                "direction": "credit",
                "amount": payload.amount_paid,
                "building_id": ledger.data["building_id"],
                "owner_id": ledger.data.get("owner_id"),
            },
        ],
    )

    return result.data[0]
