create table if not exists tenant_portal_settings (
  company_id uuid primary key references companies(id) on delete cascade,
  portal_code text not null,
  permissions jsonb not null default '{"view_invoices": true, "view_ledger": true, "submit_payment": true, "submit_repair": true, "download_receipts": true}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists tenant_portal_settings_code_key on tenant_portal_settings (portal_code);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_portal_settings_code_format_check') then
    alter table tenant_portal_settings add constraint tenant_portal_settings_code_format_check check (portal_code ~ '^[a-z0-9-]{3,40}$');
  end if;
end
$$;

create table if not exists tenant_portal_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  username text not null,
  password_hash text not null default 'temp',
  temp_counter integer not null default 1,
  must_change_password boolean not null default true,
  token_version integer not null default 1,
  status text not null default 'active' check (status in ('active', 'disabled', 'archived')),
  permission_overrides jsonb not null default '{}'::jsonb,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists tenant_portal_accounts_tenant_key on tenant_portal_accounts (tenant_id);
create unique index if not exists tenant_portal_accounts_username_key on tenant_portal_accounts (company_id, username) where status <> 'archived';
create index if not exists idx_tenant_portal_accounts_company on tenant_portal_accounts (company_id);

alter table tenant_portal_settings enable row level security;
alter table tenant_portal_accounts enable row level security;

select
  (select count(*) from information_schema.tables where table_name = 'tenant_portal_settings') as settings_table,
  (select count(*) from information_schema.tables where table_name = 'tenant_portal_accounts') as accounts_table,
  (select count(*) from pg_policies where tablename in ('tenant_portal_settings', 'tenant_portal_accounts')) as policies_should_be_zero,
  (select count(*) from pg_tables where tablename in ('tenant_portal_settings', 'tenant_portal_accounts') and rowsecurity) as rls_on_should_be_two;
