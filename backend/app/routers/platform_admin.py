"""
Add these to app/routers/platform_admin.py (alongside whatever's already
there -- the Tower cross-tenant view, etc). They all sit behind whatever
dependency that file already uses to gate access to platform admins only
(shown here as `require_platform_admin`, matching the naming convention of
`require_owner_or_admin` in deps.py -- adjust the import to whatever your
file actually calls it).

Endpoints:
    GET  /platform-admin/companies/{company_id}/backup
         -> downloads a single .json file: everything that company owns.

    POST /platform-admin/companies/{company_id}/restore
         -> body: multipart file upload (the .json from above), restores
            into {company_id}, which MUST be a brand-new, empty company
            (create it via /signup first, or the bootstrap SQL, with
            nothing else done to it yet).
"""

import json
from datetime import date, datetime
from decimal import Decimal
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from supabase import Client

from app.core.deps import get_service_client, require_platform_admin

router = APIRouter(prefix="/platform-admin", tags=["Platform Admin"])


def _json_default(obj):
    if isinstance(obj, (date, datetime)):
        return obj.isoformat()
    if isinstance(obj, Decimal):
        return float(obj)
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")


@router.get("/companies/{company_id}/backup")
def backup_company(
    company_id: str,
    _admin: None = Depends(require_platform_admin),
    service_client: Client = Depends(get_service_client),
):
    """
    Full, single-file backup of one company: every business table (buildings,
    rooms, tenants, leases, chart of accounts, every journal entry, etc).
    Uses the service-role client deliberately -- this bypasses RLS on
    purpose, since a platform admin needs to read across the one company
    being backed up regardless of their own company_id. Access is gated by
    require_platform_admin above, not by RLS, for this one endpoint.

    NOTE: does not include team member logins (`profiles`) or the audit
    trail -- see the comment block at the top of schema_patch_022 for why.
    """
    result = service_client.rpc(
        "platform_admin_export_company", {"p_company_id": company_id}
    ).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Company not found or has no data")

    company_name = (result.data.get("company") or {}).get("name") or "company"
    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in company_name)
    filename = f"backup_{safe_name}_{date.today().isoformat()}.json"

    payload = json.dumps(result.data, indent=2, default=_json_default).encode("utf-8")

    return StreamingResponse(
        BytesIO(payload),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/companies/{company_id}/restore")
def restore_company(
    company_id: str,
    file: UploadFile = File(...),
    _admin: None = Depends(require_platform_admin),
    service_client: Client = Depends(get_service_client),
):
    """
    Restores a backup .json (from the endpoint above) into {company_id}.
    {company_id} must already exist (create it via /signup or the bootstrap
    SQL first) and must be completely empty -- the underlying SQL function
    refuses to run otherwise, specifically so this can never silently merge
    into or overwrite a company that already has real data.

    Every ID in the backup is regenerated on the way in, so the same backup
    file can safely be restored into as many fresh companies as you like
    (e.g. testing a migration, or setting up a duplicate/demo company).
    """
    raw = file.file.read()
    try:
        backup_data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"That file isn't valid JSON: {e}")

    try:
        result = service_client.rpc(
            "platform_admin_import_company",
            {
                "p_backup": backup_data,
                "p_target_company_id": company_id,
                "p_force": False,
            },
        ).execute()
    except Exception as e:
        # The SQL function raises a clear exception (unresolved rows, target
        # not empty, etc) and the whole restore rolls back automatically --
        # nothing partial is ever left behind. Surface that message as-is.
        raise HTTPException(status_code=400, detail=str(e))

    return result.data
