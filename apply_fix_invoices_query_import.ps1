Write-Host "=== Fix: missing 'Query' import in invoices.py (dashboard Failed to fetch) ===" -ForegroundColor Cyan

# 1. Confirm you're in the right folder (must contain backend/ and frontend/)
if (-not (Test-Path ".\backend") -or -not (Test-Path ".\frontend")) {
    Write-Host "ERROR: Run this from your project folder (the one with backend/ and frontend/ inside it)." -ForegroundColor Red
    exit 1
}

# 2. Make sure the patch file is present next to this script
if (-not (Test-Path ".\fix_invoices_query_import.patch")) {
    Write-Host "ERROR: fix_invoices_query_import.patch not found. Put it in the same folder as this script." -ForegroundColor Red
    exit 1
}

# 3. Get the latest code first
Write-Host "Pulling latest code..." -ForegroundColor Yellow
git pull
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: git pull failed. Stopping." -ForegroundColor Red
    exit 1
}

# 4. Dry run - verify the patch will apply cleanly, changes nothing yet
Write-Host "Checking patch..." -ForegroundColor Yellow
git apply --check fix_invoices_query_import.patch
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Patch does not apply cleanly. Stopping - nothing changed." -ForegroundColor Red
    exit 1
}

# 5. Actually apply the patch
Write-Host "Applying patch..." -ForegroundColor Yellow
git apply fix_invoices_query_import.patch
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Patch failed to apply. Stopping." -ForegroundColor Red
    exit 1
}

# 6. Save and publish the change
Write-Host "Committing and pushing..." -ForegroundColor Yellow
git add -A
git commit -m "Fix: add missing Query import in invoices.py (was crashing the whole backend)"
git push
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: git push failed. Your local commit is saved, but not yet on GitHub. Let me know and we'll sort it out." -ForegroundColor Red
    exit 1
}

Write-Host "" 
Write-Host "DONE. Pushed successfully." -ForegroundColor Green
Write-Host "Vercel will auto-redeploy the backend within 1-2 minutes. Wait 2 minutes, then reload your dashboard." -ForegroundColor Green
