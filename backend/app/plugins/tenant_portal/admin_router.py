"""Staff-side management of the Tenant Portal. Owner/admin only, and only while the
plug-in is switched on for the caller's company."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from supabase import Client

from app.core.deps import get_current_company_id, get_current_user, get_service_client, get_supabase, require_owner_or_admin
from app.crud.generic import write_audit_log
from app.services.phone import normalize_to_whatsapp

from . import service as svc
from .constants import DEFAULT_PERMISSIONS, PERMISSION_LABELS
from .security import temp_password

router = APIRouter(prefix="/tenant-portal", tags=["Tenant Portal (admin)"])


def portal_admin(
    company_id: str = Depends(get_current_company_id),
    _role: None = Depends(require_owner_or_admin),
) -> str:
    if not svc.plugin_enabled(company_id):
        raise HTTPException(status_code=403, detail="The Tenant Portal isn't enabled for your company. Contact support.")
    return company_id


def _slip(acct: dict, tenant: dict, code: Optional[str]) -> dict:
    if not acct.get("must_change_password"):
        return {"available": False, "account_id": acct["id"], "tenant_name": tenant.get("full_name"),
                "reason": "The tenant has already set their own password. Use Reset password to issue a new temporary one."}
    wa = None
    try:
        wa = normalize_to_whatsapp(tenant.get("phone") or "")
    except Exception:  # noqa: BLE001 -- a bad phone number just means no WhatsApp button
        wa = None
    return {
        "available": True,
        "account_id": acct["id"],
        "tenant_name": tenant.get("full_name"),
        "username": acct["username"],
        "temp_password": temp_password(acct["id"], int(acct.get("temp_counter") or 1)),
        "portal_code": code,
        "whatsapp_phone": wa,
        "status": acct["status"],
    }


def _tenant(company_id: str, tenant_id: str) -> dict:
    rows = (
        get_service_client().table("tenants").select(svc.TENANT_COLUMNS)
        .eq("company_id", company_id).eq("id", tenant_id).execute().data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return rows[0]


def _account(company_id: str, account_id: str) -> dict:
    rows = (
        get_service_client().table(svc.ACCOUNTS).select("*")
        .eq("company_id", company_id).eq("id", account_id).execute().data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Portal account not found")
    return rows[0]


@router.get("/overview")
def overview(company_id: str = Depends(portal_admin)):
    s = svc.ensure_settings(company_id)
    return {
        "portal_code": s["portal_code"],
        "permissions": svc.effective_permissions(s.get("permissions"), None),
        "permission_labels": PERMISSION_LABELS,
    }


class PermissionsBody(BaseModel):
    permissions: dict[str, bool]


@router.put("/settings/permissions")
def set_default_permissions(
    body: PermissionsBody,
    company_id: str = Depends(portal_admin),
    supabase: Client = Depends(get_supabase),
    user: dict = Depends(get_current_user),
):
    bad = [k for k in body.permissions if k not in DEFAULT_PERMISSIONS]
    if bad:
        raise HTTPException(status_code=400, detail=f"Unknown permission: {bad[0]}")
    s = svc.ensure_settings(company_id)
    merged = svc.effective_permissions(s.get("permissions"), body.permissions)
    get_service_client().table(svc.SETTINGS).update({"permissions": merged, "updated_at": svc.now_iso()}).eq("company_id", company_id).execute()
    svc.forget(company_id)
    write_audit_log(supabase, company_id, user["user_id"], "portal_permissions", "tenant_portal_settings", company_id)
    return {"permissions": merged}


@router.get("/accounts")
def list_accounts(company_id: str = Depends(portal_admin)):
    c = get_service_client()
    tenants = {t["id"]: t for t in svc.all_company_tenants(company_id, c)}
    accounts = svc.fetch_all(lambda: c.table(svc.ACCOUNTS).select("*").eq("company_id", company_id).order("id"))
    rows, with_account = [], set()
    for a in accounts:
        t = tenants.get(a["tenant_id"]) or {}
        with_account.add(a["tenant_id"])
        rows.append({
            "account_id": a["id"], "tenant_id": a["tenant_id"], "tenant_name": t.get("full_name"),
            "username": a["username"], "status": a["status"], "must_change_password": a["must_change_password"],
            "last_login_at": a.get("last_login_at"), "locked": svc.is_future(a.get("locked_until")),
            "permission_overrides": a.get("permission_overrides") or {}, "tenant_archived": bool(t.get("is_archived")),
        })
    missing = []
    for t in tenants.values():
        if t["id"] in with_account or t.get("is_archived"):
            continue
        missing.append({"tenant_id": t["id"], "tenant_name": t.get("full_name"), "reason": svc.ineligible_reason(t) or "No account yet"})
    rows.sort(key=lambda r: (r["tenant_name"] or "").lower())
    return {"accounts": rows, "missing": missing}


@router.post("/accounts/bulk-create")
def bulk_create(company_id: str = Depends(portal_admin)):
    c = get_service_client()
    svc.ensure_settings(company_id, c)
    res = svc.create_accounts(company_id, svc.all_company_tenants(company_id, c), c)
    return {"created": len(res["created"]), "existing": res["existing"], "skipped": res["skipped"]}


@router.get("/tenants/{tenant_id}/slip")
def slip_for_tenant(tenant_id: str, company_id: str = Depends(portal_admin)):
    """Used by the Tenants page. Creates the account on the spot for a tenant that predates
    the plug-in, so the button always works."""
    tenant = _tenant(company_id, tenant_id)
    s = svc.ensure_settings(company_id)
    acct = svc.get_account_for_tenant(company_id, tenant_id)
    if not acct:
        res = svc.create_accounts(company_id, [tenant])
        if not res["created"]:
            reason = res["skipped"][0]["reason"] if res["skipped"] else "No account could be created"
            return {"available": False, "tenant_name": tenant.get("full_name"), "reason": reason}
        acct = res["created"][0]
    return _slip(acct, tenant, s["portal_code"])


@router.post("/accounts/{account_id}/reset-password")
def reset_password(
    account_id: str,
    company_id: str = Depends(portal_admin),
    supabase: Client = Depends(get_supabase),
    user: dict = Depends(get_current_user),
):
    acct = _account(company_id, account_id)
    if acct["status"] == "archived":
        raise HTTPException(status_code=400, detail="This tenant is archived. Unarchive the tenant first.")
    updated = svc.bump_session(company_id, account_id, {
        "password_hash": "temp", "temp_counter": int(acct.get("temp_counter") or 1) + 1,
        "must_change_password": True, "failed_attempts": 0, "locked_until": None,
    })
    write_audit_log(supabase, company_id, user["user_id"], "portal_password_reset", svc.ACCOUNTS, account_id)
    s = svc.ensure_settings(company_id)
    return _slip(updated, _tenant(company_id, acct["tenant_id"]), s["portal_code"])


class StatusBody(BaseModel):
    status: str


@router.post("/accounts/{account_id}/status")
def set_status(
    account_id: str, body: StatusBody,
    company_id: str = Depends(portal_admin),
    supabase: Client = Depends(get_supabase),
    user: dict = Depends(get_current_user),
):
    if body.status not in ("active", "disabled"):
        raise HTTPException(status_code=400, detail="Status must be active or disabled.")
    acct = _account(company_id, account_id)
    if acct["status"] == "archived":
        raise HTTPException(status_code=400, detail="This tenant is archived. Unarchive the tenant first.")
    svc.bump_session(company_id, account_id, {"status": body.status, "failed_attempts": 0, "locked_until": None})
    write_audit_log(supabase, company_id, user["user_id"], f"portal_{body.status}", svc.ACCOUNTS, account_id)
    return {"status": body.status}


class OverridesBody(BaseModel):
    overrides: dict[str, Optional[bool]]


@router.put("/accounts/{account_id}/permissions")
def set_overrides(account_id: str, body: OverridesBody, company_id: str = Depends(portal_admin)):
    bad = [k for k in body.overrides if k not in DEFAULT_PERMISSIONS]
    if bad:
        raise HTTPException(status_code=400, detail=f"Unknown permission: {bad[0]}")
    _account(company_id, account_id)
    clean = {k: v for k, v in body.overrides.items() if v is not None}
    get_service_client().table(svc.ACCOUNTS).update({"permission_overrides": clean, "updated_at": svc.now_iso()}).eq("company_id", company_id).eq("id", account_id).execute()
    return {"permission_overrides": clean}


# ------------------------------------------------------------------ change requests
@router.get("/requests")
def list_requests(status: str = "open", company_id: str = Depends(portal_admin)):
    c = get_service_client()
    q = c.table("tenant_portal_requests").select("*").eq("company_id", company_id).order("created_at", desc=True).limit(200)
    if status != "all":
        q = q.eq("status", status)
    rows = q.execute().data
    tenant_ids = sorted({r["tenant_id"] for r in rows})
    invoice_ids = sorted({r["invoice_id"] for r in rows if r.get("invoice_id")})
    tenants = {t["id"]: t["full_name"] for t in (c.table("tenants").select("id, full_name").eq("company_id", company_id).in_("id", tenant_ids).execute().data if tenant_ids else [])}
    invoices = {i["id"]: i for i in (c.table("invoices").select("id, invoice_month, total_amount, status").eq("company_id", company_id).in_("id", invoice_ids).execute().data if invoice_ids else [])}
    return {"requests": [
        {**r, "tenant_name": tenants.get(r["tenant_id"]), "invoice": invoices.get(r.get("invoice_id"))} for r in rows
    ]}


class ResolveBody(BaseModel):
    status: str
    reply: Optional[str] = None


@router.post("/requests/{request_id}/resolve")
def resolve_request(request_id: str, body: ResolveBody, company_id: str = Depends(portal_admin)):
    if body.status not in ("resolved", "declined"):
        raise HTTPException(status_code=400, detail="Status must be resolved or declined.")
    reply = (body.reply or "").strip()[:500] or None
    res = (
        get_service_client().table("tenant_portal_requests")
        .update({"status": body.status, "admin_reply": reply, "resolved_at": svc.now_iso(), "updated_at": svc.now_iso()})
        .eq("company_id", company_id).eq("id", request_id).eq("status", "open").execute().data
    )
    if not res:
        raise HTTPException(status_code=409, detail="This request was already handled (or no longer exists).")
    return {"status": body.status}


# ------------------------------------------------------------------ ledger check
@router.get("/accounts/{account_id}/ledger-check")
def ledger_check(
    account_id: str,
    company_id: str = Depends(portal_admin),
    supabase: Client = Depends(get_supabase),
):
    """Runs YOUR admin ledger (the general_ledger function, as the logged-in staff user) and the
    tenant portal ledger for the same tenant, and compares them line by line and by closing balance."""
    from app.services.ledger import get_account_id

    acct = _account(company_id, account_id)
    tenant_id = acct["tenant_id"]
    ar_id = get_account_id(supabase, company_id, "1100")
    admin_rows = supabase.rpc("general_ledger", {
        "p_account_id": ar_id, "p_date_from": None, "p_date_to": None, "p_owner_id": None,
        "p_tenant_id": tenant_id, "p_building_id": None, "p_room_id": None,
    }).execute().data or []
    portal_rows = get_service_client().rpc("portal_tenant_ledger", {
        "p_company_id": company_id, "p_tenant_id": tenant_id, "p_account_id": ar_id, "p_date_from": None, "p_date_to": None,
    }).execute().data or []
    admin_closing = round(float(admin_rows[-1]["running_balance"]), 2) if admin_rows else 0.0
    portal_closing = round(float(portal_rows[-1]["running_balance"]), 2) if portal_rows else 0.0
    same_lines = len(admin_rows) == len(portal_rows) and all(
        a["entry_date"] == p["entry_date"] and round(float(a["amount"]), 2) == round(float(p["amount"]), 2)
        and a["direction"] == p["direction"] and round(float(a["running_balance"]), 2) == round(float(p["running_balance"]), 2)
        for a, p in zip(admin_rows, portal_rows)
    )
    return {
        "matches": same_lines and admin_closing == portal_closing,
        "admin_closing": admin_closing, "portal_closing": portal_closing,
        "admin_lines": len(admin_rows), "portal_lines": len(portal_rows),
    }
