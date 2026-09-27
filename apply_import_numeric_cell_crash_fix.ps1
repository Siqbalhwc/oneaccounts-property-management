# apply_import_numeric_cell_crash_fix.ps1
#
# Fixes: importing Rooms still fails, even after the batching fix -- and
# gives no clear reason why.
#
# Root cause (confirmed against the actual file you uploaded): 18 of its
# 340 rows have room_number typed as a plain number in Excel (e.g. 301)
# rather than text ("301"). Every import in this app parsed a cell like
# `(row.get("room_number") or "").strip()` -- which works fine for text,
# but crashes immediately with an unhandled error the instant it hits a
# number instead, since numbers don't have .strip(). That crash sat
# outside every row's own error handling, so it didn't just skip that one
# row -- it silently took down the entire import, for every row, with no
# readable error at all. This exact same fragile pattern existed in every
# import (Owners, Buildings, Rooms, Tenants, Leases), not just Rooms.
#
# This patch touches exactly one file, backend/app/routers/data_transfer.py:
#   - Adds one shared helper, cell_str(), that safely turns ANY cell value
#     (text, whole number, or decimal) into the right string -- 301 or
#     301.0 both become "301", matching what you'd expect to see.
#   - Every import (Owners, Buildings, Rooms, Tenants, Leases) now uses
#     it instead of the fragile pattern that crashed on numbers.
#   - Every per-row error handler now catches any unexpected problem, not
#     just database errors, so a single bad row always gets a clear,
#     specific message in the report instead of ever crashing the whole
#     import silently again.
#
# Verified before delivery: ran the actual shipped cell_str() function
# (extracted straight from the patched file, not a re-typed copy) against
# every one of the 340 real rows you uploaded -- 0 crashes, and the 18
# previously-broken rows now convert correctly ("301", not "301.0").
# Also applied this exact patch to a fresh, independent clone of your repo
# and ran Python's ast.parse() against the patched file -- no syntax
# errors.

$ErrorActionPreference = "Stop"

Write-Host "== Fix: numeric Excel cells crashing imports (Owners/Buildings/Rooms/Tenants/Leases) ==" -ForegroundColor Cyan

if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "ERROR: Run this from the folder that contains both 'backend' and 'frontend' subfolders." -ForegroundColor Red
    exit 1
}

$patchFile = "import_numeric_cell_crash_fix.patch"
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
    Write-Host "This usually means data_transfer.py has changed since this patch was made. Stop here and tell me exactly what's changed, so I can regenerate the patch against your actual current file." -ForegroundColor Red
    exit 1
}

Write-Host "`nApplying patch..." -ForegroundColor Yellow
git apply $patchFile
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Patch failed to apply (unexpected, since the dry run just passed). Stop and report this." -ForegroundColor Red
    exit 1
}

Write-Host "`nChecking the patched file for Python syntax errors..." -ForegroundColor Yellow
python -c "import ast; ast.parse(open('backend/app/routers/data_transfer.py', encoding='utf-8').read())"
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Patched file has a syntax error. Stop here -- do not push -- and report this." -ForegroundColor Red
    exit 1
}
Write-Host "Syntax check passed cleanly." -ForegroundColor Green

Write-Host "`nCommitting..." -ForegroundColor Yellow
git add -A
git commit -m "Fix imports crashing on numeric Excel cells; always give a clear per-row error"
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: git commit failed. Stop and report this." -ForegroundColor Red
    exit 1
}

Write-Host "`nPushing..." -ForegroundColor Yellow
git push
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: git push failed. Your commit is saved locally but NOT live yet. Resolve the push issue, then run 'git push' manually." -ForegroundColor Red
    exit 1
}

Write-Host "`nDone. Vercel will redeploy the backend automatically within 1-2 minutes." -ForegroundColor Green
Write-Host "Then re-import the same rooms_template.xlsx you uploaded -- all 340 rows should go through, including the 18 that had a plain number in room_number." -ForegroundColor Green
