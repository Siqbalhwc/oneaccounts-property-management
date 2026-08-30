# ============================================================================
# apply_pnl_full_fix.ps1 — fixes P&L building-split, including your
# archived-building catch.
#
# (If you tried the earlier "pnl_field_name_fix" patch, don't use it --
# this one replaces it entirely with everything included. Just run this.)
#
# WHAT WAS WRONG, IN TWO PARTS:
#   1. My split-adjustment code used the wrong internal field names,
#      causing a split expense to show as two separate, oddly-labeled
#      rows instead of merging into the same account line.
#   2. Your catch was right: a cost split made against a building that's
#      since been ARCHIVED had genuinely nowhere to show up. Archived
#      buildings/owners are deliberately left out of dropdowns everywhere
#      else in the app, but that meant this report had no column for
#      them at all -- the amount only counted toward the Total, with no
#      way to see WHICH building it belonged to.
#
# WHAT THIS FIXES:
#   1. A split amount now correctly merges into the same account line,
#      one row per account -- not two.
#   2. The By Building / By Owner views now also show a column for any
#      ARCHIVED building/owner that actually has an amount in the period
#      you're viewing, clearly labeled "(Archived)" so it's obvious why
#      it's not in your normal list. Archived ones with nothing to show
#      stay hidden, same as before -- no clutter.
#   3. "Unassigned" still appears, but now ONLY for genuinely never-split
#      company-wide expenses -- not as a catch-all for archived buildings
#      anymore.
#   Active building/owner + Archived (with data) + Unassigned + Total
#   will now always add up to exactly the Total column -- nothing can
#   silently disappear.
#
# THIS IS CODE-ONLY. No SQL / database step needed.
#
# HOW TO USE:
#   1. Put this file AND "pnl_full_fix.patch" into the main folder of
#      your project (the one with "backend" and "frontend" inside it).
#   2. Open PowerShell in that folder.
#   3. Run:
#      powershell -ExecutionPolicy Bypass -File apply_pnl_full_fix.ps1
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
if (-not (Test-Path "pnl_full_fix.patch")) {
    Fail "Can't find 'pnl_full_fix.patch' in this folder. Make sure you saved it here, next to this script."
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
git apply --check pnl_full_fix.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch doesn't match your current code, so nothing was applied. Come back to Claude and say 'the patch failed to apply' and paste the message above."
}
Write-Host "OK, the patch is safe to apply." -ForegroundColor Green

Write-Host ""
Write-Host "Step 4: Applying the patch (files are changing now)..." -ForegroundColor Cyan
git apply pnl_full_fix.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch failed to apply on the real attempt (even though the check passed). Come back to Claude with this message."
}
Write-Host "OK, files updated." -ForegroundColor Green

Write-Host ""
Write-Host "Step 5: Committing and pushing to GitHub..." -ForegroundColor Cyan
git add -A
git commit -m "Fix P&L building-split field names and show archived buildings/owners with data instead of dropping them"
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
