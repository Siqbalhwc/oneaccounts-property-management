# ============================================================================
# apply_invoice_duplicate_fix.ps1 — prevents the bad data state that
# caused your Internet charge to show as Rs 516.13 instead of Rs 500, and
# adds a "Recalculate this month's invoice" button.
#
# WHAT THIS FIXES:
#   - Editing or ending a charge now refuses a date earlier than when that
#     charge itself started -- this is exactly what let a charge end up
#     with an end date BEFORE its start date last time.
#   - The "Effective from" date picker in the Edit-charge form now won't
#     even let you pick an invalid date in the first place.
#   - New "Recalculate this month's invoice" button on the Edit Lease
#     screen -- lets you manually re-run the invoice calculation any time
#     (e.g. right after the SQL cleanup below), without needing to touch
#     an unrelated charge just to trigger it.
#
# THIS DOES NOT by itself fix the Rs 516.13 already sitting on invoice
# IN/20260828/003 -- for that, ALSO run "cleanup_test_lease_internet_charge.sql"
# in Supabase (either before or after this code patch, order doesn't
# matter this time), then open that lease's "Edit lease" screen and click
# "Recalculate this month's invoice".
#
# HOW TO USE:
#   1. Put this file AND "invoice_duplicate_charge_validation.patch" into
#      the main folder of your project (the one with "backend" and
#      "frontend" inside it).
#   2. Open PowerShell in that folder.
#   3. Run:
#      powershell -ExecutionPolicy Bypass -File apply_invoice_duplicate_fix.ps1
#
# Same safe pattern as every script before: checks folder, pulls latest,
# dry-run checks the patch, applies it, commits, pushes. Stops immediately
# and pushes nothing if any step fails.
# ============================================================================

$ErrorActionPreference = "Stop"

function Fail($msg) {
    Write-Host ""
    Write-Host "STOPPED: $msg" -ForegroundColor Red
    Write-Host "Nothing further was changed. Nothing was pushed to GitHub." -ForegroundColor Red
    exit 1
}

Write-Host "Step 1: Checking you're in the right folder..." -ForegroundColor Cyan
if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Fail "This doesn't look like the project folder (no 'backend'/'frontend' folder here). Open PowerShell inside your oneaccounts-property-management folder and try again."
}
if (-not (Test-Path "invoice_duplicate_charge_validation.patch")) {
    Fail "Can't find the patch file in this folder. Make sure you saved it here, next to this script."
}
Write-Host "OK." -ForegroundColor Green

Write-Host ""
Write-Host "Step 2: Pulling the latest code from GitHub..." -ForegroundColor Cyan
git pull
if ($LASTEXITCODE -ne 0) {
    Fail "'git pull' failed. Check the message above -- often this means you have unsaved local changes. Save/commit those first, then re-run this script."
}
Write-Host "OK." -ForegroundColor Green

Write-Host ""
Write-Host "Step 3: Checking the patch will apply cleanly (no changes made yet)..." -ForegroundColor Cyan
git apply --check invoice_duplicate_charge_validation.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch doesn't match your current code, so nothing was applied. Come back to Claude and say 'the patch failed to apply' and paste the message above."
}
Write-Host "OK, the patch is safe to apply." -ForegroundColor Green

Write-Host ""
Write-Host "Step 4: Applying the patch (files are changing now)..." -ForegroundColor Cyan
git apply invoice_duplicate_charge_validation.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch failed to apply on the real attempt (even though the check passed). Come back to Claude with this message."
}
Write-Host "OK, files updated." -ForegroundColor Green

Write-Host ""
Write-Host "Step 5: Committing and pushing to GitHub..." -ForegroundColor Cyan
git add -A
git commit -m "Validate charge effective dates against the charge's own start date; add manual invoice recalculate button"
if ($LASTEXITCODE -ne 0) {
    Fail "'git commit' failed. See message above."
}
git push
if ($LASTEXITCODE -ne 0) {
    Fail "'git push' failed. Your changes ARE saved locally (the commit worked), they just didn't reach GitHub yet. Check your internet connection / GitHub login and just run 'git push' again by itself."
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "DONE. Code changes are pushed to GitHub and Vercel will redeploy automatically (takes 1-2 minutes)." -ForegroundColor Green
Write-Host "Reminder: this does NOT fix the already-wrong Rs 516.13 invoice by itself." -ForegroundColor Yellow
Write-Host "Also run cleanup_test_lease_internet_charge.sql in Supabase, then use the new" -ForegroundColor Yellow
Write-Host "'Recalculate this month's invoice' button on that lease." -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Green
