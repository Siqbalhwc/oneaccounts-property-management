with ar as (
  select company_id, id as account_id from chart_of_accounts where code = '1100'
),
pairs as (
  select distinct jl.company_id, jl.tenant_id, ar.account_id
  from journal_lines jl
  join ar on ar.account_id = jl.account_id and ar.company_id = jl.company_id
  where jl.tenant_id is not null
),
cmp as (
  select
    p.company_id,
    p.tenant_id,
    coalesce((select round(sum(case when l.direction = 'debit' then l.amount else -l.amount end), 2)
              from portal_tenant_ledger(p.company_id, p.tenant_id, p.account_id) l), 0) as portal_closing,
    round(tenant_account_balance_as_of(p.company_id, p.account_id, p.tenant_id, date '2100-01-01')::numeric, 2) as books_closing
  from pairs p
)
select
  count(*) as tenants_checked,
  count(*) filter (where portal_closing = books_closing) as matching,
  count(*) filter (where portal_closing <> books_closing) as differing_should_be_zero
from cmp;
