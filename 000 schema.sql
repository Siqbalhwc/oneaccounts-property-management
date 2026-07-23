-- ============================================================================
-- PROPERTY MANAGEMENT SYSTEM — SUPABASE SCHEMA
-- Multi-tenant from day one via company_id + Row Level Security (RLS)
-- ============================================================================
-- Notes:
--   * auth.users is Supabase's built-in auth table. We link app users to it
--     via profiles.id = auth.users.id.
--   * Every business table carries company_id, even where it could be derived
--     via a join, because RLS policies are far simpler/faster when they can
--     filter directly on company_id without extra joins.
--   * updated_at triggers keep audit trails accurate.
-- ============================================================================

create extension if not exists "uuid-ossp";

-- ============================================================================
-- 1. COMPANIES (TENANTS OF THE SAAS ITSELF)
-- ============================================================================
create table companies (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  address text,
  phone text,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 2. PROFILES (APP USERS) — extends auth.users
-- ============================================================================
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  full_name text not null,
  role text not null default 'staff' check (role in ('owner','admin','manager','accountant','staff')),
  phone text,
  created_at timestamptz not null default now()
);

-- Helper function used inside every RLS policy below.
create or replace function auth_company_id()
returns uuid
language sql stable
as $$
  select company_id from profiles where id = auth.uid()
$$;

-- ============================================================================
-- 3. BUILDINGS / FLOORS / ROOMS
-- ============================================================================
create table buildings (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  address text,
  owner_name text,          -- who owns the building (for owner_ledger)
  owner_phone text,
  created_at timestamptz not null default now()
);

create table floors (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  building_id uuid not null references buildings(id) on delete cascade,
  floor_number int not null,
  name text,                -- e.g. "Ground Floor", "Mezzanine"
  created_at timestamptz not null default now()
);

