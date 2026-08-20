from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from supabase import Client

from app.core.deps import get_current_company_id, get_current_user, get_supabase
from app.crud.generic import write_audit_log
from app.services.ledger import get_account_id, post_journal_entry

router = APIRouter(prefix="/expenses", tags=["Expenses"])


class AllocationEntry(BaseModel):
    building_id: str
    allocation_type: str  # 'percentage' | 'fixed'
    value: float


class SetAllocationsRequest(BaseModel):
    allocations: list[AllocationEntry]


class ExpenseCreate(BaseModel):
    building_id: Optional[str] = None  # null = company-wide (e.g. shared across sites via allocation)
    category_id: str
    vendor_name: Optional[str] = None
    amount: float
    expense_date: date
    description: Optional[str] = None
    receipt_url: Optional[str] = None
    recurrence: str = "one_time"  # 'one_time' | 'monthly'


class ExpenseEdit(BaseModel):
    vendor_name: Optional[str] = None
    amount: Optional[float] = None
    expense_date: Optional[date] = None
    description: Optional[str] = None
    receipt_url: Optional[str] = None


class GenerateRecurringRequest(BaseModel):
    month: date  # any date within the target month


def _post_expense_journal(supabase: Client, company_id: str, expense: dict):
    """Dr the category's mapped expense account / Cr Bank. Only tagged to a
    building when the expense has one directly -- a company-wide expense
    meant to be split across buildings (via cost_allocations) posts
    untagged here; the split only affects owner_ledger's calculation, not
    a second set of journal lines (that would double-count it)."""
    category = (
        supabase.table("expense_categories")
        .select("account_id")
        .eq("id", expense["category_id"])
        .single()
        .execute()
        .data
    )
    account_id = category["account_id"] if category and category.get("account_id") else get_account_id(supabase, company_id, "5900")
    bank_id = get_account_id(supabase, company_id, "1000")

    fallback_label = "Expense"
    if not expense.get("description"):
        cat_name = supabase.table("expense_categories").select("name").eq("id", expense["category_id"]).single().execute().data
        vendor = f" — {expense['vendor_name']}" if expense.get("vendor_name") else ""
        fallback_label = f"{(cat_name or {}).get('name', 'Expense')}{vendor}"

    post_journal_entry(
        supabase,
        company_id=company_id,
        entry_date=str(expense["expense_date"]),
        source_type="expense",
        source_id=expense["id"],
        description=expense.get("description") or fallback_label,
        lines=[
            {"account_id": account_id, "direction": "debit", "amount": float(expense["amount"]), "building_id": expense.get("building_id")},
            {"account_id": bank_id, "direction": "credit", "amount": float(expense["amount"]), "building_id": expense.get("building_id")},
        ],
    )


@router.get("")
def list_expenses(
    building_id: Optional[str] = Query(None),
    supabase: Client = Depends(get_supabase),
):
    query = supabase.table("expenses").select("*")
    if building_id:
        query = query.eq("building_id", building_id)
    return query.order("expense_date", desc=True).execute().data


