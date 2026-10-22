alter table tenants add column if not exists owner_id uuid references owners(id) on delete restrict;

alter table tenants add column if not exists owner_room_id uuid references rooms(id) on delete restrict;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenants_owner_link_check') then
    alter table tenants add constraint tenants_owner_link_check check ((owner_id is null) = (owner_room_id is null));
  end if;
end
$$;

create unique index if not exists tenants_company_cnic_normal_key on tenants (company_id, cnic) where owner_id is null;

create unique index if not exists tenants_company_owner_room_key on tenants (company_id, owner_room_id) where owner_room_id is not null;

create index if not exists idx_tenants_owner on tenants (owner_id) where owner_id is not null;

alter table tenants drop constraint if exists tenants_company_id_cnic_key;

select
  (select count(*) from tenants) as tenants_total,
  (select count(*) from tenants where owner_id is not null) as owner_linked_tenants,
  (select count(*) from pg_indexes where tablename = 'tenants' and indexname in ('tenants_company_cnic_normal_key', 'tenants_company_owner_room_key')) as new_indexes_present,
  (select count(*) from pg_constraint where conname = 'tenants_company_id_cnic_key') as old_constraint_left;
