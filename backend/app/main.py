from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import (
    company_settings,
    invoices,
    leases,
    owner_ledger,
    payments,
    reports,
    security_deposits,
    simple_resources,
)

app = FastAPI(title="Property Management API", version="0.1.0")

# Tighten this to your actual Vercel domain(s) before going to production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

API_PREFIX = "/api"

app.include_router(simple_resources.buildings_router, prefix=API_PREFIX)
app.include_router(simple_resources.floors_router, prefix=API_PREFIX)
app.include_router(simple_resources.rooms_router, prefix=API_PREFIX)
app.include_router(simple_resources.room_history_router, prefix=API_PREFIX)
app.include_router(simple_resources.tenants_router, prefix=API_PREFIX)
app.include_router(simple_resources.expense_categories_router, prefix=API_PREFIX)
app.include_router(simple_resources.expenses_router, prefix=API_PREFIX)
app.include_router(simple_resources.staff_router, prefix=API_PREFIX)
app.include_router(simple_resources.salary_payments_router, prefix=API_PREFIX)

app.include_router(leases.router, prefix=API_PREFIX)
app.include_router(security_deposits.router, prefix=API_PREFIX)
app.include_router(invoices.router, prefix=API_PREFIX)
app.include_router(payments.router, prefix=API_PREFIX)
app.include_router(owner_ledger.router, prefix=API_PREFIX)
app.include_router(reports.router, prefix=API_PREFIX)
app.include_router(company_settings.router, prefix=API_PREFIX)


@app.get("/")
def health_check():
    return {"status": "ok", "service": "property-management-api"}
