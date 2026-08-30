# ============================================================================
# apply_pnl_building_split.ps1 — a shared/split expense now shows up in
# each building's own column in the Profit & Loss report, instead of only
# in an "Unassigned" bucket.
#
# WHAT WAS HAPPENING: when you log a company-wide expense (no building
# picked) and then split it across buildings using "Manage split", the
# real accounting entry is deliberately posted WITHOUT a building tag --
# tagging it to every building directly in the ledger would double-count
# it there, which would be wrong. That's correct for the real books, but
# it meant the building-by-building P&L view just showed it stuck under
# "Unassigned" instead of reflecting the actual split.
#
# WHAT CHANGES: the Profit & Loss report (when viewed building-by-building)
# now re-distributes exactly those split amounts into each building's own
# column -- e.g. a Rs 5,000 electricity bill split 50/50 between two
# buildings now shows Rs 2,500 under EACH building, and "Unassigned" no
# longer includes it.
#
# IMPORTANT: this ONLY changes how the report is displayed. It does NOT
# touch the actual ledger, journal entries, trial balance, or balance
# sheet -- those remain exactly as accurate as they already were. A
# company-wide expense that was never split still shows under
# "Unassigned", same as before.
#
# THIS IS CODE-ONLY. No SQL / database step needed.
#
# HOW TO USE:
#   1. Put this file AND "pnl_building_split.patch" into the main folder
#      of your project (the one with "backend" and "frontend" inside it).
#   2. Open PowerShell in that folder.
#   3. Run:
#      powershell -ExecutionPolicy Bypass -File apply_pnl_building_split.ps1
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
if (-not (Test-Path "pnl_building_split.patch")) {
    Fail "Can't find 'pnl_building_split.patch' in this folder. Make sure you saved it here, next to this script."
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
git apply --check pnl_building_split.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch doesn't match your current code, so nothing was applied. Come back to Claude and say 'the patch failed to apply' and paste the message above."
}
Write-Host "OK, the patch is safe to apply." -ForegroundColor Green

Write-Host ""
Write-Host "Step 4: Applying the patch (files are changing now)..." -ForegroundColor Cyan
git apply pnl_building_split.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch failed to apply on the real attempt (even though the check passed). Come back to Claude with this message."
}
Write-Host "OK, files updated." -ForegroundColor Green

Write-Host ""
Write-Host "Step 5: Committing and pushing to GitHub..." -ForegroundColor Cyan
git add -A
git commit -m "P&L building breakdown: distribute split expenses into each building's own column instead of Unassigned"
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
