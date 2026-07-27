"""
Self-serve signup for a BRAND NEW company. This is intentionally public
(no bearer token required) since a person signing up doesn't have an
account yet. It's the only place in the backend that uses the service-role
client without first checking an existing user's identity -- because
there's no existing identity to check yet. Everything it creates (the new
auth user, company, and profile) is generated fresh here, not supplied by
the caller in a way that could let them attach themselves to someone else's
company.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr

from app.core.deps import get_service_client

router = APIRouter(prefix="/signup", tags=["Signup"])


class SignupRequest(BaseModel):
    company_name: str
    full_name: str
    email: EmailStr
    password: str


DEFAULT_EXPENSE_CATEGORIES = ["Water Bill", "Electricity", "Gas", "Repairs", "Salaries", "Other"]


@router.post("", status_code=201)
def signup(payload: SignupRequest, service_client=Depends(get_service_client)):
    if len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")

    # 1. Create the Supabase Auth user
    try:
        auth_result = service_client.auth.admin.create_user(
            {
                "email": payload.email,
                "password": payload.password,
                "email_confirm": True,  # skip email verification for a smoother first login
            }
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not create account: {e}")

    user_id = auth_result.user.id

    try:
        # 2. Create their new, isolated company
        company = (
            service_client.table("companies")
            .insert({"name": payload.company_name})
            .execute()
            .data[0]
        )

        # 3. Link the new user to it as owner
        service_client.table("profiles").insert(
            {
                "id": user_id,
                "company_id": company["id"],
                "full_name": payload.full_name,
                "role": "owner",
            }
        ).execute()

        # 4. Seed default expense categories so they're not starting from zero
        service_client.table("expense_categories").insert(
            [{"company_id": company["id"], "name": name} for name in DEFAULT_EXPENSE_CATEGORIES]
        ).execute()

    except Exception as e:
        # Best-effort rollback of the auth user if company/profile setup fails,
        # so a failed signup doesn't leave an orphaned login with no company.
        try:
            service_client.auth.admin.delete_user(user_id)
        except Exception:
            pass
        raise HTTPException(status_code=400, detail=f"Signup failed while setting up your company: {e}")

    return {"message": "Account created", "company_id": company["id"]}
