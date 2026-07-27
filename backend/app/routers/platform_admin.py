"""
The "Tower" view: a cross-tenant overview available ONLY to whoever has
is_platform_admin=true on their own profile (set manually via SQL -- there
is no in-app way to grant this to yourself or anyone else).

Every endpoint here first checks the CALLER's own admin flag using their own
RLS-scoped client (safe self-lookup, no cross-tenant read needed for that
check). Only after that passes do we use the service-role client to actually
read across every company.
"""

from fastapi import APIRouter, Depends, HTTPException
from supabase import Client

from app.core.deps import get_current_user, get_service_client, get_supabase

router = APIRouter(prefix="/platform", tags=["Platform Admin (Tower)"])


def require_platform_admin(
    supabase: Client = Depends(get_supabase),
    user: dict = Depends(get_current_user),
) -> None:
    profile = (
        supabase.table("profiles")
        .select("is_platform_admin")
        .eq("id", user["user_id"])
        .single()
        .execute()
    )
    if not profile.data or not profile.data.get("is_platform_admin"):
        raise HTTPException(status_code=403, detail="Platform admin access required.")


@router.get("/companies")
def list_all_companies(_admin: None = Depends(require_platform_admin), service_client=Depends(get_service_client)):
    companies = service_client.table("companies").select("*").execute().data
    buildings = service_client.table("buildings").select("id, company_id").execute().data
    tenants = service_client.table("tenants").select("id, company_id").execute().data
    rooms = service_client.table("rooms").select("id, company_id, status").execute().data
    payments = service_client.table("payments").select("company_id, amount, payment_date").execute().data
    profiles = service_client.table("profiles").select("company_id").execute().data

    from datetime import date

    current_month = date.today().strftime("%Y-%m")

    result = []
    for c in companies:
        cid = c["id"]
        company_rooms = [r for r in rooms if r["company_id"] == cid]
        occupied = len([r for r in company_rooms if r["status"] == "occupied"])
        income_this_month = sum(
            float(p["amount"])
            for p in payments
            if p["company_id"] == cid and str(p["payment_date"]).startswith(current_month)
        )
        result.append(
            {
                "id": cid,
                "name": c["name"],
                "created_at": c["created_at"],
                "building_count": len([b for b in buildings if b["company_id"] == cid]),
                "tenant_count": len([t for t in tenants if t["company_id"] == cid]),
                "room_count": len(company_rooms),
                "occupied_room_count": occupied,
                "user_count": len([p for p in profiles if p["company_id"] == cid]),
                "income_this_month": income_this_month,
            }
        )

    return result
