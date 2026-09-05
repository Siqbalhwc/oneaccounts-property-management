from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from supabase import Client

from app.core.deps import (
    get_current_company_id,
    get_current_user,
    get_service_client,
    get_supabase,
)

router = APIRouter(tags=["Company Settings"])


class CompanyUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None


class ProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    theme_preference: Optional[Literal["ledger", "black", "navy"]] = None


@router.get("/company/me")
def get_my_company(
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    res = supabase.table("companies").select("*").eq("id", company_id).single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Company not found")
    return res.data


@router.patch("/company/me")
def update_my_company(
    payload: CompanyUpdate,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    res = supabase.table("companies").update(updates).eq("id", company_id).execute()
    return res.data[0]


@router.post("/company/logo")
async def upload_company_logo(
    file: UploadFile = File(...),
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    """
    Uploads a company logo image to Supabase Storage and saves its public URL
    on the company row.

    Requires a PUBLIC bucket named "company-logos" to already exist in your
    Supabase project (Storage -> New bucket -> name it "company-logos" ->
    toggle "Public bucket" on). This endpoint uses the service-role key only
    for the storage write itself -- company_id has already been verified via
    the caller's own JWT before we get here, so this is safe.
    """
    allowed_types = {"image/png", "image/jpeg", "image/webp", "image/svg+xml"}
    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=400, detail="Logo must be PNG, JPEG, WEBP, or SVG"
        )

    ext = file.filename.split(".")[-1] if "." in file.filename else "png"
    path = f"{company_id}/logo.{ext}"
    contents = await file.read()

    service_client = get_service_client()
    try:
        service_client.storage.from_("company-logos").upload(
            path,
            contents,
            {"content-type": file.content_type, "upsert": "true"},
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Upload failed: {e}")

    public_url = service_client.storage.from_("company-logos").get_public_url(path)

    supabase.table("companies").update({"logo_url": public_url}).eq(
        "id", company_id
    ).execute()

    return {"logo_url": public_url}


@router.get("/profile/me")
def get_my_profile(
    supabase: Client = Depends(get_supabase),
    user: dict = Depends(get_current_user),
):
    res = (
        supabase.table("profiles")
        .select("*")
        .eq("id", user["user_id"])
        .single()
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Profile not found")
    return res.data


@router.patch("/profile/me")
def update_my_profile(
    payload: ProfileUpdate,
    supabase: Client = Depends(get_supabase),
    user: dict = Depends(get_current_user),
):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    res = (
        supabase.table("profiles")
        .update(updates)
        .eq("id", user["user_id"])
        .execute()
    )
    return res.data[0]
