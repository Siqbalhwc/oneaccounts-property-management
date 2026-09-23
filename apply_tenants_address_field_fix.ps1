# apply_tenants_address_field_fix.ps1
#
# Fixes: Tenants import/export template was out of sync with the real Add
# Tenant form. The live form collects full_name, cnic, phone, email,
# address -- but the template/import/export code still asked for
# emergency_contact_name/emergency_contact_phone (never shown anywhere in
# the app anymore) and never mentioned address at all.
#
# Confirmed against the live database before writing this (tenants table
# has both an emergency_contact_name/phone AND an address column -- the
# columns weren't dropped, the form just moved on from them), so nothing
# breaks by leaving those two columns alone at the database level -- they
# just aren't asked for by the template/import/export anymore, matching
# what the Add Tenant form actually collects today.
#
# This patch touches exactly one file, backend/app/routers/data_transfer.py:
#   - Tenants import template: full_name, cnic, phone, email, address
#   - Tenants export: same five columns
#   - Tenants import: writes address instead of the two emergency-contact
#     fields
#   - CNIC and phone validation are completely untouched -- validate_cnic()
#     and normalize_pakistani_phone() aren't touched at all, still the
#     exact same rules as the Add Tenant form.
#
# Verified before delivery: applied this exact patch to a fresh,
# independent clone of your repo and ran Python's ast.parse() against the
# patched file -- no syntax errors.

$ErrorActionPreference = "Stop"

Write-Host "== Fix: Tenants import/export template (address instead of emergency contact) ==" -ForegroundColor Cyan

if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "ERROR: Run this from the folder that contains both 'backend' and 'frontend' subfolders." -ForegroundColor Red
    exit 1
}

$patchFile = "tenants_address_field_fix.patch"
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
    Write-Host "This usually means data_transfer.py has changed since this patch was made. Stop here and tell me exactly what's changed, so I can regenerate the patch against your actual current file." -ForegroundColor Red
    exit 1
}

Write-Host "`nApplying patch..." -ForegroundColor Yellow
git apply $patchFile
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Patch failed to apply (unexpected, since the dry run just passed). Stop and report this." -ForegroundColor Red
    exit 1
}

Write-Host "`nChecking the patched file for Python syntax errors..." -ForegroundColor Yellow
python -c "import ast; ast.parse(open('backend/app/routers/data_transfer.py', encoding='utf-8').read())"
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Patched file has a syntax error. Stop here -- do not push -- and report this." -ForegroundColor Red
    exit 1
}
Write-Host "Syntax check passed cleanly." -ForegroundColor Green

Write-Host "`nCommitting..." -ForegroundColor Yellow
git add -A
git commit -m "Tenants import/export: use address, drop unused emergency contact fields"
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

Write-Host "`nDone. Vercel will redeploy the backend automatically within 1-2 minutes." -ForegroundColor Green
Write-Host "Then check: Settings > Import & export > download the Tenants template -- it should now show full_name, cnic, phone, email, address." -ForegroundColor Green
