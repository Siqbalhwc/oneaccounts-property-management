# apply_import_rooms_batch_fix.ps1
#
# Fixes: importing Rooms from Excel fails with "Failed to fetch" in the
# browser (Settings > Import & export > Rooms).
#
# Root cause: backend/app/routers/data_transfer.py's import_rooms()
# looked up/created each row's floor with its own separate database call,
# outside the try/except that protects every other step -- so one bad row
# (or just enough rows to run long) could crash or time out the whole
# import instead of reporting just that row and continuing.
#
# This patch touches exactly one file, backend/app/routers/data_transfer.py:
#   - Floors are now fetched once before the loop, same as buildings/
#     owners/existing rooms already were -- no more one-query-per-row.
#   - Floor lookup/creation now happens inside the same try/except as the
#     room insert, so a bad row is reported and skipped, not fatal to the
#     whole batch.
#
# Verified before delivery: applied this exact patch to a fresh, independent
# clone of your repo and ran Python's ast.parse() against the patched file --
# no syntax errors.

$ErrorActionPreference = "Stop"

Write-Host "== Fix: Rooms Excel import (Failed to fetch) ==" -ForegroundColor Cyan

if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "ERROR: Run this from the folder that contains both 'backend' and 'frontend' subfolders." -ForegroundColor Red
    exit 1
}

$patchFile = "import_rooms_batch_fix.patch"
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
git commit -m "Fix Rooms Excel import: batch floor lookups, contain per-row errors"
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
Write-Host "Then test: Settings > Import & export > Rooms, with the same sheet that failed before." -ForegroundColor Green
