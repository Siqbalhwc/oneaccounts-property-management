# apply_room_wise_opening_balances.ps1
#
# Fixes / adds:
#   1. Room-wise Receivables report (current template kept as is):
#        - Opening bal. now also includes manual entries (e.g. an opening
#          receivable keyed in on 31 Aug) dated INSIDE the selected period,
#          so selecting 01 Aug no longer hides it.
#        - Received now includes receipts not tied to an invoice (payments
#          against an opening balance, and advances).
#        - Security column shows the amount received in Rs (read from the
#          ledger, so a manually posted opening deposit is included), with
#          "(Agreed Rs X)" when the agreed deposit was larger. If nothing is
#          received it keeps the existing "Pending approval" tag.
#        - Filter spanning more than one month: clicking a room lists the
#          invoices (with total); clicking one opens the existing detail.
#   2. General Ledger: when a "From" date is set, an "Opening balance" row
#      is shown and the running balance starts from it. No other change.
#
# BEFORE running this script:
#   Run 013_schema_patch_029_opening_balances.sql in the Supabase SQL Editor
#   first (safe to re-run). The new code uses the functions it creates.
#
# Run from the folder that contains 'backend' and 'frontend', with this script
# and room_wise_opening_balances.patch in that same folder.

$ErrorActionPreference = "Stop"

Write-Host "== Room-wise report + General Ledger opening balance ==" -ForegroundColor Cyan

if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "ERROR: Run this from the folder that contains both 'backend' and 'frontend' subfolders." -ForegroundColor Red
    exit 1
}

$patchFile = "room_wise_opening_balances.patch"
if (-not (Test-Path $patchFile)) {
    Write-Host "ERROR: '$patchFile' not found in this folder. Place it here first (same folder as this script)." -ForegroundColor Red
    exit 1
}

$answer = Read-Host "Have you already run 013_schema_patch_029_opening_balances.sql in Supabase? (y/n)"
if ($answer -ne "y") {
    Write-Host "Run the SQL patch first, then re-run this script." -ForegroundColor Yellow
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
    Write-Host "Something in reports.py, financials.py, reports/page.tsx or ledger/page.tsx has changed since this patch was made. Stop here and tell me, so I can regenerate it against your actual current files." -ForegroundColor Red
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
    "backend/app/routers/reports.py",
    "backend/app/routers/financials.py"
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
git add "backend/app/routers/reports.py" "backend/app/routers/financials.py" "frontend/app/(dashboard)/reports/page.tsx" "frontend/app/(dashboard)/ledger/page.tsx"
if (Test-Path "013_schema_patch_029_opening_balances.sql") {
    git add "013_schema_patch_029_opening_balances.sql"
}
git commit -m "Room-wise report: opening entries in period, invoice-less receipts, security amounts, multi-invoice drill-down; General Ledger opening balance"
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
Write-Host "Then check: Reports > Room-wise (try 01 Aug to 30 Sep), and the General Ledger with a From date." -ForegroundColor Green
