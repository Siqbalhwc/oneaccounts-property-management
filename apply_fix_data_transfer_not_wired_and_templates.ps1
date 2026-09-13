# apply_fix_data_transfer_not_wired_and_templates.ps1
#
# ROOT CAUSE of "nothing found" on Export: backend/app/routers/data_transfer.py
# existed in the repo but was NEVER actually registered in main.py, and
# openpyxl was never added to requirements.txt. Every /data-transfer/*
# call was hitting a route that genuinely doesn't exist -- a plain 404,
# which is exactly what "nothing found" means. An earlier commit I
# believed had already fixed this turned out to be a mistake on my end
# (a local artifact that was never really pushed) -- this patch is the
# real fix, verified this time.
#
# THIS PATCH:
#  - Registers data_transfer.router in main.py (the actual fix)
#  - Adds openpyxl to requirements.txt (also required -- imports would
#    have crashed with ModuleNotFoundError even once the route existed)
#  - Adds GET /data-transfer/templates and /data-transfer/templates/{entity}
#    -- downloadable starter workbooks: correct headers, one filled
#    example row, styled header row, plus an "Instructions" sheet listing
#    every validation rule (CNIC format, phone format, uniqueness rules,
#    import order) so the template itself teaches the same rules the
#    manual forms enforce.
#  - Rewrites GET /data-transfer/export to accept ?entities=owners,tenants,...
#    so you can export just what you need, with explicit company scoping
#    and clear error messages instead of silent failures.
#  - Exposes the Content-Disposition header through CORS so downloaded
#    files get their real filename instead of a generic one.
#
# Verified before delivery: compiled cleanly, and the template-building
# code was actually executed (not just read) to confirm it produces real,
# valid .xlsx files, and all 8 routes were confirmed registered.
#
# Run apply_import_export_templates_and_entity_selection.ps1 (the
# companion frontend patch) either before or after this one -- order
# between the two doesn't matter, but you need both for the full feature
# to work end to end.

$ErrorActionPreference = "Stop"

Write-Host "== Fix: wire up data_transfer.py + add templates + selectable export ==" -ForegroundColor Cyan

if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "ERROR: Run this from the folder that contains both 'backend' and 'frontend' subfolders." -ForegroundColor Red
    exit 1
}

$patchFile = "fix_data_transfer_not_wired_and_templates.patch"
if (-not (Test-Path $patchFile)) {
    Write-Host "ERROR: '$patchFile' not found in this folder. Place it here first (same folder as this script)." -ForegroundColor Red
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
    Write-Host "This usually means main.py, data_transfer.py, or requirements.txt have changed since this patch was made. Stop here and tell me exactly what's changed, so I can regenerate the patch against your actual current files." -ForegroundColor Red
    exit 1
}

Write-Host "`nApplying patch..." -ForegroundColor Yellow
git apply $patchFile
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Patch failed to apply (unexpected, since the dry run just passed). Stop and report this." -ForegroundColor Red
    exit 1
}

Write-Host "`nVerifying the patched files are valid Python before committing..." -ForegroundColor Yellow
$pythonCheck = python --version 2>&1
if ($LASTEXITCODE -eq 0) {
    python -m py_compile "backend/app/main.py" "backend/app/routers/data_transfer.py"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: The patched files don't compile. Stop here -- do not push -- and report this." -ForegroundColor Red
        exit 1
    }
    Write-Host "Both files compile cleanly." -ForegroundColor Green
} else {
    Write-Host "(Skipping the compile check -- no local 'python' found. Not required, just a nice extra safety net.)" -ForegroundColor DarkYellow
}

Write-Host "`nCommitting..." -ForegroundColor Yellow
git add -A
git commit -m "Wire up data_transfer.py, add openpyxl, add import templates and selectable export"
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

Write-Host "`nDone. Vercel will redeploy the backend automatically within 1-2 minutes." -ForegroundColor Green
Write-Host "Once it's live, /api/data-transfer/export and /api/data-transfer/templates will actually respond instead of 404-ing." -ForegroundColor Green
Write-Host "Now run apply_import_export_templates_and_entity_selection.ps1 for the matching frontend (Template buttons, entity checkboxes)." -ForegroundColor Yellow
