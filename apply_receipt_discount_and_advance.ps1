# ============================================================================
# apply_receipt_discount_and_advance.ps1 -- receipts can now cover several
# outstanding invoices at once, with an optional discount and automatic
# advance handling.
#
# IMPORTANT -- RUN THE SQL STEP FIRST:
#   Before running this script, open Supabase -> SQL Editor, paste the
#   ENTIRE contents of
#   "011_schema_patch_027_receipt_discount_and_advance.sql", and click Run.
#   The last thing it does is a small check showing which companies now
#   have a "5901 Discount Allowed" account -- you should see every one of
#   your companies listed there. If you see a red error instead, STOP and
#   come back to Claude with it. Do not run this script until that SQL
#   step succeeds.
#
# HOW TO USE (after the SQL step above is done):
#   1. Put this file AND "receipt_discount_and_advance.patch" into the main
#      folder of your project (the one with "backend" and "frontend"
#      inside it).
#   2. Open PowerShell in that folder.
#   3. Run:
#      powershell -ExecutionPolicy Bypass -File apply_receipt_discount_and_advance.ps1
#
# WHAT CHANGES, IN PLAIN TERMS:
#   - The payment icon on an invoice now opens a full "Receive payment"
#     page instead of a small popup.
#   - That page lists every outstanding invoice for the lease (oldest
#     first, all ticked by default) -- including older unpaid invoices --
#     so "invoice + opening balance" now shows as one combined total
#     receivable, exactly as discussed.
#   - You can untick any invoice you don't want this receipt applied to.
#   - Owners/admins get an extra "Offer a discount" option: an amount plus
#     which account it should be charged to (any account in your chart of
#     accounts, searchable). The discount can only ever close the gap on
#     the ticked invoices -- it's rejected if it would push the total past
#     what's actually owed. This is enforced on the backend, not just
#     hidden in the interface, so it can't be bypassed by a non-owner/
#     admin user even by calling the API directly.
#   - If the amount received is MORE than the ticked invoices need, the
#     extra is automatically recorded as an advance on the lease -- it's
#     never silently lost, and never allowed into the discount box.
#   - Any advance sitting on a lease now shows up as a negative "total
#     receivable" the next time you open Receive Payment for that lease --
#     pulled live from the ledger, so it can't drift out of sync.
#   - One journal entry is posted per receipt: the bank/cash side, the
#     discount side (if any, to whichever account was picked), and
#     Accounts Receivable -- still fully balanced, still using your real
#     chart of accounts.
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
if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Fail "This doesn't look like the project folder (no 'backend'/'frontend' folder here). Open PowerShell inside your oneaccounts-property-management folder and try again."
}
if (-not (Test-Path "receipt_discount_and_advance.patch")) {
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
git apply --check receipt_discount_and_advance.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch doesn't match your current code, so nothing was applied. Come back to Claude and say 'the patch failed to apply' and paste the message above."
}
Write-Host "OK, the patch is safe to apply." -ForegroundColor Green

Write-Host ""
Write-Host "Step 4: Applying the patch (files are changing now)..." -ForegroundColor Cyan
git apply receipt_discount_and_advance.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch failed to apply on the real attempt (even though the check passed). Come back to Claude with this message."
}
Write-Host "OK, files updated." -ForegroundColor Green

Write-Host ""
Write-Host "Step 5: Committing and pushing to GitHub..." -ForegroundColor Cyan
git add -A
git commit -m "Receipts: apply payment across multiple outstanding invoices, optional owner/admin discount, automatic advance handling"
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
Write-Host "Reminder: this only works correctly if you already ran the SQL migration in Supabase first." -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Green
