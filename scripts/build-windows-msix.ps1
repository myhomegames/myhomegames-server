#Requires -Version 5.1
<#
.SYNOPSIS
  Pack MyHomeGames unified .exe into an MSIX for Microsoft Store submission.

  Requires Windows SDK MakeAppx.exe (Windows 10 SDK or later).

  Env (optional overrides):
    MSSTORE_IDENTITY_NAME          default: MyHomeGames.Server
    MSSTORE_IDENTITY_PUBLISHER     required for Store (CN=... from Partner Center)
    MSSTORE_PUBLISHER_DISPLAY_NAME default: Luca Stancapiano
#>
param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"

function Find-MakeAppx {
  $kitsRoot = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
  if (-not (Test-Path $kitsRoot)) {
    throw "Windows 10 SDK not found. Install 'MSIX Packaging Tools' / Windows SDK (MakeAppx.exe)."
  }
  $candidate = Get-ChildItem -Path $kitsRoot -Recurse -Filter "makeappx.exe" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match "\\x64\\makeappx\.exe$" } |
    Sort-Object { [version]($_.Directory.Parent.Name) } -Descending |
    Select-Object -First 1
  if (-not $candidate) {
    throw "makeappx.exe not found under $kitsRoot"
  }
  return $candidate.FullName
}

function ConvertTo-VersionQuad([string]$Version) {
  $parts = $Version.Split(".")
  while ($parts.Count -lt 4) { $parts += "0" }
  return ($parts[0..3] -join ".")
}

function Prepare-Assets([string]$AssetsDir, [string]$BuildDir) {
  New-Item -ItemType Directory -Path $AssetsDir -Force | Out-Null
  Add-Type -AssemblyName System.Drawing

  $source = Join-Path $BuildDir "MyHomeGames-Tray.png"
  $img = $null
  $disposeImg = $true
  if (Test-Path $source) {
    $img = [System.Drawing.Image]::FromFile($source)
  } else {
    Write-Host "[msix] MyHomeGames-Tray.png not found — using default Store assets"
    $bmp = New-Object System.Drawing.Bitmap 256, 256
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear([System.Drawing.Color]::FromArgb(255, 255, 215, 0))
    $font = New-Object System.Drawing.Font("Arial", 72, [System.Drawing.FontStyle]::Bold)
    $brush = [System.Drawing.Brushes]::Black
    $g.DrawString("MY", $font, $brush, 40, 80)
    $g.Dispose()
    $font.Dispose()
    $img = $bmp
  }

  try {
    $targets = @{
      "StoreLogo.png" = 50
      "Square44x44Logo.png" = 44
      "Square150x150Logo.png" = 150
      "Wide310x150Logo.png" = 310
    }
    foreach ($entry in $targets.GetEnumerator()) {
      $name = $entry.Key
      $size = [int]$entry.Value
      if ($name -eq "Wide310x150Logo.png") {
        $bmp = New-Object System.Drawing.Bitmap 310, 150
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.Clear([System.Drawing.Color]::FromArgb(255, 255, 215, 0))
        $scale = [Math]::Min(310 / $img.Width, 150 / $img.Height)
        $w = [int]($img.Width * $scale)
        $h = [int]($img.Height * $scale)
        $x = [int]((310 - $w) / 2)
        $y = [int]((150 - $h) / 2)
        $g.DrawImage($img, $x, $y, $w, $h)
        $g.Dispose()
        $bmp.Save((Join-Path $AssetsDir $name), [System.Drawing.Imaging.ImageFormat]::Png)
        $bmp.Dispose()
      } else {
        $bmp = New-Object System.Drawing.Bitmap $size, $size
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.DrawImage($img, 0, 0, $size, $size)
        $g.Dispose()
        $bmp.Save((Join-Path $AssetsDir $name), [System.Drawing.Imaging.ImageFormat]::Png)
        $bmp.Dispose()
      }
    }
  } finally {
    if ($disposeImg -and $null -ne $img) { $img.Dispose() }
  }
}

$packageJson = Get-Content (Join-Path $RepoRoot "package.json") -Raw | ConvertFrom-Json
$version = $packageJson.version
$buildDir = Join-Path $RepoRoot "build"
$exe = Join-Path $buildDir "MyHomeGames-$version-win-x64.exe"
if (-not (Test-Path $exe)) {
  throw "Unified Windows exe not found: $exe. Run npm run build or npm run build:win-unified first."
}

$publisher = $env:MSSTORE_IDENTITY_PUBLISHER
if ([string]::IsNullOrWhiteSpace($publisher)) {
  throw "MSSTORE_IDENTITY_PUBLISHER is required (CN=... from Partner Center → App identity)."
}

$identityName = if ($env:MSSTORE_IDENTITY_NAME) { $env:MSSTORE_IDENTITY_NAME } else { "MyHomeGames.Server" }
$publisherDisplay = if ($env:MSSTORE_PUBLISHER_DISPLAY_NAME) { $env:MSSTORE_PUBLISHER_DISPLAY_NAME } else { "Luca Stancapiano" }
$versionQuad = ConvertTo-VersionQuad $version

$staging = Join-Path $buildDir "msix-staging"
if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
New-Item -ItemType Directory -Path $staging | Out-Null
New-Item -ItemType Directory -Path (Join-Path $staging "Assets") | Out-Null

Copy-Item $exe (Join-Path $staging "MyHomeGames.exe")
Prepare-Assets (Join-Path $staging "Assets") $buildDir

$manifestTemplate = Get-Content (Join-Path $PSScriptRoot "windows-msix\AppxManifest.xml.tpl") -Raw
$manifest = $manifestTemplate `
  -replace "__IDENTITY_NAME__", $identityName `
  -replace "__IDENTITY_PUBLISHER__", $publisher `
  -replace "__VERSION_QUAD__", $versionQuad `
  -replace "__PUBLISHER_DISPLAY_NAME__", $publisherDisplay
Set-Content -Path (Join-Path $staging "AppxManifest.xml") -Value $manifest -Encoding UTF8

$msixOut = Join-Path $buildDir "MyHomeGames-$version-win-x64.msix"
if (Test-Path $msixOut) { Remove-Item -Force $msixOut }

$makeAppx = Find-MakeAppx
Write-Host "[msix] Packing with $makeAppx"
& $makeAppx pack /d $staging /p $msixOut /o | Write-Host
if ($LASTEXITCODE -ne 0) { throw "MakeAppx pack failed (exit $LASTEXITCODE)" }

Remove-Item -Recurse -Force $staging
Write-Host "[msix] Created $msixOut"
