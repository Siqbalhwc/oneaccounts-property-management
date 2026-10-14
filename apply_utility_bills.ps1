# apply_utility_bills.ps1
#
# Adds monthly bill-basis utility charges (electricity, water, gas, ...) from
# Excel:
#   - new table utility_bills (one row per lease + month + utility), isolated
#     per company, with a database check that a bill's company matches its lease
#   - Accounting > Utility bills: download a pre-filled template, upload it,
#     review exactly what will change, then save
#   - a bill replaces the lease amount on that month's invoice; with no bill
#     the lease amount stays as today; draft AND sent invoices are recalculated;
#     invoices with a payment recorded are never touched
#   - invoice generation (bulk, single and first-invoice) and lease-page charge
#     edits all respect the uploaded bills
#   - fix: recalculating the same invoice a second time no longer reverses
#     the earlier reversal entry (which put the cancelled amount back)
#
# BEFORE running this script:
#   Run 013_schema_patch_029_utility_bills.sql in the Supabase SQL Editor first
#   (safe to re-run). The new code needs that table.
#
# Run from the folder that contains 'backend' and 'frontend', with this script
# and utility_bills.patch in that same folder.

$ErrorActionPreference = "Stop"

Write-Host "== Utility bills (Excel upload) ==" -ForegroundColor Cyan

if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "ERROR: Run this from the folder that contains both 'backend' and 'frontend' subfolders." -ForegroundColor Red
    exit 1
}

$patchFile = "utility_bills.patch"
if (-not (Test-Path $patchFile)) {
    Write-Host "ERROR: '$patchFile' not found in this folder. Place it here first (same folder as this script)." -ForegroundColor Red
    exit 1
}

$answer = Read-Host "Have you already run 013_schema_patch_029_utility_bills.sql in Supabase? (y/n)"
if ($answer -ne "y") {
    Write-Host "Run the SQL patch first, then re-run this script." -ForegroundColor Yellow
    exit 1
}

Write-Host "`nPulling latest code..." -ForegroundColor Yellow
git pull
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: git pull failed. Resolve that first, then re-run this script." -ForegroundColor Red
    exit 1
}

Write-Host "`nChecking that the patch applies cleanly (dry run, changes nothing yet)..." -ForegroundColor Yellow
git apply --check $patchFile
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Patch does not apply cleanly against your current code." -ForegroundColor Red
    Write-Host "Something in invoicing.py, invoice_batch.py, invoices.py, ledger.py, main.py, platform_admin.py, Sidebar.tsx or api.ts has changed since this patch was made. Stop here and tell me, so I can regenerate it against your actual current files." -ForegroundColor Red
    exit 1
}

Write-Host "`nApplying patch..." -ForegroundColor Yellow
git apply $patchFile
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Patch failed to apply (unexpected, since the dry run just passed). Stop and report this." -ForegroundColor Red
    exit 1
}

Write-Host "`nChecking the patched Python files for syntax errors..." -ForegroundColor Yellow
$pyFiles = @(
    "backend/app/services/utility_bills.py",
    "backend/app/services/utility_upload.py",
    "backend/app/routers/utility_bills.py",
    "backend/app/services/invoicing.py",
    "backend/app/services/invoice_batch.py",
    "backend/app/services/ledger.py",
    "backend/app/routers/invoices.py",
    "backend/app/routers/platform_admin.py",
    "backend/app/main.py"
)
foreach ($f in $pyFiles) {
    python -c "import ast,sys; ast.parse(open(sys.argv[1], encoding='utf-8').read())" $f
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: $f has a syntax error. Stop here -- do not push -- and report this." -ForegroundColor Red
        exit 1
    }
}
Write-Host "Syntax checks passed." -ForegroundColor Green

Write-Host "`nCommitting..." -ForegroundColor Yellow
git add backend frontend 013_schema_patch_029_utility_bills.sql
git commit -m "Utility bills: monthly Excel upload of bill-basis charges, applied to draft/sent invoices and invoice generation; fix repeat-recalculation reversal"
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: git commit failed. Stop and report this." -ForegroundColor Red
    exit 1
}

Write-Host "`nPushing..." -ForegroundColor Yellow
git push
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: git push failed. Your commit is saved locally but NOT live yet. Resolve the push issue, then run 'git push' manually." -ForegroundColor Red
    exit 1
}

Write-Host "`nDone. Vercel will redeploy backend and frontend within 1-2 minutes." -ForegroundColor Green
Write-Host "Then open Accounting > Utility bills and follow the test checklist." -ForegroundColor Green
