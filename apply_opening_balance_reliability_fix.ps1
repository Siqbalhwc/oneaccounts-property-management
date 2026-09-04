# ============================================================================
# apply_opening_balance_reliability_fix.ps1 -- fixes "Opening balance"
# never showing up on the invoice PDF.
#
# WHAT WAS WRONG, IN PLAIN TERMS:
#   The "Opening balance (brought forward)" line on every invoice depended
#   on a database function (general_ledger) that only exists live inside
#   Supabase, not as a file in your repo. Something about how the code
#   called it didn't match, so it was quietly failing on EVERY invoice --
#   and the code was written to swallow that error silently rather than
#   show it, so the line (and "Total receivable" below it) just never
#   appeared, with no error anywhere to point at the cause.
#
#   I re-rendered a real invoice with this exact code, twice: once
#   reproducing your exact symptom (opening balance missing, jumps
#   straight from Total to Security deposit -- matches what you're
#   seeing), and once with the fix (opening balance appears correctly,
#   same font/alignment as every other line). Screenshots of both are
#   attached alongside this so you can compare directly against your own
#   invoice.
#
# WHAT THIS PATCH DOES:
#   Rewrites that one calculation to read directly off the same
#   journal_entries/journal_lines tables the rest of the ledger already
#   uses (exactly like the "opening balance in receipt" feature from
#   earlier today, which IS working) -- no database function involved at
#   all. Also stops silently hiding any OTHER kind of error here, so if
#   something genuinely does go wrong in future, you'll see it instead of
#   a quietly missing line.
#
#   NO DATABASE CHANGES ARE NEEDED for this one.
#
# ABOUT THE SECURITY DEPOSIT LINE NOT SHOWING:
#   This patch does NOT change that -- it's working as designed. The
#   "Security deposit (refundable, held separately)" line only reads from
#   the dedicated Security Deposit screen (under a lease), not from a
#   generic manual journal entry. If you posted the security-held amount
#   through the Journal Entry form instead of that screen, it won't show
#   here -- enter it through the lease's Security Deposit screen instead,
#   and it'll appear automatically with paid/pending/refunded tracking
#   that a plain journal entry can't represent. Come back to Claude if you
#   want that reconsidered.
#
# HOW TO USE:
#   1. Put this file AND "opening_balance_reliability_fix.patch" into the
#      main folder of your project (the one with "backend" and "frontend"
#      inside it).
#   2. Open PowerShell in that folder (address bar -> type "powershell" ->
#      Enter).
#   3. Run:
#      powershell -ExecutionPolicy Bypass -File apply_opening_balance_reliability_fix.ps1
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
if (-not (Test-Path ".\opening_balance_reliability_fix.patch")) {
    Fail "Can't find 'opening_balance_reliability_fix.patch' in this folder. Make sure you saved it next to this script before running it."
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
git apply --check opening_balance_reliability_fix.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch doesn't match your current code, so nothing was applied. Come back to Claude and say 'the patch failed to apply' and paste the message above."
}
Write-Host "OK, the patch is safe to apply." -ForegroundColor Green

Write-Host ""
Write-Host "Step 4: Applying the patch (files are changing now)..." -ForegroundColor Cyan
git apply opening_balance_reliability_fix.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch failed to apply on the real attempt (even though the check passed). Come back to Claude with this message."
}
Write-Host "OK, files updated." -ForegroundColor Green

Write-Host ""
Write-Host "Step 5: Committing and pushing to GitHub..." -ForegroundColor Cyan
git add -A
git commit -m "Invoice PDF: compute opening balance directly from the ledger tables instead of a fragile database RPC"
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
Write-Host "Then download/view an invoice PDF for a tenant with a manual receivable posted -- you should now" -ForegroundColor Green
Write-Host "see 'Opening balance (brought forward)' and 'Total receivable' lines." -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
