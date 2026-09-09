# apply_fix_receipt_crash_rollback.ps1
#
# Fixes "Failed to fetch" when posting a Receive Payment / receipt, and
# closes a more serious gap found while tracing it: if the ledger-posting
# step ever failed AFTER a receipt's payment row(s) were already saved
# (for any reason -- a missing account, a data glitch, anything), those
# payment rows were left behind in the database with NO journal entry
# behind them, and any invoice status already changed stayed changed too.
# The receipt would look "half recorded" with no error explaining why.
#
# What changed (backend/app/routers/payments.py, record_receipt only):
#   1. Several lookups (account, discount account, lease) already had
#      "if not X.data: raise a clean 404" -- but that check could never
#      actually run, because supabase-py's .single() throws its own
#      exception on a missing row before that check is reached. Wrapping
#      each lookup in try/except makes the ALREADY-INTENDED clean error
#      message work as originally designed.
#   2. The room lookup (used only for building/room tagging on the
#      journal entry) now fails soft instead of crashing the whole
#      receipt, matching the tolerant fallback the code already had for
#      when the room simply isn't found.
#   3. NEW: if posting the journal entry fails for any reason, every
#      payment row this request just created is deleted, and every
#      invoice status this request just changed is put back to what it
#      was before -- so a receipt is always either fully recorded (payment
#      + correct invoice status + journal entry, all three) or not
#      recorded at all. Never a partial, silent, unbacked payment.
#   4. backend/app/main.py: added one global exception handler so ANY
#      future unexpected crash, anywhere in the API, comes back as a
#      real JSON error with proper CORS headers, instead of the browser
#      showing a bare, unexplained "Failed to fetch".
#
# What did NOT change: the discount/overpay business rule (if a discount
# is applied, amount received + discount can never exceed the ticked
# invoices' balance; if no discount is applied, the tenant CAN pay more
# than the current balance, recorded as an advance) -- that logic is
# untouched, byte-for-byte identical to before. Every building/room/
# owner/tenant/lease tag on every journal line is also untouched.
#
# Verified: dry-run applied cleanly against a fresh, independent clone of
# main, and both edited files compile with no syntax errors after the
# patch is applied.

$ErrorActionPreference = "Stop"

Write-Host "== Fix: receipt posting crash + safe rollback if ledger posting fails ==" -ForegroundColor Cyan

if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "ERROR: Run this from the folder that contains both 'backend' and 'frontend' subfolders." -ForegroundColor Red
    exit 1
}

$patchFile = "fix_receipt_crash_rollback.patch"
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
git commit -m "Fix receipt posting crash: clean errors on missing lookups, roll back payment+invoice changes if ledger posting fails, global CORS-safe error handler"
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

Write-Host "`nDone. Vercel will redeploy the backend automatically within 1-2 minutes." -ForegroundColor Green
Write-Host "`nHow to verify:" -ForegroundColor Yellow
Write-Host "  1. Wait ~2 minutes, then try posting a receipt again the same way you did before." -ForegroundColor Yellow
Write-Host "  2. If it still fails, you should now see a REAL error message on screen instead of 'Failed to fetch' -- please send me that exact message, it tells us precisely what's wrong." -ForegroundColor Yellow
Write-Host "  3. If it succeeds, check the lease's Journal / General Ledger to confirm the entry posted." -ForegroundColor Yellow
