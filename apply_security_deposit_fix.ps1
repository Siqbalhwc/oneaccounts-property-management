# ============================================================================
# apply_security_deposit_fix.ps1 — fixes security deposit posting + adds
# receipt tracking, a "Record receipt" flow, a printable deposit receipt,
# and shows the deposit status on the first invoice.
#
# HOW TO USE:
#   1. Put this file AND "security_deposit_workflow.patch" into the main
#      folder of your oneaccounts-property-management project (the folder
#      that has "backend" and "frontend" folders inside it).
#   2. IMPORTANT: run 006_security_deposit_receipt_tracking.sql in Supabase
#      SQL Editor FIRST, before running this script.
#   3. Open PowerShell in that project folder.
#   4. Run:
#      powershell -ExecutionPolicy Bypass -File apply_security_deposit_fix.ps1
#
# WHAT CHANGES, IN PLAIN TERMS:
#   - Creating a lease no longer force-posts a security deposit journal
#     entry. You're now asked "has this deposit been collected yet?" -- if
#     yes, you also pick WHICH account (Bank, Cash, etc.) received it.
#   - If not collected yet, nothing posts. On the Leases page, that lease
#     now shows a "Pending" tag with a "Record receipt" button -- use it
#     once the money actually comes in, and THAT posts the entry.
#   - Once a deposit is received (whether at signing or later), a
#     "Print receipt" button appears on the Leases page -- a proper
#     acknowledgement-of-receipt PDF you can hand to the tenant.
#   - The first invoice (the one auto-created at signing) now shows the
#     security deposit as an extra line at the bottom -- amount + a
#     Received/Pending tag. It does NOT get added to the invoice's total;
#     the deposit keeps its own separate, dedicated flow, exactly as
#     before -- just visible on the invoice now, for reference.
#
# WHAT IT DOES, IN ORDER:
#   1. Makes sure you're in the right folder.
#   2. Pulls the latest code from GitHub (so you're up to date first).
#   3. Checks the patch will apply cleanly (a "dry run" — nothing is changed
#      by this step, it just checks).
#   4. Applies the patch (this is when files actually change).
#   5. Commits and pushes the change to GitHub, which will trigger Vercel
#      to redeploy both backend and frontend automatically.
#
# If anything goes wrong at any step, the script stops and tells you —
# it will NOT push a broken/partial change.
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
if (-not (Test-Path "security_deposit_workflow.patch")) {
    Fail "Can't find 'security_deposit_workflow.patch' in this folder. Make sure you saved it here, next to this script."
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
git apply --check security_deposit_workflow.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch doesn't match your current code, so nothing was applied. This usually means the code changed since this patch was made. Come back to Claude and say 'the patch failed to apply' and paste the message above."
}
Write-Host "OK, the patch is safe to apply." -ForegroundColor Green

Write-Host ""
Write-Host "Step 4: Applying the patch (files are changing now)..." -ForegroundColor Cyan
git apply security_deposit_workflow.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch failed to apply on the real attempt (even though the check passed). Come back to Claude with this message."
}
Write-Host "OK, files updated." -ForegroundColor Green

Write-Host ""
Write-Host "Step 5: Committing and pushing to GitHub..." -ForegroundColor Cyan
git add -A
git commit -m "Security deposit: conditional posting + receive flow + receipt PDF + show on first invoice"
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
Write-Host "Reminder: if you haven't already, run 006_security_deposit_receipt_tracking.sql in Supabase SQL Editor." -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Green
