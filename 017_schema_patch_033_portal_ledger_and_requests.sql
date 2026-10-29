create or replace function portal_tenant_ledger(
  p_company_id uuid,
  p_tenant_id uuid,
  p_account_id uuid,
  p_date_from date default null,
  p_date_to date default null
)
returns table(
  entry_date date,
  description text,
  source_type text,
  direction text,
  amount numeric,
  building_name text,
  room_number text,
  running_balance numeric
)
language sql
stable
as $function$
  with lines as (
    select
      je.entry_date, je.description, je.source_type,
      jl.direction, jl.amount, coa.account_type,
      b.name as building_name, r.room_number,
      jl.created_at
    from journal_lines jl
    join journal_entries je on je.id = jl.journal_entry_id
    join chart_of_accounts coa on coa.id = jl.account_id
    left join buildings b on b.id = jl.building_id
    left join rooms r on r.id = jl.room_id
    where jl.account_id = p_account_id
      and coa.company_id = p_company_id
      and jl.company_id = p_company_id
      and je.company_id = p_company_id
      and jl.tenant_id = p_tenant_id
      and (p_date_from is null or je.entry_date >= p_date_from)
      and (p_date_to is null or je.entry_date <= p_date_to)
  )
  select
    entry_date, description, source_type, direction, amount,
    building_name, room_number,
    sum(
      case
        when account_type in ('asset', 'expense') then (case when direction = 'debit' then amount else -amount end)
        else (case when direction = 'credit' then amount else -amount end)
      end
    ) over (order by entry_date, created_at rows between unbounded preceding and current row) as running_balance
  from lines
  order by entry_date, created_at
$function$;

create or replace function portal_tenant_ledger_opening(
  p_company_id uuid,
  p_tenant_id uuid,
  p_account_id uuid,
  p_before date
)
returns numeric
language sql
stable
as $function$
  select round(coalesce(sum(
    case
      when coa.account_type in ('asset', 'expense') then (case when jl.direction = 'debit' then jl.amount else -jl.amount end)
      else (case when jl.direction = 'credit' then jl.amount else -jl.amount end)
    end
  ), 0), 2)
  from journal_lines jl
  join journal_entries je on je.id = jl.journal_entry_id
  join chart_of_accounts coa on coa.id = jl.account_id
  where jl.account_id = p_account_id
    and coa.company_id = p_company_id
    and jl.company_id = p_company_id
    and je.company_id = p_company_id
    and jl.tenant_id = p_tenant_id
    and je.entry_date < p_before
$function$;

revoke all on function portal_tenant_ledger(uuid, uuid, uuid, date, date) from public, anon, authenticated;
revoke all on function portal_tenant_ledger_opening(uuid, uuid, uuid, date) from public, anon, authenticated;
grant execute on function portal_tenant_ledger(uuid, uuid, uuid, date, date) to service_role;
grant execute on function portal_tenant_ledger_opening(uuid, uuid, uuid, date) to service_role;

create table if not exists tenant_portal_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  kind text not null check (kind in ('invoice_change', 'repair')),
  invoice_id uuid references invoices(id) on delete set null,
  message text not null,
  status text not null default 'open' check (status in ('open', 'resolved', 'declined')),
  admin_reply text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tenant_portal_requests_company on tenant_portal_requests (company_id, status, created_at desc);
create index if not exists idx_tenant_portal_requests_tenant on tenant_portal_requests (tenant_id);

alter table tenant_portal_requests enable row level security;

select
  (select count(*) from pg_proc where proname in ('portal_tenant_ledger', 'portal_tenant_ledger_opening')) as functions_should_be_two,
  (has_function_privilege('anon', 'portal_tenant_ledger(uuid,uuid,uuid,date,date)', 'execute')
    or has_function_privilege('authenticated', 'portal_tenant_ledger(uuid,uuid,uuid,date,date)', 'execute')) as public_can_run_should_be_false,
  has_function_privilege('service_role', 'portal_tenant_ledger(uuid,uuid,uuid,date,date)', 'execute') as backend_can_run_should_be_true,
  (select count(*) from information_schema.tables where table_name = 'tenant_portal_requests') as requests_table_should_be_one,
  (select count(*) from pg_policies where tablename = 'tenant_portal_requests') as policies_should_be_zero;
