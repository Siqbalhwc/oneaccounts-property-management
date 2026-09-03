# ============================================================================
# apply_journal_edit_endpoints.ps1 -- fixes "editable journal entries"
# showing an error.
#
# WHAT WAS WRONG, IN PLAIN TERMS:
#   The Journal page and its Edit screen were already built on the frontend
#   and were calling three backend addresses that were never actually
#   created:
#     - GET   /ledger/manual-entries        (the "Manual entries" list)
#     - GET   /ledger/manual-entry/{id}      (loading one entry to edit)
#     - PATCH /ledger/manual-entry/{id}      (saving the edit)
#   Since none of those existed on the backend, every one of those calls
#   failed -- that's the error you were seeing.
#
# WHAT THIS PATCH DOES:
#   Adds those three addresses to the backend. Only entries you post
#   yourself through "New entry" (not invoices, payments, expenses,
#   salaries, or deposits -- those are still correction-by-reversal only)
#   can be opened and edited this way. Editing checks debits still equal
#   credits, checks every account you pick is real, and writes a record of
#   the change (old vs new) to the History panel, same as editing a lease
#   or an expense already does elsewhere in the app.
#
#   NO DATABASE CHANGES ARE NEEDED for this one -- it only adds backend
#   code, so there is no SQL step before this script.
#
# HOW TO USE:
#   1. Put this file AND "journal_edit_endpoints.patch" into the main
#      folder of your project (the one with "backend" and "frontend"
#      inside it).
#   2. Open PowerShell in that folder.
#   3. Run:
#      powershell -ExecutionPolicy Bypass -File apply_journal_edit_endpoints.ps1
#
# WHAT IT DOES, IN ORDER: same safe pattern as every script before --
# checks folder, pulls latest, dry-run checks the patch, applies it,
# commits, pushes. Stops immediately and pushes nothing if any step fails.
# ============================================================================

$ErrorActionPreference = "Stop"

function Fail($msg) {
    Write-Host ""
    Write-Host "STOPPED: $msg" -ForegroundColor Red
    Write-Host "Nothing further was changed. Nothing was pushed to GitHub." -ForegroundColor Red
    exit 1
}

Write-Host "Step 1: Checking you're in the right folder..." -ForegroundColor Cyan
if (-not (Test-Path ".\backend") -or -not (Test-Path ".\frontend")) {
    Fail "This doesn't look like the project folder (no 'backend' or 'frontend' folder here). Open PowerShell in the folder that contains both, then re-run this script."
}
if (-not (Test-Path ".\journal_edit_endpoints.patch")) {
    Fail "Can't find 'journal_edit_endpoints.patch' in this folder. Make sure you saved it next to this script before running it."
}
Write-Host "OK." -ForegroundColor Green

Write-Host ""
Write-Host "Step 2: Pulling the latest code from GitHub..." -ForegroundColor Cyan
git pull
if ($LASTEXITCODE -ne 0) {
    Fail "'git pull' failed. Check the message above -- often this means you have unsaved local changes. Save/commit those first, then re-run this script."
}
Write-Host "OK." -ForegroundColor Green

Write-Host ""
Write-Host "Step 3: Checking the patch will apply cleanly (no changes made yet)..." -ForegroundColor Cyan
git apply --check journal_edit_endpoints.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch doesn't match your current code, so nothing was applied. Come back to Claude and say 'the patch failed to apply' and paste the message above."
}
Write-Host "OK, the patch is safe to apply." -ForegroundColor Green

Write-Host ""
Write-Host "Step 4: Applying the patch (files are changing now)..." -ForegroundColor Cyan
git apply journal_edit_endpoints.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch failed to apply on the real attempt (even though the check passed). Come back to Claude with this message."
}
Write-Host "OK, files updated." -ForegroundColor Green

Write-Host ""
Write-Host "Step 5: Committing and pushing to GitHub..." -ForegroundColor Cyan
git add -A
git commit -m "Ledger: add missing manual journal entry list/get/edit endpoints"
if ($LASTEXITCODE -ne 0) {
    Fail "'git commit' failed. See message above."
}
git push
if ($LASTEXITCODE -ne 0) {
    Fail "'git push' failed. Your changes ARE saved locally (the commit worked), they just didn't reach GitHub yet. Check your internet connection / GitHub login and just run 'git push' again by itself."
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "DONE. Code changes are pushed to GitHub and Vercel will redeploy automatically (takes 1-2 minutes)." -ForegroundColor Green
Write-Host "After that, go to Journal -> Manual entries and try Edit on one you created." -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
