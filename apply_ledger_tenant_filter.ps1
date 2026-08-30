# ============================================================================
# apply_ledger_tenant_filter.ps1 — adds a "Tenant" filter dropdown to the
# Ledger page, so you can see one tenant's movements and running balance
# on any account (e.g. Security Deposits Held) -- useful when a tenant
# has paid in more than one installment and you want to see exactly what
# they've paid so far.
#
# IMPORTANT — RUN THE SQL STEP FIRST:
#   Before running this script, open Supabase -> SQL Editor, paste the
#   ENTIRE contents of
#   "007_schema_patch_022_general_ledger_tenant_filter.sql", and click
#   Run. Check the result at the bottom -- it should show the function
#   now has 5 arguments. If you see a red error, STOP and come back to
#   Claude with it. Do not run this script until that SQL step succeeds.
#
# HOW TO USE (after the SQL step above is done):
#   1. Put this file AND "ledger_tenant_filter.patch" into the main folder
#      of your project (the one with "backend" and "frontend" inside it).
#   2. Open PowerShell in that folder.
#   3. Run:
#      powershell -ExecutionPolicy Bypass -File apply_ledger_tenant_filter.ps1
#
# WHAT CHANGES: opening any account's Ledger page now shows a "Tenant"
# dropdown next to the date filters. Picking a tenant re-runs the ledger
# for just their entries on that account, with its own running balance --
# so on Security Deposits Held, for example, you can see exactly what one
# tenant has paid toward their deposit so far, even across more than one
# payment.
#
# WHAT IT DOES, IN ORDER: same safe pattern as every script before --
# checks folder, pulls latest, dry-run checks the patch, applies it,
# commits, pushes. Stops immediately and pushes nothing if any step fails.
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
if (-not (Test-Path "ledger_tenant_filter.patch")) {
    Fail "Can't find 'ledger_tenant_filter.patch' in this folder. Make sure you saved it here, next to this script."
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
git apply --check ledger_tenant_filter.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch doesn't match your current code, so nothing was applied. Come back to Claude and say 'the patch failed to apply' and paste the message above."
}
Write-Host "OK, the patch is safe to apply." -ForegroundColor Green

Write-Host ""
Write-Host "Step 4: Applying the patch (files are changing now)..." -ForegroundColor Cyan
git apply ledger_tenant_filter.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch failed to apply on the real attempt (even though the check passed). Come back to Claude with this message."
}
Write-Host "OK, files updated." -ForegroundColor Green

Write-Host ""
Write-Host "Step 5: Committing and pushing to GitHub..." -ForegroundColor Cyan
git add -A
git commit -m "Ledger: add tenant filter dropdown, backed by a tenant-aware general_ledger() function"
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
Write-Host "Reminder: this only works correctly if you already ran the SQL migration in Supabase first." -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Green
