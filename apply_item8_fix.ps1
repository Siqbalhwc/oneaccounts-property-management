# ============================================================================
# apply_item8_fix.ps1 — applies the code side of item 8:
#   Expenses now ask WHICH ACCOUNT (Bank, Cash, etc.) the money actually
#   came from, instead of always silently assuming Bank.
#
# IMPORTANT — RUN THE SQL STEP FIRST:
#   Before running this script, open Supabase -> SQL Editor, paste the
#   ENTIRE contents of "005_schema_patch_020_expense_paid_from_account.sql",
#   and click Run. Check the result at the bottom -- if you see a red
#   error, STOP and come back to Claude with it. Do not run this script
#   until that SQL step has succeeded.
#
# HOW TO USE (after the SQL step above is done):
#   1. Put this file AND "item8_expense_payment_source.patch" into the main
#      folder of your project (the one with "backend" and "frontend" inside).
#   2. Open PowerShell in that folder.
#   3. Run:
#      powershell -ExecutionPolicy Bypass -File apply_item8_fix.ps1
#
# WHAT CHANGES, IN PLAIN TERMS:
#   - The "Log expense" form now has a required "Paid from" dropdown
#     (Bank, Cash, or any other asset account in your chart of accounts).
#   - Existing expenses already logged in the past are backfilled (by the
#     SQL step) to show "Bank", since that's what the old code always used
#     — nothing about their numbers changes, this just makes it visible.
#   - The expense list now shows a "Paid from" column.
#   - Once an expense is logged, its paid-from account is locked (same as
#     amount/category/building already were) — delete and re-log if it was
#     genuinely wrong.
#
# WHAT IT DOES, IN ORDER: same safe pattern as before -- checks folder,
# pulls latest, dry-run checks the patch, applies it, commits, pushes.
# Stops immediately and pushes nothing if any step fails.
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
if (-not (Test-Path "item8_expense_payment_source.patch")) {
    Fail "Can't find 'item8_expense_payment_source.patch' in this folder. Make sure you saved it here, next to this script."
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
git apply --check item8_expense_payment_source.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch doesn't match your current code, so nothing was applied. Come back to Claude and say 'the patch failed to apply' and paste the message above."
}
Write-Host "OK, the patch is safe to apply." -ForegroundColor Green

Write-Host ""
Write-Host "Step 4: Applying the patch (files are changing now)..." -ForegroundColor Cyan
git apply item8_expense_payment_source.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch failed to apply on the real attempt (even though the check passed). Come back to Claude with this message."
}
Write-Host "OK, files updated." -ForegroundColor Green

Write-Host ""
Write-Host "Step 5: Committing and pushing to GitHub..." -ForegroundColor Cyan
git add -A
git commit -m "Expenses: require and record which account (Bank/Cash/etc.) was actually paid from; show real Rs amounts in the building-split summary"
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
