from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Query
from supabase import Client

from app.core.deps import get_current_company_id, get_supabase
from app.services.ledger import get_account_id

router = APIRouter(prefix="/financials", tags=["Financial Reports"])


def _expense_account_id(supabase: Client, company_id: str, category_id: str) -> str:
    category = (
        supabase.table("expense_categories")
        .select("account_id")
        .eq("id", category_id)
        .single()
        .execute()
        .data
    )
    if category and category.get("account_id"):
        return category["account_id"]
    return get_account_id(supabase, company_id, "5900")


def _apply_expense_split_to_building_pnl(
    supabase: Client,
    company_id: str,
    date_from: date,
    date_to: date,
    building_id_filter: Optional[str],
    rows: list,
) -> list:
    """
    profit_and_loss(group_by='building') groups by each journal LINE's own
    building_id. A company-wide expense split across buildings via
    cost_allocations (see expenses.py's "Manage split") posts its journal
    line with building_id = NULL on purpose -- posting it to every
    building directly in the ledger would double-count it there. That's
    correct for the real ledger, but it meant this building-by-building
    REPORT showed those amounts stuck under "Unassigned" instead of split
    across the buildings that actually share the cost.

    This re-distributes those specific amounts across the REPORT ROWS
    ONLY -- it never touches journal_lines, trial_balance, or the balance
    sheet, so the ledger itself stays exactly as accurate as it already
    was. Only expenses with building_id IS NULL AND at least one
    cost_allocations row are touched; a genuinely company-wide expense
    that was never split still shows under "Unassigned", same as before.
    """
    expenses = (
        supabase.table("expenses")
        .select("id, amount, category_id")
        .eq("company_id", company_id)
        .is_("building_id", "null")
        .gte("expense_date", str(date_from))
        .lte("expense_date", str(date_to))
        .execute()
        .data
    )
    if not expenses:
        return rows

    expense_ids = [e["id"] for e in expenses]
    allocations = (
        supabase.table("cost_allocations")
        .select("source_id, building_id, allocation_type, value")
        .eq("company_id", company_id)
        .eq("source_type", "expense")
        .in_("source_id", expense_ids)
        .execute()
        .data
    )
    if not allocations:
        return rows
    if building_id_filter:
        allocations = [a for a in allocations if a["building_id"] == building_id_filter]
        if not allocations:
            return rows

    expenses_by_id = {e["id"]: e for e in expenses}
    account_cache: dict = {}

    def account_for(category_id: str) -> str:
        if category_id not in account_cache:
            account_cache[category_id] = _expense_account_id(supabase, company_id, category_id)
        return account_cache[category_id]

    per_building: dict = {}  # {(building_id, account_id): amount}
    reclaimed: dict = {}  # {account_id: amount} -- pulled back out of "Unassigned"

    for alloc in allocations:
        expense = expenses_by_id.get(alloc["source_id"])
        if not expense:
            continue
        base_amount = float(expense["amount"])
        if base_amount == 0:
            continue
        allocated = (
            base_amount * (float(alloc["value"]) / 100)
            if alloc["allocation_type"] == "percentage"
            else min(float(alloc["value"]), base_amount)
        )
        if allocated == 0:
            continue
        account_id = account_for(expense["category_id"])
        key = (alloc["building_id"], account_id)
        per_building[key] = per_building.get(key, 0.0) + allocated
        reclaimed[account_id] = reclaimed.get(account_id, 0.0) + allocated

    if not per_building:
        return rows

    building_ids = {b for b, _ in per_building.keys()}
    buildings = supabase.table("buildings").select("id, name").in_("id", list(building_ids)).execute().data
    building_names = {b["id"]: b["name"] for b in buildings}

    # Reuse account labelling the SQL function already returned wherever
    # possible, so this matches its formatting exactly; fetch any gaps
    # (an account that only ever appeared in the "Unassigned" row so far).
    account_details: dict = {}
    for r in rows:
        if r.get("account_id") and r["account_id"] not in account_details:
            account_details[r["account_id"]] = {"code": r["account_code"], "name": r["account_name"], "account_type": r["account_type"]}
    missing_ids = [aid for aid in reclaimed if aid not in account_details]
    if missing_ids:
        fetched = supabase.table("chart_of_accounts").select("id, code, name, account_type").in_("id", missing_ids).execute().data
        for a in fetched:
            account_details[a["id"]] = {"code": a["code"], "name": a["name"], "account_type": a["account_type"]}

    adjusted = []
    for r in rows:
        if r.get("group_key") == "unassigned" and r.get("account_id") in reclaimed:
            new_amount = float(r["amount"]) - reclaimed[r["account_id"]]
            if abs(new_amount) < 0.01:
                continue  # fully reclaimed by the split -- drop the now-empty row
            adjusted.append({**r, "amount": new_amount})
        else:
            adjusted.append(r)

    for (b_id, account_id), amount in per_building.items():
        details = account_details.get(account_id)
        if not details:
            continue
        existing = next((r for r in adjusted if r.get("group_key") == b_id and r.get("account_id") == account_id), None)
        if existing:
            existing["amount"] = float(existing["amount"]) + amount
        else:
            adjusted.append(
                {
                    "group_key": b_id,
                    "group_label": building_names.get(b_id, "Unknown building"),
                    "account_id": account_id,
                    "account_code": details["code"],
                    "account_name": details["name"],
                    "account_type": details["account_type"],
                    "amount": amount,
                }
            )

    return adjusted


