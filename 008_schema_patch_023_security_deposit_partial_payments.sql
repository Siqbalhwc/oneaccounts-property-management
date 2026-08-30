-- ============================================================================
-- PATCH 023 — security deposits: support partial payments
-- ============================================================================
-- Today, security_deposits.amount_received is really the AGREED/target
-- deposit amount (set at lease signing), and the deposit is only ever
-- marked received in one lump sum. This adds proper support for a tenant
-- paying the deposit across multiple installments.
--
-- What this adds:
--   1. security_deposit_payments -- one row per actual payment received
--      toward a deposit (mirrors how the existing "payments" table already
--      supports multiple partial payments against one invoice).
--   2. Backfills one payment row for every deposit that was already marked
--      fully received under the old one-shot system, using its existing
--      amount_received/received_account_id/date_received -- so historical
--      deposits show up in the new payment history exactly as they
--      actually happened, with nothing recalculated or changed.
--
-- security_deposits.amount_received keeps its existing meaning (the
-- AGREED target amount) and is NOT renamed, to avoid touching every place
-- that already reads it. "How much has actually come in" is now the SUM
-- of security_deposit_payments.amount for that deposit.
-- ============================================================================

create table if not exists security_deposit_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  security_deposit_id uuid not null references security_deposits(id),
  amount numeric not null,
  account_id uuid not null references chart_of_accounts(id),
  payment_date date not null default current_date,
  created_at timestamptz not null default now()
);

alter table security_deposit_payments enable row level security;

drop policy if exists security_deposit_payments_company_isolation on security_deposit_payments;
create policy security_deposit_payments_company_isolation
  on security_deposit_payments
  for all
  using (company_id = auth_company_id())
  with check (company_id = auth_company_id());

create index if not exists idx_security_deposit_payments_deposit
  on security_deposit_payments (security_deposit_id);

-- Backfill: one payment row per deposit already marked fully received
-- under the old system, using exactly what was already recorded for it.
insert into security_deposit_payments (company_id, security_deposit_id, amount, account_id, payment_date)
select company_id, id, amount_received, received_account_id, coalesce(date_received, current_date)
from security_deposits
where is_received = true
  and received_account_id is not null
  and not exists (
    select 1 from security_deposit_payments sdp where sdp.security_deposit_id = security_deposits.id
  );

-- Confirm: every previously-received deposit should now have exactly one
-- backfilled payment row whose amount matches the deposit's own amount.
select
  sd.id as deposit_id,
  sd.amount_received as agreed_amount,
  coalesce(sum(sdp.amount), 0) as total_paid_now
from security_deposits sd
left join security_deposit_payments sdp on sdp.security_deposit_id = sd.id
where sd.is_received = true
group by sd.id, sd.amount_received;
