from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Query
from supabase import Client

from app.core.deps import get_supabase

router = APIRouter(prefix="/reports", tags=["Reports"])


@router.get("/pnl")
def monthly_pnl(
    month: Optional[date] = Query(None, description="Any date within the target month"),
    supabase: Client = Depends(get_supabase),
):
    """
    Monthly profit & loss: income (payments received) minus expenses minus
    staff salaries. Backed by the v_monthly_pnl view (see schema.sql).
    """
    query = supabase.table("v_monthly_pnl").select("*")
    if month:
        target_month = month.replace(day=1)
        query = query.eq("month", str(target_month))
    data = query.execute().data

    for row in data:
        row["total_income"] = float(row["total_income"])
        row["total_expenses"] = float(row["total_expenses"])
        row["total_salaries"] = float(row["total_salaries"])
        row["net_profit"] = row["total_income"] - row["total_expenses"] - row["total_salaries"]
    return data


@router.get("/collection-vs-expense")
def collection_vs_expense(
    building_id: Optional[str] = None,
    month: Optional[date] = None,
    supabase: Client = Depends(get_supabase),
):
    """
    Compares what was billed to tenants (e.g. 'Water Bill' line items) against
    actual expenses logged in the matching category, per building/month.
    Backed by v_collection_vs_expense view (see schema.sql).
    """
    query = supabase.table("v_collection_vs_expense").select("*")
    if building_id:
        query = query.eq("building_id", building_id)
    if month:
        query = query.eq("month", str(month.replace(day=1)))
    billed = query.execute().data

    exp_query = supabase.table("expenses").select(
        "amount, building_id, expense_date, expense_categories(name)"
    )
    if building_id:
        exp_query = exp_query.eq("building_id", building_id)
    actual_expenses = exp_query.execute().data

    return {"billed_to_tenants": billed, "actual_expenses_logged": actual_expenses}
