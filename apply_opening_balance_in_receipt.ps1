# ============================================================================
# apply_opening_balance_in_receipt.ps1 -- lets a manual receivable (or any
# amount owed that isn't tied to a specific invoice) be picked and paid
# down from the Receive Payment screen, the same way an invoice is.
#
# IMPORTANT -- RUN THIS AFTER apply_journal_edit_endpoints.ps1
#   This patch assumes that one has already been applied (both touch
#   backend code, and this one was written against the code AFTER that
#   patch). If you haven't run apply_journal_edit_endpoints.ps1 yet, do
#   that first.
#
# WHAT WAS MISSING, IN PLAIN TERMS:
#   Your invoice PDF/view already shows "Opening balance (brought
#   forward)" and "Total receivable" (opening balance + this invoice) --
#   that part was already working, pulled live from the ledger. What
#   DIDN'T exist yet was a way to actually receive payment against that
#   opening balance from the Receive Payment screen -- only invoices could
#   be ticked and paid down there.
#
# WHAT THIS PATCH DOES:
#   - Receive Payment now shows an "Opening balance (not tied to an
#     invoice)" row above the invoice checklist, whenever there is one --
#     ticked by default, same as invoices.
#   - You can tick/untick it and apply cash and/or a discount to it,
#     exactly like an invoice -- oldest debt first (the opening balance,
#     being older than every invoice shown, is always settled first).
#   - Still one balanced journal entry per receipt, same as before -- this
#     only changes how the payment is split and recorded across
#     invoice-tied vs. non-invoice-tied amounts, never the accounting.
#
#   NO DATABASE CHANGES ARE NEEDED for this one.
#
# HOW TO USE:
#   1. Put this file AND "opening_balance_in_receipt.patch" into the main
#      folder of your project (the one with "backend" and "frontend"
#      inside it).
#   2. Open PowerShell in that folder.
#   3. Run:
#      powershell -ExecutionPolicy Bypass -File apply_opening_balance_in_receipt.ps1
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
if (-not (Test-Path ".\opening_balance_in_receipt.patch")) {
    Fail "Can't find 'opening_balance_in_receipt.patch' in this folder. Make sure you saved it next to this script before running it."
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
git apply --check opening_balance_in_receipt.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch doesn't match your current code, so nothing was applied. This patch expects apply_journal_edit_endpoints.ps1 to have already been run -- if you haven't run that one yet, do that first. Otherwise, come back to Claude and say 'the patch failed to apply' and paste the message above."
}
Write-Host "OK, the patch is safe to apply." -ForegroundColor Green

Write-Host ""
Write-Host "Step 4: Applying the patch (files are changing now)..." -ForegroundColor Cyan
git apply opening_balance_in_receipt.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch failed to apply on the real attempt (even though the check passed). Come back to Claude with this message."
}
Write-Host "OK, files updated." -ForegroundColor Green

Write-Host ""
Write-Host "Step 5: Committing and pushing to GitHub..." -ForegroundColor Cyan
git add -A
git commit -m "Receipts: allow paying down the opening balance (non-invoice-tied receivable) the same way as an invoice"
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
Write-Host "Test it: post a manual journal entry that debits Accounts Receivable and tags a tenant/lease, then" -ForegroundColor Green
Write-Host "open Receive Payment for that lease -- you should see an 'Opening balance' row you can tick." -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
