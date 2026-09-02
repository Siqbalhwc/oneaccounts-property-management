# ============================================================================
# apply_settlement_two_column_layout.ps1
#
# WHAT THIS CHANGES (plain English):
#   The "Close lease - settlement" screen (opened from the lease list) was
#   a single narrow column, even on a wide monitor -- it left a lot of
#   empty space on the sides. This patch reorganizes ONLY the page's
#   layout into two columns:
#
#     LEFT  (wide)   - the detail you review: Rent & bills breakdown,
#                       Discount, Security deposit + deduction lines.
#     RIGHT (narrow, stays visible while you scroll) - Move-out date,
#                       Printed statement choice, the closing note, the
#                       big net refund/owed total, and the "Close lease"
#                       / "Cancel" buttons.
#
#   No calculations, API calls, field names, or button behavior were
#   changed -- every input, handler, and number on the page works exactly
#   as before. Only the arrangement of the existing cards on screen changed.
#
#   File touched: frontend/app/(dashboard)/leases/[id]/settlement/page.tsx
#   No other file is touched. No database change is needed for this fix.
#
# HOW TO RUN THIS SCRIPT:
#   1. Save this file AND settlement_two_column_layout.patch into the SAME
#      folder as your project (the folder that has "backend" and
#      "frontend" folders inside it) -- e.g.
#      C:\Users\Shahid Iqbal\Desktop\Property Management
#   2. Open PowerShell in that folder
#   3. Run:
#        powershell -ExecutionPolicy Bypass -File apply_settlement_two_column_layout.ps1
#   4. Read the messages as it runs. If anything goes wrong, it STOPS and
#      tells you -- it will never push a half-applied change.
# ============================================================================

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== Step 1: Confirming you're in the right folder ===" -ForegroundColor Cyan
if (-not (Test-Path ".\backend") -or -not (Test-Path ".\frontend")) {
    Write-Host "ERROR: This doesn't look like the project folder." -ForegroundColor Red
    Write-Host "Please 'cd' into the folder that contains 'backend' and 'frontend' subfolders, then run this script again." -ForegroundColor Red
    exit 1
}
Write-Host "OK - found backend/ and frontend/ folders here." -ForegroundColor Green

Write-Host ""
Write-Host "=== Step 2: Checking the patch file is present ===" -ForegroundColor Cyan
$patchFile = ".\settlement_two_column_layout.patch"
if (-not (Test-Path $patchFile)) {
    Write-Host "ERROR: Could not find settlement_two_column_layout.patch in this folder." -ForegroundColor Red
    Write-Host "Make sure you saved it in the same folder as this script." -ForegroundColor Red
    exit 1
}
Write-Host "OK - patch file found." -ForegroundColor Green

Write-Host ""
Write-Host "=== Step 3: Pulling the latest code first ===" -ForegroundColor Cyan
git pull
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: 'git pull' failed. Fix that first (check for uncommitted local changes or network issues), then re-run this script." -ForegroundColor Red
    exit 1
}
Write-Host "OK - up to date with GitHub." -ForegroundColor Green

Write-Host ""
Write-Host "=== Step 4: Dry-run check (this changes NOTHING yet) ===" -ForegroundColor Cyan
git apply --check $patchFile
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: The patch does not apply cleanly to your current code." -ForegroundColor Red
    Write-Host "This usually means the settlement page was already edited elsewhere since this patch was made." -ForegroundColor Red
    Write-Host "STOPPING -- nothing was changed. Please share this error output." -ForegroundColor Red
    exit 1
}
Write-Host "OK - dry run passed. Safe to apply for real." -ForegroundColor Green

Write-Host ""
Write-Host "=== Step 5: Applying the layout change ===" -ForegroundColor Cyan
git apply $patchFile
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Applying the patch failed unexpectedly after the dry run passed. STOPPING." -ForegroundColor Red
    exit 1
}
Write-Host "OK - settlement page layout updated." -ForegroundColor Green

Write-Host ""
Write-Host "=== Step 6: Saving and publishing the change ===" -ForegroundColor Cyan
git add -A
git commit -m "style: rebuild lease settlement page as full-width two-column layout"
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: git commit failed. STOPPING before push." -ForegroundColor Red
    exit 1
}
git push
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: git push failed. Your commit is saved locally but NOT yet on GitHub/Vercel." -ForegroundColor Red
    Write-Host "Please share this error output before trying again." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== DONE ===" -ForegroundColor Green
Write-Host "The change has been pushed to GitHub. Vercel will automatically rebuild the frontend in the next 1-2 minutes." -ForegroundColor Green
Write-Host "Once that's live, open any lease's settlement screen and confirm: wide screens show two columns (details on the left, date/summary/buttons on the right, staying visible as you scroll); narrow screens still stack everything in one column." -ForegroundColor Yellow
