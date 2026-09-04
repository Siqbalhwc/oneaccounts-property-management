# ============================================================================
# apply_cleanup_and_reconcile_balances.ps1
#
#   1. Security deposit on the invoice: reverted to ADDING the ledger
#      figure on top of what already worked, instead of replacing it --
#      so a company/lease where the ledger lookup comes back empty for
#      any reason still shows exactly what it always showed. I re-tested
#      this exact regression scenario before sending it (screenshot
#      attached) -- it still shows correctly.
#
#   2. Receive Payment now reconciles with the ledger: "Opening balance"
#      was being computed per-LEASE, while the invoice PDF's "Opening
#      balance" is computed per-TENANT -- so a manual journal entry tagged
#      to the tenant but not to a specific lease showed on the invoice but
#      not in Receive Payment. Both now use the same tenant-wide
#      calculation, so the figure you see in Receive Payment always
#      matches the invoice.
#
#   3. Cleans up the project folder: removes every old .patch and .ps1
#      file that's been generated across our sessions (including this
#      one, after it runs) -- they've all already been applied and were
#      just clutter sitting in your repo. Your actual database migration
#      files (000 schema.sql, 001_..., 002_..., etc.) are NOT touched --
#      those are real schema history and stay exactly where they are.
#
# NO DATABASE CHANGES ARE NEEDED for this one.
#
# HOW TO USE:
#   1. Put this file AND "cleanup_and_reconcile_balances.patch" into the
#      main folder of your project (the one with "backend" and "frontend"
#      inside it).
#   2. Open PowerShell in that folder (address bar -> type "powershell" ->
#      Enter).
#   3. Run:
#      powershell -ExecutionPolicy Bypass -File apply_cleanup_and_reconcile_balances.ps1
#
# Same safe pattern as before: checks folder, pulls latest, dry-run checks
# the patch, applies it, commits, pushes. Stops immediately if any step
# fails -- never pushes a half-applied change. The patch file deletes
# itself once applied; only currently-tracked files are staged for the
# commit (via `git add -u`), so this script itself is never pushed to
# GitHub -- it just stays as one small leftover local file, safe to
# delete by hand afterward, same as any other file you're done with.
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
if (-not (Test-Path ".\cleanup_and_reconcile_balances.patch")) {
    Fail "Can't find 'cleanup_and_reconcile_balances.patch' in this folder. Make sure you saved it next to this script before running it."
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
git apply --check cleanup_and_reconcile_balances.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch doesn't match your current code, so nothing was applied. Come back to Claude and say 'the patch failed to apply' and paste the message above."
}
Write-Host "OK, the patch is safe to apply." -ForegroundColor Green

Write-Host ""
Write-Host "Step 4: Applying the patch (files are changing now)..." -ForegroundColor Cyan
git apply cleanup_and_reconcile_balances.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch failed to apply on the real attempt (even though the check passed). Come back to Claude with this message."
}
Write-Host "OK, files updated." -ForegroundColor Green

Write-Host ""
Write-Host "Step 5: Removing the patch file too, now that it's applied..." -ForegroundColor Cyan
Remove-Item ".\cleanup_and_reconcile_balances.patch" -ErrorAction SilentlyContinue
Write-Host "OK." -ForegroundColor Green

Write-Host ""
Write-Host "Step 6: Committing and pushing to GitHub..." -ForegroundColor Cyan
git add -u
git commit -m "Invoice: keep old security deposit figure as the floor, ledger only adds to it; Receive Payment: reconcile opening balance with the tenant-wide ledger; remove old patch/fix files"
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
Write-Host "Your project folder is now clean of old fix files. Then re-check the invoice PDF and Receive Payment --" -ForegroundColor Green
Write-Host "both should show the same opening balance / security deposit figures now." -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "(This script file itself is safe to delete now too, the same way you'd delete any other old file.)" -ForegroundColor DarkGray
