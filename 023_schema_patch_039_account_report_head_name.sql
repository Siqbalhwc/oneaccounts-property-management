alter table chart_of_accounts add column if not exists report_head_name text;

update chart_of_accounts
set report_head_name = 'Rent'
where code = '2200' and report_head_name is null;

select code, name, report_head_name
from chart_of_accounts
where report_head_name is not null
order by code;
