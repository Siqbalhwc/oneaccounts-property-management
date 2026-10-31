alter table lease_settlements add column if not exists ledger_adjustments jsonb;

select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'lease_settlements' and column_name = 'ledger_adjustments';
