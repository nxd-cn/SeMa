$ErrorActionPreference = "Stop"

$launcherDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent (Split-Path -Parent $launcherDir)
$exe = Join-Path $launcherDir "SeMa.exe"
$vbs = Join-Path $launcherDir "SeMa.vbs"
$ico = Join-Path $launcherDir "SeMa.ico"
$electronExe = Join-Path $repoRoot "node_modules\electron\dist\electron.exe"
$helper = Join-Path $launcherDir "write-shortcuts.js"
# Must match main.js WINDOWS_AUMID
$appUserModelId = "com.sema.app"

if (-not (Test-Path $electronExe)) {
  Write-Error "Missing Electron: $electronExe — run npm install at repo root first."
}
if (-not (Test-Path $helper)) {
  Write-Error "Missing helper: $helper"
}
if ((-not (Test-Path $exe)) -and (-not (Test-Path $vbs))) {
  Write-Error "Missing launcher target: $exe or $vbs"
}
if (-not (Test-Path $ico)) {
  Write-Error "Missing icon: $ico — run build-sema-exe.ps1 first (or keep SeMa.ico)."
}

& $electronExe $helper
$exitCode = $LASTEXITCODE

$desktop = Join-Path ([Environment]::GetFolderPath("Desktop")) "SeMa.lnk"
$startMenu = Join-Path ([Environment]::GetFolderPath("StartMenu")) "Programs\SeMa.lnk"

if (($null -ne $exitCode -and $exitCode -ne 0) -or -not (Test-Path $startMenu)) {
  Write-Error "Electron shortcut helper failed (exit $exitCode)"
}

Write-Host "Created:"
Write-Host "  $desktop"
Write-Host "  $startMenu"
Write-Host "AppUserModelID: $appUserModelId"
Write-Host "Pin from Start Menu or Desktop to the taskbar if desired."
Write-Host "If an old Electron pin remains, unpin it and pin SeMa again."
