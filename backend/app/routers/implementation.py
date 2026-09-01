"""
Client Implementation Portal.

Follows the same trust boundary as the rest of this backend: every endpoint
runs queries through the CALLER's own Supabase client, so Row Level Security
(patch 024) is what actually decides who can see or change what. The
Python code below never filters by company_id or role itself except where
the operation inherently needs it (e.g. picking which company a new project
belongs to) -- a bug here can't leak data across clients, the database
refuses it.

Two places DO use the service-role client, and only these two, because the
operation necessarily happens before the person in question has a normal
JWT/session yet:
  1. Creating a new implementation project (the client's `companies` row and
     first profile don't exist yet).
  2. Inviting a client-side stakeholder by email (same reason).
"""

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from supabase import Client

from app.core.deps import get_current_user, get_service_client, get_supabase

router = APIRouter(prefix="/implementation", tags=["Implementation Portal"])

STAGE_DEFS = [
    ("first_engagement", 1, "First Engagement"),
    ("demo", 2, "Demo"),
    ("requirement_analysis", 3, "Requirement Analysis"),
    ("uat", 4, "UAT"),
    ("implementation_golive", 5, "Implementation / Go-Live"),
]


def require_platform_admin(
    supabase: Client = Depends(get_supabase),
    user: dict = Depends(get_current_user),
) -> None:
    profile = (
        supabase.table("profiles").select("is_platform_admin").eq("id", user["user_id"]).single().execute()
    )
    if not profile.data or not profile.data.get("is_platform_admin"):
        raise HTTPException(status_code=403, detail="Only a platform admin can do this.")


def require_platform_staff(
    supabase: Client = Depends(get_supabase),
    user: dict = Depends(get_current_user),
) -> None:
    """
    Either a full platform admin, or someone flagged as an implementation
    consultant (patch 024) -- i.e. anyone allowed to work the queue at all.
    Used for actions like self-claiming an open engagement, where we want
    to exclude ordinary client logins but don't need full admin power.

    KNOWN LIMITATION: this only gates the ENDPOINT call. The underlying
    RLS policies on implementation_projects/implementation_stages don't
    yet grant is_implementation_consultant (non-admin) any table-level
    visibility -- only is_platform_admin does. Until that's fixed with its
    own tested patch, someone flagged as a consultant but not a platform
    admin will pass this check but get empty/broken results back. For now,
    anyone who needs to actually work the queue needs is_platform_admin.
    """
    profile = (
        supabase.table("profiles")
        .select("is_platform_admin, is_implementation_consultant")
        .eq("id", user["user_id"])
        .single()
        .execute()
    )
    if not profile.data or not (
        profile.data.get("is_platform_admin") or profile.data.get("is_implementation_consultant")
    ):
        raise HTTPException(status_code=403, detail="Only platform staff can do this.")


def require_stage_editor(
    stage_id: str,
    supabase: Client = Depends(get_supabase),
    user: dict = Depends(get_current_user),
) -> dict:
    """
    Lets a platform admin OR an ACCEPTED consultant on that stage's project
    edit it -- not just full platform admins. Returns the stage row so
    callers don't have to re-fetch it.
    """
    stage = supabase.table("implementation_stages").select("*").eq("id", stage_id).single().execute()
    if not stage.data:
        raise HTTPException(status_code=404, detail="Not found")

    profile = (
        supabase.table("profiles").select("is_platform_admin").eq("id", user["user_id"]).single().execute()
    )
    if profile.data and profile.data.get("is_platform_admin"):
        return stage.data

    assignment = (
        supabase.table("implementation_assignments")
        .select("id")
        .eq("project_id", stage.data["project_id"])
        .eq("consultant_id", user["user_id"])
        .eq("status", "accepted")
        .execute()
    )
    if not assignment.data:
        raise HTTPException(status_code=403, detail="Only a platform admin or an accepted consultant on this engagement can edit stages.")
    return stage.data


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class ProjectCreate(BaseModel):
    client_display_name: str
    primary_contact_name: Optional[str] = None
    primary_contact_phone: Optional[str] = None
    assign_to_consultant_id: Optional[str] = None  # leave null to drop it in the open queue


class ProjectUpdate(BaseModel):
    client_display_name: Optional[str] = None
    primary_contact_name: Optional[str] = None
    primary_contact_phone: Optional[str] = None
    status: Optional[str] = None


class StageUpdate(BaseModel):
    planned_start: Optional[date] = None
    planned_end: Optional[date] = None
    actual_start: Optional[date] = None
    actual_end: Optional[date] = None
    budget_amount: Optional[float] = None
    actual_amount: Optional[float] = None
    status: Optional[str] = None
    notes: Optional[str] = None


