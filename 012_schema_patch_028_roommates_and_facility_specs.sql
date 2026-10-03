-- ============================================================================
-- PATCH 028 -- roommates (police/monitoring register) + facility specs
-- Run in Supabase SQL Editor. Safe to re-run (everything is IF NOT EXISTS).
--
-- 1. room_occupants (roommates): the table already exists in production, but
--    its CREATE was never committed to the repo. This patch declares it
--    idempotently (no-op if present) and adds the columns the new features
--    need. Nothing is ever hard-deleted: "removing" a roommate stamps
--    moved_out_date + who/when/why, so the police register keeps history.
--
-- 2. lease_facilities: one row per facility spec on a lease, e.g. one row per
--    parked vehicle, one for the internet connection, one per meter. Specs
--    live in a jsonb column so ANY facility (including custom ones) can carry
--    its own fields without another schema change.
-- ============================================================================

-- ---------------------------------------------------------------- roommates
create table if not exists room_occupants (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete restrict,
  room_id uuid not null references rooms(id) on delete restrict,
  full_name text not null,
  cnic text,
  phone text,
  address text,
  moved_in_date date not null default current_date,
  moved_out_date date,
  created_at timestamptz not null default now()
);

alter table room_occupants add column if not exists lease_id uuid references leases(id) on delete set null;
alter table room_occupants add column if not exists relationship text;
alter table room_occupants add column if not exists removed_at timestamptz;
alter table room_occupants add column if not exists removed_by uuid references profiles(id);
alter table room_occupants add column if not exists removal_reason text;
alter table room_occupants add column if not exists added_by uuid references profiles(id);

create index if not exists idx_room_occupants_company on room_occupants(company_id);
create index if not exists idx_room_occupants_tenant on room_occupants(tenant_id);
create index if not exists idx_room_occupants_room on room_occupants(room_id);

alter table room_occupants enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'room_occupants'
      and policyname = 'room_occupants_isolation'
  ) then
    create policy room_occupants_isolation on room_occupants
      for all using (company_id = auth_company_id());
  end if;
end;
$$;

-- --------------------------------------------------------- facility specs
create table if not exists lease_facilities (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  lease_id uuid not null references leases(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete restrict,
  room_id uuid not null references rooms(id) on delete restrict,
  label text not null,                       -- 'Parking', 'Internet', 'Electricity', or any custom name
  kind text not null default 'other'
    check (kind in ('parking','internet','electricity','water','gas','other')),
  specs jsonb not null default '{}'::jsonb,  -- e.g. {"vehicle_number":"LEA-1234","card_number":"0042"}
  notes text,
  is_active boolean not null default true,
  ended_on date,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_lease_facilities_company on lease_facilities(company_id);
create index if not exists idx_lease_facilities_lease on lease_facilities(lease_id);
create index if not exists idx_lease_facilities_tenant on lease_facilities(tenant_id);
create index if not exists idx_lease_facilities_kind on lease_facilities(company_id, kind) where is_active;

alter table lease_facilities enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'lease_facilities'
      and policyname = 'lease_facilities_isolation'
  ) then
    create policy lease_facilities_isolation on lease_facilities
      for all using (company_id = auth_company_id());
  end if;
end;
$$;

drop trigger if exists trg_lease_facilities_updated_at on lease_facilities;
create trigger trg_lease_facilities_updated_at
before update on lease_facilities
for each row execute function set_updated_at();

-- Verify
select 'room_occupants' as table_name, count(*) from room_occupants
union all
select 'lease_facilities', count(*) from lease_facilities;
