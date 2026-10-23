# apply_owner_tenants.ps1
#
# Owners living in their own rooms: each such room gets its own tenant record
# (created from the owner's details), so a lease with service charges can be made.
# New Lease form: "Owner lives here" option; Tenants list shows an (owner) tag;
# lease import accepts an owner_occupied column.
#
# RUN FIRST in Supabase SQL Editor: 014_schema_patch_030_owner_occupant_tenants.sql
#
# Run from the folder that contains 'backend' and 'frontend', with this script
# and owner_tenants.patch in that same folder.

$ErrorActionPreference = "Stop"

Write-Host "== Owner-occupied rooms ==" -ForegroundColor Cyan

if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "ERROR: Run this from the folder that contains both 'backend' and 'frontend' subfolders." -ForegroundColor Red
    exit 1
}

$patchFile = "owner_tenants.patch"
if (-not (Test-Path $patchFile)) {
    Write-Host "ERROR: '$patchFile' not found in this folder. Place it here first (same folder as this script)." -ForegroundColor Red
    exit 1
}

$ran = Read-Host "Have you already run 014_schema_patch_030_owner_occupant_tenants.sql in the Supabase SQL Editor? (y/n)"
if ($ran -ne "y") {
    Write-Host "Stop: run the SQL file first (Supabase > SQL Editor), then run this script again. The code needs the new columns." -ForegroundColor Red
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
    Write-Host "the files this patch touches have changed since this patch was made. Stop here and tell me, so I can regenerate it." -ForegroundColor Red
    exit 1
}

Write-Host "`nApplying patch..." -ForegroundColor Yellow
git apply $patchFile
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Patch failed to apply (unexpected, since the dry run just passed). Stop and report this." -ForegroundColor Red
    exit 1
}

Write-Host "`nChecking the patched Python file for syntax errors..." -ForegroundColor Yellow
foreach ($f in @("backend/app/routers/data_transfer.py", "backend/app/routers/owner_tenants.py", "backend/app/services/owner_tenants.py", "backend/app/main.py")) {
    python -c "import ast,sys; ast.parse(open(sys.argv[1], encoding='utf-8').read())" $f
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: $f has a syntax error. Stop here -- do not push -- and report this." -ForegroundColor Red
        exit 1
    }
}
Write-Host "Syntax check passed." -ForegroundColor Green

Write-Host "`nCommitting..." -ForegroundColor Yellow
git add 014_schema_patch_030_owner_occupant_tenants.sql backend/app/main.py backend/app/routers/data_transfer.py backend/app/routers/owner_tenants.py backend/app/services/owner_tenants.py "frontend/app/(dashboard)/leases/new/page.tsx" "frontend/app/(dashboard)/tenants/page.tsx" frontend/lib/api.ts
git commit -m "Owner-occupied rooms: per-room owner tenant record, Owner lives here option on New Lease, owner_occupied column in lease import"
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: git commit failed. Stop and report this." -ForegroundColor Red
    exit 1
}

Write-Host "`nPushing..." -ForegroundColor Yellow
git push
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: git push failed. Your commit is saved locally but NOT live yet. Resolve the push issue, then run 'git push' manually." -ForegroundColor Red
    exit 1
}

Write-Host "`nDone. Vercel will redeploy within 1-2 minutes." -ForegroundColor Green
Write-Host "Then: Leases > New lease, pick building and apartment, tick Owner lives here." -ForegroundColor Green
