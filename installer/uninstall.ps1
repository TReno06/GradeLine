$ErrorActionPreference = 'Stop'

$installDir = Join-Path $env:LOCALAPPDATA 'GradeLine'
$desktop    = [Environment]::GetFolderPath('Desktop')
$startMenu  = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'

Write-Host ""
Write-Host "This will remove GradeLine for $env:USERNAME (shortcuts and the copied"
Write-Host "gradeline.html - any DXF files you loaded were never saved anywhere,"
Write-Host "so there is nothing else to clean up)."
Write-Host ""
$confirm = Read-Host "Continue? (Y/N)"
if ($confirm -notmatch '^[Yy]') {
    Write-Host "Cancelled."
    exit 0
}

$desktopLnk = Join-Path $desktop 'GradeLine.lnk'
$startLnk   = Join-Path $startMenu 'GradeLine.lnk'

if (Test-Path $desktopLnk) { Remove-Item $desktopLnk -Force }
if (Test-Path $startLnk)   { Remove-Item $startLnk -Force }
if (Test-Path $installDir) { Remove-Item $installDir -Recurse -Force }

Write-Host ""
Write-Host "GradeLine has been removed."
Write-Host ""
