# apply_receipts_heads_update.ps1
#
# Receipts by Head becomes one clean table, settlements are shown as the
# money they are, and charge names are uniform.
#
#   - ONE table with one Total row. Received heads on the left, then Total
#     received, Paid against security, Net cash (= the cash and bank books).
#     "Amounts in Rupees" sits on the top border of the report.
#   - one column per GL account: "Gas" / "Gas Bill" / "Gas Recovery Income"
#     all show as one column (rent shows as "Rent" even though it posts to
#     Due to Owners); tenant and shop show on one line with "..." and open on
#     click
#   - final settlement is shown gross: dues and charges RECEIVED, the deposit
#     PAID, net cash = what actually moved. The dues paid out of the deposit
#     (and any discount) are recorded as receipts against the invoices, so
#     the invoices show as PAID
#   - charge names match ignoring capital letters and spaces, so
#     "Commission" and "COMMISSION" always post to the same account
#   - the charge name field fills from the GL account and cannot be retyped
#     (lease form, add charge on a lease, Excel import); the Chart of
#     Accounts gets a "Name on reports & charges" column
#
# BEFORE running this script:
#   Run 023_schema_patch_039_account_report_head_name.sql in the Supabase SQL
#   Editor first (safe to re-run). It adds the new name field and sets
#   "Rent" for the Due to Owners account.
#
# Run from the folder that contains 'backend' and 'frontend', with this script
# and receipts_heads_update.patch in that same folder.

$ErrorActionPreference = "Stop"

Write-Host "== Receipts by Head: one table, GL heads, settlements shown gross ==" -ForegroundColor Cyan

if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "ERROR: Run this from the folder that contains both 'backend' and 'frontend' subfolders." -ForegroundColor Red
    exit 1
}

$patchFile = "receipts_heads_update.patch"
if (-not (Test-Path $patchFile)) {
    Write-Host "ERROR: '$patchFile' not found in this folder. Place it here first (same folder as this script)." -ForegroundColor Red
    exit 1
}

$answer = Read-Host "Have you already run 023_schema_patch_039_account_report_head_name.sql in Supabase? (y/n)"
if ($answer -ne "y") {
    Write-Host "Run the SQL file first, then re-run this script." -ForegroundColor Yellow
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
    Write-Host "A report, settlement, charge or account file has changed since this patch was made. Stop here and tell me, so I can regenerate it against your actual current files." -ForegroundColor Red
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
    "backend/app/services/charge_heads.py",
    "backend/app/services/receipts_report.py",
    "backend/app/services/income_by_head_pdf.py",
    "backend/app/services/lease_settlement.py",
    "backend/app/services/ledger.py",
    "backend/app/services/invoice_batch.py",
    "backend/app/services/utility_upload.py",
    "backend/app/routers/reports.py",
    "backend/app/routers/chart_of_accounts.py",
    "backend/app/routers/data_transfer.py"
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
git add backend frontend 023_schema_patch_039_account_report_head_name.sql
git commit -m "Receipts by Head: one table, one column per GL account, settlements shown gross with invoices marked paid; uniform charge names from the GL account; case-insensitive charge matching"
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
Write-Host "Then open Reports > Receipts by Head and set October 1-31." -ForegroundColor Green
