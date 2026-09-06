# apply_deposit_flow_and_cashbank_fix.ps1
# Three things, based on your feedback:
#  1. New Lease form now only asks for the security deposit AMOUNT (and
#     date agreed) -- the "has it been collected / which account" step is
#     gone. Receiving it, picking the bank/cash account, and printing the
#     receipt all happen in one place now: the Leases list page's
#     "Record payment" action (which already did all of that).
#  2. New "Bank / cash account?" flag on Chart of Accounts (asset accounts
#     only). "Which account was this received into" pickers -- currently
#     just the security deposit receipt modal -- now only show accounts
#     flagged this way, so Accounts Receivable (also technically an
#     asset) can never be picked there by mistake again.
#  3. Chart of Accounts page: new column to see/toggle that flag, plus a
#     checkbox on the "Add account" form for new asset accounts.
#
# Run the SQL migration FIRST in Supabase SQL Editor, in this order:
#   1. 011_schema_patch_026_cash_bank_account_flag.sql
#   2. 012_data_fix_taiyba_security_deposit_entry.sql
#      (the one-off correction for Taiyba Nisar's specific entry -- safe
#      to run once; does nothing if run again)
# Then apply this code patch.

$ErrorActionPreference = "Stop"

Write-Host "== Security deposit flow simplification + bank/cash account flag ==" -ForegroundColor Cyan

if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "ERROR: Run this from the folder that contains both 'backend' and 'frontend' subfolders." -ForegroundColor Red
    exit 1
}

$patchFile = "deposit_flow_and_cashbank_fix.patch"
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
git commit -m "Security deposits: simplify New Lease form, add bank/cash account flag to prevent AR being picked as a receiving account"
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

Write-Host "`nDone. Vercel will redeploy both frontend and backend automatically within 1-2 minutes." -ForegroundColor Green
Write-Host "Reminder: if you haven't already, run both SQL files in Supabase SQL Editor (see the header of this script for the order)." -ForegroundColor Yellow
