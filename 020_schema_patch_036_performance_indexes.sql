create index if not exists idx_invoice_line_items_invoice on invoice_line_items (invoice_id);
create index if not exists idx_payments_invoice on payments (invoice_id);
create index if not exists idx_payments_tenant on payments (tenant_id);

select
  (select count(*) from pg_indexes where schemaname = 'public' and indexname in ('idx_invoice_line_items_invoice', 'idx_payments_invoice', 'idx_payments_tenant')) as new_indexes_should_be_three,
  (select count(*) from invoice_line_items) as invoice_line_items_rows,
  (select count(*) from payments) as payments_rows;
