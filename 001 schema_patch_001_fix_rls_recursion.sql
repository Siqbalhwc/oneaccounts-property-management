-- ============================================================================
-- PATCH 001 — fix infinite recursion in RLS
-- Run this AFTER schema.sql
-- ============================================================================
-- Problem: auth_company_id() reads from `profiles` to find the caller's
-- company. But the RLS policy ON `profiles` itself called auth_company_id(),
-- so checking a profiles row required re-checking a profiles row, forever.
--
-- Fix: make auth_company_id() SECURITY DEFINER so it bypasses RLS internally
-- (it still only ever returns the CALLING user's own company_id, so this is
-- safe), and give `profiles` its own simple, non-recursive policy.
-- ============================================================================

create or replace function auth_company_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select company_id from profiles where id = auth.uid()
$$;

drop policy if exists profiles_isolation on profiles;

-- A user can always manage their own profile row directly (no recursion).
create policy profiles_self on profiles
  for all using (id = auth.uid());

-- A user can also view colleague profiles in the same company (e.g. for
-- assigning staff/managers in dropdowns). Read-only, and safe now that
-- auth_company_id() is SECURITY DEFINER.
create policy profiles_company_readonly on profiles
  for select using (company_id = auth_company_id());
