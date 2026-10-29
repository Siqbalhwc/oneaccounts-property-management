"""
Tenant Portal plug-in.

ATTACH:  main.py calls register(app) once.
DETACH:  remove that one call (and optionally this folder). Nothing in the core imports
         from here; the only core touch-points are the hook bus (app/core/hooks.py) and
         the emit() lines in crud/generic.py, which do nothing when no plug-in listens.
"""

from fastapi import FastAPI

from .handlers import register_handlers


def register(app: FastAPI, guard: list, api_prefix: str) -> None:
    from .admin_router import router as admin_router
    from .portal_data_router import router as portal_data_router
    from .portal_router import router as portal_router

    register_handlers()
    app.include_router(admin_router, prefix=api_prefix, dependencies=guard)  # staff: same access rules as the rest of the app
    app.include_router(portal_router, prefix=api_prefix)  # tenants: own token, deliberately NOT behind the staff guard
    app.include_router(portal_data_router, prefix=api_prefix)  # tenants: invoices, ledger, change requests (same token rules)
