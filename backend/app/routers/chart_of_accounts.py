from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from supabase import Client

from app.core.deps import get_current_company_id, get_supabase, require_owner_or_admin

router = APIRouter(prefix="/chart-of-accounts", tags=["Chart of Accounts"])


@router.get("")
def list_accounts(supabase: Client = Depends(get_supabase)):
    return supabase.table("chart_of_accounts").select("*").order("code").execute().data


class AccountCreate(BaseModel):
    code: str
    name: str
    account_type: str  # asset | liability | equity | income | expense
    transfers_to_owner: bool = False


@router.post("", status_code=201)
def create_account(
    payload: AccountCreate,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
    _perm: None = Depends(require_owner_or_admin),
):
    """Lets an owner/admin add a custom account (e.g. a new income head)
    beyond the seeded defaults. is_system is always False here -- the
    protected system accounts (Bank, AR, Due to Owners, etc.) can only be
    created by the schema patch, never through this endpoint."""
    row = payload.model_dump()
    row["company_id"] = company_id
    row["is_system"] = False
    res = supabase.table("chart_of_accounts").insert(row).execute()
    return res.data[0]


class ChargeMapping(BaseModel):
    label: str
    account_id: str


@router.get("/charge-mappings")
def list_charge_mappings(supabase: Client = Depends(get_supabase)):
    """Which lease-charge label (Rent, Electricity Recovery, ...) posts to which account."""
    return supabase.table("charge_type_accounts").select("*").execute().data


@router.put("/charge-mappings")
def set_charge_mapping(
    payload: ChargeMapping,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
    _perm: None = Depends(require_owner_or_admin),
):
    """
    Upserts the account a lease-charge label posts to. Call this once when
    a new charge label is introduced (e.g. "Generator Fee") -- every future
    lease using that label will then post correctly without further setup.
    """
    account = supabase.table("chart_of_accounts").select("id").eq("id", payload.account_id).single().execute()
    if not account.data:
        raise HTTPException(status_code=404, detail="Account not found")

    existing = (
        supabase.table("charge_type_accounts")
        .select("id")
        .eq("company_id", company_id)
        .eq("label", payload.label)
        .execute()
        .data
    )
    if existing:
        res = (
            supabase.table("charge_type_accounts")
            .update({"account_id": payload.account_id})
            .eq("id", existing[0]["id"])
            .execute()
        )
    else:
        res = (
            supabase.table("charge_type_accounts")
            .insert({"company_id": company_id, "label": payload.label, "account_id": payload.account_id})
            .execute()
        )
    return res.data[0]