@router.get("/allocations/summary")
def list_all_expense_allocations(
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    """All cost_allocations for every expense in one call, so a list page
    can show each shared expense's split without an N+1 request per row."""
    return (
        supabase.table("cost_allocations")
        .select("*")
        .eq("company_id", company_id)
        .eq("source_type", "expense")
        .execute()
        .data
    )


@router.get("/{expense_id}")
def get_expense(expense_id: str, supabase: Client = Depends(get_supabase)):
    res = supabase.table("expenses").select("*").eq("id", expense_id).single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Expense not found")
    return res.data


@router.post("", status_code=201)
def create_expense(
    payload: ExpenseCreate,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
    user: dict = Depends(get_current_user),
):
    if payload.recurrence not in ("one_time", "monthly"):
        raise HTTPException(status_code=400, detail="recurrence must be 'one_time' or 'monthly'")

    row = payload.model_dump()
    row["expense_date"] = str(row["expense_date"])
    row["company_id"] = company_id
    res = supabase.table("expenses").insert(row).execute()
    expense = res.data[0]

    _post_expense_journal(supabase, company_id, expense)
    write_audit_log(supabase, company_id, user["user_id"], "create", "expenses", expense["id"])
    return expense


@router.patch("/{expense_id}")
def edit_expense(
    expense_id: str,
    payload: ExpenseEdit,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
    user: dict = Depends(get_current_user),
):
    """
    Edits an expense's non-structural fields. Deliberately does NOT let you
    change building_id, category_id, or recurrence here -- those affect
    which account/building the original journal entry posted against, and
    editing them after the fact would leave the ledger inconsistent with
    what's on the expense record. Delete/recreate if those need to change.
    """
    before = supabase.table("expenses").select("*").eq("id", expense_id).single().execute()
    if not before.data:
        raise HTTPException(status_code=404, detail="Expense not found")

    updates = {k: (str(v) if isinstance(v, date) else v) for k, v in payload.model_dump(exclude_unset=True).items()}
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    if "amount" in updates:
        raise HTTPException(
            status_code=400,
            detail="Amount can't be edited after the journal entry has posted. Delete and recreate the expense instead.",
        )

    res = supabase.table("expenses").update(updates).eq("id", expense_id).execute()
    after = res.data[0]
    write_audit_log(supabase, company_id, user["user_id"], "update", "expenses", expense_id, before.data, after)
    return after


@router.post("/generate-recurring", status_code=201)
def generate_recurring_expenses(
    payload: GenerateRecurringRequest,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    """
    Mirrors how invoice generation already works: every expense marked
    recurrence='monthly' that is itself a TEMPLATE (recurring_source_id is
    null -- i.e. not already a generated instance) gets a new expense row
    created for the target month, unless one was already generated for that
    template + month. Each new instance posts its own journal entry.
    """
    target_month = payload.month.replace(day=1)
    next_month = (
        date(target_month.year + 1, 1, 1)
        if target_month.month == 12
        else date(target_month.year, target_month.month + 1, 1)
    )

    templates = (
        supabase.table("expenses")
        .select("*")
        .eq("company_id", company_id)
        .eq("recurrence", "monthly")
        .is_("recurring_source_id", "null")
        .execute()
        .data
    )

    created, skipped = [], []
    for template in templates:
        existing = (
            supabase.table("expenses")
            .select("id")
            .eq("recurring_source_id", template["id"])
            .gte("expense_date", str(target_month))
            .lt("expense_date", str(next_month))
            .execute()
            .data
        )
        if existing:
            skipped.append(template["id"])
            continue

        new_row = {
            "company_id": company_id,
            "building_id": template.get("building_id"),
            "category_id": template["category_id"],
            "vendor_name": template.get("vendor_name"),
            "amount": template["amount"],
            "expense_date": str(target_month),
            "description": template.get("description"),
            "recurrence": "monthly",
            "recurring_source_id": template["id"],
        }
        expense = supabase.table("expenses").insert(new_row).execute().data[0]
        _post_expense_journal(supabase, company_id, expense)
        created.append(expense["id"])

    return {"created": created, "skipped_already_generated": skipped}


@router.get("/{expense_id}/allocations")
def get_expense_allocations(expense_id: str, supabase: Client = Depends(get_supabase)):
    """How this expense is split across buildings for owner-ledger purposes
    (e.g. a shared generator fuel bill split 40/60 between two buildings).
    Only meaningful for an expense NOT already tied to one building directly."""
    return (
        supabase.table("cost_allocations")
        .select("*")
        .eq("source_type", "expense")
        .eq("source_id", expense_id)
        .execute()
        .data
    )


@router.put("/{expense_id}/allocations")
def set_expense_allocations(
    expense_id: str,
    payload: SetAllocationsRequest,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    """
    Replaces the full allocation split for this expense -- deletes whatever
    was set before and inserts the new list, same as how the existing
    staff allocation endpoint works. Does NOT re-post any journal entry:
    the expense's own Dr/Cr posting already happened at creation time and
    is untouched by how it's later split for owner-ledger reporting.
    """
    expense = supabase.table("expenses").select("id").eq("id", expense_id).single().execute()
    if not expense.data:
        raise HTTPException(status_code=404, detail="Expense not found")

    percentage_rows = [a for a in payload.allocations if a.allocation_type == "percentage"]
    if percentage_rows and len(percentage_rows) == len(payload.allocations):
        # Only enforced when EVERY row is percentage-based -- a mix of
        # percentage and fixed-amount rows doesn't have one obvious "100%"
        # to check against, so that combination is left unvalidated for now.
        total_pct = sum(a.value for a in percentage_rows)
        if abs(total_pct - 100) > 0.01:
            raise HTTPException(
                status_code=400,
                detail=f"Percentage split must add up to 100% (currently {total_pct}%) so the full expense is accounted for.",
            )

    supabase.table("cost_allocations").delete().eq("source_type", "expense").eq("source_id", expense_id).execute()

    if payload.allocations:
        rows = [
            {
                "company_id": company_id,
                "source_type": "expense",
                "source_id": expense_id,
                "building_id": a.building_id,
                "allocation_type": a.allocation_type,
                "value": a.value,
            }
            for a in payload.allocations
        ]
        supabase.table("cost_allocations").insert(rows).execute()

    return get_expense_allocations(expense_id, supabase)
