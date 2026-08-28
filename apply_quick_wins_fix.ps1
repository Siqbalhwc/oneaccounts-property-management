# ============================================================================
# apply_quick_wins_fix.ps1 — applies 4 small frontend fixes:
#   1. Owner list now shows which property/properties each owner owns
#   2. Tenant list now shows which property the tenant currently lives in
#      (or "Not assigned" if they have no active lease)
#   3. Owner page search bar now lines up the same way the Tenant page's does
#   4. The "›" actions menu on the Expenses page no longer gets clipped into
#      an ugly scrollbar — it now floats properly above the table
#
# HOW TO USE:
#   1. Put this file AND "quick_wins_owner_tenant_expense_fixes.patch" into
#      the main folder of your oneaccounts-property-management project (the
#      folder that has "backend" and "frontend" folders inside it).
#   2. Open PowerShell in that folder.
#   3. Run:
#      powershell -ExecutionPolicy Bypass -File apply_quick_wins_fix.ps1
#
# This is a FRONTEND-ONLY change. No SQL / database step is needed for this
# particular fix — nothing to run in Supabase.
#
# WHAT IT DOES, IN ORDER:
#   1. Makes sure you're in the right folder.
#   2. Pulls the latest code from GitHub (so you're up to date first).
#   3. Checks the patch will apply cleanly (a "dry run" — nothing is changed
#      by this step, it just checks).
#   4. Applies the patch (this is when files actually change).
#   5. Commits and pushes the change to GitHub, which will trigger Vercel
#      to redeploy your frontend automatically.
#
# If anything goes wrong at any step, the script stops and tells you —
# it will NOT push a broken/partial change.
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
if (-not (Test-Path "quick_wins_owner_tenant_expense_fixes.patch")) {
    Fail "Can't find 'quick_wins_owner_tenant_expense_fixes.patch' in this folder. Make sure you saved it here, next to this script."
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
git apply --check quick_wins_owner_tenant_expense_fixes.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch doesn't match your current code, so nothing was applied. This usually means the code changed since this patch was made. Come back to Claude and say 'the patch failed to apply' and paste the message above."
}
Write-Host "OK, the patch is safe to apply." -ForegroundColor Green

Write-Host ""
Write-Host "Step 4: Applying the patch (files are changing now)..." -ForegroundColor Cyan
git apply quick_wins_owner_tenant_expense_fixes.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch failed to apply on the real attempt (even though the check passed). Come back to Claude with this message."
}
Write-Host "OK, files updated." -ForegroundColor Green

Write-Host ""
Write-Host "Step 5: Committing and pushing to GitHub..." -ForegroundColor Cyan
git add -A
git commit -m "Owner/tenant property columns, owner search bar alignment, fix clipped expense actions menu"
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
Write-Host "No SQL step needed for this one." -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Green
