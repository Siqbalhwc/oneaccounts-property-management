# ============================================================================
# apply_show_on_invoice_merge_fix.ps1 — fixes "unchecked print on PDF but
# it's still showing" for a charge you edited mid-month.
#
# WHAT WAS WRONG: when a charge is edited mid-month, the old segment (before
# your edit) and new segment (after) both get merged into ONE invoice line
# so the amount doesn't show twice -- that part is correct and unchanged.
# But the code combined their "print on PDF" setting with OR logic: if
# EITHER segment was checked, the merged line stayed visible -- so an old,
# already-checked segment from before your edit kept overriding your new
# unchecked choice forever. That's exactly what happened with Water,
# Parking, Electricity, Gas, and Internet on invoice IN/20260830/007.
#
# WHAT THIS FIXES: the merged line now uses whichever segment started MOST
# RECENTLY -- so unchecking "print on PDF" when you edit a charge actually
# takes effect, instead of being silently overridden by an earlier segment
# from before the edit.
#
# THIS IS CODE-ONLY. No SQL / database step needed.
#
# IMPORTANT -- this fixes the CALCULATION going forward. It does NOT
# retroactively rewrite invoice IN/20260830/007's already-stored line items
# by itself. After applying this patch:
#   1. Open that lease's "Edit lease" screen
#   2. Click "Recalculate this month's invoice"
#   3. Re-check the PDF -- Water/Parking/Electricity/Gas/Internet should
#      now be hidden from the printed lines (still counted in the total)
# If the invoice already has a payment recorded against it, recalculate
# won't touch it on purpose (same rule as always) -- come back and let me
# know if that's the case and we'll figure out next steps.
#
# HOW TO USE:
#   1. Put this file AND "show_on_invoice_merge_fix.patch" into the main
#      folder of your project (the one with "backend" and "frontend"
#      inside it).
#   2. Open PowerShell in that folder.
#   3. Run:
#      powershell -ExecutionPolicy Bypass -File apply_show_on_invoice_merge_fix.ps1
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
if (-not (Test-Path "show_on_invoice_merge_fix.patch")) {
    Fail "Can't find 'show_on_invoice_merge_fix.patch' in this folder. Make sure you saved it here, next to this script."
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
git apply --check show_on_invoice_merge_fix.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch doesn't match your current code, so nothing was applied. Come back to Claude and say 'the patch failed to apply' and paste the message above."
}
Write-Host "OK, the patch is safe to apply." -ForegroundColor Green

Write-Host ""
Write-Host "Step 4: Applying the patch (files are changing now)..." -ForegroundColor Cyan
git apply show_on_invoice_merge_fix.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch failed to apply on the real attempt (even though the check passed). Come back to Claude with this message."
}
Write-Host "OK, files updated." -ForegroundColor Green

Write-Host ""
Write-Host "Step 5: Committing and pushing to GitHub..." -ForegroundColor Cyan
git add -A
git commit -m "Fix: merged invoice line now uses the most recent segment's print-on-PDF setting instead of OR-ing all segments"
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
Write-Host "Now go click 'Recalculate this month's invoice' on that lease to fix invoice IN/20260830/007 itself." -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Green
