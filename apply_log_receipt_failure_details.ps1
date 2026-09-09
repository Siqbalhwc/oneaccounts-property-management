# apply_log_receipt_failure_details.ps1
#
# Adds ONE thing: logs the real underlying error (with full traceback) to
# Vercel's Runtime Logs right before returning the safe generic message
# to the screen. Nothing about behavior, validation, or the rollback
# added in the previous patch changes -- this is purely so we can SEE
# what's actually failing on your next attempt.
#
# After this deploys, reproduce the failed receipt one more time, then
# check: Vercel dashboard -> backend project -> Logs tab -> filter to
# that moment -> copy the error line(s) back here.

$ErrorActionPreference = "Stop"

Write-Host "== Add detailed error logging for receipt posting failures ==" -ForegroundColor Cyan

if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "ERROR: Run this from the folder that contains both 'backend' and 'frontend' subfolders." -ForegroundColor Red
    exit 1
}

$patchFile = "log_receipt_failure_details.patch"
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
git commit -m "Log the real error behind a failed receipt posting to Vercel Runtime Logs"
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

Write-Host "`nDone. Vercel will redeploy the backend automatically within 1-2 minutes." -ForegroundColor Green
Write-Host "`nNext step:" -ForegroundColor Yellow
Write-Host "  1. Wait ~2 minutes." -ForegroundColor Yellow
Write-Host "  2. Try posting the SAME receipt again (same lease, same amounts if you can)." -ForegroundColor Yellow
Write-Host "  3. Go to Vercel -> your BACKEND project -> Logs tab -> find the moment you clicked Save." -ForegroundColor Yellow
Write-Host "  4. Copy the error line(s) you see there and send them back -- that will show us the exact cause." -ForegroundColor Yellow
