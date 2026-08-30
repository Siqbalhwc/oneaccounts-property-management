# ============================================================================
# apply_security_deposit_partial_payments.ps1 — security deposits can now
# be paid in more than one installment.
#
# IMPORTANT — RUN THE SQL STEP FIRST:
#   Before running this script, open Supabase -> SQL Editor, paste the
#   ENTIRE contents of
#   "008_schema_patch_023_security_deposit_partial_payments.sql", and
#   click Run. Check the result at the bottom -- for every deposit already
#   marked received, "total_paid_now" should match "agreed_amount"
#   exactly (this confirms the backfill worked correctly). If you see a
#   red error, STOP and come back to Claude with it. Do not run this
#   script until that SQL step succeeds.
#
# HOW TO USE (after the SQL step above is done):
#   1. Put this file AND "security_deposit_partial_payments.patch" into
#      the main folder of your project (the one with "backend" and
#      "frontend" inside it).
#   2. Open PowerShell in that folder.
#   3. Run:
#      powershell -ExecutionPolicy Bypass -File apply_security_deposit_partial_payments.ps1
#
# WHAT CHANGES, IN PLAIN TERMS:
#   - The Leases page's Security Deposit column now shows "Rs X received,
#     Rs Y pending" for a partially-paid deposit, with a "Partially
#     received" badge instead of a flat yes/no.
#   - "Record receipt" is now "Record payment" -- callable as many times
#     as needed. Each click records ONE payment: an amount, which account
#     it went into, and a date. A tenant can pay the whole deposit in one
#     go, or across as many installments as they need.
#   - The system will NOT let a payment push the total past the amount
#     agreed in the lease -- it's blocked with a clear message showing
#     exactly how much is still pending.
#   - Every payment posts its own journal entry for exactly that amount --
#     never for the full deposit before it's actually all in.
#   - The printable receipt now lists every payment made so far, the
#     total received, and (if not yet complete) how much is still
#     pending -- clearly marked "PARTIALLY RECEIVED" vs "FULLY RECEIVED".
#   - Refunding a deposit now refunds what was ACTUALLY paid in, not the
#     full agreed amount -- correct even if a tenant leaves having only
#     paid part of the deposit.
#   - Existing deposits already marked received are completely unaffected
#     -- the SQL step already gave each of them one matching payment
#     record behind the scenes, so nothing about them changes on screen.
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
if (-not (Test-Path "security_deposit_partial_payments.patch")) {
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
git apply --check security_deposit_partial_payments.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch doesn't match your current code, so nothing was applied. Come back to Claude and say 'the patch failed to apply' and paste the message above."
}
Write-Host "OK, the patch is safe to apply." -ForegroundColor Green

Write-Host ""
Write-Host "Step 4: Applying the patch (files are changing now)..." -ForegroundColor Cyan
git apply security_deposit_partial_payments.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch failed to apply on the real attempt (even though the check passed). Come back to Claude with this message."
}
Write-Host "OK, files updated." -ForegroundColor Green

Write-Host ""
Write-Host "Step 5: Committing and pushing to GitHub..." -ForegroundColor Cyan
git add -A
git commit -m "Security deposits: support partial payments, with overpayment guard and updated receipt PDF"
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
