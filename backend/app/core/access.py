"""
Role-based access (who may DO what) -- the "Access Control" feature.

Two independent layers, deliberately:

  1. WHICH ROWS a user can see  -> enforced by Postgres (restrictive RLS
     policies in schema_patch_027, driven by user_building_access). This is
     the real security boundary, same philosophy as the rest of this app.

  2. WHICH ACTIONS a user can take -> enforced HERE, centrally, from one
     table below, attached once per router in main.py. No individual endpoint
     had to be edited, and a new endpoint is gated automatically (a role that
     isn't explicitly allowed a write is denied it -- fail closed).

The whole thing is OFF unless companies.access_control_enabled is true for the
caller's company (platform admin switches it on). While off, every function
here allows everything, so existing companies behave exactly as before.
"""

import time
from typing import Optional

import jwt
from fastapi import Header, HTTPException, Request

from app.core.deps import get_service_client

# --------------------------------------------------------------------------
# Roles
# --------------------------------------------------------------------------
# The three roles the business uses, plus the two legacy ones mapped onto them
# so nobody is locked out when the feature is switched on.
ROLE_LABELS = {
    "owner": "Owner",
    "admin": "Admin",
    "accountant": "Accountant",
    "auditor": "Auditor / Owner (view only)",
    "manager": "Manager (legacy, = Admin)",
    "staff": "Staff (legacy, = Accountant)",
}
EFFECTIVE_ROLE = {
    "owner": "owner",
    "admin": "admin",
    "manager": "admin",
    "accountant": "accountant",
    "staff": "accountant",
    "auditor": "auditor",
}
# Roles a company owner may hand out. 'owner' stays platform-admin-only.
COMPANY_ASSIGNABLE_ROLES = {"admin", "accountant", "auditor", "manager", "staff"}
PLATFORM_ASSIGNABLE_ROLES = COMPANY_ASSIGNABLE_ROLES | {"owner"}

# --------------------------------------------------------------------------
# Policy table
# --------------------------------------------------------------------------
# Paths are FastAPI route templates WITHOUT the "/api" prefix.

# Never gated: login bookkeeping, "who am I", the Implementation portal and
# Tower (both have their own gates), public pages.
EXEMPT_PREFIXES = ("/auth/", "/access/me", "/implementation", "/platform", "/signup")
EXEMPT_EXACT = {("GET", "/company/me"), ("GET", "/profile/me"), ("PATCH", "/profile/me")}

# Company-wide financial statements: Owner + Auditor only.
STATEMENT_PATHS = {"/financials/trial-balance", "/financials/balance-sheet"}

# Bulk data export/import: Owner + Admin (+ Auditor may export).
DATA_PREFIX = "/data-transfer"

# Accountant = "pass entries only". Everything NOT listed here is denied.
ACCOUNTANT_WRITES = {
    ("POST", "/payments"),
    ("POST", "/payments/receipt"),
    ("POST", "/invoices/generate"),
    ("POST", "/invoices/{invoice_id}/mark-paid"),
    ("POST", "/invoices/{invoice_id}/mark-sent"),
    ("POST", "/expenses"),
    ("POST", "/expenses/generate-recurring"),
    ("PUT", "/expenses/{expense_id}/allocations"),
    ("POST", "/expense_categories"),
    ("POST", "/salary_payments"),
    ("POST", "/ledger/manual-entry"),
    ("POST", "/security-deposits/{deposit_id}/payments"),
    ("POST", "/security-deposits/{deposit_id}/refund"),
    ("POST", "/owner-ledger/compute"),
    ("POST", "/owner-ledger/pay-owner"),
    ("POST", "/owner-ledger/pay-owner-allocated"),
    ("POST", "/owner-ledger/{ledger_id}/pay"),
    ("POST", "/owner-ledger/apply-earlier-payouts/{owner_id}"),
}

# Admin can do everything an accountant can plus master data, WhatsApp,
# archive, reverse/edit, settlements, import -- EXCEPT these (owner only).
OWNER_ONLY_WRITES = {
    ("POST", "/company/team"),
}


def _normalize(path: str) -> str:
    return path[4:] if path.startswith("/api/") else path


