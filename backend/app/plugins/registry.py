"""Which optional plug-ins are switched on for the caller's company (drives the sidebar)."""

from fastapi import APIRouter, Depends
from supabase import Client

from app.core.deps import get_current_company_id, get_supabase

# Plug-ins are OPT-IN: they appear only when Tower has explicitly enabled them.
OPT_IN_PLUGINS = {"tenant_portal": "Tenant Portal"}

router = APIRouter(tags=["Plugins"])


@router.get("/company/plugins")
def my_plugins(
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    rows = (
        supabase.table("company_feature_flags").select("feature_key, enabled")
        .eq("company_id", company_id).in_("feature_key", list(OPT_IN_PLUGINS)).execute().data
    )
    return {"enabled": sorted(r["feature_key"] for r in rows if r.get("enabled"))}