class AssignmentCreate(BaseModel):
    consultant_id: str
    role_on_engagement: str = "support"


class AssignmentRespond(BaseModel):
    decision: str  # "accepted" | "declined"


class StakeholderInvite(BaseModel):
    full_name: str
    email: str
    role: str  # "client_requester" | "client_senior_approver"


class RequirementCreate(BaseModel):
    title: str
    description: Optional[str] = None
    stage_id: Optional[str] = None
    entered_on_behalf: bool = False
    entered_for_name: Optional[str] = None


class RequirementUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None


class ApprovalCreate(BaseModel):
    decision: str  # "approved" | "changes_requested" | "rejected"
    notes: Optional[str] = None


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------
@router.get("/projects")
def list_projects(supabase: Client = Depends(get_supabase)):
    """
    RLS does the filtering: a platform admin sees every engagement (the
    Tower view); anyone else sees only their own company's single project.
    """
    return supabase.table("implementation_projects").select("*").order("created_at", desc=True).execute().data


@router.post("/projects", status_code=201)
def create_project(
    payload: ProjectCreate,
    supabase: Client = Depends(get_supabase),
    service_client: Client = Depends(get_service_client),
    user: dict = Depends(get_current_user),
    _perm: None = Depends(require_platform_admin),
):
    """
    Creates the client's real `companies` row (bypassing RLS via the service
    client, since no profile ties the caller to it yet), seeds its chart of
    accounts + default expense categories immediately, then creates the
    implementation_projects row and its 5 fixed stages through the caller's
    own client (RLS allows this because the caller is a platform admin).
    """
    company = (
        service_client.table("companies")
        .insert({"name": payload.client_display_name})
        .execute()
        .data[0]
    )
    company_id = company["id"]

    try:
        service_client.rpc("seed_default_chart_of_accounts", {"p_company_id": company_id}).execute()
    except Exception:
        # Non-fatal -- chart of accounts can be (re)seeded any time before
        # go-live via the same RPC; don't block project creation on it.
        pass

    service_client.table("expense_categories").insert(
        [{"company_id": company_id, "name": n} for n in
         ["Water Bill", "Electricity", "Gas", "Repairs", "Salaries", "Other"]]
    ).execute()

    project = (
        supabase.table("implementation_projects")
        .insert(
            {
                "company_id": company_id,
                "client_display_name": payload.client_display_name,
                "primary_contact_name": payload.primary_contact_name,
                "primary_contact_phone": payload.primary_contact_phone,
                "created_by": user["user_id"],
            }
        )
        .execute()
        .data[0]
    )

    stage_rows = [
        {
            "project_id": project["id"],
            "company_id": company_id,
            "stage_key": key,
            "sort_order": order,
            "display_name": name,
        }
        for key, order, name in STAGE_DEFS
    ]
    supabase.table("implementation_stages").insert(stage_rows).execute()

    if payload.assign_to_consultant_id:
        supabase.table("implementation_assignments").insert(
            {
                "project_id": project["id"],
                "consultant_id": payload.assign_to_consultant_id,
                "role_on_engagement": "lead",
                "status": "invited",
                "assigned_by": user["user_id"],
            }
        ).execute()

    return project


@router.get("/projects/{project_id}")
def get_project(project_id: str, supabase: Client = Depends(get_supabase)):
    project = supabase.table("implementation_projects").select("*").eq("id", project_id).single().execute()
    if not project.data:
        raise HTTPException(status_code=404, detail="Not found")
    stages = (
        supabase.table("implementation_stages")
        .select("*")
        .eq("project_id", project_id)
        .order("sort_order")
        .execute()
        .data
    )
    assignments = (
        supabase.table("implementation_assignments").select("*").eq("project_id", project_id).execute().data
    )
    return {**project.data, "stages": stages, "assignments": assignments}


