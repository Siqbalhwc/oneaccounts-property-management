<#
  apply-layout-sidebar-fixes.ps1

  Applies two fixes to your local oneaccounts-property-management clone:

  1. Dashboard layout.tsx - removes the max-w-[1440px] cap on <main> so the
     dashboard content uses the same full width as the header, instead of
     shrinking with side gaps on wide screens.

  2. Sidebar.tsx - lets the nav list shrink and scroll internally
     (flex-1 min-h-0) instead of refusing to shrink (shrink-0), so the
     theme switcher and footer at the bottom of the sidebar are never
     pushed off-screen and unreachable on short viewports.

  3. Sidebar.tsx - stops the decorative watermark icon block (the div
     right after the nav list) from also claiming flex-1. It was already
     flex-1, competing with the nav list for the same leftover space; left
     alone, that would make fix #2 split space ~50/50 between the nav and
     the watermark instead of giving the nav list the room it needs. This
     changes it to shrink-0 so the nav list is the only element that grows.

  USAGE:
    1. Open PowerShell.
    2. cd into the ROOT of your local repo clone (the folder that
       contains "frontend" and "backend").
    3. Run:  .\apply-layout-sidebar-fixes.ps1
    4. Each modified file gets a ".bak" backup alongside it before editing,
       so you can revert manually if needed.
    5. Review the diff, then commit/push as usual.
#>

$ErrorActionPreference = "Stop"

$layoutPath  = Join-Path (Get-Location) "frontend\app\(dashboard)\layout.tsx"
$sidebarPath = Join-Path (Get-Location) "frontend\components\ui\Sidebar.tsx"

function Apply-Fix {
    param(
        [string]$Path,
        [string]$OldString,
        [string]$NewString,
        [string]$Description
    )

    if (-not (Test-Path $Path)) {
        Write-Host "SKIPPED (file not found): $Path" -ForegroundColor Yellow
        Write-Host "  -> Make sure you're running this from the repo root (the folder containing 'frontend')." -ForegroundColor Yellow
        return
    }

    $content = Get-Content -Path $Path -Raw

    if ($content -notmatch [regex]::Escape($OldString)) {
        if ($content -match [regex]::Escape($NewString)) {
            Write-Host "ALREADY APPLIED: $Description" -ForegroundColor Cyan
            Write-Host "  -> $Path already contains the new version. No change made." -ForegroundColor Cyan
        } else {
            Write-Host "NOT APPLIED (line not found as expected): $Description" -ForegroundColor Red
            Write-Host "  -> $Path may have changed since this script was written." -ForegroundColor Red
            Write-Host "  -> Expected to find: $OldString" -ForegroundColor Red
            Write-Host "  -> Please apply this fix by hand, or send the current file for a fresh patch." -ForegroundColor Red
        }
        return
    }

    # Backup once, before the first edit ever made to this file by this script.
    $backupPath = "$Path.bak"
    if (-not (Test-Path $backupPath)) {
        Copy-Item -Path $Path -Destination $backupPath
        Write-Host "  Backup created: $backupPath" -ForegroundColor DarkGray
    }

    $updated = $content.Replace($OldString, $NewString)
    Set-Content -Path $Path -Value $updated -NoNewline

    Write-Host "APPLIED: $Description" -ForegroundColor Green
    Write-Host "  -> $Path" -ForegroundColor Green
}

Write-Host "=== Fix 1: Dashboard layout - remove 1440px width cap on <main> ===" -ForegroundColor White
Apply-Fix -Path $layoutPath `
    -OldString '<main className="content flex-1 max-w-[1440px] w-full mx-auto">' `
    -NewString '<main className="content flex-1 w-full">' `
    -Description "Dashboard <main> now spans full width like the header, no more side gaps on wide screens"

Write-Host ""
Write-Host "=== Fix 2: Sidebar nav - let it shrink and scroll instead of pushing footer off-screen ===" -ForegroundColor White
Apply-Fix -Path $sidebarPath `
    -OldString '<nav className="px-3 py-4 overflow-y-auto scrollbar-thin shrink-0">' `
    -NewString '<nav className="px-3 py-4 overflow-y-auto scrollbar-thin flex-1 min-h-0">' `
    -Description "Sidebar nav now scrolls internally; theme switcher and footer stay visible on short screens"

Write-Host ""
Write-Host "=== Fix 3: Sidebar watermark block - stop it competing with nav for leftover space ===" -ForegroundColor White
Apply-Fix -Path $sidebarPath `
    -OldString '<div className="flex-1 flex items-center justify-center opacity-[0.05] pointer-events-none min-h-10">' `
    -NewString '<div className="shrink-0 flex items-center justify-center opacity-[0.05] pointer-events-none min-h-10">' `
    -Description "Watermark block no longer claims flex-1, so the nav list (fix 2) gets all the leftover space instead of splitting it"

Write-Host ""
Write-Host "Done. Review the changes (git diff), then commit and push as usual." -ForegroundColor White
