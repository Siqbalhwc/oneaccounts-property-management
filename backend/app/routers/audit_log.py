from fastapi import APIRouter, Depends, Query
from supabase import Client

from app.core.deps import get_supabase

router = APIRouter(prefix="/audit-log", tags=["Audit Log"])


@router.get("")
def get_history(
    table_name: str = Query(...),
    record_id: str = Query(...),
    supabase: Client = Depends(get_supabase),
):
    """
    Returns the edit history for one specific record, newest first, with the
    editor's name embedded via the audit_log -> profiles foreign key.
    """
    res = (
        supabase.table("audit_log")
        .select("id, action, details, created_at, profiles(full_name)")
        .eq("table_name", table_name)
        .eq("record_id", record_id)
        .order("created_at", desc=True)
        .execute()
    )
    return res.data
