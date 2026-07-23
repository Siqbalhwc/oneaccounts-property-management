insert into profiles (id, company_id, full_name, role)
values (
  '7491d2d7-055c-4b6b-bbfb-32de8058b62f',   -- your Auth user UUID
  '2a6e0f3c-494f-4bf9-a4c6-53ae591dbfdb',   -- your company UUID
  'Your Full Name',                          -- <-- change this to your actual name
  'owner'
);

insert into expense_categories (company_id, name)
values
  ('2a6e0f3c-494f-4bf9-a4c6-53ae591dbfdb', 'Water Bill'),
  ('2a6e0f3c-494f-4bf9-a4c6-53ae591dbfdb', 'Electricity'),
  ('2a6e0f3c-494f-4bf9-a4c6-53ae591dbfdb', 'Gas'),
  ('2a6e0f3c-494f-4bf9-a4c6-53ae591dbfdb', 'Repairs'),
  ('2a6e0f3c-494f-4bf9-a4c6-53ae591dbfdb', 'Salaries'),
  ('2a6e0f3c-494f-4bf9-a4c6-53ae591dbfdb', 'Other');

-- Verify it worked:
select p.full_name, p.role, c.name as company_name
from profiles p
join companies c on c.id = p.company_id;
