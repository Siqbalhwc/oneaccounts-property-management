# ============================================================================
# apply_journal_searchable_fields.ps1
#
# WHAT THIS CHANGES (plain English):
#   On the "New journal entry" table, the Account / Tenant / Owner / Room /
#   Building columns were plain dropdown lists -- slow to use once your
#   chart of accounts or tenant list gets long. This patch turns all five
#   into type-to-search boxes: start typing a few letters (e.g. "util" for
#   Utilities, or a tenant's name) and the list narrows instantly. Click or
#   arrow-key + Enter to pick one, same as before.
#
#   The table itself is UNCHANGED from the last update -- still full width,
#   still scrolls sideways on narrow screens with the Account column pinned
#   and the brass-colored scrollbar. Nothing about what gets posted to the
#   ledger changed either -- same /ledger/manual-entry call, same validation.
#   This is purely about making the dropdowns faster to use.
#
#   Files touched:
#     - frontend/components/ui/SearchableSelect.tsx   (NEW file -- the
#       reusable search dropdown itself; doesn't touch any other screen)
#     - frontend/app/(dashboard)/journal/new/page.tsx  (uses the new
#       component instead of plain dropdowns for those 5 fields)
#   No other file is touched. No database change is needed for this fix.
#
# HOW TO RUN THIS SCRIPT:
#   1. Save this file AND journal_searchable_fields.patch into the SAME
#      folder as your project (the folder that has "backend" and
#      "frontend" folders inside it) -- e.g.
#      C:\Users\Shahid Iqbal\Desktop\Property Management
#   2. Open PowerShell in that folder
#   3. Run:
#        powershell -ExecutionPolicy Bypass -File apply_journal_searchable_fields.ps1
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
$patchFile = ".\journal_searchable_fields.patch"
if (-not (Test-Path $patchFile)) {
    Write-Host "ERROR: Could not find journal_searchable_fields.patch in this folder." -ForegroundColor Red
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
    Write-Host "This usually means the journal entry page was already edited elsewhere since this patch was made." -ForegroundColor Red
    Write-Host "STOPPING -- nothing was changed. Please share this error output." -ForegroundColor Red
    exit 1
}
Write-Host "OK - dry run passed. Safe to apply for real." -ForegroundColor Green

Write-Host ""
Write-Host "=== Step 5: Applying the change ===" -ForegroundColor Cyan
git apply $patchFile
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Applying the patch failed unexpectedly after the dry run passed. STOPPING." -ForegroundColor Red
    exit 1
}
Write-Host "OK - searchable dropdowns added." -ForegroundColor Green

Write-Host ""
Write-Host "=== Step 6: Saving and publishing the change ===" -ForegroundColor Cyan
git add -A
git commit -m "feat: type-to-search dropdowns for account/tenant/owner/room/building on journal entry"
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
Write-Host "Once that's live, open Journal > New Entry and confirm: clicking into Account/Tenant/Owner/Room/Building shows a search box, typing narrows the list, and picking an option works with both mouse click and arrow keys + Enter." -ForegroundColor Yellow
