# apply_region_singapore.ps1
# Moves both Vercel projects' functions from Washington, D.C. (iad1) to
# Singapore (sin1) -- next to your Supabase database (confirmed
# ap-southeast-1, Singapore) instead of ~15,000km away.
#
# This is a deploy-configuration change, NOT an application code change --
# nothing about what the app does is different, only where it physically
# runs. No SQL, no logic touched.
#
# What this fixes: every database round trip your backend makes currently
# crosses from the US East Coast to Singapore and back -- confirmed via
# your own Network tab tests (4.6+ seconds "waiting for server response",
# identical on repeat requests, ruling out cold start). Moving the
# function next to the database removes that distance entirely.
#
# What this does NOT change: your frontend's static pages (HTML/CSS/JS)
# are already served from Vercel's CDN, from whichever edge location is
# closest to each visitor -- that's unrelated to function region and
# stays exactly as fast as it already was. This change only affects
# server-rendered/dynamic pages and API calls, which is where the
# database-latency cost actually lives.
#
# Since your real users are in Pakistan, Singapore should also make the
# app feel faster in general, not just in this specific test -- Singapore
# is far closer to Lahore than Virginia is.

$ErrorActionPreference = "Stop"

Write-Host "== Move both Vercel projects to Singapore (sin1), next to your database ==" -ForegroundColor Cyan

if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "ERROR: Run this from the folder that contains both 'backend' and 'frontend' subfolders." -ForegroundColor Red
    exit 1
}

$patchFile = "region_singapore.patch"
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
git commit -m "Move Vercel functions (backend + frontend) from Washington D.C. to Singapore, next to the Supabase database"
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Commit failed." -ForegroundColor Red
    exit 1
}

Write-Host "`nPushing..." -ForegroundColor Yellow
git push
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Push failed. Your commit is saved locally -- resolve the push issue, then run 'git push' yourself." -ForegroundColor Red
    exit 1
}

Write-Host "`nDone. Vercel will redeploy both backend and frontend automatically within 1-2 minutes." -ForegroundColor Green
Write-Host "`nIMPORTANT -- how to verify this actually took effect:" -ForegroundColor Yellow
Write-Host "  1. Go to your Vercel dashboard for BOTH projects (backend and frontend)." -ForegroundColor Yellow
Write-Host "  2. Open the latest deployment's build log." -ForegroundColor Yellow
Write-Host "  3. The very first line used to say 'Running build in Washington, D.C., USA (East) - iad1'." -ForegroundColor Yellow
Write-Host "     It should now say Singapore instead." -ForegroundColor Yellow
Write-Host "  4. Then repeat the same Network tab test on an invoice PDF -- 'Waiting for server response' should drop noticeably from the ~4.6s we measured." -ForegroundColor Yellow
