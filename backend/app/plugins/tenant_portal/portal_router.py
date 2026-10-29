"""What a TENANT calls. No Supabase session, no staff profile, no RLS: the tenant proves who
they are with a portal token (see security.py), and every query below is scoped to the
company_id and tenant_id found inside that verified token -- never taken from the request."""

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from app.core.deps import get_service_client
from app.core.labels import resolve_unit

from . import service as svc
from .constants import LOCK_MINUTES, MAX_FAILED_ATTEMPTS, MIN_PASSWORD_LENGTH, SESSION_HOURS
from .security import burn_time, hash_password, issue_token, mask_username, normalize_username, read_token, verify_login_password

router = APIRouter(prefix="/portal", tags=["Tenant Portal"])

BAD_LOGIN = "Invalid sign-in details."
UNAVAILABLE = "This portal is currently unavailable. Please contact your property office."


class LoginBody(BaseModel):
    portal_code: str
    username: str
    password: str


def _register_failure(c, acct: dict) -> None:
    n = int(acct.get("failed_attempts") or 0) + 1
    upd = {"failed_attempts": n, "updated_at": svc.now_iso()}
    if n >= MAX_FAILED_ATTEMPTS:
        upd = {"failed_attempts": 0, "locked_until": (datetime.now(timezone.utc) + timedelta(minutes=LOCK_MINUTES)).isoformat(), "updated_at": svc.now_iso()}
    c.table(svc.ACCOUNTS).update(upd).eq("company_id", acct["company_id"]).eq("id", acct["id"]).execute()


@router.post("/login")
def login(body: LoginBody):
    c = get_service_client()
    code = (body.portal_code or "").strip().lower()
    username = normalize_username(body.username)
    rows = c.table(svc.SETTINGS).select("company_id").eq("portal_code", code).execute().data if code else []
    company_id = rows[0]["company_id"] if rows else None
    acct = None
    if company_id and username:
        found = c.table(svc.ACCOUNTS).select("*").eq("company_id", company_id).eq("username", username).neq("status", "archived").execute().data
        acct = found[0] if found else None
    if not acct:
        burn_time()
        raise HTTPException(status_code=401, detail=BAD_LOGIN)
    if svc.is_future(acct.get("locked_until")):
        raise HTTPException(status_code=429, detail=f"Too many attempts. Please try again in {LOCK_MINUTES} minutes.")
    if not verify_login_password(acct, body.password):
        _register_failure(c, acct)
        raise HTTPException(status_code=401, detail=BAD_LOGIN)
    if acct["status"] != "active" or not svc.plugin_enabled(company_id, c):
        raise HTTPException(status_code=403, detail=UNAVAILABLE)
    comp = c.table("companies").select("status").eq("id", company_id).execute().data
    if not comp or comp[0].get("status", "active") != "active":
        raise HTTPException(status_code=403, detail=UNAVAILABLE)
    c.table(svc.ACCOUNTS).update({"failed_attempts": 0, "locked_until": None, "last_login_at": svc.now_iso()}).eq("company_id", company_id).eq("id", acct["id"]).execute()
    return {"token": issue_token(acct, SESSION_HOURS), "must_change_password": acct["must_change_password"]}


def _auth(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Please sign in.")
    claims = read_token(authorization.split(" ", 1)[1])
    if not claims:
        raise HTTPException(status_code=401, detail="Please sign in again.")
    c = get_service_client()
    rows = (
        c.table(svc.ACCOUNTS)
        .select("*, tenant:tenants(id, full_name, cnic, phone, is_archived), company:companies(id, name, logo_url, status, unit_type)")
        .eq("id", claims["sub"]).eq("company_id", claims["cid"]).eq("tenant_id", claims["tid"]).execute().data
    )
    acct = rows[0] if rows else None
    if not acct or acct["status"] != "active" or int(acct["token_version"]) != int(claims["tv"]):
        raise HTTPException(status_code=401, detail="Please sign in again.")
    tenant, company = acct.get("tenant") or {}, acct.get("company") or {}
    if tenant.get("is_archived") or company.get("status", "active") != "active" or not svc.plugin_enabled(acct["company_id"], c):
        raise HTTPException(status_code=403, detail=UNAVAILABLE)
    settings = svc.get_settings(acct["company_id"], c) or {}
    return {
        "account": acct, "tenant": tenant, "company": company,
        "company_id": acct["company_id"], "tenant_id": acct["tenant_id"],
        "permissions": svc.effective_permissions(settings.get("permissions"), acct.get("permission_overrides")),
    }


def portal_ready(ctx: dict = Depends(_auth)) -> dict:
    """For every data endpoint: the tenant must have replaced their temporary password first."""
    if ctx["account"]["must_change_password"]:
        raise HTTPException(status_code=403, detail="Please set your own password first.")
    return ctx


def require_permission(key: str):
    def _check(ctx: dict = Depends(portal_ready)) -> dict:
        if not ctx["permissions"].get(key):
            raise HTTPException(status_code=403, detail="Your property office hasn't enabled this for your account.")
        return ctx

    return _check


@router.get("/me")
def me(ctx: dict = Depends(_auth)):
    a, t, co = ctx["account"], ctx["tenant"], ctx["company"]
    unit = resolve_unit(co.get("unit_type"))
    return {
        "unit": unit["singular"], "units": unit["plural"],
        "tenant_name": t.get("full_name"), "masked_username": mask_username(a["username"]),
        "company_name": co.get("name"), "logo_url": co.get("logo_url"), "unit_type": co.get("unit_type"),
        "must_change_password": a["must_change_password"], "permissions": ctx["permissions"],
    }


class ChangePasswordBody(BaseModel):
    current_password: str
    new_password: str


@router.post("/change-password")
def change_password(body: ChangePasswordBody, ctx: dict = Depends(_auth)):
    a = ctx["account"]
    c = get_service_client()
    if not verify_login_password(a, body.current_password):
        _register_failure(c, a)
        raise HTTPException(status_code=400, detail="Your current password is not correct.")
    new = body.new_password or ""
    if len(new) < MIN_PASSWORD_LENGTH:
        raise HTTPException(status_code=400, detail=f"Your new password must be at least {MIN_PASSWORD_LENGTH} characters.")
    if normalize_username(new) == a["username"] or new == body.current_password:
        raise HTTPException(status_code=400, detail="Please choose a password that is different from your CNIC and your current password.")
    updated = svc.bump_session(a["company_id"], a["id"], {"password_hash": hash_password(new), "must_change_password": False, "failed_attempts": 0, "locked_until": None})
    return {"token": issue_token(updated, SESSION_HOURS)}


@router.post("/logout")
def logout(ctx: dict = Depends(_auth)):
    a = ctx["account"]
    svc.bump_session(a["company_id"], a["id"], {})
    return {"ok": True}
