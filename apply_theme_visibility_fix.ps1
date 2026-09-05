# apply_theme_visibility_fix.ps1
# Fixes buttons/text/borders/chart fills that were invisible in the Black
# and Navy themes (Add Building, Add Tenant, Add Owner, Add Lease, chart
# fills, secondary buttons, links, badges, etc).
#
# No SQL migration needed for this one -- code only.

$ErrorActionPreference = "Stop"

Write-Host "== Theme visibility fix (Black/Navy buttons & text) =======" -ForegroundColor Cyan

if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "ERROR: Run this from the folder that contains both 'backend' and 'frontend' subfolders." -ForegroundColor Red
    exit 1
}

$patchFile = "theme_visibility_fix.patch"
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
git commit -m "Fix invisible buttons/text/borders/chart fills in Black and Navy themes (introduce accent token, separate from the always-dark ledger surface color)"
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Commit failed." -ForegroundColor Red
    exit 1
}

Write-Host "`nPushing..." -ForegroundColor Yellow
git push
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Push failed. Your commit is saved locally -- ask for help before retrying." -ForegroundColor Red
    exit 1
}

Write-Host "`n== Done =====================================================" -ForegroundColor Green
Write-Host "Pushed successfully. Vercel will redeploy both frontend and backend automatically within 1-2 minutes."
Write-Host "Once it's live: switch to Black and Navy and check the Add Building / Add Tenant / Add Owner / Add Lease buttons, plus a few pages with links or badges."
