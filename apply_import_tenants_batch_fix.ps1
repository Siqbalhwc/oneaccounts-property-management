# apply_import_tenants_batch_fix.ps1
#
# Fixes: importing Tenants from Excel fails with "Failed to fetch" in the
# browser (Settings > Import & export > Tenants).
#
# Root cause: import_tenants() in backend/app/routers/data_transfer.py
# wrote one tenant PLUS one audit-log entry per row, sequentially -- two
# separate database round trips for every single row in the sheet. For a
# sheet with a few hundred tenants (a normal size for a real company),
# that's enough sequential round trips to run past the backend's 30-second
# limit and come back as a bare "Failed to fetch" with no readable error --
# the same underlying cause behind the earlier Rooms import fix and the
# backup restore timeout fix.
#
# This patch touches exactly one file, backend/app/routers/data_transfer.py:
#   - All rows are validated first (no database writes), exactly as
#     before, with identical error/skip messages.
#   - Valid rows are then written in batches of 50 (one bulk insert +
#     one bulk audit-log insert per batch) instead of one row at a time.
#   - If a batch fails as a whole for some reason, that one batch falls
#     back to inserting its rows one at a time, so a single bad row is
#     still reported individually instead of losing the whole batch.
#
# Verified before delivery: applied this exact patch to a fresh,
# independent clone of your repo and ran Python's ast.parse() against the
# patched file -- no syntax errors.

$ErrorActionPreference = "Stop"

Write-Host "== Fix: Tenants Excel import (Failed to fetch) ==" -ForegroundColor Cyan

if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "ERROR: Run this from the folder that contains both 'backend' and 'frontend' subfolders." -ForegroundColor Red
    exit 1
}

$patchFile = "import_tenants_batch_fix.patch"
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
git commit -m "Fix Tenants Excel import: batch inserts instead of one row at a time"
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
Write-Host "Then test: Settings > Import & export > Tenants, with the same sheet that failed before." -ForegroundColor Green
