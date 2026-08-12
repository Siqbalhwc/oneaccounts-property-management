from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from supabase import Client
from postgrest.exceptions import APIError

from app.core.deps import get_current_company_id, get_current_user, get_supabase
from app.crud.generic import friendly_db_error, write_audit_log
from app.services.ledger import get_account_id, post_journal_entry

router = APIRouter(prefix="/salary-payments", tags=["Salary Payments"])


class SalaryPaymentCreate(BaseModel):
    staff_id: str
    salary_month: date  # any date within the month
    amount_paid: float
    payment_date: Optional[date] = None


@router.get("")
def list_salary_payments(supabase: Client = Depends(get_supabase)):
    return supabase.table("salary_payments").select("*").order("salary_month", desc=True).execute().data


@router.post("", status_code=201)
def record_salary_payment(
    payload: SalaryPaymentCreate,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
    user: dict = Depends(get_current_user),
):
    """
    Records a salary payment and posts Dr Salaries Expense / Cr Bank. If
    staff.building_id is set (a guard/manager dedicated to one site), the
    journal line is tagged to that building directly. If it's null (staff
    working across multiple sites), it posts untagged here -- the split
    across buildings for owner_ledger purposes comes from cost_allocations,
    same as before, not from a second set of journal lines.
    """
    staff = supabase.table("staff").select("building_id").eq("id", payload.staff_id).single().execute()
    if not staff.data:
        raise HTTPException(status_code=404, detail="Staff member not found")

    row = {
        "company_id": company_id,
        "staff_id": payload.staff_id,
        "salary_month": str(payload.salary_month.replace(day=1)),
        "amount_paid": payload.amount_paid,
        "payment_date": str(payload.payment_date or date.today()),
    }
    try:
        res = supabase.table("salary_payments").insert(row).execute()
    except APIError as e:
        status, detail = friendly_db_error(e)
        raise HTTPException(status_code=status, detail=detail)
    payment = res.data[0]

    salaries_expense_id = get_account_id(supabase, company_id, "5400")
    bank_id = get_account_id(supabase, company_id, "1000")
    post_journal_entry(
        supabase,
        company_id=company_id,
        entry_date=row["payment_date"],
        source_type="salary_payment",
        source_id=payment["id"],
        description=f"Salary payment - {payment['id']}",
        lines=[
            {"account_id": salaries_expense_id, "direction": "debit", "amount": payload.amount_paid, "building_id": staff.data.get("building_id")},
            {"account_id": bank_id, "direction": "credit", "amount": payload.amount_paid, "building_id": staff.data.get("building_id")},
        ],
    )

    write_audit_log(supabase, company_id, user["user_id"], "create", "salary_payments", payment["id"])
    return payment
