create table if not exists settlement_allocations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  settlement_id text,
  lease_id uuid references leases(id) on delete cascade,
  tenant_id uuid references tenants(id) on delete set null,
  settled_on date not null,
  kind text not null,
  label text not null,
  amount numeric not null,
  account_id uuid references chart_of_accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint settlement_allocations_kind_check check (kind in ('invoice_settled', 'charge', 'refund_paid'))
);

alter table settlement_allocations enable row level security;

drop policy if exists settlement_allocations_company_isolation on settlement_allocations;
create policy settlement_allocations_company_isolation
  on settlement_allocations
  for all
  using (company_id = auth_company_id())
  with check (company_id = auth_company_id());

create index if not exists idx_settlement_allocations_company_date
  on settlement_allocations (company_id, settled_on);

create index if not exists idx_settlement_allocations_lease
  on settlement_allocations (lease_id);

select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'settlement_allocations'
order by ordinal_position;
