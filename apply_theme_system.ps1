# apply_theme_system.ps1
# Applies the Dark/Navy theme system patch (frontend) + the small
# theme_preference profile field (backend).
#
# IMPORTANT: Run the matching SQL migration
# (009_schema_patch_024_add_theme_preference.sql) in Supabase -> SQL Editor
# FIRST, before running this script. The frontend/backend code expects that
# column to already exist.

$ErrorActionPreference = "Stop"

Write-Host "== Theme system (Dark/Navy) patch =========================" -ForegroundColor Cyan

# 1. Confirm we're in the right folder
if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "ERROR: Run this from the folder that contains both 'backend' and 'frontend' subfolders." -ForegroundColor Red
    exit 1
}

$patchFile = "theme_system.patch"
if (-not (Test-Path $patchFile)) {
    Write-Host "ERROR: '$patchFile' not found in this folder. Place it here first." -ForegroundColor Red
    exit 1
}

# 2. Get the latest code first
Write-Host "`nPulling latest code..." -ForegroundColor Yellow
git pull
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: git pull failed. Resolve that first, then re-run this script." -ForegroundColor Red
    exit 1
}

# 3. Dry run - verify the patch will apply cleanly before changing anything
Write-Host "`nChecking that the patch applies cleanly (dry run, changes nothing yet)..." -ForegroundColor Yellow
git apply --check $patchFile
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Patch does not apply cleanly against your current code." -ForegroundColor Red
    Write-Host "This usually means the code has moved on since this patch was made. Stop here and ask for a refreshed patch." -ForegroundColor Red
    exit 1
}

# 4. Actually apply it
Write-Host "`nApplying patch..." -ForegroundColor Yellow
git apply $patchFile
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Patch failed to apply (unexpected, since the dry run just passed). Stop and report this." -ForegroundColor Red
    exit 1
}

# 5. Save and publish
Write-Host "`nCommitting..." -ForegroundColor Yellow
git add -A
git commit -m "Add Dark and Navy themes alongside the existing Ledger theme, with a sidebar theme switcher, DB-synced preference, and app-wide themed scrollbars"
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
Write-Host "Once it's live: open the app, look at the bottom of the sidebar for the 3 small theme icons (Ledger / Black / Navy)."
