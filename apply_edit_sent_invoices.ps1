# apply_edit_sent_invoices.ps1
#
# Lets an invoice be recalculated after it has been sent to the tenant on
# WhatsApp (status 'sent'), not only while it is still a draft. Needed when a
# tenant asks for a facility change after seeing the invoice.
# Invoices with a payment recorded (partial / paid) stay protected exactly as before.
#
# NO SQL needed for this one.
#
# Run from the folder that contains 'backend' and 'frontend', with this script
# and edit_sent_invoices.patch in that same folder.

$ErrorActionPreference = "Stop"

Write-Host "== Allow editing invoices after WhatsApp send ==" -ForegroundColor Cyan

if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "ERROR: Run this from the folder that contains both 'backend' and 'frontend' subfolders." -ForegroundColor Red
    exit 1
}

$patchFile = "edit_sent_invoices.patch"
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
    Write-Host "backend/app/services/invoicing.py has changed since this patch was made. Stop here and tell me, so I can regenerate it." -ForegroundColor Red
    exit 1
}

Write-Host "`nApplying patch..." -ForegroundColor Yellow
git apply $patchFile
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Patch failed to apply (unexpected, since the dry run just passed). Stop and report this." -ForegroundColor Red
    exit 1
}

Write-Host "`nChecking the patched Python file for syntax errors..." -ForegroundColor Yellow
python -c "import ast,sys; ast.parse(open(sys.argv[1], encoding='utf-8').read())" "backend/app/services/invoicing.py"
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: invoicing.py has a syntax error. Stop here -- do not push -- and report this." -ForegroundColor Red
    exit 1
}
Write-Host "Syntax check passed." -ForegroundColor Green

Write-Host "`nCommitting..." -ForegroundColor Yellow
git add backend/app/services/invoicing.py
git commit -m "Allow recalculating an invoice after it has been sent on WhatsApp (still blocked once a payment is recorded)"
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

Write-Host "`nDone. Vercel will redeploy within 1-2 minutes." -ForegroundColor Green
Write-Host "Then test: pick a lease whose current-month invoice shows 'sent' with no payment, add a facility (e.g. Parking) from the lease page, and confirm the invoice total updates." -ForegroundColor Green
