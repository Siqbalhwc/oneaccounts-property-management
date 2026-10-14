# apply_room_search_all_lists.ps1
# Room / apartment / building search on every list page that needs it.
#
# What you can type in the search box now (all of these work together):
#   Sunrise            -> everything belonging to the Sunrise building
#   101  or  A-101     -> everything belonging to apartment 101 (in any building)
#   Sunrise 101        -> apartment 101 in Sunrise only
#   Sunrise Apartment 101  (the word "Apartment" is simply ignored)
#
# Pages changed:
#   Tenants   - also finds tenants by room/building, including PAST tenants of
#               that room (shown with a small "Past tenant" note)
#   Owners    - also finds the owner of that room or building
#   Staff     - NEW search box (name, designation, phone, building)
#   Expenses  - NEW search box (vendor, category, building, apartment)
#   Journal   - NEW search box (both the Manual entries list and all journal lines)
#   Utility bills - NEW search box on the Saved bills table
# Leases, Invoices, Residents and Buildings already had room/building search
# and are NOT touched.
#
# How it is built: the matching logic lives on the server (new endpoint
# /property-search/{entity}); every read runs as the logged-in user, so
# company isolation and building-scoped users are enforced by the database
# itself. It is read-only -- it cannot change any data.
#
# No SQL migration for this one -- no database changes.

$ErrorActionPreference = "Stop"

Write-Host "== Room / apartment / building search on list pages ==" -ForegroundColor Cyan

if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "ERROR: Run this from the folder that contains both 'backend' and 'frontend' subfolders." -ForegroundColor Red
    exit 1
}

$patchFile = "room_search_all_lists.patch"
if (-not (Test-Path $patchFile)) {
    Write-Host "ERROR: '$patchFile' not found in this folder. Place it here first." -ForegroundColor Red
    exit 1
}

Write-Host "`nPulling latest code..." -ForegroundColor Yellow
git pull
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: git pull failed. Resolve that first, then re-run this script." -ForegroundColor Red
    exit 1
}

Write-Host "`nChecking that the patch applies cleanly (dry run, changes nothing yet)..." -ForegroundColor Yellow
git apply --check $patchFile
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Patch does not apply cleanly against your current code." -ForegroundColor Red
    Write-Host "This usually means the code has moved on since this patch was made. Stop here and ask for a refreshed patch." -ForegroundColor Red
    exit 1
}

Write-Host "`nApplying patch..." -ForegroundColor Yellow
git apply $patchFile
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Patch failed to apply (unexpected, since the dry run just passed). Stop and report this." -ForegroundColor Red
    exit 1
}

Write-Host "`nCommitting..." -ForegroundColor Yellow
git add backend frontend
git commit -m "Room, apartment and building search on Tenants, Owners, Staff, Expenses, Journal and Utility bills (server-side, read-only)"
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Commit failed." -ForegroundColor Red
    exit 1
}

Write-Host "`nPushing..." -ForegroundColor Yellow
git push
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Push failed. Your commit is saved locally -- resolve the push issue, then run 'git push' yourself." -ForegroundColor Red
    exit 1
}

Write-Host "`nDone. Vercel will redeploy both backend and frontend automatically within 1-2 minutes." -ForegroundColor Green
Write-Host "No SQL to run for this one." -ForegroundColor Yellow
Write-Host "`nWorth testing once it's live: on Tenants, Owners, Staff, Expenses, Journal and Utility bills, search a building name, an apartment number, and both together (e.g. Sunrise 101)." -ForegroundColor Yellow
