-- ============================================================================
-- PATCH 020 — expenses: record which account (Bank, Cash, etc.) each expense
-- was actually paid from, instead of always assuming Bank.
-- Run this AFTER 004_schema_patch_019_suspension_and_feature_flags.sql.
-- Run this SQL step BEFORE applying the matching code patch (the code will
-- expect this column to exist).
-- ============================================================================
-- What this adds:
--   1. expenses.paid_from_account_id -- which chart-of-accounts row (Bank,
--      Cash, etc.) the expense was paid from. The backend previously always
--      credited a hardcoded "1000" (Bank) account no matter what the user
--      actually paid with.
--   2. Backfills every EXISTING expense row to whichever account has code
--      '1000' in that company's own chart of accounts -- this matches what
--      actually happened in the past (the old code always used that
--      account), so this backfill is just making the historical record
--      match reality, not changing it.
--   3. Left NULLABLE on purpose: the application layer requires this field
--      going forward (enforced in the API, not the database), but we don't
--      want a hard NOT NULL constraint here in case any company's chart of
--      accounts is missing a '1000' code for some historical reason -- that
--      should never silently break other, unrelated database writes.
-- ============================================================================

alter table expenses
  add column if not exists paid_from_account_id uuid references chart_of_accounts(id);

-- Backfill: match each expense to the Bank (code '1000') account belonging
-- to THAT SAME expense's own company (never across companies).
update expenses e
set paid_from_account_id = coa.id
from chart_of_accounts coa
where coa.company_id = e.company_id
  and coa.code = '1000'
  and e.paid_from_account_id is null;

-- Confirm: this should return 0 once everything with a matching '1000'
-- account has been backfilled. Any rows still showing here belong to a
-- company whose chart of accounts has no '1000' code -- worth a manual
-- look, but harmless (new expenses will still require a choice going
-- forward regardless).
select company_id, count(*) as expenses_still_missing_paid_from_account
from expenses
where paid_from_account_id is null
group by company_id;
