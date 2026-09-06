-- ============================================================================
-- PATCH 026 — chart_of_accounts.is_cash_or_bank
-- ============================================================================
-- "Which account was this actually received into" pickers (security
-- deposit receipts, and similar spots) were filtering by account_type =
-- 'asset' -- but Accounts Receivable is ALSO an asset account, so it was
-- selectable there even though it's never a place real money lands. This
-- adds an explicit flag so only genuine bank/cash accounts show up in
-- those pickers, regardless of what else is filed under "asset".
--
-- Defaults to false for every existing account (nothing is auto-guessed)
-- except the single account with code '1000', which every company's
-- default chart of accounts seeds as "Bank / Cash" -- that one is safe to
-- flag automatically since it's a fixed part of the standard setup, not a
-- user-typed custom account. Any other real bank accounts you've since
-- added yourself (a specific bank name, a JazzCash account, etc.) need a
-- one-time manual flip -- from the Chart of Accounts page, click "No"
-- next to that account under "Bank / cash account" to mark it "Yes".
-- This is deliberate: guessing from account codes/names for anything
-- beyond the fixed default risks flagging the wrong account in some
-- company's custom chart, which would be worse than asking you to confirm
-- it once yourself.
-- ============================================================================

alter table public.chart_of_accounts
  add column if not exists is_cash_or_bank boolean not null default false;

update public.chart_of_accounts
set is_cash_or_bank = true
where code = '1000' and is_system = true;

-- Confirm: lists every account now flagged as a bank/cash account, per company.
select company_id, code, name, is_cash_or_bank
from public.chart_of_accounts
where is_cash_or_bank = true
order by company_id, code;
