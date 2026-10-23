# apply_lease_reversal.ps1
#
# Adds "Reverse" for owners and admins on the Leases page:
#   - a Reverse icon on every lease row: reverse that lease's invoices for months
#     before a date (lease stays active), OR reverse the entire lease
#   - a "Reverse past invoices" button at the top: pick a building and a date,
#     preview every lease affected, then confirm -- done in small safe batches
#   - NOTHING is deleted. Each posted journal entry is cancelled by an
#     equal-and-opposite entry dated the SAME day as the original, and the invoice
#     is marked cancelled. Opening balances and manual entries are never touched.
#   - invoices that already have a payment are skipped (a whole lease with
#     payments cannot be fully reversed until those receipts are reversed)
#   - every reversal is written to the audit log
#   - owner/admin only, enforced on the server; every query is limited to the
#     caller's own company
#
# NO SQL migration is needed for this change.
#
# Run from the folder that contains 'backend' and 'frontend', with this script
# and lease_reversal.patch in that same folder.

$ErrorActionPreference = "Stop"

Write-Host "== Lease reversal (owner / admin) ==" -ForegroundColor Cyan

if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "ERROR: Run this from the folder that contains both 'backend' and 'frontend' subfolders." -ForegroundColor Red
    exit 1
}

$patchFile = "lease_reversal.patch"
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
    Write-Host "backend/app/routers/leases.py or frontend/app/(dashboard)/leases/page.tsx has changed since this patch was made. Stop here and tell me, so I can regenerate it against your actual current files." -ForegroundColor Red
    exit 1
}

Write-Host "`nApplying patch..." -ForegroundColor Yellow
git apply $patchFile
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Patch failed to apply (unexpected, since the dry run just passed). Stop and report this." -ForegroundColor Red
    exit 1
}

Write-Host "`nChecking the patched Python files for syntax errors..." -ForegroundColor Yellow
$pyFiles = @(
    "backend/app/services/lease_reversal.py",
    "backend/app/routers/leases.py"
)
foreach ($f in $pyFiles) {
    python -c "import ast,sys; ast.parse(open(sys.argv[1], encoding='utf-8').read())" $f
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: $f has a syntax error. Stop here -- do not push -- and report this." -ForegroundColor Red
        exit 1
    }
}
Write-Host "Syntax checks passed." -ForegroundColor Green

Write-Host "`nCommitting..." -ForegroundColor Yellow
git add backend frontend
git commit -m "Leases: owner/admin can reverse a lease's past invoices or an entire lease (nothing deleted, audit-logged)"
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

Write-Host "`nDone. Vercel will redeploy backend and frontend within 1-2 minutes." -ForegroundColor Green
Write-Host "Then open Leases (as owner/admin) and follow the checklist." -ForegroundColor Green
