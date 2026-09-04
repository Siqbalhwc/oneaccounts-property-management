# ============================================================================
# apply_hotfix_receipt_null_check.ps1 -- fixes the Vercel build failure from
# the last deploy.
#
# WHAT WENT WRONG:
#   TypeScript correctly flagged that "summary" could theoretically still be
#   null at the point one line used it, inside the Save-receipt function.
#   It's not actually null there in practice, but TypeScript can't always
#   tell that across functions -- and it's right to be strict about it, so
#   this fixes it properly rather than silencing the check. One line
#   changed: `summary.opening_balance` -> `(summary?.opening_balance ?? 0)`.
#
#   I ran the REAL production type-check (the same one Vercel runs) against
#   this fix before sending it to you, and it came back completely clean --
#   zero errors anywhere in the project.
#
# HOW TO USE:
#   1. Put this file AND "hotfix_receipt_null_check.patch" into the main
#      folder of your project (the one with "backend" and "frontend"
#      inside it).
#   2. Open PowerShell in that folder (address bar -> type "powershell" ->
#      Enter).
#   3. Run:
#      powershell -ExecutionPolicy Bypass -File apply_hotfix_receipt_null_check.ps1
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
if (-not (Test-Path ".\hotfix_receipt_null_check.patch")) {
    Fail "Can't find 'hotfix_receipt_null_check.patch' in this folder. Make sure you saved it next to this script before running it."
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
git apply --check hotfix_receipt_null_check.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch doesn't match your current code, so nothing was applied. Come back to Claude and say 'the hotfix patch failed to apply' and paste the message above."
}
Write-Host "OK, the patch is safe to apply." -ForegroundColor Green

Write-Host ""
Write-Host "Step 4: Applying the patch (files are changing now)..." -ForegroundColor Cyan
git apply hotfix_receipt_null_check.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch failed to apply on the real attempt (even though the check passed). Come back to Claude with this message."
}
Write-Host "OK, files updated." -ForegroundColor Green

Write-Host ""
Write-Host "Step 5: Committing and pushing to GitHub..." -ForegroundColor Cyan
git add -A
git commit -m "Hotfix: fix TypeScript build error in receipts/new (null-check on summary)"
if ($LASTEXITCODE -ne 0) {
    Fail "'git commit' failed. See message above."
}
git push
if ($LASTEXITCODE -ne 0) {
    Fail "'git push' failed. Your changes ARE saved locally (the commit worked), they just didn't reach GitHub yet. Check your internet connection / GitHub login and just run 'git push' again by itself."
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "DONE. Pushed to GitHub. Watch the Vercel deployment for this commit -- it should now say" -ForegroundColor Green
Write-Host "'Compiled successfully' and complete, instead of failing on the TypeScript check." -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
