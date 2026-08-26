-- ============================================================================
-- PATCH 019 — company/user suspension + per-company feature flags
-- Run this AFTER everything else currently in your database.
-- ============================================================================
-- What this adds:
--   1. companies.status ('active' | 'suspended') + suspended_reason/at
--   2. companies.max_users (null = unlimited)
--   3. profiles.is_suspended (individual user, independent of company status)
--   4. company_feature_flags table (generic, so new flags don't need new
--      columns later -- just insert a new feature_key)
--   5. auth_company_id() now returns NULL for a suspended user OR a
--      suspended company. Since EVERY RLS policy in this system is
--      "company_id = auth_company_id()", this one change blocks ALL data
--      access for a suspended tenant/user everywhere, automatically --
--      no need to touch every router. This matches how this schema already
--      enforces every other isolation rule: in the database, not in Python.
-- ============================================================================

-- 1 & 2: companies
alter table companies
  add column if not exists status text not null default 'active' check (status in ('active','suspended')),
  add column if not exists suspended_reason text,
  add column if not exists suspended_at timestamptz,
  add column if not exists max_users int;  -- null = unlimited

-- 3: profiles
alter table profiles
  add column if not exists is_suspended boolean not null default false,
  add column if not exists suspended_at timestamptz;

-- 4: feature flags (generic key/value per company, so this table doesn't
-- need a schema change every time a new toggleable feature is added)
create table if not exists company_feature_flags (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  feature_key text not null,       -- e.g. 'data_export', 'data_import', 'whatsapp_invoicing'
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id),
  unique (company_id, feature_key)
);

alter table company_feature_flags enable row level security;

-- Companies can READ their own flags (so the frontend can hide/show
-- features), but only platform admin (via service-role client, checked in
-- Python -- same pattern as every other platform_admin.py endpoint) can
-- WRITE them. A plain company-scoped user has no INSERT/UPDATE/DELETE
-- policy here at all, so RLS blocks writes from a normal company session
-- even if someone tried to call this table directly.
create policy company_feature_flags_read on company_feature_flags
  for select using (company_id = auth_company_id());

create index if not exists idx_company_feature_flags_company on company_feature_flags(company_id);

-- 5: the single enforcement point
create or replace function auth_company_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select p.company_id
  from profiles p
  join companies c on c.id = p.company_id
  where p.id = auth.uid()
    and p.is_suspended = false
    and c.status = 'active'
$$;

-- Verify: this should show is_suspended/status columns and the new table
select column_name from information_schema.columns where table_name = 'companies' and column_name in ('status','suspended_reason','suspended_at','max_users');
select column_name from information_schema.columns where table_name = 'profiles' and column_name in ('is_suspended','suspended_at');
select * from company_feature_flags limit 1;
