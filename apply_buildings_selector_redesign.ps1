# ============================================================================
# apply_buildings_selector_redesign.ps1 -- redesigns the Buildings &
# apartments page:
#
#   1. The old wrapping row of building-name tabs (which grew unreadable
#      once you had more than ~10 buildings) is replaced with a compact,
#      type-to-search building selector on the right of the page title.
#      Each option in the dropdown shows the building's unit count.
#   2. The "Edit building / Archive building / Add apartment / Add building"
#      buttons, which used to float alone on their own row, now share one
#      row with the apartment search box and status filter -- no more empty
#      row above the apartment cards.
#   3. A new "Building snapshot" strip appears below the apartment cards:
#      an occupied/available/under-repair bar plus average rent for the
#      selected building. This always reflects the WHOLE building, even
#      while you're searching/filtering the cards above it.
#
# WHAT THIS DOES NOT CHANGE:
#   - Two files change: frontend/app/(dashboard)/buildings/page.tsx and
#     frontend/components/ui/SearchableSelect.tsx (the second gets one
#     small, backward-compatible addition -- an optional "meta" label per
#     dropdown row -- used by every other page that already uses this
#     component, e.g. Chart of Accounts, Owners, Tenants, Journal Entries).
#   - No backend files touched, no database changes, no API changes.
#   - Every action (Edit building, Archive building, Add apartment, Add
#     building, editing/archiving a room) still does exactly what it did
#     before -- just laid out more cleanly.
#
# NO DATABASE CHANGES ARE NEEDED FOR THIS ONE.
#
# HOW TO USE:
#   1. Put this file AND "buildings_selector_redesign.patch" into the main
#      folder of your project (the one with "backend" and "frontend"
#      inside it).
#   2. Open PowerShell in that folder.
#   3. Run:
#      powershell -ExecutionPolicy Bypass -File apply_buildings_selector_redesign.ps1
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
if (-not (Test-Path ".\buildings_selector_redesign.patch")) {
    Fail "Can't find 'buildings_selector_redesign.patch' in this folder. Make sure you saved it next to this script before running it."
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
git apply --check buildings_selector_redesign.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch doesn't match your current code, so nothing was applied. Come back to Claude and say 'the patch failed to apply' and paste the message above."
}
Write-Host "OK, the patch is safe to apply." -ForegroundColor Green

Write-Host ""
Write-Host "Step 4: Applying the patch (files are changing now)..." -ForegroundColor Cyan
git apply buildings_selector_redesign.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch failed to apply on the real attempt (even though the check passed). Come back to Claude with this message."
}
Write-Host "OK, files updated." -ForegroundColor Green

Write-Host ""
Write-Host "Step 5: Removing the patch file, now that it's applied..." -ForegroundColor Cyan
Remove-Item ".\buildings_selector_redesign.patch" -ErrorAction SilentlyContinue
Write-Host "OK." -ForegroundColor Green

Write-Host ""
Write-Host "Step 6: Committing and pushing to GitHub..." -ForegroundColor Cyan
git add -u
git commit -m "Redesign Buildings & apartments page: searchable building selector, merged toolbar row, building snapshot strip"
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
Write-Host "Then open Buildings & apartments: try the building selector top-right," -ForegroundColor Green
Write-Host "check the merged search/filter + buttons row, and the new snapshot strip" -ForegroundColor Green
Write-Host "below the apartment cards." -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