@router.get("/journal")
def list_journal_entries(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    building_id: Optional[str] = Query(None),
    room_id: Optional[str] = Query(None),
    owner_id: Optional[str] = Query(None),
    tenant_id: Optional[str] = Query(None),
    lease_id: Optional[str] = Query(None),
    source_type: Optional[str] = Query(None),
    account_id: Optional[str] = Query(None),
    limit: int = Query(200, le=1000),
    offset: int = Query(0, ge=0),
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    """
    Journal entries (one row per LINE, already joined with account/building/
    room/owner/tenant names) -- reads directly from v_journal_detail, all
    the joining/naming done in SQL, not looped in Python. Every dimension
    is filterable but none are meant to be displayed as columns in the UI --
    tags stay in the background, used for filtering only.
    """
    query = supabase.table("v_journal_detail").select("*").eq("company_id", company_id)
    if date_from:
        query = query.gte("entry_date", str(date_from))
    if date_to:
        query = query.lte("entry_date", str(date_to))
    if building_id:
        query = query.eq("building_id", building_id)
    if room_id:
        query = query.eq("room_id", room_id)
    if owner_id:
        query = query.eq("owner_id", owner_id)
    if tenant_id:
        query = query.eq("tenant_id", tenant_id)
    if lease_id:
        query = query.eq("lease_id", lease_id)
    if source_type:
        query = query.eq("source_type", source_type)
    if account_id:
        query = query.eq("account_id", account_id)
    result = (
        query.order("entry_date", desc=True)
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
    )
    return result.data


@router.get("/trial-balance")
def get_trial_balance(
    as_of_date: date = Query(default_factory=date.today),
    building_id: Optional[str] = Query(None),
    supabase: Client = Depends(get_supabase),
):
    """Wraps the trial_balance() SQL function -- the summing happens in Postgres."""
    result = supabase.rpc(
        "trial_balance",
        {"p_as_of_date": str(as_of_date), "p_building_id": building_id},
    ).execute()
    return result.data


@router.get("/general-ledger/{account_id}")
def get_general_ledger(
    account_id: str,
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    owner_id: Optional[str] = Query(None),
    tenant_id: Optional[str] = Query(None),
    supabase: Client = Depends(get_supabase),
):
    """Wraps the general_ledger() SQL function -- the running balance is a
    SQL window function, not accumulated in a Python loop."""
    result = supabase.rpc(
        "general_ledger",
        {
            "p_account_id": account_id,
            "p_date_from": str(date_from) if date_from else None,
            "p_date_to": str(date_to) if date_to else None,
            "p_owner_id": owner_id,
            "p_tenant_id": tenant_id,
        },
    ).execute()
    return result.data


@router.get("/profit-and-loss")
def get_profit_and_loss(
    date_from: date = Query(...),
    date_to: date = Query(...),
    group_by: str = Query("total", pattern="^(total|building|room|owner)$"),
    building_id: Optional[str] = Query(None),
    room_id: Optional[str] = Query(None),
    owner_id: Optional[str] = Query(None),
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    """
    Wraps the profit_and_loss() SQL function -- returns one row per
    (group, account). Call with group_by='building' for the building-level
    breakdown; to drill further into one building's rooms, call again with
    group_by='room' AND building_id set to that building -- genuinely
    hierarchical, one level at a time.
    """
    result = supabase.rpc(
        "profit_and_loss",
        {
            "p_date_from": str(date_from),
            "p_date_to": str(date_to),
            "p_group_by": group_by,
            "p_building_id": building_id,
            "p_room_id": room_id,
            "p_owner_id": owner_id,
        },
    ).execute()
    rows = result.data
    if group_by == "building":
        rows = _apply_expense_split_to_building_pnl(supabase, company_id, date_from, date_to, building_id, rows)
    return rows


@router.get("/balance-sheet")
def get_balance_sheet(
    as_of_date: date = Query(default_factory=date.today),
    building_id: Optional[str] = Query(None),
    supabase: Client = Depends(get_supabase),
):
    """Wraps the balance_sheet() SQL function. Retained Earnings is a
    COMPUTED figure (income minus expense to date), not a posted entry --
    see patch_014's comment for why."""
    result = supabase.rpc(
        "balance_sheet",
        {"p_as_of_date": str(as_of_date), "p_building_id": building_id},
    ).execute()
    return result.data
