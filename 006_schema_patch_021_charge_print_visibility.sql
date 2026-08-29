-- ============================================================================
-- PATCH 021 — lease_charges: which charges print on the invoice PDF
-- Run this AFTER 005_schema_patch_020_expense_paid_from_account.sql.
-- Run this SQL step BEFORE applying the matching code patch.
-- ============================================================================
-- What this adds:
--   1. lease_charges.show_on_invoice -- a checkbox at the charge level.
--      Defaults to TRUE (every existing charge keeps printing exactly as
--      it always has). When unchecked, the charge's amount still counts
--      fully toward the invoice total and the ledger -- ONLY its own
--      printed line on the PDF is hidden. Nothing about the accounting
--      changes; this is a print-layout choice only.
--   2. invoice_line_items.show_on_invoice -- a SNAPSHOT of that same flag,
--      copied onto each invoice line at the moment it's generated. This
--      matches how this schema already treats charge AMOUNTS (versioned,
--      never retroactively rewritten) -- so if you later flip a charge's
--      print visibility, invoices already generated keep printing exactly
--      as they did when they were made.
-- ============================================================================

alter table lease_charges
  add column if not exists show_on_invoice boolean not null default true;

alter table invoice_line_items
  add column if not exists show_on_invoice boolean not null default true;

-- Confirm: both should show 0 rows missing a value (the "not null default
-- true" above already backfills every existing row automatically).
select
  (select count(*) from lease_charges where show_on_invoice is null) as lease_charges_missing,
  (select count(*) from invoice_line_items where show_on_invoice is null) as invoice_line_items_missing;
