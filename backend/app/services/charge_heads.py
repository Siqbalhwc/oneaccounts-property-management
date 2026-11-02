"""
Charge heads -- one name per GL account.

A charge on a lease is saved with a name (its label) and posts to a GL account
through the company's charge_type_accounts mapping. Names used to be typed by
hand, so "Commission" and "COMMISSION" (or "Gas" and "Gas Bill") were treated
as different things: the lookup was case-sensitive, a name that missed the
mapping silently posted to Other Income, and reports showed one column per
spelling.

This module is the single place that decides:
  * norm_label()        -- two names are "the same" when they match ignoring
                           capital letters and extra spaces
  * ChargeHeads         -- label -> GL account (same matching), and the one
                           name a column / charge line shows for that account:
                           the account's report_head_name if it has one (e.g.
                           Due to Owners shows as "Rent"), else its own name.

Read-only. Every query goes through the caller's own RLS-scoped client, so it
only ever sees the caller's own company's accounts and mappings.
"""

import logging
from typing import Dict, Optional

from supabase import Client

logger = logging.getLogger("app.charge_heads")

OTHER_INCOME_CODE = "4100"


def norm_label(label: Optional[str]) -> str:
    """Case-insensitive, whitespace-collapsed key for comparing charge names."""
    return " ".join(str(label or "").split()).casefold()


def head_name(account: Optional[dict]) -> str:
    """The name shown for a GL account's charge head."""
    if not account:
        return "Other Income"
    custom = str(account.get("report_head_name") or "").strip()
    return custom or str(account.get("name") or "Other Income")


class ChargeHeads:
    """Loads the company's accounts and charge mappings once."""

    def __init__(self, supabase: Client, company_id: Optional[str] = None):
        def accounts_query(columns: str):
            q = supabase.table("chart_of_accounts").select(columns)
            return q.eq("company_id", company_id) if company_id else q

        try:
            rows = accounts_query("id, code, name, report_head_name").execute().data or []
        except Exception:
            # Migration 023 (report_head_name) not run yet: use plain account names.
            logger.warning("chart_of_accounts.report_head_name unavailable; using account names")
            rows = accounts_query("id, code, name").execute().data or []
        self.accounts: Dict[str, dict] = {r["id"]: r for r in rows}
        self.other_income = next((r for r in rows if r.get("code") == OTHER_INCOME_CODE), None)

        q = supabase.table("charge_type_accounts").select("label, account_id")
        if company_id:
            q = q.eq("company_id", company_id)
        self._label_to_account: Dict[str, str] = {}
        for m in q.execute().data or []:
            self._label_to_account.setdefault(norm_label(m["label"]), m["account_id"])

    def account_for_label(self, label: Optional[str]) -> Optional[dict]:
        """The GL account a charge name posts to; Other Income when unmapped."""
        account_id = self._label_to_account.get(norm_label(label))
        return self.accounts.get(account_id) if account_id else self.other_income

    def is_mapped(self, label: Optional[str]) -> bool:
        return norm_label(label) in self._label_to_account

    def heading_for_label(self, label: Optional[str]) -> str:
        return head_name(self.account_for_label(label))

    def heading_for_account(self, account_id: Optional[str]) -> str:
        return head_name(self.accounts.get(account_id)) if account_id else head_name(self.other_income)
