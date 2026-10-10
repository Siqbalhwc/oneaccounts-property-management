create table if not exists utility_bills (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  lease_id uuid not null references leases(id) on delete cascade,
  bill_month date not null,
  label text not null,
  label_key text not null,
  amount numeric(14,2) not null check (amount >= 0),
  bill_reference text,
  previous_reading numeric(14,2),
  current_reading numeric(14,2),
  source text not null default 'excel_upload',
  uploaded_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint utility_bills_month_is_first_day check (bill_month = date_trunc('month', bill_month)::date),
  constraint utility_bills_one_per_lease_month_label unique (lease_id, bill_month, label_key)
);

create index if not exists idx_utility_bills_company_month on utility_bills(company_id, bill_month);
create index if not exists idx_utility_bills_lease_month on utility_bills(lease_id, bill_month);

alter table utility_bills enable row level security;

drop policy if exists utility_bills_isolation on utility_bills;
create policy utility_bills_isolation on utility_bills
  for all
  using (company_id = auth_company_id())
  with check (company_id = auth_company_id());

drop policy if exists utility_bills_lease_visible on utility_bills;
create policy utility_bills_lease_visible on utility_bills
  as restrictive
  for all
  using (exists (select 1 from leases l where l.id = utility_bills.lease_id));

create or replace function utility_bills_check_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from leases where id = new.lease_id and company_id = new.company_id) then
    raise exception 'utility bill company does not match the lease company';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_utility_bills_company on utility_bills;
create trigger trg_utility_bills_company
before insert or update of lease_id, company_id on utility_bills
for each row execute function utility_bills_check_company();

drop trigger if exists trg_utility_bills_updated_at on utility_bills;
create trigger trg_utility_bills_updated_at
before update on utility_bills
for each row execute function set_updated_at();

select 'utility_bills ready' as status, count(*) as rows_now from utility_bills;
