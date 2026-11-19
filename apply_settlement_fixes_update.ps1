# apply_settlement_fixes_update.ps1
#
# Fixes found by closing a real lease (Sunrinze Tenant 2, room SF003):
#   - the confirmation screen after closing said "Net amount still owed 43,000"
#     even though 43,000 had just been received. It now says what really
#     happened ("Settled in full - nothing owed"), and the received amount
#     and the account it went into
#   - the settlement statement now prints "Received from tenant at settlement
#     (account)" / "Refund paid (account)" and "Settled in full"
#   - the reversal of the old October invoice was dated TODAY while the
#     corrected invoice was dated the move-out date, so the two fell in
#     different months. Both are now dated the move-out date
#   - if recording the receipts against the invoices ever fails, you are now
#     TOLD on screen (before it only went to a log nobody sees)
#   - a closed lease now shows as "Settled" in the leases list
#
# No SQL is needed for this update.
#
# Run from the folder that contains 'backend' and 'frontend', with this script
# and settlement_fixes_update.patch in that same folder.

$ErrorActionPreference = "Stop"

Write-Host "== Settlement fixes ==" -ForegroundColor Cyan

if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "ERROR: Run this from the folder that contains both 'backend' and 'frontend' subfolders." -ForegroundColor Red
    exit 1
}

$patchFile = "settlement_fixes_update.patch"
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
    "backend/app/services/lease_settlement.py",
    "backend/app/services/settlement_pdf.py"
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
git commit -m "Final settlement: honest confirmation screen and statement (received and refund accounts), reversal dated with the repost, never hide receipt-recording problems, closed leases show as Settled"
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
Write-Host "Then close a test lease and check the confirmation screen and the statement." -ForegroundColor Green
