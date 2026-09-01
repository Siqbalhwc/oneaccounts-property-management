# ============================================================================
# apply_implementation_portal.ps1 — places the Client Implementation Portal
# feature into your repo: backend router, 2 frontend pages, a Gantt chart
# component, and a sidebar link.
#
# IMPORTANT — RUN THE SQL STEP FIRST:
#   Before running this script, open Supabase -> SQL Editor, paste the
#   ENTIRE contents of "009_schema_patch_024_implementation_portal.sql",
#   and click Run. Check the two confirmation queries at the bottom -- the
#   first should list 6 new tables (implementation_projects,
#   implementation_stages, implementation_assignments,
#   implementation_requirements, implementation_attachments,
#   implementation_stage_approvals), the second should show the new
#   is_implementation_consultant column on profiles. If you see a red
#   error, STOP and come back to Claude with it. Do not run this script
#   until that SQL step has succeeded.
#
# ALSO NEEDED — ONE MANUAL STEP IN SUPABASE (not SQL):
#   Storage -> New bucket -> name it "implementation-attachments" -> make
#   it PUBLIC. Same exact way "company-logos" was set up. Requirement/stage
#   file uploads go through this bucket.
#
# WHAT I CHECKED AND FIXED BEFORE SHIPPING THIS (worth knowing):
#   1. The backend router referenced a `profiles.is_implementation_consultant`
#      column that the original SQL never created -- would have 500'd the
#      moment anyone touched the queue. Added it to the migration.
#   2. The SQL called itself "PATCH 022" but your repo already used that
#      label for a different migration. Renumbered to the correct next
#      slot: file 009, "PATCH 024".
#   3. A REAL LIMITATION I'm flagging rather than silently patching: the
#      narrower "is_implementation_consultant" permission tier (someone who
#      can work the queue without being a full platform admin) is NOT fully
#      wired up yet -- the underlying database permissions only grant
#      visibility to full platform admins. If you flag someone as a
#      consultant without ALSO making them a platform admin, they'll hit
#      empty/broken results. For now, anyone who needs real queue access
#      needs is_platform_admin = true, which fully works. Let me know if
#      you want the properly-scoped narrower tier -- it's a real but
#      non-trivial database permissions change I'd rather build and test
#      properly than rush in blind.
#
# WHAT'S IN THIS PATCH:
#   - backend/app/routers/implementation.py -- the full API (projects,
#     stages, the accept/decline queue, requirements, file attachments,
#     stakeholder invites, go-live approval)
#   - backend/app/main.py -- registers the new router
#   - frontend implementation pages: the engagement list (for platform
#     admins) and the single-engagement detail page (Gantt chart, stages,
#     requirements, team, approvals) -- for a client login, this page
#     auto-redirects straight to their own engagement
#   - frontend/components/ui/GanttChart.tsx -- the planned-vs-actual
#     timeline component
#   - Sidebar: platform admins see "Implementation Portal" next to Tower;
#     client_requester / client_senior_approver logins see "My
#     Implementation" instead
#   - StampBadge: added proper labels for every new status this feature
#     uses (in progress, blocked, invited, approved, etc.) instead of
#     falling back to raw snake_case text
#
# HOW TO USE (after both steps above are done):
#   1. Put this file AND "implementation_portal_code.patch" into the main
#      folder of your project (the one with "backend" and "frontend"
#      inside it).
#   2. Open PowerShell in that folder.
#   3. Run:
#      powershell -ExecutionPolicy Bypass -File apply_implementation_portal.ps1
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
if (-not (Test-Path "implementation_portal_code.patch")) {
    Fail "Can't find 'implementation_portal_code.patch' in this folder. Make sure you saved it here, next to this script."
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
git apply --check implementation_portal_code.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch doesn't match your current code, so nothing was applied. Come back to Claude and say 'the patch failed to apply' and paste the message above."
}
Write-Host "OK, the patch is safe to apply." -ForegroundColor Green

Write-Host ""
Write-Host "Step 4: Applying the patch (files are changing now)..." -ForegroundColor Cyan
git apply implementation_portal_code.patch
if ($LASTEXITCODE -ne 0) {
    Fail "The patch failed to apply on the real attempt (even though the check passed). Come back to Claude with this message."
}
Write-Host "OK, files updated." -ForegroundColor Green

Write-Host ""
Write-Host "Step 5: Committing and pushing to GitHub..." -ForegroundColor Cyan
git add -A
git commit -m "Add Client Implementation Portal: engagement tracking, Gantt chart, accept/decline queue, requirements, approvals"
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
Write-Host "Reminder: this only works correctly if you already ran the SQL migration AND created the storage bucket." -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Green
