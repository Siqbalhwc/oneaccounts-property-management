# ============================================================================
# apply_deposit_tenant_scope_fix.ps1 -- fixes security deposit still not
# showing on the invoice for a manually-journaled entry.
#
# WHAT WAS WRONG, IN PLAIN TERMS:
#   Same root cause as the "opening balance" mismatch fixed earlier today,
#   just in one more place we'd missed: the security deposit ledger check
#   was still scoped to the specific LEASE. Your opening security entry
#   was tagged to the tenant, not to a specific lease_id -- so it was
#   invisible to that lookup. Now it checks the tenant (same as every
#   other "opening balance" figure already fixed today), so it's picked
#   up correctly.
#
#   I re-rendered your EXACT invoice (Shehroz Rafiq, Maria Apartments,
#   Room 101, Rs 39,000) with this fix using the real code -- it now shows
#   the security deposit line. I also re-checked the normal case (a
#   deposit taken through the dedicated Security Deposit screen) still
#   works exactly as before.
#
# NO DATABASE CHANGES ARE NEEDED for this one.
#
# HOW TO USE:
#   1. Put this file AND "deposit_tenant_scope_fix.patch" into the main
#      folder of your project (the one with "backend" and "frontend"
#      inside it).
#   2. Open PowerShell in that folder (address bar -> type "powershell" ->
#      Enter).
#   3. Run:
#      powershell -ExecutionPolicy Bypass -File apply_deposit_tenant_scope_fix.ps1
#
# Same safe pattern as before: checks folder, pulls latest, dry-run checks
# the patch, applies it, commits, pushes, then removes the patch file and
# itself is left as one small untracked local file -- safe to delete by
# hand afterward, never pushed to GitHub.
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
if (-not (Test-Path ".\deposit_tenant_scope_fix.patch")) {
    Fail "Can't find 'deposit_tenant_scope_fix.patch' in this folder. Make sure you saved it next to this script before running it."
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
git apply --check deposit_tenant_scope_fix.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch doesn't match your current code, so nothing was applied. Come back to Claude and say 'the patch failed to apply' and paste the message above."
}
Write-Host "OK, the patch is safe to apply." -ForegroundColor Green

Write-Host ""
Write-Host "Step 4: Applying the patch (files are changing now)..." -ForegroundColor Cyan
git apply deposit_tenant_scope_fix.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch failed to apply on the real attempt (even though the check passed). Come back to Claude with this message."
}
Write-Host "OK, files updated." -ForegroundColor Green

Write-Host ""
Write-Host "Step 5: Removing the patch file, now that it's applied..." -ForegroundColor Cyan
Remove-Item ".\deposit_tenant_scope_fix.patch" -ErrorAction SilentlyContinue
Write-Host "OK." -ForegroundColor Green

Write-Host ""
Write-Host "Step 6: Committing and pushing to GitHub..." -ForegroundColor Cyan
git add -u
git commit -m "Invoice: check the security deposit ledger tenant-wide, not just lease-scoped, so a manually-journaled deposit is picked up"
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
Write-Host "Then re-view Shehroz Rafiq's invoice (IN/20260902/001) -- the security deposit line should now appear." -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
