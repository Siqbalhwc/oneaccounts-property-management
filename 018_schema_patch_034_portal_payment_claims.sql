create table if not exists tenant_portal_payment_claims (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  lease_id uuid references leases(id) on delete set null,
  invoice_ids jsonb not null default '[]'::jsonb,
  amount numeric(14, 2) not null check (amount > 0),
  payment_method text not null check (payment_method in ('cash', 'bank_transfer')),
  paid_to text,
  payment_date date not null,
  reference text,
  note text,
  status text not null default 'pending' check (status in ('pending', 'processing', 'approved', 'rejected', 'cancelled')),
  reject_reason text,
  approved_amount numeric(14, 2),
  approved_account_id uuid references chart_of_accounts(id) on delete set null,
  receipt_group_id uuid,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_portal_claims_company_status on tenant_portal_payment_claims (company_id, status, created_at desc);
create index if not exists idx_portal_claims_tenant on tenant_portal_payment_claims (tenant_id, created_at desc);

alter table tenant_portal_payment_claims enable row level security;

select
  (select count(*) from information_schema.tables where table_name = 'tenant_portal_payment_claims') as claims_table_should_be_one,
  (select count(*) from pg_policies where tablename = 'tenant_portal_payment_claims') as policies_should_be_zero,
  (select count(*) from pg_tables where tablename = 'tenant_portal_payment_claims' and rowsecurity) as rls_on_should_be_one;
