# apply_logo_cache.ps1
# Performance fix, no SQL migration needed:
#  - Every invoice PDF used to download the company logo from the
#    internet, live, on every single render -- a real blocking network
#    call before the PDF could finish.
#  - Now the logo's bytes are kept in memory for 5 minutes after the
#    first download, so repeat invoices for the same company reuse it
#    instead of re-downloading it each time.
#  - DISCLOSED TRADE-OFF (confirmed with you before building this): your
#    logo's URL stays the same even after you upload a new logo, so for
#    up to 5 minutes after changing it, an invoice generated in that
#    window could still show the OLD logo, until the cache expires or the
#    server restarts. After that, it always shows the current one. This
#    only affects the picture, never any number or figure on the invoice.
#
# No SQL to run for this one -- nothing in the database changes.

$ErrorActionPreference = "Stop"

Write-Host "== Cache company logo for invoice PDFs (bounded 5-minute cache) ==" -ForegroundColor Cyan

if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "ERROR: Run this from the folder that contains both 'backend' and 'frontend' subfolders." -ForegroundColor Red
    exit 1
}

$patchFile = "logo_cache.patch"
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
git commit -m "Cache company logo in memory for invoice PDFs (5-minute bound) instead of re-downloading it from the internet on every render"
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

Write-Host "`nDone. Vercel will redeploy both backend and frontend automatically within 1-2 minutes." -ForegroundColor Green
Write-Host "No SQL to run for this one." -ForegroundColor Yellow
