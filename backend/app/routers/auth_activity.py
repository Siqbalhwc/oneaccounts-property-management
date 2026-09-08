"""
Two small endpoints that sit between "Supabase confirms the password was
correct" and "the dashboard actually loads":

  POST /auth/log-login    -- call right after a successful Supabase sign-in
                              (login page, and signup's auto-sign-in). Logs
                              the attempt AND tells the frontend whether to
                              proceed or show a pending/suspended screen.
  GET  /auth/access-status -- same status check, no log row. Used by the
                              dashboard layout on page load/refresh so
                              browsing around isn't recorded as a fresh
                              "login attempt" -- only real sign-ins are.

Both use the SERVICE-ROLE client deliberately. This is the one place a
pending or suspended user's own RLS session genuinely cannot answer "why
am I blocked" -- auth_company_id() (schema_patch_019/027) returns NULL for
them, so their own session can't even read their own company's status.
Reading that status here, purely to explain it back to the same user who
already owns it, does not grant them any actual data access -- every real
business endpoint is still independently enforced by Postgres RLS.
"""

from typing import Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from app.core.deps import get_current_user, get_service_client

router = APIRouter(prefix="/auth", tags=["Auth"])


class AccessStatusResponse(BaseModel):
    access_status: str  # "active" | "pending" | "suspended" | "company_suspended" | "no_profile"
    message: str
    company_name: Optional[str] = None


def _resolve_access_status(service_client, user_id: str):
    """Returns (access_status, message, company_name, company_id)."""
    rows = (
        service_client.table("profiles")
        .select("company_id, is_suspended, companies(name, status, suspended_reason)")
        .eq("id", user_id)
        .execute()
        .data
    )
    if not rows:
        return "no_profile", "No account found for this login.", None, None

    row = rows[0]
    company = row.get("companies") or {}
    company_name = company.get("name")
    company_id = row.get("company_id")

    if row.get("is_suspended"):
        return (
            "suspended",
            "Your account has been suspended. Contact your company owner for help.",
            company_name,
            company_id,
        )

    company_status = company.get("status", "active")
    if company_status == "pending":
        return (
            "pending",
            "Your company's signup is awaiting approval. You'll get access as soon as it's approved.",
            company_name,
            company_id,
        )
    if company_status == "suspended":
        reason = company.get("suspended_reason")
        message = "Your company's access has been suspended."
        if reason:
            message += f" Reason: {reason}"
        return "company_suspended", message, company_name, company_id

    return "active", "Access granted.", company_name, company_id


def _client_ip(request: Request) -> Optional[str]:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


@router.post("/log-login", response_model=AccessStatusResponse)
def log_login(
    request: Request,
    user: dict = Depends(get_current_user),
    service_client=Depends(get_service_client),
):
    status, message, company_name, company_id = _resolve_access_status(
        service_client, user["user_id"]
    )

    try:
        service_client.table("login_log").insert(
            {
                "user_id": user["user_id"],
                "company_id": company_id,
                "email": user.get("email"),
                "access_status": status,
                "success": status == "active",
                "ip_address": _client_ip(request),
                "user_agent": request.headers.get("user-agent"),
            }
        ).execute()
    except Exception:
        # Logging must never block the person from finding out their own
        # access status -- same "best-effort, swallow the error" pattern
        # used by write_audit_log() elsewhere in this codebase.
        pass

    return AccessStatusResponse(access_status=status, message=message, company_name=company_name)


@router.get("/access-status", response_model=AccessStatusResponse)
def access_status(
    user: dict = Depends(get_current_user),
    service_client=Depends(get_service_client),
):
    status, message, company_name, _ = _resolve_access_status(service_client, user["user_id"])
    return AccessStatusResponse(access_status=status, message=message, company_name=company_name)
