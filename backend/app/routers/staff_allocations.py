from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from supabase import Client

from app.core.deps import get_current_company_id, get_supabase

router = APIRouter(prefix="/staff", tags=["Staff Allocations"])


class AllocationEntry(BaseModel):
    building_id: str
    allocation_type: str  # 'percentage' | 'fixed'
    value: float


class SetAllocationsRequest(BaseModel):
    allocations: list[AllocationEntry]


@router.get("/{staff_id}/allocations")
def get_staff_allocations(staff_id: str, supabase: Client = Depends(get_supabase)):
    return (
        supabase.table("cost_allocations")
        .select("*")
        .eq("source_type", "staff")
        .eq("source_id", staff_id)
        .execute()
        .data
    )


@router.put("/{staff_id}/allocations")
def set_staff_allocations(
    staff_id: str,
    payload: SetAllocationsRequest,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    """
    Replaces this staff member's full allocation split. Unlike expense
    splits, a staff allocation is allowed to total LESS than 100% (e.g. a
    manager whose oversight of a 3rd building isn't being cost-allocated
    yet) -- only exceeding 100% is rejected, matching what the existing
    frontend already checks for on its own.
    """
    staff = supabase.table("staff").select("id").eq("id", staff_id).single().execute()
    if not staff.data:
        raise HTTPException(status_code=404, detail="Staff member not found")

    percentage_rows = [a for a in payload.allocations if a.allocation_type == "percentage"]
    if percentage_rows:
        total_pct = sum(a.value for a in percentage_rows)
        if total_pct > 100.01:
            raise HTTPException(status_code=400, detail=f"Percentage split can't exceed 100% (currently {total_pct}%).")

    supabase.table("cost_allocations").delete().eq("source_type", "staff").eq("source_id", staff_id).execute()

    if payload.allocations:
        rows = [
            {
                "company_id": company_id,
                "source_type": "staff",
                "source_id": staff_id,
                "building_id": a.building_id,
                "allocation_type": a.allocation_type,
                "value": a.value,
            }
            for a in payload.allocations
        ]
        supabase.table("cost_allocations").insert(rows).execute()

    return get_staff_allocations(staff_id, supabase)
