"""Reactions to core events. Registered by register(); each one is failure-isolated by the
hook bus, so none of this can ever fail or slow down creating/editing a tenant."""

from app.core import hooks

from . import service as svc
from .security import is_usable_username, normalize_username


def _on_created(row: dict, company_id: str, **_):
    if svc.plugin_enabled(company_id):
        svc.ensure_settings(company_id)
        svc.create_accounts(company_id, [row])


def _on_bulk_created(company_id: str, **_):
    if svc.plugin_enabled(company_id):
        svc.ensure_settings(company_id)
        svc.create_accounts(company_id, svc.all_company_tenants(company_id))


def _on_updated(before: dict, after: dict, company_id: str, **_):
    if (before or {}).get("cnic") == (after or {}).get("cnic"):
        return
    acct = svc.get_account_for_tenant(company_id, after["id"])
    new_user = normalize_username(after.get("cnic"))
    if acct and is_usable_username(new_user) and acct["username"] != new_user:
        svc.get_service_client().table(svc.ACCOUNTS).update(
            {"username": new_user, "updated_at": svc.now_iso()}
        ).eq("company_id", company_id).eq("id", acct["id"]).execute()


def _on_archived(row: dict, company_id: str, **_):
    acct = svc.get_account_for_tenant(company_id, row["id"])
    if acct and acct["status"] != "archived":
        svc.bump_session(company_id, acct["id"], {"status": "archived"})


def _on_unarchived(row: dict, company_id: str, **_):
    acct = svc.get_account_for_tenant(company_id, row["id"])
    if acct:
        if acct["status"] == "archived":
            svc.bump_session(company_id, acct["id"], {"status": "active"})
    elif svc.plugin_enabled(company_id):
        svc.create_accounts(company_id, [row])


def register_handlers() -> None:
    hooks.on("tenants.created")(_on_created)
    hooks.on("tenants.bulk_created")(_on_bulk_created)
    hooks.on("tenants.updated")(_on_updated)
    hooks.on("tenants.archived")(_on_archived)
    hooks.on("tenants.unarchived")(_on_unarchived)
