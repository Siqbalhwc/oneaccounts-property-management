# apply_fast_tenant_balance.ps1
# Performance fix, no logic change:
#  1. Invoice PDF opening balance + security deposit balance, the Receive
#     Payment screen's running balance, and the balance shown after
#     recording a payment all now compute the tenant's account balance
#     with ONE fast Postgres function call instead of pulling every
#     journal entry the company has ever posted into Python first. Same
#     formula, same rounding, same result -- just doesn't get slower as
#     your transaction history grows.
#  2. Receive Payment screen: the list of unpaid invoices now fetches all
#     their payments in one batched query instead of one query per
#     invoice in a loop. Same math per invoice, fewer round trips.
#
# Run the matching SQL migration FIRST in Supabase SQL Editor:
#   012_schema_patch_027_fast_tenant_balance.sql
# It adds the new tenant_account_balance_as_of() function plus two
# supporting indexes. This code patch calls that function directly, so it
# will NOT work correctly until that SQL has been run.

$ErrorActionPreference = "Stop"

Write-Host "== Fast tenant balance (invoice PDF / Receive Payment performance fix) ==" -ForegroundColor Cyan

if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "ERROR: Run this from the folder that contains both 'backend' and 'frontend' subfolders." -ForegroundColor Red
    exit 1
}

$patchFile = "fast_tenant_balance.patch"
if (-not (Test-Path $patchFile)) {
    Write-Host "ERROR: '$patchFile' not found in this folder. Place it here first." -ForegroundColor Red
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
    Write-Host "This usually means the code has moved on since this patch was made. Stop here and ask for a refreshed patch." -ForegroundColor Red
    exit 1
}

Write-Host "`nApplying patch..." -ForegroundColor Yellow
git apply $patchFile
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Patch failed to apply (unexpected, since the dry run just passed). Stop and report this." -ForegroundColor Red
    exit 1
}

Write-Host "`nCommitting..." -ForegroundColor Yellow
git add -A
git commit -m "Speed up tenant balance lookups (invoice PDF, Receive Payment) with a single database function instead of pulling full company history into Python"
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Commit failed." -ForegroundColor Red
    exit 1
}

Write-Host "`nPushing..." -ForegroundColor Yellow
git push
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Push failed. Your commit is saved locally -- resolve the push issue, then run 'git push' yourself." -ForegroundColor Red
    exit 1
}

Write-Host "`nDone. Vercel will redeploy both backend and frontend automatically within 1-2 minutes." -ForegroundColor Green
Write-Host "Reminder: if you haven't already, run 012_schema_patch_027_fast_tenant_balance.sql in Supabase SQL Editor FIRST." -ForegroundColor Yellow
