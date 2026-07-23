"""
Factory that builds a standard list/get/create/update/delete router for a
simple table. Used for tables that don't need special business logic
(buildings, floors, rooms, room_history, tenants, expense_categories,
expenses, staff, salary_payments).

Tables with real business logic (leases, invoices, security_deposits,
owner_ledger) get their own dedicated router files instead.
"""

import re
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException
from postgrest.exceptions import APIError
from supabase import Client

from app.core.deps import get_current_company_id, get_supabase


def friendly_db_error(e: APIError) -> tuple[int, str]:
    """
    Turns a raw Postgres/PostgREST error into a short, human-readable message
    instead of leaking database internals to the user.
    """
    code = getattr(e, "code", None)
    details = getattr(e, "details", None) or ""
    message = getattr(e, "message", None) or str(e)

    if code == "23505":  # unique_violation
        match = re.search(r"Key \(([^)]+)\)=\(([^)]+)\) already exists", details)
        if match:
            fields = [f.strip() for f in match.group(1).split(",")]
            values = [v.strip() for v in match.group(2).split(",")]
            pairs = [
                f"{f} '{v}'"
                for f, v in zip(fields, values)
                if f != "company_id"  # internal detail, not meaningful to the user
            ]
            if pairs:
                return 409, f"Already exists with {', '.join(pairs)}."
        return 409, "A record with these details already exists."

    if code == "23503":  # foreign_key_violation
        return 400, "This action references something that doesn't exist or was deleted."

    if code == "23502":  # not_null_violation
        return 400, "A required field is missing."

    return 400, message


def build_crud_router(table: str, tags: list[str]) -> APIRouter:
    router = APIRouter(prefix=f"/{table}", tags=tags)

    @router.get("/")
    def list_all(supabase: Client = Depends(get_supabase)):
        res = supabase.table(table).select("*").order("created_at", desc=True).execute()
        return res.data

    @router.get("/{record_id}")
    def get_one(record_id: str, supabase: Client = Depends(get_supabase)):
        res = supabase.table(table).select("*").eq("id", record_id).single().execute()
        if not res.data:
            raise HTTPException(status_code=404, detail="Not found")
        return res.data

    @router.post("/", status_code=201)
    def create(
        payload: Dict[str, Any],
        supabase: Client = Depends(get_supabase),
        company_id: str = Depends(get_current_company_id),
    ):
        # company_id is always forced server-side, never trusted from the client.
        payload["company_id"] = company_id
        try:
            res = supabase.table(table).insert(payload).execute()
        except APIError as e:
            status, detail = friendly_db_error(e)
            raise HTTPException(status_code=status, detail=detail)
        return res.data[0] if res.data else None

    @router.patch("/{record_id}")
    def update(
        record_id: str,
        payload: Dict[str, Any],
        supabase: Client = Depends(get_supabase),
    ):
        payload.pop("company_id", None)  # never allow moving a record between companies
        try:
            res = supabase.table(table).update(payload).eq("id", record_id).execute()
        except APIError as e:
            status, detail = friendly_db_error(e)
            raise HTTPException(status_code=status, detail=detail)
        if not res.data:
            raise HTTPException(status_code=404, detail="Not found")
        return res.data[0]

    @router.delete("/{record_id}", status_code=204)
    def delete(record_id: str, supabase: Client = Depends(get_supabase)):
        try:
            supabase.table(table).delete().eq("id", record_id).execute()
        except APIError as e:
            status, detail = friendly_db_error(e)
            raise HTTPException(status_code=status, detail=detail)
        return None

    return router
