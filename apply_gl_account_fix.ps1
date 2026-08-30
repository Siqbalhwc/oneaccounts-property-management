# ============================================================================
# apply_gl_account_fix.ps1 — "+ Add charge" now ALWAYS shows which GL
# account a charge posts to, and lets you correct it (e.g. a spelling
# mismatch from before) -- not just when the label is brand new.
#
# (If you already applied an earlier version of this fix, this replaces
# it entirely -- just run this one, no need to do anything else first.)
#
# WHAT CHANGES:
#   - The "Label" field now suggests your existing charge labels as you
#     type (browser autocomplete), to reduce the chance of a spelling
#     slip creating an accidental duplicate label.
#   - A "GL account" dropdown is now ALWAYS shown:
#       - Known label (e.g. "Parking") -> pre-fills with the account it
#         already posts to, with a note that you can pick a different one
#         if that's wrong. Changing it updates it for every FUTURE charge
#         under that exact label, on any lease -- it's a company-wide
#         setting, not just for this one charge.
#       - New label -> empty, required, with a note that this is the
#         first time it's been billed.
#   - Nothing about already-generated invoices is touched by this --
#     correcting a mapping only affects charges created from now on.
#
# THIS IS CODE-ONLY. No SQL / database step needed.
#
# HOW TO USE:
#   1. Put this file AND "gl_account_mapping_visible_editable.patch" into
#      the main folder of your project (the one with "backend" and
#      "frontend" inside it).
#   2. Open PowerShell in that folder.
#   3. Run:
#      powershell -ExecutionPolicy Bypass -File apply_gl_account_fix.ps1
#
# Same safe pattern as every script before: checks folder, pulls latest,
# dry-run checks the patch, applies it, commits, pushes. Stops immediately
# and pushes nothing if any step fails.
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
if (-not (Test-Path "gl_account_mapping_visible_editable.patch")) {
    Fail "Can't find the patch file in this folder. Make sure you saved it here, next to this script."
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
git apply --check gl_account_mapping_visible_editable.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch doesn't match your current code, so nothing was applied. Come back to Claude and say 'the patch failed to apply' and paste the message above."
}
Write-Host "OK, the patch is safe to apply." -ForegroundColor Green

Write-Host ""
Write-Host "Step 4: Applying the patch (files are changing now)..." -ForegroundColor Cyan
git apply gl_account_mapping_visible_editable.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch failed to apply on the real attempt (even though the check passed). Come back to Claude with this message."
}
Write-Host "OK, files updated." -ForegroundColor Green

Write-Host ""
Write-Host "Step 5: Committing and pushing to GitHub..." -ForegroundColor Cyan
git add -A
git commit -m "Add Charge: always show and allow correcting the GL account mapping, with label autocomplete"
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
Write-Host "No SQL step needed for this one." -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Green
