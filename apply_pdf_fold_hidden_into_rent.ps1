# ============================================================================
# apply_pdf_fold_hidden_into_rent.ps1 — hidden charges now fold into
# Rent's printed amount on the PDF, so the printed lines actually add up
# to the total.
#
# WHAT WAS WRONG: unchecking "print on PDF" for a charge correctly hid its
# own row, but its amount still only showed up in the Total -- so the
# visible lines (e.g. just "Rent" and "Commission") didn't add up to the
# printed Total. That looks broken on a real invoice.
#
# WHAT THIS FIXES: every hidden charge's amount is now folded into the
# Rent line's PRINTED figure -- e.g. if Rent is Rs 5,806 and Water/
# Parking/Electricity/Gas/Internet are hidden totalling Rs 3,922, the PDF
# now prints "Rent: Rs 9,729" instead of "Rent: Rs 5,806" with the extra
# amount nowhere to be seen. The printed lines now always sum to the
# Total.
#
# THIS IS PDF DISPLAY ONLY, exactly as you asked:
#   - invoice_line_items in the database is NOT changed
#   - the invoice total is NOT changed
#   - the ledger/journal entries are NOT touched
#   - the in-app invoice view (not the PDF) still shows the real, separate
#     amounts if you ever need to see them broken out
#
# THIS IS CODE-ONLY. No SQL / database step needed. It also applies
# automatically to any invoice PDF you open or reprint from now on --
# no separate "recalculate" step needed for this particular fix, since
# it only changes how the PDF is drawn, not what's stored.
#
# HOW TO USE:
#   1. Put this file AND "pdf_fold_hidden_into_rent.patch" into the main
#      folder of your project (the one with "backend" and "frontend"
#      inside it).
#   2. Open PowerShell in that folder.
#   3. Run:
#      powershell -ExecutionPolicy Bypass -File apply_pdf_fold_hidden_into_rent.ps1
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
if (-not (Test-Path "pdf_fold_hidden_into_rent.patch")) {
    Fail "Can't find 'pdf_fold_hidden_into_rent.patch' in this folder. Make sure you saved it here, next to this script."
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
git apply --check pdf_fold_hidden_into_rent.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch doesn't match your current code, so nothing was applied. Come back to Claude and say 'the patch failed to apply' and paste the message above."
}
Write-Host "OK, the patch is safe to apply." -ForegroundColor Green

Write-Host ""
Write-Host "Step 4: Applying the patch (files are changing now)..." -ForegroundColor Cyan
git apply pdf_fold_hidden_into_rent.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch failed to apply on the real attempt (even though the check passed). Come back to Claude with this message."
}
Write-Host "OK, files updated." -ForegroundColor Green

Write-Host ""
Write-Host "Step 5: Committing and pushing to GitHub..." -ForegroundColor Cyan
git add -A
git commit -m "Invoice PDF: fold hidden charges into Rent's printed amount so visible lines sum to the total"
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
