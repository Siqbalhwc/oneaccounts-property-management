from fastapi import APIRouter, Depends, Query
from supabase import Client

from app.core.deps import get_supabase

router = APIRouter(prefix="/ledger", tags=["Ledger"])


@router.get("/entries")
def get_ledger_entries(
    source_type: str = Query(..., description="e.g. 'expense', 'salary_payment', 'invoice', 'payment'"),
    source_id: str = Query(...),
    supabase: Client = Depends(get_supabase),
):
    """
    Returns the journal entry (or entries) and their lines behind one
    source record -- e.g. source_type=expense&source_id=<id> shows exactly
    what posted when that expense was logged. Powers a "View ledger" action
    from any list page without needing a dedicated endpoint per table.
    """
    entries = (
        supabase.table("journal_entries")
        .select("*")
        .eq("source_type", source_type)
        .eq("source_id", source_id)
        .execute()
        .data
    )
    entry_ids = [e["id"] for e in entries]
    lines = []
    if entry_ids:
        lines = (
            supabase.table("journal_lines")
            .select("*")
            .in_("journal_entry_id", entry_ids)
            .execute()
            .data
        )
    return {"entries": entries, "lines": lines}
