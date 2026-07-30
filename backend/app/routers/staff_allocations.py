from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from supabase import Client

from app.core.deps import get_current_company_id, get_supabase

router = APIRouter(prefix="/staff", tags=["Staff Allocations"])


class AllocationRow(BaseModel):
    building_id: str
    allocation_type: str  # "percentage" or "fixed"
    value: float


class SetAllocationsRequest(BaseModel):
    allocations: List[AllocationRow]


@router.get("/{staff_id}/allocations")
def get_allocations(staff_id: str, supabase: Client = Depends(get_supabase)):
    res = (
        supabase.table("staff_allocations")
        .select("*")
        .eq("staff_id", staff_id)
        .execute()
    )
    return res.data


@router.put("/{staff_id}/allocations")
def set_allocations(
    staff_id: str,
    payload: SetAllocationsRequest,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    """
    Replaces this staff member's entire allocation set in one call (simpler
    and safer than incremental add/remove -- the frontend always sends the
    full desired set).
    """
    types_used = {a.allocation_type for a in payload.allocations}
    if len(types_used) > 1:
        raise HTTPException(
            status_code=400,
            detail="A staff member's allocations must all be the same type (all percentage or all fixed).",
        )
    if "percentage" in types_used:
        total = sum(a.value for a in payload.allocations)
        if round(total, 2) > 100:
            raise HTTPException(
                status_code=400, detail=f"Percentages add up to {total}%, which is over 100%."
            )

    # Replace-all: clear existing rows for this staff member, then insert the new set.
    supabase.table("staff_allocations").delete().eq("staff_id", staff_id).execute()

    if payload.allocations:
        rows = [
            {
                "company_id": company_id,
                "staff_id": staff_id,
                "building_id": a.building_id,
                "allocation_type": a.allocation_type,
                "value": a.value,
            }
            for a in payload.allocations
        ]
        supabase.table("staff_allocations").insert(rows).execute()

    return {"message": "Allocations updated"}
