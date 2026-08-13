"""
Factory that builds a standard list/get/create/update router for a simple
table. Used for tables that don't need special business logic (buildings,
floors, rooms, room_history, tenants, expense_categories, expenses, staff,
salary_payments).

Tables with real business logic (leases, invoices, security_deposits,
owner_ledger) get their own dedicated router files instead.

Two things apply uniformly here:
  - Every successful edit writes a row to audit_log (who changed what, and
    the before/after values), regardless of which table.
  - Records are never hard-deleted. Tables passed archivable=True get an
    is_archived flag and an /archive endpoint (owner/admin only) instead of
    a DELETE endpoint; tables passed archivable=False (lookup-ish data like
    expense_categories) have no delete or archive at all, since removing
    them would silently orphan things that reference them.
"""

import re
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from postgrest.exceptions import APIError
from supabase import Client

from app.core.deps import get_current_company_id, get_current_user, get_supabase, require_owner_or_admin


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
                if not f.endswith("_id")  # foreign keys (UUIDs) aren't meaningful to show the user
            ]
            if pairs:
                return 409, f"Already exists with {', '.join(pairs)}."
        return 409, "A record with these details already exists."

    if code == "23503":  # foreign_key_violation
        return 400, "This action references something that doesn't exist or was deleted."

    if code == "23502":  # not_null_violation
        return 400, "A required field is missing."

    return 400, message


def write_audit_log(
    supabase: Client,
    company_id: str,
    user_id: str,
    action: str,
    table: str,
    record_id: str,
    before: Optional[dict] = None,
    after: Optional[dict] = None,
) -> None:
    """
    Best-effort audit trail write. Deliberately swallows its own errors --
    a logging failure should never block the actual edit from succeeding.
    """
    try:
        changed_fields = {}
        if before is not None and after is not None:
            for key, new_value in after.items():
                old_value = before.get(key)
                if old_value != new_value:
                    changed_fields[key] = {"from": old_value, "to": new_value}
        supabase.table("audit_log").insert(
            {
                "company_id": company_id,
                "user_id": user_id,
                "action": action,
                "table_name": table,
                "record_id": record_id,
                "details": changed_fields or None,
            }
        ).execute()
    except Exception:
        pass


def build_crud_router(
    table: str,
    tags: list[str],
    archivable: bool = False,
    validators: dict[str, Any] | None = None,
) -> APIRouter:
    """
    validators: optional {field_name: fn(raw_value) -> normalized_value}.
    fn should raise HTTPException(400, ...) on invalid input, or return the
    (possibly normalized/cleaned) value to store. Runs on create AND update,
    only when that field is present in the payload -- so a PATCH that
    doesn't touch phone, for example, doesn't re-validate it.
    """
    router = APIRouter(prefix=f"/{table}", tags=tags)
    validators = validators or {}

    def _run_validators(payload: Dict[str, Any]) -> None:
        for field, validate in validators.items():
            if field in payload and payload[field] is not None:
                payload[field] = validate(payload[field])

    @router.get("")
    def list_all(
        include_archived: bool = Query(False),
        limit: int = Query(1000, le=5000),
        offset: int = Query(0, ge=0),
        supabase: Client = Depends(get_supabase),
    ):
        query = supabase.table(table).select("*")
        if archivable and not include_archived:
            query = query.eq("is_archived", False)
        res = query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()
        return res.data

    @router.get("/{record_id}")
    def get_one(record_id: str, supabase: Client = Depends(get_supabase)):
        res = supabase.table(table).select("*").eq("id", record_id).single().execute()
        if not res.data:
            raise HTTPException(status_code=404, detail="Not found")
        return res.data

    @router.post("", status_code=201)
    def create(
        payload: Dict[str, Any],
        supabase: Client = Depends(get_supabase),
        company_id: str = Depends(get_current_company_id),
        user: dict = Depends(get_current_user),
    ):
        _run_validators(payload)
        # company_id is always forced server-side, never trusted from the client.
        payload["company_id"] = company_id
        try:
            res = supabase.table(table).insert(payload).execute()
        except APIError as e:
            status, detail = friendly_db_error(e)
            raise HTTPException(status_code=status, detail=detail)
        created = res.data[0] if res.data else None
        if created:
            write_audit_log(supabase, company_id, user["user_id"], "create", table, created["id"])
        return created

    @router.patch("/{record_id}")
    def update(
        record_id: str,
        payload: Dict[str, Any],
        supabase: Client = Depends(get_supabase),
        company_id: str = Depends(get_current_company_id),
        user: dict = Depends(get_current_user),
    ):
        _run_validators(payload)
        payload.pop("company_id", None)  # never allow moving a record between companies
        payload.pop("is_archived", None)  # archiving has its own gated endpoint below

        before = supabase.table(table).select("*").eq("id", record_id).single().execute()
        if not before.data:
            raise HTTPException(status_code=404, detail="Not found")

        try:
            res = supabase.table(table).update(payload).eq("id", record_id).execute()
        except APIError as e:
            status, detail = friendly_db_error(e)
            raise HTTPException(status_code=status, detail=detail)
        if not res.data:
            raise HTTPException(status_code=404, detail="Not found")

        after = res.data[0]
        write_audit_log(supabase, company_id, user["user_id"], "update", table, record_id, before.data, after)
        return after

    if archivable:

        @router.post("/{record_id}/archive")
        def archive(
            record_id: str,
            supabase: Client = Depends(get_supabase),
            company_id: str = Depends(get_current_company_id),
            user: dict = Depends(get_current_user),
            _perm: None = Depends(require_owner_or_admin),
        ):
            res = supabase.table(table).update({"is_archived": True}).eq("id", record_id).execute()
            if not res.data:
                raise HTTPException(status_code=404, detail="Not found")
            write_audit_log(supabase, company_id, user["user_id"], "archive", table, record_id)
            return res.data[0]

        @router.post("/{record_id}/unarchive")
        def unarchive(
            record_id: str,
            supabase: Client = Depends(get_supabase),
            company_id: str = Depends(get_current_company_id),
            user: dict = Depends(get_current_user),
            _perm: None = Depends(require_owner_or_admin),
        ):
            res = supabase.table(table).update({"is_archived": False}).eq("id", record_id).execute()
            if not res.data:
                raise HTTPException(status_code=404, detail="Not found")
            write_audit_log(supabase, company_id, user["user_id"], "unarchive", table, record_id)
            return res.data[0]

    return router
