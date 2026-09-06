# apply_gl_drilldown_fix.ps1
# General Ledger upgrade:
#  1. Added "General ledger" to the sidebar under Accounting (was a real
#     page before this, but had no menu link -- only reachable by clicking
#     an account from Trial Balance).
#  2. GL page: added an account picker (searchable dropdown, no more
#     needing to arrive from Trial Balance), plus Building and Apartment
#     filters alongside the existing Date and Tenant filters.
#  3. Drill-down: every Dr/Cr figure on the GL page is now clickable and
#     opens that line's source document -- the real invoice PDF or
#     security deposit receipt when one exists, otherwise a new generic
#     printable "journal voucher" built straight from the ledger entry
#     (covers payments, expenses, salary payments, owner payouts, and
#     manual adjustments -- none of which had a document before this).
#  4. Trial Balance -> GL, Balance Sheet -> GL, and Profit & Loss -> GL
#     links now all carry the building filter through, and Balance Sheet
#     and Profit & Loss got clickable accounts/figures for the first time
#     (Trial Balance already had this).
#
# Run the matching SQL migration FIRST in Supabase SQL Editor:
#   009_schema_patch_024_general_ledger_drilldown.sql
# It rebuilds the general_ledger() function to add the building/apartment
# filters and return the two extra fields (source_id, journal_entry_id)
# the new drill-down needs. This code patch will still apply without it,
# but the GL page's new filters/drill-down won't work until that SQL has
# been run.

$ErrorActionPreference = "Stop"

Write-Host "== General Ledger: sidebar link, filters, and source-document drill-down ==" -ForegroundColor Cyan

if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "ERROR: Run this from the folder that contains both 'backend' and 'frontend' subfolders." -ForegroundColor Red
    exit 1
}

$patchFile = "gl_drilldown.patch"
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
git commit -m "General ledger: sidebar link, account/building/apartment filters, and source-document drill-down"
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
Write-Host "Reminder: if you haven't already, run 009_schema_patch_024_general_ledger_drilldown.sql in Supabase SQL Editor." -ForegroundColor Yellow
