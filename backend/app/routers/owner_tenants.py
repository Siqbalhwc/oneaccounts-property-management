"""
Owner lives in his own room -- gives the New Lease form (and any other
caller) the tenant record that represents the owner in that one room.
Creates it on first use, returns the same one afterwards.

Gated centrally (app/core/access.py): not in ACCOUNTANT_WRITES, so only
Owner/Admin may call it when Access Control is on -- the same people who
can create tenants and leases.
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from supabase import Client

from app.core.deps import get_current_company_id, get_supabase
from app.services.owner_tenants import ensure_owner_tenant

router = APIRouter(prefix="/owner-tenants", tags=["Owner tenants"])


class OwnerTenantRequest(BaseModel):
    room_id: str


@router.post("")
def get_or_create_owner_tenant(
    payload: OwnerTenantRequest,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    return ensure_owner_tenant(supabase, company_id, payload.room_id)
