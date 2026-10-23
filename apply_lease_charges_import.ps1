# apply_lease_charges_import.ps1
#
# 1) Leases import template now has one "charge: <Label>" column per extra charge
#    (Parking, Internet, Service Charges, ...), and the Leases import reads them.
# 2) New Settings > Import slot "Add charges to existing leases" (Preview, then Apply):
#    adds the missing charges onto leases that already exist, recalculates the
#    current month's invoice, never changes an existing amount, never duplicates.
#
# NO SQL needed for this one.
#
# Run from the folder that contains 'backend' and 'frontend', with this script
# and lease_charges_import.patch in that same folder.

$ErrorActionPreference = "Stop"

Write-Host "== Lease template charges + Add charges to existing leases ==" -ForegroundColor Cyan

if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "ERROR: Run this from the folder that contains both 'backend' and 'frontend' subfolders." -ForegroundColor Red
    exit 1
}

$patchFile = "lease_charges_import.patch"
if (-not (Test-Path $patchFile)) {
    Write-Host "ERROR: '$patchFile' not found in this folder. Place it here first (same folder as this script)." -ForegroundColor Red
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
    Write-Host "data_transfer.py or settings/page.tsx has changed since this patch was made. Stop here and tell me, so I can regenerate it." -ForegroundColor Red
    exit 1
}

Write-Host "`nApplying patch..." -ForegroundColor Yellow
git apply $patchFile
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Patch failed to apply (unexpected, since the dry run just passed). Stop and report this." -ForegroundColor Red
    exit 1
}

Write-Host "`nChecking the patched Python file for syntax errors..." -ForegroundColor Yellow
python -c "import ast,sys; ast.parse(open(sys.argv[1], encoding='utf-8').read())" "backend/app/routers/data_transfer.py"
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: data_transfer.py has a syntax error. Stop here -- do not push -- and report this." -ForegroundColor Red
    exit 1
}
Write-Host "Syntax check passed." -ForegroundColor Green

Write-Host "`nCommitting..." -ForegroundColor Yellow
git add backend/app/routers/data_transfer.py "frontend/app/(dashboard)/settings/page.tsx"
git commit -m "Lease import template: one column per extra charge; new 'Add charges to existing leases' import with preview"
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
Write-Host "Then: Settings > Import, in 'Add charges to existing leases' choose studio_apartment_leases_with_charges.xlsx, press Preview, check the list, then Apply." -ForegroundColor Green
