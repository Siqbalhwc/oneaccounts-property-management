# ============================================================================
# apply_simplify_charge_model.ps1 — the general fix you asked for:
# editing ANY charge (amount, print-on-PDF, anything) means the latest
# edit is final, applied for the whole time that charge has been part of
# the lease -- not blended with old, superseded values.
#
# (If you tried the earlier "one_time_charge_dedup_fix" patch, don't use
# it -- this one replaces it entirely with the full, general fix. Just
# run this.)
#
# WHAT WAS WRONG: recalculating an invoice was treating an edited charge
# as if the OLD and NEW versions both applied to different days of the
# month -- correct for something like a genuine rate change on a fixed
# date, but not what you actually wanted. On top of that, there was a
# subtle one-day double-count right at the boundary where an old segment
# closes and a new one opens on the same date.
#
# WHAT THIS FIXES: recalculating now uses ONE version per charge --
# whatever is currently active (its latest amount, print-on-PDF setting,
# anything about it) -- applied for the whole period that charge has been
# part of the lease. A charge added fresh mid-lease (never existed
# before) still only counts from its own actual start date, so adding a
# new facility partway through is still correctly prorated for just the
# days it applies -- this only changes how an EDIT to something already
# there is treated.
#
# Already-generated invoices are never touched by this -- it only changes
# what a fresh invoice, or a manual recalculation of the current month's
# invoice, computes from here on.
#
# THIS IS CODE-ONLY. No SQL / database step needed.
#
# AFTER APPLYING: go back into that lease's "Edit lease" screen and click
# "Recalculate this month's invoice" to bring invoice IN/20260830/007
# itself up to date (the code fix alone doesn't rewrite what's already
# stored). Expect Commission to settle at Rs 5,000 and Rent to fold in
# the hidden charges at Rs 9,523, Total Rs 14,523.
#
# HOW TO USE:
#   1. Put this file AND "simplify_charge_model.patch" into the main
#      folder of your project (the one with "backend" and "frontend"
#      inside it).
#   2. Open PowerShell in that folder.
#   3. Run:
#      powershell -ExecutionPolicy Bypass -File apply_simplify_charge_model.ps1
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
if (-not (Test-Path "simplify_charge_model.patch")) {
    Fail "Can't find 'simplify_charge_model.patch' in this folder. Make sure you saved it here, next to this script."
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
git apply --check simplify_charge_model.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch doesn't match your current code, so nothing was applied. Come back to Claude and say 'the patch failed to apply' and paste the message above."
}
Write-Host "OK, the patch is safe to apply." -ForegroundColor Green

Write-Host ""
Write-Host "Step 4: Applying the patch (files are changing now)..." -ForegroundColor Cyan
git apply simplify_charge_model.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch failed to apply on the real attempt (even though the check passed). Come back to Claude with this message."
}
Write-Host "OK, files updated." -ForegroundColor Green

Write-Host ""
Write-Host "Step 5: Committing and pushing to GitHub..." -ForegroundColor Cyan
git add -A
git commit -m "Invoice recalculation: latest edit to a charge always wins for its whole active period, not blended with superseded versions"
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
Write-Host "Now go click 'Recalculate this month's invoice' on that lease to fix invoice IN/20260830/007 itself." -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Green
