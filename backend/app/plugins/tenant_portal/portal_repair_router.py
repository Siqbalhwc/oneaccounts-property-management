"""Repair / maintenance requests from tenants. Like invoice-change requests these are only MESSAGES to
the office; they never touch the books. Every query is scoped to the company and tenant in the
verified portal token, and the unit a tenant can pick is limited to the ones on their own agreements."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.deps import get_service_client

from . import service as svc
from .constants import REPAIR_CATEGORIES
from .portal_router import portal_ready, require_permission

router = APIRouter(prefix="/portal", tags=["Tenant Portal"])
REQUESTS = "tenant_portal_requests"
MAX_ACTIVE = 10


def _my_units(c, cid: str, tid: str) -> list[dict]:
    """Units on this tenant's current agreements (not terminated), as {room_id, building, number}."""
    leases = c.table("leases").select("room_id, status").eq("company_id", cid).eq("tenant_id", tid).neq("status", "terminated").execute().data
    room_ids = sorted({l["room_id"] for l in leases if l.get("room_id")})
    if not room_ids:
        return []
    rooms = c.table("rooms").select("id, room_number, building:buildings(name)").eq("company_id", cid).in_("id", room_ids).execute().data
    return [{"room_id": r["id"], "building": (r.get("building") or {}).get("name"), "number": r["room_number"]} for r in rooms]


@router.get("/repair-options")
def repair_options(ctx: dict = Depends(require_permission("submit_repair"))):
    return {"categories": REPAIR_CATEGORIES, "units": _my_units(get_service_client(), ctx["company_id"], ctx["tenant_id"])}


class RepairBody(BaseModel):
    category: str
    description: str
    room_id: Optional[str] = None


@router.post("/repairs", status_code=201)
def create_repair(body: RepairBody, ctx: dict = Depends(require_permission("submit_repair"))):
    c = get_service_client()
    cid, tid = ctx["company_id"], ctx["tenant_id"]
    if body.category not in REPAIR_CATEGORIES:
        raise HTTPException(status_code=400, detail="Please choose what the problem is about.")
    text = (body.description or "").strip()
    if len(text) < 5 or len(text) > 500:
        raise HTTPException(status_code=400, detail="Please describe the problem in a few words (5 to 500 characters).")
    units = _my_units(c, cid, tid)
    if not units:
        raise HTTPException(status_code=400, detail="You don't have a current agreement, so a repair request can't be sent. Please contact your property office.")
    if body.room_id:
        if body.room_id not in {u["room_id"] for u in units}:
            raise HTTPException(status_code=404, detail="That unit wasn't found on your agreement.")
        room_id = body.room_id
    elif len(units) == 1:
        room_id = units[0]["room_id"]
    else:
        raise HTTPException(status_code=400, detail="Please choose which unit the problem is in.")

    active = c.table(REQUESTS).select("id, room_id, category, message").eq("company_id", cid).eq("tenant_id", tid).eq("kind", "repair").in_("status", ["open", "in_progress"]).execute().data
    if len(active) >= MAX_ACTIVE:
        raise HTTPException(status_code=429, detail="You have many open repair requests. Please wait for the office to deal with them.")
    if any(a.get("room_id") == room_id and a.get("category") == body.category and (a["message"] or "").strip().lower() == text.lower() for a in active):
        raise HTTPException(status_code=409, detail="You already sent this request. The office will reply soon.")
    row = {"company_id": cid, "tenant_id": tid, "kind": "repair", "category": body.category, "room_id": room_id, "message": text}
    return {"id": c.table(REQUESTS).insert(row).execute().data[0]["id"]}


@router.get("/repairs")
def my_repairs(ctx: dict = Depends(portal_ready)):
    c = get_service_client()
    cid, tid = ctx["company_id"], ctx["tenant_id"]
    rows = (
        c.table(REQUESTS).select("id, category, message, status, admin_reply, room_id, created_at, resolved_at")
        .eq("company_id", cid).eq("tenant_id", tid).eq("kind", "repair").order("created_at", desc=True).limit(50).execute().data
    )
    room_ids = sorted({r["room_id"] for r in rows if r.get("room_id")})
    rooms = {
        rm["id"]: {"building": (rm.get("building") or {}).get("name"), "number": rm["room_number"]}
        for rm in (c.table("rooms").select("id, room_number, building:buildings(name)").eq("company_id", cid).in_("id", room_ids).execute().data if room_ids else [])
    }
    for r in rows:
        r["unit"] = rooms.get(r.pop("room_id", None))
    return {"repairs": rows}


@router.post("/repairs/{request_id}/cancel")
def cancel_repair(request_id: str, ctx: dict = Depends(require_permission("submit_repair"))):
    res = (
        get_service_client().table(REQUESTS).update({"status": "cancelled", "updated_at": svc.now_iso()})
        .eq("company_id", ctx["company_id"]).eq("tenant_id", ctx["tenant_id"]).eq("kind", "repair").eq("id", request_id).eq("status", "open").execute().data
    )
    if not res:
        raise HTTPException(status_code=409, detail="This request can't be cancelled any more (the office may already be working on it).")
    return {"ok": True}
