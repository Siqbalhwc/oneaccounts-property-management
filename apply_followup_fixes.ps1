# ============================================================================
# apply_followup_fixes.ps1 — fixes the 3 things you flagged after testing:
#   1. "End charge" now shows an in-app confirmation box instead of a
#      plain browser popup.
#   2. The "Edit lease" screen is now full-width instead of a cramped
#      narrow box, and any scrollbars inside it (history lists, etc.) are
#      now slim and styled instead of the default clunky browser ones.
#   3. THE REAL BUG: if you edit a charge's amount partway through the
#      current month, the invoice was showing that charge TWICE (once at
#      the old amount for the days before the change, once at the new
#      amount for the days after) instead of combining them into one
#      line. Now they're correctly merged into a single line with one
#      blended amount -- exactly what your Internet charge did.
#
# This is a CODE-ONLY fix. No SQL / database step needed.
#
# HOW TO USE:
#   1. Put this file AND
#      "followup_fixes_ending_modal_scrollbar_duplicate_line.patch"
#      into the main folder of your project (the one with "backend" and
#      "frontend" inside it).
#   2. Open PowerShell in that folder.
#   3. Run:
#      powershell -ExecutionPolicy Bypass -File apply_followup_fixes.ps1
#
# Same safe pattern as every script before: checks folder, pulls latest,
# dry-run checks the patch, applies it, commits, pushes. Stops immediately
# and pushes nothing if any step fails.
# ============================================================================

$ErrorActionPreference = "Stop"

function Fail($msg) {
    Write-Host ""
    Write-Host "STOPPED: $msg" -ForegroundColor Red
    Write-Host "Nothing further was changed. Nothing was pushed to GitHub." -ForegroundColor Red
    exit 1
}

Write-Host "Step 1: Checking you're in the right folder..." -ForegroundColor Cyan
if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Fail "This doesn't look like the project folder (no 'backend'/'frontend' folder here). Open PowerShell inside your oneaccounts-property-management folder and try again."
}
if (-not (Test-Path "followup_fixes_ending_modal_scrollbar_duplicate_line.patch")) {
    Fail "Can't find the patch file in this folder. Make sure you saved it here, next to this script."
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
git apply --check followup_fixes_ending_modal_scrollbar_duplicate_line.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch doesn't match your current code, so nothing was applied. Come back to Claude and say 'the patch failed to apply' and paste the message above."
}
Write-Host "OK, the patch is safe to apply." -ForegroundColor Green

Write-Host ""
Write-Host "Step 4: Applying the patch (files are changing now)..." -ForegroundColor Cyan
git apply followup_fixes_ending_modal_scrollbar_duplicate_line.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch failed to apply on the real attempt (even though the check passed). Come back to Claude with this message."
}
Write-Host "OK, files updated." -ForegroundColor Green

Write-Host ""
Write-Host "Step 5: Committing and pushing to GitHub..." -ForegroundColor Cyan
git add -A
git commit -m "Fix: in-app confirm for ending a charge, wider edit-lease modal with styled scrollbars, duplicate invoice line when a charge changes mid-month"
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
Write-Host "No SQL step needed for this one." -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Green
