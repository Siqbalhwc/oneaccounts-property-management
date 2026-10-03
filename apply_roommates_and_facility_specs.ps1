# apply_roommates_and_facility_specs.ps1
#
# Adds:
#   1. Roommates -- tenant-wise register for police/monitoring. The lease and
#      room stay in the tenant's name.
#        Owner       add, edit, REMOVE
#        Admin       add, edit, REMOVE
#        Accountant  add only
#        Auditor     view / print only
#      "Removing" never deletes: the roommate is stamped with a move-out date,
#      who removed them and why, and stays in the register.
#   2. Facility specs -- per-lease details for what a tenant opted into:
#      parking (vehicle / card number), internet (allowed speed), electricity /
#      water / gas (meter, allowed units), plus free-form fields for anything
#      else. Owner/Admin edit; everyone else view only.
#   3. New "Residents & facilities" page (sidebar > Property) with printable
#      Roommates and Facilities registers, and a Users icon on each lease row
#      that opens that lease's roommates + facilities.
#
# BEFORE running this script:
#   Run 012_schema_patch_028_roommates_and_facility_specs.sql in the Supabase
#   SQL Editor first (safe to re-run). The new code needs its columns/table.
#
# Run from the folder that contains 'backend' and 'frontend', with this script,
# roommates_and_facility_specs.patch in that same folder.

$ErrorActionPreference = "Stop"

Write-Host "== Roommates + facility specs ==" -ForegroundColor Cyan

if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "ERROR: Run this from the folder that contains both 'backend' and 'frontend' subfolders." -ForegroundColor Red
    exit 1
}

$patchFile = "roommates_and_facility_specs.patch"
if (-not (Test-Path $patchFile)) {
    Write-Host "ERROR: '$patchFile' not found in this folder. Place it here first (same folder as this script)." -ForegroundColor Red
    exit 1
}

$answer = Read-Host "Have you already run 012_schema_patch_028_roommates_and_facility_specs.sql in Supabase? (y/n)"
if ($answer -ne "y") {
    Write-Host "Run the SQL patch first, then re-run this script." -ForegroundColor Yellow
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
    Write-Host "Something in access.py, main.py, Sidebar.tsx or leases/page.tsx has changed since this patch was made. Stop here and tell me, so I can regenerate it against your actual current files." -ForegroundColor Red
    exit 1
}

Write-Host "`nApplying patch..." -ForegroundColor Yellow
git apply $patchFile
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Patch failed to apply (unexpected, since the dry run just passed). Stop and report this." -ForegroundColor Red
    exit 1
}

Write-Host "`nChecking the patched Python files for syntax errors..." -ForegroundColor Yellow
$pyFiles = @(
    "backend/app/routers/room_occupants.py",
    "backend/app/routers/facilities.py",
    "backend/app/core/access.py",
    "backend/app/main.py"
)
foreach ($f in $pyFiles) {
    python -c "import ast,sys; ast.parse(open(sys.argv[1], encoding='utf-8').read())" $f
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: $f has a syntax error. Stop here -- do not push -- and report this." -ForegroundColor Red
        exit 1
    }
}
Write-Host "Syntax checks passed." -ForegroundColor Green

Write-Host "`nCommitting..." -ForegroundColor Yellow
git add -A
git commit -m "Roommates register (role-gated) + per-lease facility specs, residents & facilities page"
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

Write-Host "`nDone. Vercel will redeploy backend and frontend within 1-2 minutes." -ForegroundColor Green
Write-Host "Then check: Leases > Users icon on any active lease, and Property > Residents & facilities." -ForegroundColor Green
