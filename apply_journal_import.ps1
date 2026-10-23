# apply_journal_import.ps1
#
# New Settings > Import slot "Journal entries" (Preview, then Post) + a Journal template:
#    imports balanced journal entries from Excel (opening security, opening receivable,
#    any adjustment). Entries that do not balance are declined whole; duplicates are
#    skipped; lines on 1100 / 2100 are tagged to building + room + tenant.
# Also: if a journal entry's lines fail to save, the empty entry header is removed
#    (services/ledger.py), so no empty entry can be left in the books.
#
# NO SQL needed for this one.
#
# Run from the folder that contains 'backend' and 'frontend', with this script
# and journal_import.patch in that same folder.

$ErrorActionPreference = "Stop"

Write-Host "== Journal entries import ==" -ForegroundColor Cyan

if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "ERROR: Run this from the folder that contains both 'backend' and 'frontend' subfolders." -ForegroundColor Red
    exit 1
}

$patchFile = "journal_import.patch"
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
    Write-Host "data_transfer.py, ledger.py or settings/page.tsx has changed since this patch was made. Stop here and tell me, so I can regenerate it." -ForegroundColor Red
    exit 1
}

Write-Host "`nApplying patch..." -ForegroundColor Yellow
git apply $patchFile
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Patch failed to apply (unexpected, since the dry run just passed). Stop and report this." -ForegroundColor Red
    exit 1
}

Write-Host "`nChecking the patched Python file for syntax errors..." -ForegroundColor Yellow
foreach ($f in @("backend/app/routers/data_transfer.py", "backend/app/services/ledger.py")) {
    python -c "import ast,sys; ast.parse(open(sys.argv[1], encoding='utf-8').read())" $f
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: $f has a syntax error. Stop here -- do not push -- and report this." -ForegroundColor Red
        exit 1
    }
}
Write-Host "Syntax check passed." -ForegroundColor Green

Write-Host "`nCommitting..." -ForegroundColor Yellow
git add backend/app/routers/data_transfer.py backend/app/services/ledger.py "frontend/app/(dashboard)/settings/page.tsx"
git commit -m "Add Journal entries Excel import (preview then post, balance check, duplicate guard); remove empty entry header if lines fail to save"
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
Write-Host "Then: Settings > Import > Journal entries: download the Template, fill it, press Preview, check the list, then Post." -ForegroundColor Green
