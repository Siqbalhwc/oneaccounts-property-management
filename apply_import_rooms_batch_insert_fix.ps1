# apply_import_rooms_batch_insert_fix.ps1
#
# Fixes: importing a large Rooms sheet (e.g. 340 rows across several
# buildings) still fails with "Failed to fetch", even after the earlier
# floor-lookup fix.
#
# Root cause: the earlier fix (already live) batched the FLOOR lookups,
# but each ROOM was still inserted one at a time, plus one separate
# audit-log write per room -- for a 340-row sheet that's ~680 sequential
# database round trips, easily enough to run past the backend's 30-second
# limit. This is the exact same underlying cause already fixed for
# Tenants, just not yet applied to Rooms' own insert step.
#
# This patch touches exactly one file, backend/app/routers/data_transfer.py:
#   - Every row is still validated and its floor resolved/created exactly
#     as before (identical messages, identical floor-creation logic).
#   - Valid rows are then written in batches of 50 (one bulk insert + one
#     bulk audit-log insert per batch) instead of one row at a time.
#   - If a batch fails as a whole for some reason, that one batch falls
#     back to inserting its rows one at a time, so a single bad row is
#     still reported individually instead of losing the whole batch.
#
# Verified before delivery: applied this exact patch to a fresh,
# independent clone of your repo and ran Python's ast.parse() against the
# patched file -- no syntax errors.

$ErrorActionPreference = "Stop"

Write-Host "== Fix: Rooms Excel import for large sheets (Failed to fetch) ==" -ForegroundColor Cyan

if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "ERROR: Run this from the folder that contains both 'backend' and 'frontend' subfolders." -ForegroundColor Red
    exit 1
}

$patchFile = "import_rooms_batch_insert_fix.patch"
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
git commit -m "Fix Rooms Excel import for large sheets: batch room + audit-log inserts"
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
Write-Host "Then test: Settings > Import & export > Rooms, with the same 340-row sheet that failed before." -ForegroundColor Green
