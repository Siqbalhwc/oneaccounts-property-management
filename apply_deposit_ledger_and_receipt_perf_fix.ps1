# ============================================================================
# apply_deposit_ledger_and_receipt_perf_fix.ps1 -- two fixes:
#   1. Security deposit on the invoice now checks the real ledger, so a
#      manually-journaled deposit (e.g. an opening balance) is included,
#      not just deposits taken through the dedicated Security Deposit
#      screen.
#   2. Fixes "Failed to fetch" on Receive Payment, caused by too many
#      sequential database calls on one request.
#
# WHAT WAS WRONG, IN PLAIN TERMS:
#
#   (1) Security deposit -- the invoice was only ever looking at the
#   dedicated Security Deposit screen's own records. Money you'd entered
#   as an opening balance through a manual journal entry (crediting the
#   "Security Deposits Held" account directly) was invisible to it, even
#   though it's sitting in the exact same ledger account as a normal
#   deposit payment. Now it reads the account itself, so BOTH kinds of
#   entry are included in one true total. I test-rendered both cases
#   (journal-entry-only, and a mix of journal entry + proper-channel
#   payment) with the real code before sending this -- both came out
#   correct and cleanly aligned, matching the rest of the invoice.
#
#   (2) Receive Payment -- computing "how much is still owed" was making
#   ONE extra database round-trip PER invoice on the lease, done twice
#   over (once for the ticked invoices, again for the opening-balance
#   check I added earlier today). On a lease with a year or more of
#   invoices, that's 20-30+ sequential round-trips on a single request --
#   slow enough on Vercel's serverless cold starts to show "Failed to
#   fetch" in the browser, even though the receipt had usually already
#   been saved successfully a few calls earlier. This is now TWO queries
#   total, regardless of how many invoices exist on the lease.
#
# NO DATABASE CHANGES ARE NEEDED for either of these.
#
# HOW TO USE:
#   1. Put this file AND "deposit_ledger_and_receipt_perf_fix.patch" into
#      the main folder of your project (the one with "backend" and
#      "frontend" inside it).
#   2. Open PowerShell in that folder (address bar -> type "powershell" ->
#      Enter).
#   3. Run:
#      powershell -ExecutionPolicy Bypass -File apply_deposit_ledger_and_receipt_perf_fix.ps1
#
# Same safe pattern as before: checks folder, pulls latest, dry-run checks
# the patch, applies it, commits, pushes. Stops immediately if any step
# fails -- never pushes a half-applied change.
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
if (-not (Test-Path ".\deposit_ledger_and_receipt_perf_fix.patch")) {
    Fail "Can't find 'deposit_ledger_and_receipt_perf_fix.patch' in this folder. Make sure you saved it next to this script before running it."
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
git apply --check deposit_ledger_and_receipt_perf_fix.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch doesn't match your current code, so nothing was applied. Come back to Claude and say 'the patch failed to apply' and paste the message above."
}
Write-Host "OK, the patch is safe to apply." -ForegroundColor Green

Write-Host ""
Write-Host "Step 4: Applying the patch (files are changing now)..." -ForegroundColor Cyan
git apply deposit_ledger_and_receipt_perf_fix.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch failed to apply on the real attempt (even though the check passed). Come back to Claude with this message."
}
Write-Host "OK, files updated." -ForegroundColor Green

Write-Host ""
Write-Host "Step 5: Committing and pushing to GitHub..." -ForegroundColor Cyan
git add -A
git commit -m "Invoice: read security deposit from the ledger (not just the dedicated table); Receipts: batch invoice-balance queries to fix Failed to fetch"
if ($LASTEXITCODE -ne 0) {
    Fail "'git commit' failed. See message above."
}
git push
if ($LASTEXITCODE -ne 0) {
    Fail "'git push' failed. Your changes ARE saved locally (the commit worked), they just didn't reach GitHub yet. Check your internet connection / GitHub login and just run 'git push' again by itself."
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "DONE. Pushed to GitHub -- watch Vercel for 'Compiled successfully' / 'Deployment completed'." -ForegroundColor Green
Write-Host "Then: (1) view that invoice PDF again -- the security deposit total should now include your" -ForegroundColor Green
Write-Host "journal-entered amount, and (2) try the receipt again -- it should no longer say Failed to fetch." -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
