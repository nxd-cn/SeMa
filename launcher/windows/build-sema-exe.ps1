$ErrorActionPreference = "Stop"

$launcherDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent (Split-Path -Parent $launcherDir)
$src = Join-Path $launcherDir "SeMaLauncher.cs"
$png = Join-Path $repoRoot "assets\icon.png"
$png1024 = Join-Path $repoRoot "assets\icon1024.png"
# Prefer higher-res master when present (sharper 128/256 ICO frames).
if (Test-Path $png1024) { $png = $png1024 }
$ico = Join-Path $launcherDir "SeMa.ico"
$outExe = Join-Path $launcherDir "SeMa.exe"

if (-not (Test-Path $src)) { throw "Missing source: $src" }
if (-not (Test-Path $png)) { throw "Missing icon png: $png" }

function Resolve-FrameworkCsc {
  $candidates = @(
    "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { return $c }
  }
  return $null
}

# Build a Vista+ PNG-in-ICO with multiple sizes (taskbar needs 16/32/48, not only 256).
function Convert-PngToIco([string]$pngPath, [string]$icoPath) {
  Add-Type -AssemblyName System.Drawing
  $sizes = @(16, 32, 48, 64, 128, 256)
  $src = [System.Drawing.Bitmap]::FromFile($pngPath)
  $images = New-Object System.Collections.Generic.List[byte[]]
  try {
    foreach ($size in $sizes) {
      $bmp = New-Object System.Drawing.Bitmap $size, $size
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      try {
        $g.Clear([System.Drawing.Color]::Transparent)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $g.DrawImage($src, 0, 0, $size, $size)
      } finally {
        $g.Dispose()
      }
      $ms = New-Object System.IO.MemoryStream
      try {
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $images.Add($ms.ToArray()) | Out-Null
      } finally {
        $ms.Dispose()
        $bmp.Dispose()
      }
    }
  } finally {
    $src.Dispose()
  }

  $count = $images.Count
  $headerSize = 6
  $entrySize = 16
  $dataOffset = $headerSize + ($entrySize * $count)
  $fs = [System.IO.File]::Open($icoPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
  try {
    $bw = New-Object System.IO.BinaryWriter $fs
    $bw.Write([uint16]0)       # reserved
    $bw.Write([uint16]1)       # type = icon
    $bw.Write([uint16]$count)  # count
    $offset = $dataOffset
    for ($i = 0; $i -lt $count; $i++) {
      $size = $sizes[$i]
      $bytes = $images[$i]
      $bw.Write([byte]$(if ($size -ge 256) { 0 } else { $size })) # width
      $bw.Write([byte]$(if ($size -ge 256) { 0 } else { $size })) # height
      $bw.Write([byte]0)       # color palette
      $bw.Write([byte]0)       # reserved
      $bw.Write([uint16]1)     # planes
      $bw.Write([uint16]32)    # bit count
      $bw.Write([uint32]$bytes.Length)
      $bw.Write([uint32]$offset)
      $offset += $bytes.Length
    }
    foreach ($bytes in $images) {
      $bw.Write($bytes)
    }
    $bw.Flush()
  } finally {
    $fs.Dispose()
  }
}

$csc = Resolve-FrameworkCsc
if (-not $csc) {
  throw "Cannot find .NET Framework csc.exe. Keep using SeMa.vbs on this machine."
}

# Always rebuild ICO (prefer assets/icon1024.png) so taskbar gets fresh multi-size frames.
Convert-PngToIco -pngPath $png -icoPath $ico
Write-Host "Regenerated multi-size icon: $ico (from $png)"

& $csc /nologo /target:winexe /optimize+ /out:$outExe /win32icon:$ico /reference:System.Windows.Forms.dll $src
if ($LASTEXITCODE -ne 0) {
  throw "csc build failed (exit code $LASTEXITCODE)"
}
if (-not (Test-Path $outExe)) {
  throw "Build failed: $outExe not created"
}

Write-Host "Built: $outExe"
Write-Host "Icon:  $ico"
