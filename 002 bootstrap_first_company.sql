-- ============================================================================
-- BOOTSTRAP — run this once, after schema.sql + patch 001, to create your
-- first company and link your own Supabase Auth user to it as admin.
-- ============================================================================

-- 1. Create your company
insert into companies (id, name, address, phone)
values (
  gen_random_uuid(),
  'Your Company Name Here',      -- <-- change this
  'Your office address',          -- <-- change or leave null
  '03XX-XXXXXXX'                  -- <-- change or leave null
)
returning id;

-- ^ COPY THE RETURNED id FROM ABOVE, you'll need it in step 2.

-- 2. Link your Supabase Auth user to that company as an admin/owner.
-- Replace both UUIDs below:
--   - 'YOUR-AUTH-USER-UUID'  -> from Authentication -> Users in Supabase
--   - 'YOUR-COMPANY-UUID'    -> the id returned by step 1 above
insert into profiles (id, company_id, full_name, role)
values (
  'YOUR-AUTH-USER-UUID',
  'YOUR-COMPANY-UUID',
  'Your Full Name',
  'owner'
);

-- 3. (Recommended) seed default expense categories for this company
insert into expense_categories (company_id, name)
values
  ('YOUR-COMPANY-UUID', 'Water Bill'),
  ('YOUR-COMPANY-UUID', 'Electricity'),
  ('YOUR-COMPANY-UUID', 'Gas'),
  ('YOUR-COMPANY-UUID', 'Repairs'),
  ('YOUR-COMPANY-UUID', 'Salaries'),
  ('YOUR-COMPANY-UUID', 'Other');

-- 4. Verify it worked
select p.full_name, p.role, c.name as company_name
from profiles p
join companies c on c.id = p.company_id;
