"""
Data layer for the Tenant Portal plug-in.

These tables have Row Level Security switched on with NO policies, so only the
backend (service role) can touch them. Because the service role bypasses RLS, the
isolation is enforced HERE instead, by one rule: every query below is filtered by
company_id, and company_id only ever comes from a verified source (the staff
member's own company, or a signed portal token) -- never from a request body.
"""

import logging
import re
import secrets
import time
from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

from app.core.deps import get_service_client
from app.services.invoice_batch import fetch_all

from .constants import DEFAULT_PERMISSIONS, FEATURE_KEY
from .security import is_usable_username, normalize_username

_log = logging.getLogger("app.tenant_portal")
ACCOUNTS = "tenant_portal_accounts"
SETTINGS = "tenant_portal_settings"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def is_future(ts: Optional[str]) -> bool:
    """True if a database timestamp is still ahead of now (parsed properly, not compared as text)."""
    if not ts:
        return False
    try:
        return datetime.fromisoformat(str(ts).replace("Z", "+00:00")) > datetime.now(timezone.utc)
    except ValueError:
        return False


# ----------------------------------------------------------- small TTL cache
_TTL = 15
_cache: dict = {}


def _cached(key, loader):
    hit = _cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]
    value = loader()
    _cache[key] = (time.time() + _TTL, value)
    return value


def forget(company_id: str) -> None:
    for k in [k for k in _cache if k[1] == company_id]:
        _cache.pop(k, None)


# ----------------------------------------------------------- plug-in switch
def plugin_enabled(company_id: str, client=None) -> bool:
    """OPT-IN: off unless Tower has switched it on for this company."""

    def load():
        c = client or get_service_client()
        rows = (
            c.table("company_feature_flags").select("enabled")
            .eq("company_id", company_id).eq("feature_key", FEATURE_KEY).execute().data
        )
        return bool(rows and rows[0].get("enabled"))

    return _cached(("enabled", company_id), load)


def get_settings(company_id: str, client=None) -> Optional[dict]:
    def load():
        c = client or get_service_client()
        rows = c.table(SETTINGS).select("*").eq("company_id", company_id).execute().data
        return rows[0] if rows else None

    return _cached(("settings", company_id), load)


def _slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")[:30].strip("-")
    return s if len(s) >= 3 else "company"


def ensure_settings(company_id: str, client=None) -> dict:
    c = client or get_service_client()
    existing = c.table(SETTINGS).select("*").eq("company_id", company_id).execute().data
    if existing:
        return existing[0]
    name_rows = c.table("companies").select("name").eq("id", company_id).execute().data
    base = _slug((name_rows[0] if name_rows else {}).get("name", ""))
    code = base
    for _ in range(6):
        taken = c.table(SETTINGS).select("company_id").eq("portal_code", code).execute().data
        if not taken:
            try:
                row = c.table(SETTINGS).insert(
                    {"company_id": company_id, "portal_code": code, "permissions": DEFAULT_PERMISSIONS}
                ).execute().data[0]
                forget(company_id)
                return row
            except Exception:  # lost a race for the code, or for the row itself
                again = c.table(SETTINGS).select("*").eq("company_id", company_id).execute().data
                if again:
                    return again[0]
        code = f"{base}-{secrets.token_hex(2)}"
    raise RuntimeError("Could not allocate a portal code")


def effective_permissions(company_perms: Optional[dict], overrides: Optional[dict]) -> dict:
    merged = dict(DEFAULT_PERMISSIONS)
    for k, v in (company_perms or {}).items():
        if k in merged:
            merged[k] = bool(v)
    for k, v in (overrides or {}).items():
        if k in merged and v is not None:
            merged[k] = bool(v)
    return merged


# ----------------------------------------------------------- accounts
TENANT_COLUMNS = "id, company_id, cnic, full_name, phone, owner_id, is_archived"


def ineligible_reason(tenant: dict) -> Optional[str]:
    if tenant.get("owner_id"):
        return "Owner-occupied unit (owner is the tenant)"
    if tenant.get("is_archived"):
        return "Tenant is archived"
    if not is_usable_username(normalize_username(tenant.get("cnic"))):
        return "CNIC missing or too short"
    return None


def get_account_for_tenant(company_id: str, tenant_id: str, client=None) -> Optional[dict]:
    c = client or get_service_client()
    rows = c.table(ACCOUNTS).select("*").eq("company_id", company_id).eq("tenant_id", tenant_id).execute().data
    return rows[0] if rows else None


def create_accounts(company_id: str, tenants: list[dict], client=None) -> dict:
    """Create the portal account for each tenant that should have one and doesn't yet.
    Returns {"created": [account rows], "existing": n, "skipped": [{tenant_id, name, reason}]}."""
    c = client or get_service_client()
    out = {"created": [], "existing": 0, "skipped": []}
    tenants = [t for t in tenants if t.get("company_id") == company_id]  # belt and braces
    if not tenants:
        return out

    have = set()
    ids = [t["id"] for t in tenants]
    for i in range(0, len(ids), 150):
        rows = c.table(ACCOUNTS).select("tenant_id").eq("company_id", company_id).in_("tenant_id", ids[i:i + 150]).execute().data
        have |= {r["tenant_id"] for r in rows}

    to_add, seen = [], set()
    for t in tenants:
        if t["id"] in have:
            out["existing"] += 1
            continue
        why = ineligible_reason(t)
        username = normalize_username(t.get("cnic"))
        if not why and username in seen:
            why = "Same CNIC as another tenant in this batch"
        if why:
            out["skipped"].append({"tenant_id": t["id"], "name": t.get("full_name"), "reason": why})
            continue
        seen.add(username)
        to_add.append({"id": str(uuid4()), "company_id": company_id, "tenant_id": t["id"], "username": username})

    names = {t["id"]: t.get("full_name") for t in tenants}
    for i in range(0, len(to_add), 100):
        chunk = to_add[i:i + 100]
        try:
            out["created"] += c.table(ACCOUNTS).insert(chunk).execute().data
        except Exception:
            for row in chunk:  # one bad row (e.g. CNIC already used) must not sink the rest
                try:
                    out["created"] += c.table(ACCOUNTS).insert(row).execute().data
                except Exception:
                    out["skipped"].append(
                        {"tenant_id": row["tenant_id"], "name": names.get(row["tenant_id"]),
                         "reason": "Another active tenant already uses this CNIC"}
                    )
    return out


def all_company_tenants(company_id: str, client=None) -> list[dict]:
    c = client or get_service_client()
    return fetch_all(lambda: c.table("tenants").select(TENANT_COLUMNS).eq("company_id", company_id).order("id"))


def bump_session(company_id: str, account_id: str, fields: dict, client=None) -> Optional[dict]:
    """Update one account (scoped to the company) and sign out its sessions."""
    c = client or get_service_client()
    cur = c.table(ACCOUNTS).select("token_version").eq("company_id", company_id).eq("id", account_id).execute().data
    if not cur:
        return None
    upd = dict(fields, token_version=int(cur[0]["token_version"]) + 1, updated_at=now_iso())
    res = c.table(ACCOUNTS).update(upd).eq("company_id", company_id).eq("id", account_id).execute().data
    return res[0] if res else None
