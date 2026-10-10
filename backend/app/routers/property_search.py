"""
GET /property-search/{entity}?q=...

"Which of my <entity> belong to the rooms / buildings this text means?"

Every list page (Tenants, Owners, Staff, Expenses, ...) keeps its own text
search (name, CNIC, vendor ...) and, in addition, asks this endpoint which
records belong to the typed room / apartment / building. The page then shows a
record if EITHER matches. All the room/building logic stays here, on the
server (see services/room_search.py).

Each entity is one small function registered in ENTITY_HANDLERS. A new module
-- e.g. the construction company's sites -- plugs in by registering another
handler; nothing else here changes.

Isolation: the caller's own RLS-scoped client does every read, and every query
also pins company_id to the caller's own company (belt and braces). Read-only:
no endpoint here writes anything.
"""

from typing import Callable

from fastapi import APIRouter, Depends, HTTPException, Query
from supabase import Client

from app.core.deps import get_current_company_id, get_supabase
from app.services.room_search import PropertyMatch, resolve_property_term, rows_in

router = APIRouter(prefix="/property-search", tags=["Property search"])

# handler(supabase, company_id, match) -> (ids, notes)
#   ids   = ids of this entity's records that belong to the matched rooms/buildings
#   notes = optional {id: short text} the page may show beside a record
Handler = Callable[[Client, str, PropertyMatch], tuple[set[str], dict[str, str]]]


def _tenants(supabase: Client, company_id: str, m: PropertyMatch) -> tuple[set[str], dict[str, str]]:
    """Tenants with a lease -- current OR ended -- on a matched room. A tenant
    who is only there through an ended lease gets a 'Past tenant' note."""
    leases = rows_in(supabase, "leases", "id, tenant_id, room_id, status", "room_id", m.room_ids, company_id)
    by_tenant: dict[str, list[dict]] = {}
    for lease in leases:
        if lease.get("tenant_id"):
            by_tenant.setdefault(lease["tenant_id"], []).append(lease)
    ids: set[str] = set()
    notes: dict[str, str] = {}
    for tenant_id, tenant_leases in by_tenant.items():
        ids.add(tenant_id)
        if not any(l.get("status") == "active" for l in tenant_leases):
            notes[tenant_id] = f"Past tenant \u00b7 {m.room_label(tenant_leases[0]['room_id'])}"
    return ids, notes


def _owners(supabase: Client, company_id: str, m: PropertyMatch) -> tuple[set[str], dict[str, str]]:
    """Owners of the matched rooms/buildings. A room's own owner wins, else its
    building's -- the same rule the ledger uses to decide who is owed."""
    return m.effective_owner_ids(), {}


def _staff(supabase: Client, company_id: str, m: PropertyMatch) -> tuple[set[str], dict[str, str]]:
    """Staff assigned to a matched building, directly or through a cost split.
    Staff belong to buildings, not rooms."""
    scope = m.building_scope()
    ids = {s["id"] for s in rows_in(supabase, "staff", "id", "building_id", scope, company_id)}
    for row in rows_in(
        supabase, "cost_allocations", "id, source_id", "building_id", scope, company_id,
        extra=lambda q: q.eq("source_type", "staff"),
    ):
        ids.add(row["source_id"])
    return ids, {}


def _expenses(supabase: Client, company_id: str, m: PropertyMatch) -> tuple[set[str], dict[str, str]]:
    """Expenses charged to a matched room, or to a building whose NAME matched
    (directly or through a cost split). 'Sunrise 101' therefore finds only room
    101's expenses, while 'Sunrise' finds the whole building's."""
    ids = {e["id"] for e in rows_in(supabase, "expenses", "id", "room_id", m.room_ids, company_id)}
    ids |= {e["id"] for e in rows_in(supabase, "expenses", "id", "building_id", m.building_ids, company_id)}
    for row in rows_in(
        supabase, "cost_allocations", "id, source_id", "building_id", m.building_ids, company_id,
        extra=lambda q: q.eq("source_type", "expense"),
    ):
        ids.add(row["source_id"])
    return ids, {}


ENTITY_HANDLERS: dict[str, Handler] = {
    "tenants": _tenants,
    "owners": _owners,
    "staff": _staff,
    "expenses": _expenses,
}


@router.get("/{entity}")
def property_search(
    entity: str,
    q: str = Query("", max_length=200, description="What the user typed: building, apartment, or both"),
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    handler = ENTITY_HANDLERS.get(entity)
    if handler is None:
        raise HTTPException(status_code=404, detail=f"Room search isn't available for '{entity}'.")
    match = resolve_property_term(supabase, q)
    if match.empty:
        return {"ids": [], "notes": {}}
    ids, notes = handler(supabase, company_id, match)
    return {"ids": sorted(ids), "notes": notes}
