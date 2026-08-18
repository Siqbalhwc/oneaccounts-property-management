from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Query
from supabase import Client

from app.core.deps import get_current_company_id, get_supabase

router = APIRouter(prefix="/financials", tags=["Financial Reports"])


@router.get("/journal")
def list_journal_entries(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    building_id: Optional[str] = Query(None),
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
    the joining/naming done in SQL, not looped in Python.
    """
    query = supabase.table("v_journal_detail").select("*").eq("company_id", company_id)
    if date_from:
        query = query.gte("entry_date", str(date_from))
    if date_to:
        query = query.lte("entry_date", str(date_to))
    if building_id:
        query = query.eq("building_id", building_id)
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
        },
    ).execute()
    return result.data
