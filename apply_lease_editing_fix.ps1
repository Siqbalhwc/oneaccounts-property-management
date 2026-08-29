# ============================================================================
# apply_lease_editing_fix.ps1 — applies items 4, 6, 7 (and fixes the item 5
# date-editing screen along the way): full lease editing.
#
# IMPORTANT — RUN THE SQL STEP FIRST:
#   Before running this script, open Supabase -> SQL Editor, paste the
#   ENTIRE contents of "006_schema_patch_021_charge_print_visibility.sql",
#   and click Run. Check the result at the bottom -- if you see a red
#   error, STOP and come back to Claude with it. Do not run this script
#   until that SQL step has succeeded.
#
# HOW TO USE (after the SQL step above is done):
#   1. Put this file AND "lease_editing_overhaul.patch" into the main
#      folder of your project (the one with "backend" and "frontend"
#      inside it).
#   2. Open PowerShell in that folder.
#   3. Run:
#      powershell -ExecutionPolicy Bypass -File apply_lease_editing_fix.ps1
#
# WHAT CHANGES, IN PLAIN TERMS:
#   - "Edit dates" is now "Edit lease" -- a fuller screen with:
#       - Dates (unchanged, but now clearly labeled -- any date works,
#         including shortening a lease to a single month)
#       - Charges: every active charge, each with an "Edit" (change the
#         amount from a chosen date, keeping the old amount on invoices
#         already made) and an "End" button (stop it going forward, e.g.
#         parking no longer needed)
#       - "+ Add charge" -- add something new mid-lease (e.g. parking for
#         one month), with a "print on PDF" checkbox
#       - A plain-English message after every change, telling you exactly
#         what it affects: "This month's invoice was updated -- new total
#         Rs X" or "This applies from the next invoice onward"
#       - A "Full charge history" panel showing everything ever added,
#         changed, or ended on this lease
#   - New lease creation now has a "print this line on the invoice PDF"
#     checkbox per fee -- checked by default. Unchecking it still counts
#     the fee fully in the total, it just doesn't print its own line.
#   - The Leases list now has a search bar (tenant / building / room),
#     matching the Tenants page.
#   - Since you asked for it: if a lease already has an unpaid invoice
#     for the CURRENT month when you add/change/end a charge, that
#     invoice is automatically recalculated (never a past invoice, and
#     never one that already has a payment recorded against it).
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
if (-not (Test-Path "lease_editing_overhaul.patch")) {
    Fail "Can't find 'lease_editing_overhaul.patch' in this folder. Make sure you saved it here, next to this script."
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
git apply --check lease_editing_overhaul.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch doesn't match your current code, so nothing was applied. Come back to Claude and say 'the patch failed to apply' and paste the message above."
}
Write-Host "OK, the patch is safe to apply." -ForegroundColor Green

Write-Host ""
Write-Host "Step 4: Applying the patch (files are changing now)..." -ForegroundColor Cyan
git apply lease_editing_overhaul.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch failed to apply on the real attempt (even though the check passed). Come back to Claude with this message."
}
Write-Host "OK, files updated." -ForegroundColor Green

Write-Host ""
Write-Host "Step 5: Committing and pushing to GitHub..." -ForegroundColor Cyan
git add -A
git commit -m "Full lease editing: add/edit/end charges with audit trail and invoice-impact messaging, PDF print-visibility checkbox, lease search bar"
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
