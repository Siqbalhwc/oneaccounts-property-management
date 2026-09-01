# apply_deposit_payment_fetch_error_fix.ps1
#
# Fixes: security deposit "Record payment" sometimes shows "Failed to
# fetch" even though the payment actually saved successfully (a slow
# server response after the browser gives up, not a real failure).
#
# What this changes: ONE frontend file only --
#   frontend/app/(dashboard)/leases/page.tsx
#
# After a failed save attempt, the app now double-checks with the server
# whether the payment actually went through before showing an error. If
# it did go through, it's treated as a success (no error shown, list
# refreshed) instead of tempting you to click "Record payment" again and
# risk creating a duplicate.
#
# No database changes in this fix. No backend (.py) changes in this fix.

$ErrorActionPreference = "Stop"

Write-Host "=== Deposit payment 'Failed to fetch' UI fix ===" -ForegroundColor Cyan

# Step 1: Confirm we're in the right folder
if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "STOPPED: This doesn't look like the project folder (no backend/ or frontend/ found here)." -ForegroundColor Red
    Write-Host "Run this from: C:\Users\Shahid Iqbal\Desktop\Property Management" -ForegroundColor Yellow
    exit 1
}
Write-Host "[1/5] Confirmed project folder." -ForegroundColor Green

# Step 2: Pull latest code first
Write-Host "[2/5] Pulling latest code from GitHub..." -ForegroundColor Cyan
git pull
if ($LASTEXITCODE -ne 0) {
    Write-Host "STOPPED: git pull failed. Fix that first, then re-run this script." -ForegroundColor Red
    exit 1
}

# Step 3: Dry-run check -- verifies the patch will apply cleanly, changes nothing yet
Write-Host "[3/5] Checking the patch applies cleanly (no changes made yet)..." -ForegroundColor Cyan
git apply --check "deposit_payment_fetch_error_fix.patch"
if ($LASTEXITCODE -ne 0) {
    Write-Host "STOPPED: Patch does not apply cleanly against your current code." -ForegroundColor Red
    Write-Host "This usually means the file changed since this patch was made. Send this message back and I'll rebuild the patch against your current code." -ForegroundColor Yellow
    exit 1
}
Write-Host "      Check passed." -ForegroundColor Green

# Step 4: Actually apply the patch
Write-Host "[4/5] Applying the patch..." -ForegroundColor Cyan
git apply "deposit_payment_fetch_error_fix.patch"
if ($LASTEXITCODE -ne 0) {
    Write-Host "STOPPED: Patch failed to apply on the real attempt (unexpected after check passed). Nothing else will run." -ForegroundColor Red
    exit 1
}
Write-Host "      Patch applied." -ForegroundColor Green

# Step 5: Commit and push
Write-Host "[5/5] Committing and pushing..." -ForegroundColor Cyan
git add -A
git commit -m "fix: avoid false 'Failed to fetch' error on security deposit payment"
if ($LASTEXITCODE -ne 0) {
    Write-Host "STOPPED: git commit failed." -ForegroundColor Red
    exit 1
}
git push
if ($LASTEXITCODE -ne 0) {
    Write-Host "STOPPED: git push failed. Your local commit is saved -- ask for help pushing it." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "DONE. Pushed successfully." -ForegroundColor Green
Write-Host "Vercel will redeploy the frontend automatically within 1-2 minutes." -ForegroundColor Green
Write-Host "After that, test the same partial deposit payment flow again." -ForegroundColor Green
