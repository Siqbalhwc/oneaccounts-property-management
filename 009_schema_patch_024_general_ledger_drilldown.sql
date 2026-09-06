-- ============================================================================
-- PATCH 024 — general_ledger(): building/apartment filters + drill-down IDs
-- ============================================================================
-- What this does, in two parts:
--
-- 1. Two new filter parameters, the same way p_owner_id / p_tenant_id
--    already work: p_building_id and p_room_id. Lets the General Ledger
--    page narrow an account's movement down to one building or one
--    apartment, on top of the date/owner/tenant filters it already has.
--
-- 2. Two new columns in the result: source_id and journal_entry_id.
--    These power "click a figure -> see the source document" on the
--    General Ledger page. journal_entries already stores source_type and
--    source_id for every entry (that part is not new) -- this just also
--    returns them from the report, plus the journal entry's own id, so
--    the frontend can resolve each line to its invoice / receipt / voucher
--    without a second round trip.
--
-- Rebuilt from the EXACT current definition of general_ledger() (the one
-- added by patch 022, confirmed by reading it straight out of this repo's
-- own migration history before writing this), with only these additions.
-- Nothing about how amounts/balances are calculated changes for existing
-- callers -- a call that doesn't pass the two new filters behaves exactly
-- as it did before this patch.
--
-- Function is dropped and recreated (rather than CREATE OR REPLACE)
-- because adding parameters changes the signature -- Postgres would
-- otherwise create a second, overloaded version alongside the old one
-- instead of truly replacing it, same reasoning as patch 022. Dropped by
-- name only (no argument list) since general_ledger has exactly one
-- version today -- if that's no longer true when this runs, Postgres will
-- raise a clear "not unique" error here instead of silently leaving an
-- old copy behind, so this is safe to run even if that assumption turns
-- out to be wrong.
-- ============================================================================

drop function if exists public.general_ledger;

CREATE OR REPLACE FUNCTION public.general_ledger(
  p_account_id uuid,
  p_date_from date DEFAULT NULL::date,
  p_date_to date DEFAULT NULL::date,
  p_owner_id uuid DEFAULT NULL::uuid,
  p_tenant_id uuid DEFAULT NULL::uuid,
  p_building_id uuid DEFAULT NULL::uuid,
  p_room_id uuid DEFAULT NULL::uuid
)
 RETURNS TABLE(
   entry_date date, description text, source_type text, source_id uuid,
   journal_entry_id uuid, direction text, amount numeric,
   building_name text, room_number text, owner_name text, tenant_name text,
   running_balance numeric
 )
 LANGUAGE sql
 STABLE
AS $function$
  with lines as (
    select
      je.entry_date, je.description, je.source_type, je.source_id, je.id as journal_entry_id,
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
      and (p_building_id is null or jl.building_id = p_building_id)
      and (p_room_id is null or jl.room_id = p_room_id)
  )
  select
    entry_date, description, source_type, source_id, journal_entry_id, direction, amount,
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

grant execute on function public.general_ledger(uuid, date, date, uuid, uuid, uuid, uuid) to authenticated, anon;

-- Confirm: should show the new 7-parameter signature.
select proname, pg_get_function_identity_arguments(oid) as arguments
from pg_proc
where proname = 'general_ledger';
