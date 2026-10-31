$ErrorActionPreference = 'Stop'

$srcDir     = $PSScriptRoot
$installDir = Join-Path $env:LOCALAPPDATA 'GradeLine'
$desktop    = [Environment]::GetFolderPath('Desktop')
$startMenu  = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'

Write-Host ""
Write-Host "Installing GradeLine for $env:USERNAME ..."
Write-Host ""

$htmlSrc = Join-Path $srcDir 'gradeline.html'
if (-not (Test-Path $htmlSrc)) {
    Write-Host "ERROR: gradeline.html was not found next to this installer." -ForegroundColor Red
    Write-Host "Make sure you extracted the WHOLE zip file first (right-click it,"
    Write-Host "'Extract All'), then run the installer from inside that extracted"
    Write-Host "folder - not from inside the zip preview window."
    exit 1
}

try {
    if (-not (Test-Path $installDir)) {
        New-Item -ItemType Directory -Path $installDir | Out-Null
    }
    Copy-Item -Path $htmlSrc -Destination (Join-Path $installDir 'gradeline.html') -Force

    $icoSrc  = Join-Path $srcDir 'gradeline.ico'
    $icoDest = Join-Path $installDir 'gradeline.ico'
    if (Test-Path $icoSrc) {
        Copy-Item -Path $icoSrc -Destination $icoDest -Force
    }
} catch {
    Write-Host "ERROR: could not copy GradeLine into $installDir" -ForegroundColor Red
    Write-Host $_.Exception.Message
    exit 1
}

$targetHtml = Join-Path $installDir 'gradeline.html'
$shortcutsOk = $true

try {
    $shell = New-Object -ComObject WScript.Shell

    $desktopLnk = $shell.CreateShortcut((Join-Path $desktop 'GradeLine.lnk'))
    $desktopLnk.TargetPath = $targetHtml
    if (Test-Path $icoDest) { $desktopLnk.IconLocation = $icoDest }
    $desktopLnk.Description = 'GradeLine - TIN surface and long section viewer'
    $desktopLnk.Save()

    if (-not (Test-Path $startMenu)) {
        New-Item -ItemType Directory -Path $startMenu -Force | Out-Null
    }
    $startLnk = $shell.CreateShortcut((Join-Path $startMenu 'GradeLine.lnk'))
    $startLnk.TargetPath = $targetHtml
    if (Test-Path $icoDest) { $startLnk.IconLocation = $icoDest }
    $startLnk.Description = 'GradeLine - TIN surface and long section viewer'
    $startLnk.Save()
} catch {
    $shortcutsOk = $false
    Write-Host ""
    Write-Host "Could not create the shortcuts automatically:" -ForegroundColor Yellow
    Write-Host $_.Exception.Message -ForegroundColor Yellow
}

Write-Host ""
if ($shortcutsOk) {
    Write-Host "Done. A GradeLine icon is now on your Desktop and in your Start Menu."
    Write-Host "It opens straight in your default browser - nothing else to install."
} else {
    Write-Host "GradeLine itself installed fine, but the shortcut step above failed"
    Write-Host "(this can happen if your IT policy blocks scripts creating desktop"
    Write-Host "icons). You can still open it any time from:"
    Write-Host "  $targetHtml"
    Write-Host "or make your own shortcut to that file."
}
Write-Host ""
Write-Host "To update GradeLine later, just re-run this installer over the top."
Write-Host ""
