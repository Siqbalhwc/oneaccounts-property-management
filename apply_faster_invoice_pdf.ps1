# apply_faster_invoice_pdf.ps1
# Performance fix, no logic change, NO SQL migration needed this time:
#  - Invoice PDF / preview / WhatsApp-link generation used to fetch the
#    invoice, lease, tenant, room, building, and company one after another
#    (6 separate database round trips), then the security deposit and its
#    payments (2 more), then 2 more for the two ledger account lookups --
#    up to 13 sequential round trips per invoice.
#  - Now: the invoice/lease/tenant/room/building/company chain is fetched
#    as ONE query (using the foreign keys that already exist in the
#    database), the deposit + its payments are fetched as ONE query, and
#    the two account lookups (1100, 2100) are batched into ONE query.
#  - Every number shown on the invoice is computed exactly the same way as
#    before -- this only changes how many requests it takes to gather the
#    same data. Nothing in the database itself needs to change, so there
#    is no SQL file to run first for this one.

$ErrorActionPreference = "Stop"

Write-Host "== Faster invoice PDF (batched fetch, same numbers) ==" -ForegroundColor Cyan

if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "ERROR: Run this from the folder that contains both 'backend' and 'frontend' subfolders." -ForegroundColor Red
    exit 1
}

$patchFile = "faster_invoice_pdf.patch"
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
git commit -m "Speed up invoice PDF generation by batching the invoice/lease/tenant/room/building/company/deposit/account lookups into a handful of queries instead of up to 13 sequential ones"
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
Write-Host "No SQL to run for this one -- this fix only changes how the data is fetched, not what's in the database." -ForegroundColor Yellow
