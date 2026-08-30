-- ============================================================================
-- PATCH 022 — general_ledger(): add tenant filtering
-- ============================================================================
-- What this does: adds a new p_tenant_id parameter to general_ledger(),
-- the same way p_owner_id already works. Lets you view an account's
-- ledger (e.g. "Security Deposits Held") filtered down to just one
-- tenant's movements and running balance -- useful when a tenant has
-- paid a deposit in more than one installment and you want to see
-- exactly what they've paid so far.
--
-- Rebuilt from the EXACT current definition (confirmed via
-- pg_get_functiondef before writing this), with only two additions:
--   1. a new p_tenant_id uuid parameter, defaulting to null (so every
--      existing call that doesn't pass it keeps working exactly as before)
--   2. one extra line in the WHERE clause filtering by it when provided
--
-- Nothing about how amounts/balances are calculated changes for existing
-- callers -- passing no tenant filter (or the same 4 params as before)
-- behaves identically to today.
--
-- Function is dropped and recreated (rather than a plain CREATE OR
-- REPLACE) because adding a parameter changes the signature -- Postgres
-- would otherwise create a second, overloaded version alongside the old
-- one instead of truly replacing it. The explicit GRANT at the end
-- restores the same access the original function already had.
-- ============================================================================

drop function if exists public.general_ledger(uuid, date, date, uuid);

CREATE OR REPLACE FUNCTION public.general_ledger(
  p_account_id uuid,
  p_date_from date DEFAULT NULL::date,
  p_date_to date DEFAULT NULL::date,
  p_owner_id uuid DEFAULT NULL::uuid,
  p_tenant_id uuid DEFAULT NULL::uuid
)
 RETURNS TABLE(entry_date date, description text, source_type text, direction text, amount numeric, building_name text, room_number text, owner_name text, tenant_name text, running_balance numeric)
 LANGUAGE sql
 STABLE
AS $function$
  with lines as (
    select
      je.entry_date, je.description, je.source_type,
      jl.direction, jl.amount, coa.account_type,
      b.name as building_name, r.room_number, o.name as owner_name, t.full_name as tenant_name,
      jl.created_at
    from journal_lines jl
    join journal_entries je on je.id = jl.journal_entry_id
    join chart_of_accounts coa on coa.id = jl.account_id
    left join buildings b on b.id = jl.building_id
    left join rooms r on r.id = jl.room_id
    left join owners o on o.id = jl.owner_id
    left join tenants t on t.id = jl.tenant_id
    where jl.account_id = p_account_id
      and coa.company_id = auth_company_id()
      and (p_date_from is null or je.entry_date >= p_date_from)
      and (p_date_to is null or je.entry_date <= p_date_to)
      and (p_owner_id is null or jl.owner_id = p_owner_id)
      and (p_tenant_id is null or jl.tenant_id = p_tenant_id)
  )
  select
    entry_date, description, source_type, direction, amount,
    building_name, room_number, owner_name, tenant_name,
    -- Sign follows each account's own natural balance -- debit-positive for
    -- assets/expenses, credit-positive for liabilities/equity/income. Without
    -- this, a payable that's owed would show as a confusing negative number.
    sum(
      case
        when account_type in ('asset', 'expense') then (case when direction = 'debit' then amount else -amount end)
        else (case when direction = 'credit' then amount else -amount end)
      end
    ) over (order by entry_date, created_at rows between unbounded preceding and current row) as running_balance
  from lines
  order by entry_date, created_at
$function$;

grant execute on function public.general_ledger(uuid, date, date, uuid, uuid) to authenticated, anon;

-- Confirm: should show the new 5-parameter signature.
select proname, pg_get_function_identity_arguments(oid) as arguments
from pg_proc
where proname = 'general_ledger';