create table rooms (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  building_id uuid not null references buildings(id) on delete cascade,
  floor_id uuid not null references floors(id) on delete cascade,
  room_number text not null,
  room_type text,            -- e.g. "1-bed", "studio", "shop"
  status text not null default 'vacant' check (status in ('vacant','occupied','under_maintenance','reserved')),
  base_rent numeric(12,2),   -- reference/default rent, actual rent lives on lease_charges
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Full maintenance/repair/carpeting history per room
create table room_history (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  room_id uuid not null references rooms(id) on delete cascade,
  entry_type text not null check (entry_type in ('maintenance','repair','carpeting','painting','plumbing','electrical','other')),
  description text not null,
  vendor_name text,
  cost numeric(12,2) default 0,
  performed_date date not null,
  photo_urls text[],         -- Supabase storage URLs
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 4. TENANTS (CNIC-BASED IDENTITY)
-- ============================================================================
create table tenants (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  cnic text not null,
  full_name text not null,
  phone text not null,       -- used for WhatsApp later
  email text,
  emergency_contact_name text,
  emergency_contact_phone text,
  cnic_copy_url text,
  created_at timestamptz not null default now(),
  unique (company_id, cnic)  -- CNIC unique per company, not globally (multi-tenant safe)
);

-- ============================================================================
-- 5. LEASES / AGREEMENTS
-- ============================================================================
create table leases (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete restrict,
  room_id uuid not null references rooms(id) on delete restrict,
  start_date date not null,
  end_date date not null,     -- typically start_date + 1 year
  status text not null default 'active' check (status in ('active','terminated','expired')),
  terminated_at date,
  termination_reason text,
  agreement_doc_url text,     -- signed PDF in Supabase storage
  created_at timestamptz not null default now()
);

-- Editable, itemized rent components (Rent, Internet, Parking, Water, custom...)
-- effective_to = null means "currently in effect". When user edits an amount,
-- close out the old row (set effective_to) and insert a new one — this keeps
-- full history of rent changes instead of overwriting data.
create table lease_charges (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  lease_id uuid not null references leases(id) on delete cascade,
  label text not null,        -- 'Rent','Internet Fee','Parking Fee','Water Bill', or custom
  amount numeric(12,2) not null,
  effective_from date not null default current_date,
  effective_to date,
  created_at timestamptz not null default now()
);

create index idx_lease_charges_active on lease_charges(lease_id) where effective_to is null;

-- ============================================================================
-- 6. SECURITY DEPOSITS
-- ============================================================================
create table security_deposits (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  lease_id uuid not null references leases(id) on delete cascade,
  amount_received numeric(12,2) not null,
  date_received date not null,
  status text not null default 'held' check (status in ('held','partially_refunded','refunded')),
  amount_refunded numeric(12,2) default 0,
  date_refunded date,
  created_at timestamptz not null default now()
);

-- Deductions taken from the deposit at refund time (damages, unpaid dues, etc.)
create table security_deposit_deductions (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  security_deposit_id uuid not null references security_deposits(id) on delete cascade,
  reason text not null,
  amount numeric(12,2) not null,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 7. INVOICES & PAYMENTS
-- ============================================================================
create table invoices (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  lease_id uuid not null references leases(id) on delete cascade,
  invoice_month date not null,   -- store as first-of-month, e.g. 2026-07-01
  due_date date not null,
  total_amount numeric(12,2) not null,
  status text not null default 'draft' check (status in ('draft','sent','paid','partial','overdue','cancelled')),
  pdf_url text,
  sent_via_whatsapp_at timestamptz,   -- populated once WhatsApp integration is live
  created_at timestamptz not null default now(),
  unique (lease_id, invoice_month)
);

-- Snapshot of charges at the time the invoice was generated
-- (so later edits to lease_charges don't retroactively change old invoices)
create table invoice_line_items (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  label text not null,
  amount numeric(12,2) not null
);

create table payments (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  invoice_id uuid references invoices(id) on delete set null,
  tenant_id uuid not null references tenants(id) on delete restrict,
  amount numeric(12,2) not null,
  payment_date date not null default current_date,
  payment_method text check (payment_method in ('cash','bank_transfer','cheque','other')),
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 8. EXPENSES (ACTUAL BILLS PAID, SALARIES, REPAIRS, ETC.)
-- ============================================================================
create table expense_categories (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,          -- 'Water Bill','Electricity','Gas','Repairs','Salaries','Other'
  unique (company_id, name)
);

create table expenses (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  building_id uuid references buildings(id) on delete set null,  -- null = company-wide expense
  category_id uuid not null references expense_categories(id),
  vendor_name text,
  amount numeric(12,2) not null,
  expense_date date not null,
  description text,
  receipt_url text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 9. STAFF & SALARIES
-- ============================================================================
create table staff (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  building_id uuid references buildings(id) on delete set null,  -- null = works across buildings
  full_name text not null,
  designation text,           -- 'Guard','Plumber','Sweeper','Manager'...
  phone text,
  joining_date date,
  monthly_salary numeric(12,2) not null,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now()
);

create table salary_payments (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  staff_id uuid not null references staff(id) on delete cascade,
  salary_month date not null,    -- first-of-month
  amount_paid numeric(12,2) not null,
  payment_date date not null default current_date,
  unique (staff_id, salary_month)
);

-- ============================================================================
-- 10. OWNER LEDGER (MONTHLY PAYABLE / PAID PER BUILDING)
-- ============================================================================
create table owner_ledger (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  building_id uuid not null references buildings(id) on delete cascade,
  ledger_month date not null,      -- first-of-month
  total_collected numeric(12,2) not null default 0,
  total_expenses numeric(12,2) not null default 0,
  amount_payable numeric(12,2) not null default 0,   -- collected - expenses - company commission (if any)
  amount_paid numeric(12,2) not null default 0,
  paid_date date,
  status text not null default 'pending' check (status in ('pending','partial','paid')),
  created_at timestamptz not null default now(),
  unique (building_id, ledger_month)
);

-- ============================================================================
-- 11. AUDIT LOG (who changed what — important once multiple staff have access)
-- ============================================================================
create table audit_log (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid references profiles(id),
  action text not null,          -- 'update_rent','refund_deposit','delete_expense', etc.
  table_name text not null,
  record_id uuid,
  details jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 12. USEFUL VIEWS
-- ============================================================================

-- Compare what was billed to tenants vs what was actually paid out, per building/month/category
-- e.g. Water Bill collected from tenants vs actual Water Bill paid to utility company
create view v_collection_vs_expense as
select
  b.id as building_id,
  b.company_id,
  b.name as building_name,
  ili.label,
  date_trunc('month', i.invoice_month) as month,
  sum(ili.amount) as amount_billed_to_tenants
from invoice_line_items ili
join invoices i on i.id = ili.invoice_id
join leases l on l.id = i.lease_id
join rooms r on r.id = l.room_id
join buildings b on b.id = r.building_id
group by b.id, b.company_id, b.name, ili.label, date_trunc('month', i.invoice_month);

-- Simple monthly P&L rollup per company.
-- Built from three independently-aggregated CTEs, joined with FULL OUTER JOIN
-- so a month with expenses/salaries but no income (or vice versa) still
-- shows up correctly instead of being silently dropped.
create view v_monthly_pnl as
with income as (
  select company_id, date_trunc('month', payment_date) as month, sum(amount) as total_income
  from payments
  group by company_id, date_trunc('month', payment_date)
),
expense as (
  select company_id, date_trunc('month', expense_date) as month, sum(amount) as total_expenses
  from expenses
  group by company_id, date_trunc('month', expense_date)
),
salary as (
  select company_id, date_trunc('month', salary_month) as month, sum(amount_paid) as total_salaries
  from salary_payments
  group by company_id, date_trunc('month', salary_month)
)
select
  coalesce(income.company_id, expense.company_id, salary.company_id) as company_id,
  coalesce(income.month, expense.month, salary.month) as month,
  coalesce(income.total_income, 0) as total_income,
  coalesce(expense.total_expenses, 0) as total_expenses,
  coalesce(salary.total_salaries, 0) as total_salaries
from income
full outer join expense
  on expense.company_id = income.company_id and expense.month = income.month
full outer join salary
  on salary.company_id = coalesce(income.company_id, expense.company_id)
  and salary.month = coalesce(income.month, expense.month);

-- ============================================================================
-- 13. updated_at TRIGGER (rooms only needs it for now; extend as needed)
-- ============================================================================
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_rooms_updated_at
before update on rooms
for each row execute function set_updated_at();

-- ============================================================================
-- 14. ROW LEVEL SECURITY — enable + policies for every business table
-- ============================================================================
alter table companies enable row level security;
alter table profiles enable row level security;
alter table buildings enable row level security;
alter table floors enable row level security;
alter table rooms enable row level security;
alter table room_history enable row level security;
alter table tenants enable row level security;
alter table leases enable row level security;
alter table lease_charges enable row level security;
alter table security_deposits enable row level security;
alter table security_deposit_deductions enable row level security;
alter table invoices enable row level security;
alter table invoice_line_items enable row level security;
alter table payments enable row level security;
alter table expense_categories enable row level security;
alter table expenses enable row level security;
alter table staff enable row level security;
alter table salary_payments enable row level security;
alter table owner_ledger enable row level security;
alter table audit_log enable row level security;

-- profiles: a user can only see profiles in their own company
create policy profiles_isolation on profiles
  for all using (company_id = auth_company_id());

-- companies: a user can only see their own company row
create policy companies_isolation on companies
  for all using (id = auth_company_id());

-- Generic pattern applied to every remaining table: company_id = auth_company_id()
create policy buildings_isolation on buildings for all using (company_id = auth_company_id());
create policy floors_isolation on floors for all using (company_id = auth_company_id());
create policy rooms_isolation on rooms for all using (company_id = auth_company_id());
create policy room_history_isolation on room_history for all using (company_id = auth_company_id());
create policy tenants_isolation on tenants for all using (company_id = auth_company_id());
create policy leases_isolation on leases for all using (company_id = auth_company_id());
create policy lease_charges_isolation on lease_charges for all using (company_id = auth_company_id());
create policy security_deposits_isolation on security_deposits for all using (company_id = auth_company_id());
create policy security_deposit_deductions_isolation on security_deposit_deductions for all using (company_id = auth_company_id());
create policy invoices_isolation on invoices for all using (company_id = auth_company_id());
create policy invoice_line_items_isolation on invoice_line_items for all using (company_id = auth_company_id());
create policy payments_isolation on payments for all using (company_id = auth_company_id());
create policy expense_categories_isolation on expense_categories for all using (company_id = auth_company_id());
create policy expenses_isolation on expenses for all using (company_id = auth_company_id());
create policy staff_isolation on staff for all using (company_id = auth_company_id());
create policy salary_payments_isolation on salary_payments for all using (company_id = auth_company_id());
create policy owner_ledger_isolation on owner_ledger for all using (company_id = auth_company_id());
create policy audit_log_isolation on audit_log for all using (company_id = auth_company_id());

-- ============================================================================
-- 15. HELPFUL INDEXES (company_id is filtered on every query — index it everywhere)
-- ============================================================================
create index idx_buildings_company on buildings(company_id);
create index idx_floors_company on floors(company_id);
create index idx_rooms_company on rooms(company_id);
create index idx_rooms_building on rooms(building_id);
create index idx_room_history_company on room_history(company_id);
create index idx_tenants_company on tenants(company_id);
create index idx_leases_company on leases(company_id);
create index idx_leases_tenant on leases(tenant_id);
create index idx_leases_room on leases(room_id);
create index idx_invoices_company on invoices(company_id);
create index idx_invoices_lease on invoices(lease_id);
create index idx_payments_company on payments(company_id);
create index idx_expenses_company on expenses(company_id);
create index idx_owner_ledger_company on owner_ledger(company_id);

-- ============================================================================
-- 16. SEED DATA (default expense categories for a new company)
-- ============================================================================
-- Run this after inserting a new company row, replacing :company_id
-- insert into expense_categories (company_id, name) values
--   (:company_id, 'Water Bill'), (:company_id, 'Electricity'), (:company_id, 'Gas'),
--   (:company_id, 'Repairs'), (:company_id, 'Salaries'), (:company_id, 'Other');
