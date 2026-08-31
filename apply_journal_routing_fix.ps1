# ============================================================================
# Applies: journal_routing_fix.patch
#
# WHAT THIS FIXES:
#   The last "Fix pages" push added the New Journal Entry feature as two
#   loose files (journal_list_page.tsx and journal_new_entry_page.tsx) that
#   were never actually wired into the app's routing -- Next.js only ever
#   loads a file literally named "page.tsx". That's why the app deployed
#   successfully but no "New entry" button appeared anywhere.
#
#   This patch does not change any logic. It only:
#     1. Replaces journal/page.tsx with the version that has the
#        "New entry" button and links to /journal/new
#     2. Moves journal_new_entry_page.tsx to journal/new/page.tsx so the
#        form is actually reachable
#     3. Removes the now-empty leftover journal_list_page.tsx
#
# Tested: dry-run applied cleanly against a fresh clone of live main
# (commit 21df41c) before being handed to you.
# ============================================================================

$ErrorActionPreference = "Stop"

# 1. Confirm we're in the right folder
if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "ERROR: Run this from the project folder that contains both 'backend' and 'frontend' subfolders." -ForegroundColor Red
    exit 1
}

# 2. Get the latest code first
Write-Host "Pulling latest from main..." -ForegroundColor Cyan
git pull
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: git pull failed. Stopping." -ForegroundColor Red; exit 1 }

# 3. Dry-run check -- verifies the patch will apply cleanly, changes nothing yet
Write-Host "Checking patch applies cleanly..." -ForegroundColor Cyan
git apply --check journal_routing_fix.patch
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Patch does not apply cleanly against your current code." -ForegroundColor Red
    Write-Host "This usually means the repo has changed since this patch was made. Stopping -- nothing was touched." -ForegroundColor Red
    exit 1
}

# 4. Actually apply it
Write-Host "Applying patch..." -ForegroundColor Cyan
git apply journal_routing_fix.patch
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: git apply failed unexpectedly after a successful check. Stopping." -ForegroundColor Red; exit 1 }

# 5. Save and publish
Write-Host "Committing and pushing..." -ForegroundColor Cyan
git add -A
git commit -m "Fix journal entry routing: wire New Entry button and /journal/new page correctly"
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: git commit failed. Stopping." -ForegroundColor Red; exit 1 }

git push
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: git push failed. Your commit is saved locally but NOT pushed -- let me know and paste the error." -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "DONE. Pushed successfully." -ForegroundColor Green
Write-Host "Vercel will auto-redeploy the frontend in 1-2 minutes." -ForegroundColor Green
Write-Host "After that, refresh the Journal page in your browser -- you should see a 'New entry' button top-right." -ForegroundColor Green
