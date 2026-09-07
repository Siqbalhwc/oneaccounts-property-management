# apply_leases_pagination.ps1
# Leases list page: real server-side search + pagination (50 per page,
# page numbers, Prev/Next), matching the mockup you approved.
#
# IMPORTANT, and worth understanding before you run this: GET /leases is
# also called by 5 OTHER screens (Dashboard, Invoices, Tenants, Reports,
# New Lease) with no parameters at all -- this patch does not touch how
# any of those work. The backend only changes behavior when the NEW
# `limit` parameter is explicitly passed, which currently only the
# updated Leases list page does. Calling it with no parameters (what
# those 5 screens do) returns the exact same data, in the exact same
# shape, as before.
#
# Search behavior: matches tenant name, building name, or apartment/room
# number -- the same two things the old in-browser search matched,
# just resolved on the server now instead of after loading every lease
# your company has ever created into the browser.
#
# No SQL migration for this one -- no database schema changes, only how
# the /leases endpoint is queried and how the Leases page fetches data.

$ErrorActionPreference = "Stop"

Write-Host "== Leases list: server-side search + pagination ==" -ForegroundColor Cyan

if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "ERROR: Run this from the folder that contains both 'backend' and 'frontend' subfolders." -ForegroundColor Red
    exit 1
}

$patchFile = "leases_pagination.patch"
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
git add -A
git commit -m "Leases list: server-side search and pagination (50/page, page numbers, Prev/Next) instead of loading every lease into the browser"
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
Write-Host "`nWorth testing once it's live: open Leases, try the search box (tenant name, building name, apartment number), and click through the page numbers / Prev / Next." -ForegroundColor Yellow