def decide(ctx: dict, method: str, route_path: str) -> tuple[bool, str]:
    """Pure function: may a user with this access context call this route?
    Returns (allowed, reason-if-denied)."""
    if not ctx.get("enabled"):
        return True, ""

    p = _normalize(route_path)
    method = method.upper()

    if any(p.startswith(x) for x in EXEMPT_PREFIXES) or (method, p) in EXEMPT_EXACT:
        return True, ""

    role = ctx.get("role")
    eff = EFFECTIVE_ROLE.get(role, "auditor")  # unknown role -> read-only (fail closed)
    label = ROLE_LABELS.get(role, role)

    if eff == "owner":
        return True, ""

    deny = f"Your role ({label}) isn't allowed to do this. Ask your company owner if you need access."

    if method in ("GET", "HEAD"):
        if p in STATEMENT_PATHS:
            return (True, "") if eff == "auditor" else (False, "Financial statements are visible to the company owner and auditors only.")
        if p.startswith(DATA_PREFIX):
            return (True, "") if eff in ("admin", "auditor") else (False, deny)
        return True, ""

    # ---- writes ----
    if eff == "auditor":
        return False, "Your account is view-only (Auditor). Ask your company owner if you need to make changes."
    if eff == "accountant":
        return ((True, "") if (method, p) in ACCOUNTANT_WRITES else (False, deny))
    if eff == "admin":
        return ((False, deny) if (method, p) in OWNER_ONLY_WRITES else (True, ""))
    return False, deny


def permissions_for(ctx: dict) -> dict:
    """What the frontend needs to know to show/hide menus and buttons."""
    if not ctx.get("enabled"):
        eff = "owner"  # feature off => legacy behaviour => nothing hidden
    else:
        eff = EFFECTIVE_ROLE.get(ctx.get("role"), "auditor")
    is_owner = eff == "owner"
    return {
        "effective_role": eff,
        "can_view_statements": is_owner or eff == "auditor",
        "can_post_entries": eff in ("owner", "admin", "accountant"),
        "can_manage_master_data": eff in ("owner", "admin"),
        "can_use_data_transfer": eff in ("owner", "admin"),
        "read_only": eff == "auditor",
    }


# --------------------------------------------------------------------------
# Access context (cached briefly -- this runs on every request)
# --------------------------------------------------------------------------
_TTL_SECONDS = 15
_CACHE: dict[str, tuple[float, dict]] = {}


def invalidate_access_cache(user_id: Optional[str] = None) -> None:
    if user_id:
        _CACHE.pop(user_id, None)
    else:
        _CACHE.clear()


def load_access_context(user_id: str, service_client=None, use_cache: bool = True) -> Optional[dict]:
    """Role, company, feature switch and assigned buildings for one user.
    Read with the service client because a suspended/blocked session can't read
    its own row through RLS; this only ever describes the CALLER themselves."""
    now = time.time()
    if use_cache:
        hit = _CACHE.get(user_id)
        if hit and hit[0] > now:
            return hit[1]

    sc = service_client or get_service_client()
    rows = (
        sc.table("profiles")
        .select("id, company_id, role, full_name, is_platform_admin, companies(access_control_enabled)")
        .eq("id", user_id)
        .execute()
        .data
    )
    if not rows:
        return None
    row = rows[0]
    enabled = bool((row.get("companies") or {}).get("access_control_enabled"))
    building_ids: list[str] = []
    if enabled:
        building_ids = [
            r["building_id"]
            for r in sc.table("user_building_access").select("building_id").eq("user_id", user_id).execute().data
        ]
    ctx = {
        "user_id": user_id,
        "company_id": row["company_id"],
        "role": row["role"],
        "full_name": row.get("full_name"),
        "is_platform_admin": bool(row.get("is_platform_admin")),
        "enabled": enabled,
        "building_ids": building_ids,
        "scoped": bool(building_ids),
    }
    _CACHE[user_id] = (now + _TTL_SECONDS, ctx)
    return ctx


# --------------------------------------------------------------------------
# FastAPI dependency -- attached once per router in main.py
# --------------------------------------------------------------------------
def enforce_access(request: Request, authorization: Optional[str] = Header(None)) -> None:
    # No bearer token => a public endpoint (e.g. the WhatsApp invoice link), or
    # a request the endpoint's own auth dependency will reject. Not our job here.
    if not authorization or not authorization.startswith("Bearer "):
        return
    try:
        payload = jwt.decode(authorization.split(" ", 1)[1], options={"verify_signature": False})
    except jwt.PyJWTError:
        return
    user_id = payload.get("sub")
    if not user_id:
        return

    route = request.scope.get("route")
    route_path = getattr(route, "path", None) or request.url.path

    ctx = load_access_context(user_id)
    if ctx is None:
        return  # no profile -> the endpoint's own checks produce the right error
    allowed, reason = decide(ctx, request.method, route_path)
    if not allowed:
        raise HTTPException(status_code=403, detail=reason)
