# ============================================================================
# apply_room_to_apartment_labels.ps1 -- renames the word "Room" to "Apartment"
# everywhere it's visible to a user on screen.
#
# WHAT THIS CHANGES, IN PLAIN TERMS:
#   Every button, field label, table column header, placeholder text, empty
#   state message, and summary line that said "Room" now says "Apartment"
#   instead. This touches 14 frontend files:
#     Buildings, Leases (list + new), Tenants, Owners, Dashboard home,
#     Invoices, Reports, Journal (new + edit), Lease Settlement,
#     Notification Bell, Receipts, and the Sidebar menu.
#
# WHAT THIS DOES NOT CHANGE (on purpose):
#   - No backend files are touched at all.
#   - No database changes -- no SQL to run for this one.
#   - The underlying data model stays exactly as-is: the "rooms" database
#     table, the "room_id" / "room_number" / "room_type" fields, and the
#     "/rooms" API route are untouched. Those are wired into your
#     accounting tags, RLS policies, journal entries, and reports, so they
#     were deliberately left alone -- only the on-screen words changed.
#
# NO DATABASE CHANGES ARE NEEDED FOR THIS ONE.
#
# HOW TO USE:
#   1. Put this file AND "room_to_apartment_labels.patch" into the main
#      folder of your project (the one with "backend" and "frontend"
#      inside it).
#   2. Open PowerShell in that folder (address bar -> type "powershell" ->
#      Enter).
#   3. Run:
#      powershell -ExecutionPolicy Bypass -File apply_room_to_apartment_labels.ps1
#
# Same safe pattern as always: checks folder, pulls latest, dry-run checks
# the patch, applies it, commits, pushes, then removes the patch file.
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
if (-not (Test-Path ".\room_to_apartment_labels.patch")) {
    Fail "Can't find 'room_to_apartment_labels.patch' in this folder. Make sure you saved it next to this script before running it."
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
git apply --check room_to_apartment_labels.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch doesn't match your current code, so nothing was applied. Come back to Claude and say 'the patch failed to apply' and paste the message above."
}
Write-Host "OK, the patch is safe to apply." -ForegroundColor Green

Write-Host ""
Write-Host "Step 4: Applying the patch (files are changing now)..." -ForegroundColor Cyan
git apply room_to_apartment_labels.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch failed to apply on the real attempt (even though the check passed). Come back to Claude with this message."
}
Write-Host "OK, files updated." -ForegroundColor Green

Write-Host ""
Write-Host "Step 5: Removing the patch file, now that it's applied..." -ForegroundColor Cyan
Remove-Item ".\room_to_apartment_labels.patch" -ErrorAction SilentlyContinue
Write-Host "OK." -ForegroundColor Green

Write-Host ""
Write-Host "Step 6: Committing and pushing to GitHub..." -ForegroundColor Cyan
git add -u
git commit -m "Frontend labels: rename Room to Apartment everywhere it's visible to the user"
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
Write-Host "Then check the Buildings page, Leases page, and Dashboard -- 'Room' should now read 'Apartment' everywhere." -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
