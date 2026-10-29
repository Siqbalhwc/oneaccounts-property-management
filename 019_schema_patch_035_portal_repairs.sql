alter table tenant_portal_requests add column if not exists category text;
alter table tenant_portal_requests add column if not exists room_id uuid references rooms(id) on delete set null;

alter table tenant_portal_requests drop constraint if exists tenant_portal_requests_status_check;
alter table tenant_portal_requests add constraint tenant_portal_requests_status_check check (status in ('open', 'in_progress', 'resolved', 'declined', 'cancelled'));

select
  (select count(*) from information_schema.columns where table_name = 'tenant_portal_requests' and column_name in ('category', 'room_id')) as new_columns_should_be_two,
  (select pg_get_constraintdef(oid) like '%in_progress%' from pg_constraint where conname = 'tenant_portal_requests_status_check') as status_check_allows_in_progress,
  (select count(*) from pg_policies where tablename = 'tenant_portal_requests') as policies_should_be_zero;