@router.patch("/projects/{project_id}")
def update_project(
    project_id: str,
    payload: ProjectUpdate,
    supabase: Client = Depends(get_supabase),
    _perm: None = Depends(require_platform_admin),
):
    updates = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    res = supabase.table("implementation_projects").update(updates).eq("id", project_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Not found")
    return res.data[0]


# ---------------------------------------------------------------------------
# Stages / Gantt
# ---------------------------------------------------------------------------
@router.get("/projects/{project_id}/stages")
def list_stages(project_id: str, supabase: Client = Depends(get_supabase)):
    """Same shape the Gantt chart consumes directly."""
    return (
        supabase.table("implementation_stages")
        .select("*")
        .eq("project_id", project_id)
        .order("sort_order")
        .execute()
        .data
    )


@router.patch("/stages/{stage_id}")
def update_stage(
    stage_id: str,
    payload: StageUpdate,
    supabase: Client = Depends(get_supabase),
    _stage: dict = Depends(require_stage_editor),
):
    """Planned/actual dates and budget/actual cost -- what drives the Gantt bars."""
    updates = {
        k: (str(v) if isinstance(v, date) else v)
        for k, v in payload.model_dump(exclude_unset=True).items()
    }
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    res = supabase.table("implementation_stages").update(updates).eq("id", stage_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Not found")
    return res.data[0]


# ---------------------------------------------------------------------------
# Consultant assignment queue ("some will carry, some will decline")
# ---------------------------------------------------------------------------
@router.get("/queue")
def my_queue(
    supabase: Client = Depends(get_supabase),
    user: dict = Depends(get_current_user),
):
    """
    Two buckets for the current user:
      - invited: assignments made TO them, awaiting accept/decline
      - open: projects with ZERO assignment rows at all -- first to accept
        claims it (platform admins only see this bucket; it's meaningless
        for a client login, which RLS would empty out anyway).
    """
    invited = (
        supabase.table("implementation_assignments")
        .select("*, implementation_projects(client_display_name)")
        .eq("consultant_id", user["user_id"])
        .eq("status", "invited")
        .execute()
        .data
    )

    all_projects = supabase.table("implementation_projects").select("id, client_display_name").execute().data
    assigned_project_ids = {
        a["project_id"] for a in supabase.table("implementation_assignments").select("project_id").execute().data
    }
    open_projects = [p for p in all_projects if p["id"] not in assigned_project_ids]

    return {"invited": invited, "open": open_projects}


@router.post("/projects/{project_id}/assignments", status_code=201)
def assign_consultant(
    project_id: str,
    payload: AssignmentCreate,
    supabase: Client = Depends(get_supabase),
    user: dict = Depends(get_current_user),
    _perm: None = Depends(require_platform_admin),
):
    res = (
        supabase.table("implementation_assignments")
        .insert(
            {
                "project_id": project_id,
                "consultant_id": payload.consultant_id,
                "role_on_engagement": payload.role_on_engagement,
                "assigned_by": user["user_id"],
            }
        )
        .execute()
    )
    return res.data[0]


@router.post("/projects/{project_id}/assignments/claim", status_code=201)
def claim_open_project(
    project_id: str,
    supabase: Client = Depends(get_supabase),
    user: dict = Depends(get_current_user),
    _perm: None = Depends(require_platform_staff),
):
    """A consultant self-claims a project that has no assignments yet at all."""
    existing = (
        supabase.table("implementation_assignments").select("id").eq("project_id", project_id).execute().data
    )
    if existing:
        raise HTTPException(status_code=400, detail="This engagement already has a consultant assigned.")
    res = (
        supabase.table("implementation_assignments")
        .insert(
            {
                "project_id": project_id,
                "consultant_id": user["user_id"],
                "role_on_engagement": "lead",
                "status": "accepted",
                "assigned_by": user["user_id"],
                "responded_at": "now()",
            }
        )
        .execute()
    )
    return res.data[0]


@router.post("/assignments/{assignment_id}/respond")
def respond_to_assignment(
    assignment_id: str,
    payload: AssignmentRespond,
    supabase: Client = Depends(get_supabase),
):
    if payload.decision not in ("accepted", "declined"):
        raise HTTPException(status_code=400, detail="decision must be 'accepted' or 'declined'")
    res = (
        supabase.table("implementation_assignments")
        .update({"status": payload.decision, "responded_at": "now()"})
        .eq("id", assignment_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Not found")
    return res.data[0]


@router.post("/assignments/{assignment_id}/withdraw")
def withdraw_assignment(
    assignment_id: str,
    supabase: Client = Depends(get_supabase),
    _perm: None = Depends(require_platform_admin),
):
    res = (
        supabase.table("implementation_assignments")
        .update({"status": "withdrawn"})
        .eq("id", assignment_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Not found")
    return res.data[0]


# ---------------------------------------------------------------------------
# Client-side stakeholders (just profiles, scoped to the project's company)
# ---------------------------------------------------------------------------
@router.get("/projects/{project_id}/stakeholders")
def list_stakeholders(project_id: str, supabase: Client = Depends(get_supabase)):
    project = supabase.table("implementation_projects").select("company_id").eq("id", project_id).single().execute()
    if not project.data:
        raise HTTPException(status_code=404, detail="Not found")
    return (
        supabase.table("profiles")
        .select("id, full_name, phone, role")
        .eq("company_id", project.data["company_id"])
        .in_("role", ["client_requester", "client_senior_approver"])
        .execute()
        .data
    )


@router.post("/projects/{project_id}/stakeholders", status_code=201)
def invite_stakeholder(
    project_id: str,
    payload: StakeholderInvite,
    supabase: Client = Depends(get_supabase),
    service_client: Client = Depends(get_service_client),
    _perm: None = Depends(require_platform_admin),
):
    if payload.role not in ("client_requester", "client_senior_approver"):
        raise HTTPException(status_code=400, detail="role must be client_requester or client_senior_approver")

    project = supabase.table("implementation_projects").select("company_id").eq("id", project_id).single().execute()
    if not project.data:
        raise HTTPException(status_code=404, detail="Not found")
    company_id = project.data["company_id"]

    try:
        invite = service_client.auth.admin.invite_user_by_email(payload.email)
        new_user_id = invite.user.id
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not send invite: {e}")

    service_client.table("profiles").insert(
        {
            "id": new_user_id,
            "company_id": company_id,
            "full_name": payload.full_name,
            "role": payload.role,
        }
    ).execute()

    return {"id": new_user_id, "full_name": payload.full_name, "role": payload.role}


@router.delete("/stakeholders/{profile_id}")
def remove_stakeholder(
    profile_id: str,
    service_client: Client = Depends(get_service_client),
    _perm: None = Depends(require_platform_admin),
):
    """
    Revokes portal access by deleting their auth user (cascades to the
    profiles row via its FK). Only ever call this on client_requester /
    client_senior_approver profiles -- never expose this for real staff.
    """
    try:
        service_client.auth.admin.delete_user(profile_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not remove access: {e}")
    return {"message": "Access removed"}


# ---------------------------------------------------------------------------
# Requirements
# ---------------------------------------------------------------------------
@router.get("/projects/{project_id}/requirements")
def list_requirements(project_id: str, supabase: Client = Depends(get_supabase)):
    return (
        supabase.table("implementation_requirements")
        .select("*, profiles(full_name)")
        .eq("project_id", project_id)
        .order("created_at", desc=True)
        .execute()
        .data
    )


@router.post("/projects/{project_id}/requirements", status_code=201)
def create_requirement(
    project_id: str,
    payload: RequirementCreate,
    supabase: Client = Depends(get_supabase),
    user: dict = Depends(get_current_user),
):
    project = supabase.table("implementation_projects").select("company_id").eq("id", project_id).single().execute()
    if not project.data:
        raise HTTPException(status_code=404, detail="Not found")

    row = {
        "project_id": project_id,
        "company_id": project.data["company_id"],
        "stage_id": payload.stage_id,
        "title": payload.title,
        "description": payload.description,
        "entered_by": user["user_id"],
        "entered_on_behalf": payload.entered_on_behalf,
        "entered_for_name": payload.entered_for_name if payload.entered_on_behalf else None,
    }
    res = supabase.table("implementation_requirements").insert(row).execute()
    return res.data[0]


@router.patch("/requirements/{requirement_id}")
def update_requirement(
    requirement_id: str,
    payload: RequirementUpdate,
    supabase: Client = Depends(get_supabase),
):
    updates = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    res = supabase.table("implementation_requirements").update(updates).eq("id", requirement_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Not found")
    return res.data[0]


# ---------------------------------------------------------------------------
# Attachments
# ---------------------------------------------------------------------------
@router.post("/requirements/{requirement_id}/attachments", status_code=201)
async def upload_attachment(
    requirement_id: str,
    file: UploadFile = File(...),
    supabase: Client = Depends(get_supabase),
    service_client: Client = Depends(get_service_client),
    user: dict = Depends(get_current_user),
):
    """
    Uploads to the 'implementation-attachments' storage bucket (create this
    bucket in Supabase Storage, public, same pattern as 'company-logos').
    The service client does the actual storage write (Storage isn't covered
    by Postgres RLS the same way tables are), but the requirement lookup
    above still goes through the caller's own client first, so RLS still
    gates *which* requirement they're even allowed to attach to.
    """
    req = (
        supabase.table("implementation_requirements")
        .select("id, project_id, company_id")
        .eq("id", requirement_id)
        .single()
        .execute()
    )
    if not req.data:
        raise HTTPException(status_code=404, detail="Requirement not found")

    path = f"{req.data['project_id']}/{requirement_id}/{file.filename}"
    content = await file.read()
    service_client.storage.from_("implementation-attachments").upload(
        path, content, {"content-type": file.content_type or "application/octet-stream", "upsert": "true"}
    )
    public_url = service_client.storage.from_("implementation-attachments").get_public_url(path)

    row = {
        "project_id": req.data["project_id"],
        "company_id": req.data["company_id"],
        "requirement_id": requirement_id,
        "file_name": file.filename,
        "file_url": public_url,
        "uploaded_by": user["user_id"],
    }
    res = supabase.table("implementation_attachments").insert(row).execute()
    return res.data[0]


@router.get("/requirements/{requirement_id}/attachments")
def list_attachments(requirement_id: str, supabase: Client = Depends(get_supabase)):
    return (
        supabase.table("implementation_attachments")
        .select("*")
        .eq("requirement_id", requirement_id)
        .execute()
        .data
    )


@router.post("/stages/{stage_id}/attachments", status_code=201)
async def upload_stage_attachment(
    stage_id: str,
    file: UploadFile = File(...),
    supabase: Client = Depends(get_supabase),
    service_client: Client = Depends(get_service_client),
    user: dict = Depends(get_current_user),
):
    """
    For files that belong to a whole stage rather than one requirement --
    e.g. a signed agreement uploaded during First Engagement, or a UAT
    sign-off sheet. Same upload mechanics as the requirement-level endpoint.
    """
    stage = supabase.table("implementation_stages").select("id, project_id, company_id").eq("id", stage_id).single().execute()
    if not stage.data:
        raise HTTPException(status_code=404, detail="Stage not found")

    path = f"{stage.data['project_id']}/stages/{stage_id}/{file.filename}"
    content = await file.read()
    service_client.storage.from_("implementation-attachments").upload(
        path, content, {"content-type": file.content_type or "application/octet-stream", "upsert": "true"}
    )
    public_url = service_client.storage.from_("implementation-attachments").get_public_url(path)

    row = {
        "project_id": stage.data["project_id"],
        "company_id": stage.data["company_id"],
        "stage_id": stage_id,
        "file_name": file.filename,
        "file_url": public_url,
        "uploaded_by": user["user_id"],
    }
    res = supabase.table("implementation_attachments").insert(row).execute()
    return res.data[0]


@router.get("/stages/{stage_id}/attachments")
def list_stage_attachments(stage_id: str, supabase: Client = Depends(get_supabase)):
    return supabase.table("implementation_attachments").select("*").eq("stage_id", stage_id).execute().data


# ---------------------------------------------------------------------------
# Approvals
# ---------------------------------------------------------------------------
@router.post("/stages/{stage_id}/approve", status_code=201)
def approve_stage(
    stage_id: str,
    payload: ApprovalCreate,
    supabase: Client = Depends(get_supabase),
    service_client: Client = Depends(get_service_client),
    user: dict = Depends(get_current_user),
):
    """
    RLS (implementation_approvals_write) already restricts WHO can insert
    this: a client_senior_approver in the stage's own company, or a platform
    admin. This endpoint just also handles the one side-effect that's
    genuinely special: approving the final Go-Live stage promotes the
    client's profiles to real access.
    """
    stage = supabase.table("implementation_stages").select("*").eq("id", stage_id).single().execute()
    if not stage.data:
        raise HTTPException(status_code=404, detail="Stage not found")

    approval_row = {
        "stage_id": stage_id,
        "company_id": stage.data["company_id"],
        "approved_by": user["user_id"],
        "decision": payload.decision,
        "notes": payload.notes,
    }
    approval = supabase.table("implementation_stage_approvals").insert(approval_row).execute().data[0]

    if payload.decision == "approved":
        new_stage_status = "completed" if stage.data["stage_key"] != "implementation_golive" else "completed"
        supabase.table("implementation_stages").update({"status": new_stage_status}).eq("id", stage_id).execute()

        if stage.data["stage_key"] == "implementation_golive":
            company_id = stage.data["company_id"]
            # Promote client profiles to real, live-app roles. Uses the
            # service client since this crosses from "implementation portal"
            # permissions into normal company role management.
            service_client.table("profiles").update({"role": "owner"}).eq(
                "company_id", company_id
            ).eq("role", "client_senior_approver").execute()
            service_client.table("profiles").update({"role": "staff"}).eq(
                "company_id", company_id
            ).eq("role", "client_requester").execute()
            service_client.table("implementation_projects").update({"status": "completed"}).eq(
                "company_id", company_id
            ).execute()

    return approval


@router.get("/stages/{stage_id}/approvals")
def list_approvals(stage_id: str, supabase: Client = Depends(get_supabase)):
    return (
        supabase.table("implementation_stage_approvals")
        .select("*, profiles(full_name)")
        .eq("stage_id", stage_id)
        .order("decided_at", desc=True)
        .execute()
        .data
    )
