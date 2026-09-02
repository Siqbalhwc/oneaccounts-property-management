# ============================================================================
# apply_journal_entry_table_layout.ps1
#
# WHAT THIS CHANGES (plain English):
#   The "New journal entry" screen (Journal > New) was a narrow single
#   column, with each line stacked as its own two-row card -- slow to scan
#   and very unlike a normal accounting entry screen. This patch rebuilds
#   it as a proper Odoo/QuickBooks-style table:
#
#     - Date and a single reference/memo field at the top.
#     - One row per journal line: Account | Debit | Credit | Tenant |
#       Owner | Room | Building -- type the amount into the Debit box OR
#       the Credit box, not both (there's no Dr/Cr dropdown any more).
#     - A Total row at the bottom under the Debit/Credit columns, plus a
#       "Balanced" / "Out of balance" banner.
#     - Full page width, and on narrow screens the table scrolls
#       sideways with the Account column pinned in place (so you always
#       know which line you're editing) using a themed scrollbar instead
#       of the browser's plain black one.
#
#   Nothing about what gets POSTED changed -- it's still the exact same
#   /ledger/manual-entry call, same validation (must balance, at least
#   two lines), same accounts. This is purely how you enter the numbers.
#
#   Files touched:
#     - frontend/app/(dashboard)/journal/new/page.tsx
#     - frontend/app/globals.css   (adds the themed scrollbar style only --
#       nothing existing in that file is changed or removed)
#   No other file is touched. No database change is needed for this fix.
#
# HOW TO RUN THIS SCRIPT:
#   1. Save this file AND journal_entry_table_layout.patch into the SAME
#      folder as your project (the folder that has "backend" and
#      "frontend" folders inside it) -- e.g.
#      C:\Users\Shahid Iqbal\Desktop\Property Management
#   2. Open PowerShell in that folder
#   3. Run:
#        powershell -ExecutionPolicy Bypass -File apply_journal_entry_table_layout.ps1
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
$patchFile = ".\journal_entry_table_layout.patch"
if (-not (Test-Path $patchFile)) {
    Write-Host "ERROR: Could not find journal_entry_table_layout.patch in this folder." -ForegroundColor Red
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
    Write-Host "This usually means the journal entry page or globals.css was already edited elsewhere since this patch was made." -ForegroundColor Red
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
Write-Host "OK - journal entry page rebuilt as a table." -ForegroundColor Green

Write-Host ""
Write-Host "=== Step 6: Saving and publishing the change ===" -ForegroundColor Cyan
git add -A
git commit -m "style: rebuild new journal entry page as full-width Odoo/QBO-style table"
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
Write-Host "Once that's live, open Journal > New Entry and confirm: a proper table with Debit/Credit boxes, a Total row, a Balanced/Out-of-balance banner, and on a narrow window the table scrolls sideways with a brass-colored scrollbar and the Account column staying put." -ForegroundColor Yellow
