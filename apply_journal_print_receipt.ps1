# apply_journal_print_receipt.ps1
# Journal page: adds a Print icon to every row in the "all lines" table.
# Clicking it opens that line's real document in a new tab:
#   - receipt/payment rows  -> the same branded receipt PDF the
#                              "Receive Payment" screen downloads
#   - invoice rows          -> the invoice PDF
#   - security deposit rows -> the deposit receipt PDF
#   - everything else       -> a generic journal voucher PDF
#
# This fixes: the "Receive Payment" confirmation screen promises you can
# "come back to it later from this receipt's entry in the Journal" -- that
# was never actually built until now, so there was no way to reprint a
# receipt once you left that first confirmation screen.
#
# No SQL migration needed -- nothing in the database changes.

$ErrorActionPreference = "Stop"

Write-Host "== Journal page: print icon for receipts/invoices/vouchers ==" -ForegroundColor Cyan

if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "ERROR: Run this from the folder that contains both 'backend' and 'frontend' subfolders." -ForegroundColor Red
    exit 1
}

$patchFile = "journal_print_receipt.patch"
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
git commit -m "Journal: add print icon to every line, resolving receipts to the branded receipt PDF"
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

Write-Host "`nDone. Vercel will redeploy both frontend and backend automatically within 1-2 minutes." -ForegroundColor Green
Write-Host "No SQL to run for this one -- nothing in the database changed." -ForegroundColor Yellow
