alter table companies add column if not exists unit_type text not null default 'apartment';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'companies_unit_type_format_check') then
    alter table companies add constraint companies_unit_type_format_check check (unit_type ~ '^[a-z_]{2,30}$');
  end if;
end
$$;

select
  (select count(*) from companies) as companies_total,
  (select count(*) from companies where unit_type = 'apartment') as on_default_apartment,
  (select count(*) from information_schema.columns where table_name = 'companies' and column_name = 'unit_type') as column_present,
  (select count(*) from pg_constraint where conname = 'companies_unit_type_format_check') as check_present;
