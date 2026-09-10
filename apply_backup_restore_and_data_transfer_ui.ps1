# apply_backup_restore_and_data_transfer_ui.ps1
# Adds the frontend pieces for two features already live on the backend:
#   1. Tower page: "Backup" button per company + a "Backup & restore"
#      section inside each company's detail view (download a full backup,
#      or restore one into an empty company).
#   2. Settings page: "Import & export" card -- one-click Excel export of
#      Owners/Buildings/Rooms/Tenants/Leases, plus five upload slots to
#      import them back in, each showing a row-by-row report.
#
# Touches exactly three files, all additive (nothing existing is removed):
#   - frontend/lib/api.ts                       (+ downloadFile helper)
#   - frontend/app/(dashboard)/tower/page.tsx   (+ backup/restore UI)
#   - frontend/app/(dashboard)/settings/page.tsx (+ import/export UI)
#
# Verified before delivery: applied this exact patch to a fresh clone of
# your repo and ran the real TypeScript compiler (`tsc --noEmit`) across
# the whole frontend project -- zero errors.
#
# BACKEND PREREQUISITE: schema_patch_027_company_backup_restore.sql must
# already be run in Supabase for the Tower page's backup/restore buttons to
# work (the backend endpoints and data_transfer.py were already deployed
# earlier). If you haven't run that SQL patch yet, this frontend still
# installs fine -- the buttons will just show a clear error from the API
# until the SQL patch is run.

$ErrorActionPreference = "Stop"

Write-Host "== Add frontend: Tower backup/restore + Settings import/export ==" -ForegroundColor Cyan

if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "ERROR: Run this from the folder that contains both 'backend' and 'frontend' subfolders." -ForegroundColor Red
    exit 1
}

$patchFile = "frontend_backup_restore_and_data_transfer_ui.patch"
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
    Write-Host "This usually means lib/api.ts, tower/page.tsx, or settings/page.tsx have changed since this patch was made. Stop here and tell me exactly what's changed, so I can regenerate the patch against your actual current files." -ForegroundColor Red
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
    Write-Host "ERROR: TypeScript check failed on the patched files. Stop here -- do not push -- and report this." -ForegroundColor Red
    Pop-Location
    exit 1
}
Write-Host "Type-check passed cleanly." -ForegroundColor Green
Pop-Location

Write-Host "`nCommitting..." -ForegroundColor Yellow
git add -A
git commit -m "Add Tower backup/restore UI and Settings import/export UI"
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
Write-Host "Once it's live:" -ForegroundColor Green
Write-Host "  - Tower page: each company row gets a 'Backup' button; opening a company's detail view has a new 'Backup & restore' section." -ForegroundColor Green
Write-Host "  - Settings page: a new 'Import & export' card near the bottom (owner/admin only)." -ForegroundColor Green
Write-Host "`nReminder: run schema_patch_027_company_backup_restore.sql in Supabase first if you haven't yet -- the buttons need it." -ForegroundColor Yellow
