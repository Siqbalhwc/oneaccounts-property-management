# apply_restore_tenant_owner_fields.ps1
#
# FIXES the Vercel build failure:
#   ./app/(dashboard)/leases/new/page.tsx:123:15
#   Type error: Property 'owner_id' does not exist on type 'Tenant'.
#
# Cause: the "lease time fix" commit (b5b02e3) replaced frontend/lib/api.ts with a
# version made from an older copy, which silently removed the two owner fields
# (owner_id, owner_room_id) from the Tenant type that the owner-occupied-rooms
# change had added. This script puts those two lines back. Nothing else changes.
# No SQL needed -- the database columns already exist.
#
# Run from the folder that contains 'backend' and 'frontend', with this script
# and restore_tenant_owner_fields.patch in that same folder.

$ErrorActionPreference = "Stop"

Write-Host "== Restore Tenant owner fields (build fix) ==" -ForegroundColor Cyan

if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "ERROR: Run this from the folder that contains both 'backend' and 'frontend' subfolders." -ForegroundColor Red
    exit 1
}

$patchFile = "restore_tenant_owner_fields.patch"
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

$apiFile = "frontend/lib/api.ts"
if (Select-String -Path $apiFile -Pattern "owner_room_id" -Quiet) {
    Write-Host "`nThe Tenant type in $apiFile already has the owner fields. Nothing to apply." -ForegroundColor Cyan
    Write-Host "If Vercel still fails, send me the new build log." -ForegroundColor Cyan
    exit 0
}

Write-Host "`nChecking that the patch applies cleanly (dry run, changes nothing yet)..." -ForegroundColor Yellow
git apply --check $patchFile
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Patch does not apply cleanly against your current code." -ForegroundColor Red
    Write-Host "frontend/lib/api.ts has changed since this patch was made. Stop here and tell me, so I can regenerate it." -ForegroundColor Red
    exit 1
}

Write-Host "`nApplying patch..." -ForegroundColor Yellow
git apply $patchFile
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Patch failed to apply (unexpected, since the dry run just passed). Stop and report this." -ForegroundColor Red
    exit 1
}

if (-not (Select-String -Path $apiFile -Pattern "owner_room_id" -Quiet)) {
    Write-Host "ERROR: The change is not in $apiFile after applying. Stop here -- do not push -- and report this." -ForegroundColor Red
    exit 1
}
Write-Host "Change confirmed in $apiFile." -ForegroundColor Green

Write-Host "`nCommitting..." -ForegroundColor Yellow
git add frontend/lib/api.ts
git commit -m "Fix build: restore owner_id and owner_room_id on the Tenant type"
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
Write-Host "Then open Leases > New lease and Tenants to confirm both pages load." -ForegroundColor Green
