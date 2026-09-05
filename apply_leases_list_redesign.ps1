# ============================================================================
# apply_leases_list_redesign.ps1 -- redesigns the Leases list page:
#
#   1. No wrapping text anywhere -- long content truncates or the table
#      scrolls sideways instead of breaking the layout.
#   2. A "Columns" dropdown (top right of the table) lets you show/hide
#      Start date, End date, and Security deposit. Tenant, Building /
#      Apartment, and Status always stay visible.
#   3. The Security deposit column is now a compact badge (Received /
#      Partial / Pending / none) instead of amounts + buttons crammed in.
#   4. Click anywhere on a row to expand it and see the full deposit
#      breakdown (agreed / received / pending) plus the relevant action
#      button (Print receipt or Record payment).
#   5. The "Settlement" and "Edit lease" text buttons are now small icon
#      buttons with hover tooltips, matching the icon style already used
#      on your Owners and Journal pages.
#
# WHAT THIS DOES NOT CHANGE:
#   - Only one file changes: frontend/app/(dashboard)/leases/page.tsx
#   - No backend files touched, no database changes, no API changes.
#   - All the same data and the same actions (Settlement, Edit lease,
#     Print receipt, Record payment) work exactly as before -- just
#     laid out differently.
#
# NO DATABASE CHANGES ARE NEEDED FOR THIS ONE.
#
# HOW TO USE:
#   1. Put this file AND "leases_list_redesign.patch" into the main
#      folder of your project (the one with "backend" and "frontend"
#      inside it).
#   2. Open PowerShell in that folder.
#   3. Run:
#      powershell -ExecutionPolicy Bypass -File apply_leases_list_redesign.ps1
# ============================================================================

$ErrorActionPreference = "Stop"

function Fail($msg) {
    Write-Host ""
    Write-Host "STOPPED: $msg" -ForegroundColor Red
    Write-Host "Nothing further was changed. Nothing was pushed to GitHub." -ForegroundColor Red
    exit 1
}

Write-Host "Step 1: Checking you're in the right folder..." -ForegroundColor Cyan
if (-not (Test-Path ".\backend") -or -not (Test-Path ".\frontend")) {
    Fail "This doesn't look like the project folder (no 'backend' or 'frontend' folder here). Open PowerShell in the folder that contains both, then re-run this script."
}
if (-not (Test-Path ".\leases_list_redesign.patch")) {
    Fail "Can't find 'leases_list_redesign.patch' in this folder. Make sure you saved it next to this script before running it."
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
git apply --check leases_list_redesign.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch doesn't match your current code, so nothing was applied. Come back to Claude and say 'the patch failed to apply' and paste the message above."
}
Write-Host "OK, the patch is safe to apply." -ForegroundColor Green

Write-Host ""
Write-Host "Step 4: Applying the patch (files are changing now)..." -ForegroundColor Cyan
git apply leases_list_redesign.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch failed to apply on the real attempt (even though the check passed). Come back to Claude with this message."
}
Write-Host "OK, file updated." -ForegroundColor Green

Write-Host ""
Write-Host "Step 5: Removing the patch file, now that it's applied..." -ForegroundColor Cyan
Remove-Item ".\leases_list_redesign.patch" -ErrorAction SilentlyContinue
Write-Host "OK." -ForegroundColor Green

Write-Host ""
Write-Host "Step 6: Committing and pushing to GitHub..." -ForegroundColor Cyan
git add -u
git commit -m "Redesign Leases list page: column picker, icon actions, expandable row detail, no text wrapping"
if ($LASTEXITCODE -ne 0) {
    Fail "'git commit' failed. See message above."
}
git push
if ($LASTEXITCODE -ne 0) {
    Fail "'git push' failed. Your changes ARE saved locally (the commit worked), they just didn't reach GitHub yet. Check your internet connection / GitHub login and just run 'git push' again by itself."
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "DONE. Pushed to GitHub -- watch Vercel for 'Compiled successfully' / 'Deployment completed'." -ForegroundColor Green
Write-Host "Then open the Leases page: try the Columns dropdown, click a row to expand it," -ForegroundColor Green
Write-Host "and check the icon buttons (document = Settlement, pencil = Edit lease) on the right." -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
