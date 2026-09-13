# apply_import_export_templates_and_entity_selection.ps1
#
# Adds two small frontend pieces on top of the Import & Export card that's
# already live on your Settings page:
#   1. A "Template" button next to each import slot (Owners, Buildings,
#      Rooms, Tenants, Leases) -- downloads a ready-to-fill starter
#      workbook for just that one entity.
#   2. Checkboxes above the export button so you can choose which
#      entities to include, plus a "Download all templates" button that
#      gets all five starter sheets (and the Instructions sheet) in one file.
#
# This is an ADDITIVE patch on top of your already-deployed Settings page
# -- it does not re-add the Import & Export card itself (that's already
# there), it just adds the Template buttons and export checkboxes to it.
#
# BACKEND PREREQUISITE: run apply_fix_data_transfer_not_wired_and_templates.ps1
# (the companion backend patch) either before or after this one -- these
# buttons call /data-transfer/templates and /data-transfer/export?entities=...,
# which only exist once that backend patch is applied.
#
# Verified before delivery: applied this exact patch to a clean copy of
# your already-deployed Settings page and ran the real TypeScript
# compiler (tsc --noEmit) across the whole frontend project -- zero errors.

$ErrorActionPreference = "Stop"

Write-Host "== Add: Template buttons + selectable export on Settings page ==" -ForegroundColor Cyan

if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "ERROR: Run this from the folder that contains both 'backend' and 'frontend' subfolders." -ForegroundColor Red
    exit 1
}

$patchFile = "import_export_templates_and_entity_selection.patch"
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
    Write-Host "ERROR: Patch does not apply cleanly against your current Settings page." -ForegroundColor Red
    Write-Host "This usually means frontend/app/(dashboard)/settings/page.tsx has changed since this patch was made -- e.g. if the earlier Import & Export card was applied differently than expected. Stop here and tell me exactly what's changed, so I can regenerate the patch against your actual current file." -ForegroundColor Red
    exit 1
}

Write-Host "`nApplying patch..." -ForegroundColor Yellow
git apply $patchFile
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Patch failed to apply (unexpected, since the dry run just passed). Stop and report this." -ForegroundColor Red
    exit 1
}

Write-Host "`nInstalling frontend dependencies and type-checking..." -ForegroundColor Yellow
Push-Location frontend
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: npm install failed. Stop here -- do not push." -ForegroundColor Red
    Pop-Location
    exit 1
}
npx tsc --noEmit -p tsconfig.json
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: TypeScript check failed on the patched file. Stop here -- do not push -- and report this." -ForegroundColor Red
    Pop-Location
    exit 1
}
Write-Host "Type-check passed cleanly." -ForegroundColor Green
Pop-Location

Write-Host "`nCommitting..." -ForegroundColor Yellow
git add -A
git commit -m "Add per-entity import templates and selectable export on Settings page"
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

Write-Host "`nDone. Vercel will redeploy the frontend automatically within 1-2 minutes." -ForegroundColor Green
Write-Host "Once it's live: each import slot gets a 'Template' button, and the export area gets checkboxes plus a 'Download all templates' button." -ForegroundColor Green
Write-Host "Reminder: make sure apply_fix_data_transfer_not_wired_and_templates.ps1 has also been run -- these buttons need that backend fix to actually respond." -ForegroundColor Yellow
