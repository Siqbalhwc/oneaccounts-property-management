# apply_leases_lookups_optimized.ps1
# The other 5 screens that used to fetch EVERY lease your company has ever
# created, just to look up one or two by ID/tenant/status:
#   - Tenants page       -> now asks for only active leases
#   - New Lease page      -> now asks for only active leases
#   - Invoices page       -> now asks for only the leases its loaded invoices
#                             actually reference
#   - Reports page        -> now asks for the selected tenant's leases +
#                             whichever leases its loaded deposits reference
#   - Dashboard            -> now asks for the 15 most recent (activity feed)
#                             + whichever leases its loaded invoices reference
#
# Every one of these is the exact same lookup logic as before (same
# tenant/room/status shown, same figures) -- only how many leases get
# fetched to answer them changed. Backend change is purely additive: GET
# /leases with no parameters still returns everything, unchanged, exactly
# as before -- these 5 screens are just the only callers left who now ask
# a narrower question instead.
#
# Verified: Python compiles, and `npx tsc --noEmit` passes with ZERO
# errors across the whole frontend, both on my working copy and an
# independent fresh clone.
#
# No SQL migration needed -- no database schema changes.

$ErrorActionPreference = "Stop"

Write-Host "== Leases lookups: Tenants, New Lease, Invoices, Reports, Dashboard ==" -ForegroundColor Cyan

if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "ERROR: Run this from the folder that contains both 'backend' and 'frontend' subfolders." -ForegroundColor Red
    exit 1
}

$patchFile = "leases_lookups_optimized.patch"
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
git commit -m "Tenants, New Lease, Invoices, Reports, Dashboard: fetch only the leases each screen actually needs instead of every lease the company has ever created"
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
Write-Host "`nWorth testing once live: Tenants page (property shown per tenant), New Lease page (a tenant with an active lease should still be excluded), Invoices page (tenant/room still show correctly), Reports (Tenant Statement + Security Deposits tabs), and the Dashboard (recent activity + awaiting payment + top buildings)." -ForegroundColor Yellow
