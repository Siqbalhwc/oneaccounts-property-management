# apply_theme_polish_fix.ps1
# Three fixes based on your screenshot feedback:
#  1. Navy theme: page/card backgrounds pulled much closer to the sidebar's
#     tone, so it reads as one cohesive deep navy instead of a dark sidebar
#     next to a noticeably brighter blue content area.
#  2. Native date-picker calendars (the little calendar icon and its popup
#     on every date field) were invisible in Black/Navy -- fixed app-wide
#     via a single CSS property (color-scheme) rather than touching each
#     of the 22 files that have a date field.
#  3. The "Income" bar in the Income vs Expenses chart now uses gold
#     instead of blue, so it's visually distinct from the blue progress
#     bars in "Top performing buildings" (Expenses stays red).
#
# No SQL migration needed -- code only.

$ErrorActionPreference = "Stop"

Write-Host "== Theme polish fix (Navy colors, calendars, chart colors) ==" -ForegroundColor Cyan

if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "ERROR: Run this from the folder that contains both 'backend' and 'frontend' subfolders." -ForegroundColor Red
    exit 1
}

$patchFile = "theme_polish_fix.patch"
if (-not (Test-Path $patchFile)) {
    Write-Host "ERROR: '$patchFile' not found in this folder. Place it here first." -ForegroundColor Red
    exit 1
}

Write-Host "`nPulling latest code..." -ForegroundColor Yellow
git pull
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: git pull failed. Resolve that first, then re-run this script." -ForegroundColor Red
    exit 1
}

Write-Host "`nChecking that the patch applies cleanly (dry run, changes nothing yet)..." -ForegroundColor Yellow
git apply --check $patchFile
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Patch does not apply cleanly against your current code." -ForegroundColor Red
    Write-Host "This usually means the code has moved on since this patch was made. Stop here and ask for a refreshed patch." -ForegroundColor Red
    exit 1
}

Write-Host "`nApplying patch..." -ForegroundColor Yellow
git apply $patchFile
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Patch failed to apply (unexpected, since the dry run just passed). Stop and report this." -ForegroundColor Red
    exit 1
}

Write-Host "`nCommitting..." -ForegroundColor Yellow
git add -A
git commit -m "Polish Navy theme colors, fix invisible date-picker calendars app-wide, and differentiate dashboard chart colors"
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Commit failed." -ForegroundColor Red
    exit 1
}

Write-Host "`nPushing..." -ForegroundColor Yellow
git push
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Push failed. Your commit is saved locally -- ask for help before retrying." -ForegroundColor Red
    exit 1
}

Write-Host "`n== Done =====================================================" -ForegroundColor Green
Write-Host "Pushed successfully. Vercel will redeploy both frontend and backend automatically within 1-2 minutes."
Write-Host "Check: Navy theme dashboard should now look like one cohesive dark blue. Click into any date field in Black/Navy and confirm the calendar icon and popup are visible. Income vs Expenses chart should show gold Income bars against red Expense bars."
