# apply_redate_fixes.ps1
#
# Two date fixes, backend only (NO SQL migration needed):
#   1. Editing a lease's charges (rent, parking, ...) recalculates the current
#      invoice. Until now the old journal entry was reversed TODAY and the
#      corrected entry also posted TODAY. Now each old entry is reversed on its
#      OWN original date (e.g. 1 October) and the corrected entry is posted on
#      that same date, so receivable as of ANY date stays right.
#      (The utility-bill upload path is unchanged.)
#   2. "Reverse entire lease" now ends the lease on its START date, not today,
#      so a lease entered in error never counts as in force for any period.
#
# Entries that were ALREADY posted with today's date are not changed by this
# script (posted entries are never edited).
#
# Run from the folder that contains 'backend' and 'frontend', with this script
# and redate_fixes.patch in that same folder.

$ErrorActionPreference = "Stop"

Write-Host "== Date fixes: charge-edit reversals and lease reversal ==" -ForegroundColor Cyan

if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "ERROR: Run this from the folder that contains both 'backend' and 'frontend' subfolders." -ForegroundColor Red
    exit 1
}

$patchFile = "redate_fixes.patch"
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

if (-not (Test-Path "backend/app/services/lease_reversal.py")) {
    Write-Host "ERROR: The earlier Reverse-lease patch is not in your code yet. Apply apply_lease_reversal.ps1 first, then re-run this script." -ForegroundColor Red
    exit 1
}

Write-Host "`nChecking that the patch applies cleanly (dry run, changes nothing yet)..." -ForegroundColor Yellow
git apply --check $patchFile
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Patch does not apply cleanly against your current code." -ForegroundColor Red
    Write-Host "invoicing.py, lease_reversal.py or leases.py has changed since this patch was made, or this patch was already applied. Stop here and tell me, so I can regenerate it against your actual current files." -ForegroundColor Red
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
    "backend/app/services/invoicing.py",
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
git commit -m "Charge-edit recalculation now reverses and reposts invoice entries on their original date; lease reversal ends the lease on its start date"
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

Write-Host "`nDone. Vercel will redeploy the backend within 1-2 minutes." -ForegroundColor Green
