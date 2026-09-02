# ============================================================================
# apply_sidebar_fix.ps1
#
# WHAT THIS FIXES (plain English):
#   Your frontend has been failing to deploy since commit dc90e2e. That
#   commit correctly removed the old "Owner ledger" sidebar link, but it
#   accidentally reverted the Sidebar.tsx file to an OLDER version that
#   doesn't know about a setting called "showImplementation" -- a setting
#   your layout.tsx file (unchanged, still correct) tries to hand it.
#   TypeScript refuses to build when the two files disagree like this, so
#   every deploy since then has failed, and Vercel has just been quietly
#   re-serving your last SUCCESSFUL build -- the one that still shows
#   "Owner ledger" in the sidebar. That's why hard-refreshing never helped.
#
#   This patch updates ONLY frontend/components/ui/Sidebar.tsx to:
#     1. Accept the "showImplementation" setting again
#     2. Show an "Implementation Portal" link for Tower/platform admins
#     3. Show a "My Implementation" link for client-portal users
#     4. Keep "Owner ledger" removed (that part was already correct)
#
#   Nothing else changes. No other file is touched. No database change is
#   needed for this fix.
#
# HOW TO RUN THIS SCRIPT:
#   1. Save this file AND fix_sidebar_implementation_portal.patch into the
#      SAME folder as your project (the folder that has "backend" and
#      "frontend" folders inside it) -- e.g.
#      C:\Users\Shahid Iqbal\Desktop\Property Management
#   2. Open PowerShell in that folder
#   3. Run:
#        powershell -ExecutionPolicy Bypass -File apply_sidebar_fix.ps1
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
$patchFile = ".\fix_sidebar_implementation_portal.patch"
if (-not (Test-Path $patchFile)) {
    Write-Host "ERROR: Could not find fix_sidebar_implementation_portal.patch in this folder." -ForegroundColor Red
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
    Write-Host "This usually means someone already fixed Sidebar.tsx, or another change conflicts with it." -ForegroundColor Red
    Write-Host "STOPPING -- nothing was changed. Please share this error output." -ForegroundColor Red
    exit 1
}
Write-Host "OK - dry run passed. Safe to apply for real." -ForegroundColor Green

Write-Host ""
Write-Host "=== Step 5: Applying the fix ===" -ForegroundColor Cyan
git apply $patchFile
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Applying the patch failed unexpectedly after the dry run passed. STOPPING." -ForegroundColor Red
    exit 1
}
Write-Host "OK - Sidebar.tsx updated." -ForegroundColor Green

Write-Host ""
Write-Host "=== Step 6: Saving and publishing the change ===" -ForegroundColor Cyan
git add -A
git commit -m "fix: restore Implementation Portal sidebar link, fixing broken frontend build"
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
Write-Host "The fix has been pushed to GitHub. Vercel will automatically rebuild the frontend in the next 1-2 minutes." -ForegroundColor Green
Write-Host "Please check the Vercel dashboard for the FRONTEND project after a couple of minutes and confirm the build says 'Compiled successfully' with no errors." -ForegroundColor Yellow
Write-Host "Once that's live, do a hard refresh -- 'Owner ledger' should be gone and (if you're a platform admin) you should see 'Implementation Portal' under a new 'Platform' section." -ForegroundColor Yellow
