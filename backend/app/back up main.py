import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.routers import (
    audit_log,
    auth_activity,
    chart_of_accounts,
    company_settings,
    data_transfer,
    expenses,
    financials,
    implementation,
    invoices,
    ledger,
    leases,
    owner_ledger,
    payments,
    platform_admin,
    reports,
    room_occupants,
    salary_payments,
    security_deposits,
    signup,
    simple_resources,
    staff_allocations,
    team,
)

app = FastAPI(title="Property Management API", version="0.1.0", redirect_slashes=False)

# Restricted to origins that actually need access, instead of "*":
#  - localhost, for local development
#  - any Vercel preview/alias URL for this specific project (Vercel generates
#    a new one on every deploy, so a regex is needed rather than a fixed list)
#  - the real custom domain, once it's pointed at the frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://properties.oneaccountsbysiqbal.com",
    ],
    allow_origin_regex=r"https://oneaccounts-property-management.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # Browsers hide all response headers from JS by default except a small
    # "simple" set -- Content-Disposition isn't one of them. Without this,
    # file downloads (backup .json, Excel export/templates) still work, but
    # the frontend can't read the server's suggested filename and falls
    # back to a generic one.
    expose_headers=["Content-Disposition"],
)

# Safety net for any endpoint that raises an exception nobody caught.
# Without this, an unhandled crash could reach the browser as a bare,
# unhelpful network failure instead of a real error -- because the
# response never made it back through normal FastAPI handling to pick up
# CORS headers. This does not change behavior for any request that
# already works correctly today; it only affects the crash path, which
# previously had no defined response at all.
logger = logging.getLogger("app")


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Something went wrong on our end. Nothing was saved -- please try again."},
    )


API_PREFIX = "/api"

app.include_router(simple_resources.buildings_router, prefix=API_PREFIX)
app.include_router(simple_resources.owners_router, prefix=API_PREFIX)
app.include_router(simple_resources.floors_router, prefix=API_PREFIX)
app.include_router(simple_resources.rooms_router, prefix=API_PREFIX)
app.include_router(simple_resources.room_history_router, prefix=API_PREFIX)
app.include_router(simple_resources.tenants_router, prefix=API_PREFIX)
app.include_router(simple_resources.expense_categories_router, prefix=API_PREFIX)
app.include_router(simple_resources.staff_router, prefix=API_PREFIX)
app.include_router(expenses.router, prefix=API_PREFIX)
app.include_router(salary_payments.router, prefix=API_PREFIX)
app.include_router(room_occupants.router, prefix=API_PREFIX)

app.include_router(leases.router, prefix=API_PREFIX)
app.include_router(security_deposits.router, prefix=API_PREFIX)
app.include_router(invoices.router, prefix=API_PREFIX)
app.include_router(payments.router, prefix=API_PREFIX)
app.include_router(owner_ledger.router, prefix=API_PREFIX)
app.include_router(reports.router, prefix=API_PREFIX)
app.include_router(company_settings.router, prefix=API_PREFIX)
app.include_router(signup.router, prefix=API_PREFIX)
app.include_router(auth_activity.router, prefix=API_PREFIX)
app.include_router(team.router, prefix=API_PREFIX)
app.include_router(platform_admin.router, prefix=API_PREFIX)
app.include_router(audit_log.router, prefix=API_PREFIX)
app.include_router(staff_allocations.router, prefix=API_PREFIX)
app.include_router(chart_of_accounts.router, prefix=API_PREFIX)
app.include_router(ledger.router, prefix=API_PREFIX)
app.include_router(financials.router, prefix=API_PREFIX)
app.include_router(implementation.router, prefix=API_PREFIX)
app.include_router(data_transfer.router, prefix=API_PREFIX)


@app.get("/")
def health_check():
    return {"status": "ok", "service": "property-management-api"}
