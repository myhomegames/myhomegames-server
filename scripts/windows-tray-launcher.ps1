#Requires -Version 5.1
# Encoding: UTF-8 with BOM (required for Windows PowerShell 5.1 string parsing).
# MyHomeGames Server - Windows system tray launcher (no console window).
# Launched by "Start-MyHomeGames-Server.exe" in this folder (double-click the .exe).

$ErrorActionPreference = "Stop"

# Script folder + error log (resolve early so failures can be written to file)
$ScriptDir = $PSScriptRoot
if (-not $ScriptDir) {
  $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}
$TrayErrorLog = if ($ScriptDir) {
  Join-Path $ScriptDir "MyHomeGames-Server-Tray-errors.log"
} else {
  Join-Path $env:TEMP "MyHomeGames-Server-Tray-errors.log"
}

function Write-TrayErrorLog {
  param(
    [Parameter(Mandatory = $true)][string]$Section,
    [Parameter(Mandatory = $true)][string]$Detail
  )
  try {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $nl = [Environment]::NewLine
    $block = "==== $ts ====$nl[$Section]$nl$Detail$nl$nl"
    Add-Content -LiteralPath $TrayErrorLog -Value $block -Encoding utf8 -ErrorAction SilentlyContinue
  } catch {}
}

try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
} catch {
  $full = $_.Exception.ToString()
  if ($_.ScriptStackTrace) { $full = $full + [Environment]::NewLine + $_.ScriptStackTrace }
  Write-TrayErrorLog -Section "WinForms load" -Detail $full
  [Console]::Error.WriteLine("MyHomeGames tray: WinForms load failed: $($_.Exception.Message)")
  exit 1
}

if (-not $ScriptDir) {
  Write-TrayErrorLog -Section "Script directory" -Detail "PSScriptRoot and MyInvocation.MyCommand.Path were empty."
  [Console]::Error.WriteLine("MyHomeGames: could not resolve script directory (PSScriptRoot empty).")
  exit 1
}

function Read-DotEnv([string]$path) {
  $h = @{}
  if (-not (Test-Path $path)) { return $h }
  Get-Content -LiteralPath $path -ErrorAction SilentlyContinue | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq "" -or $line.StartsWith("#")) { return }
    $i = $line.IndexOf("=")
    if ($i -lt 1) { return }
    $k = $line.Substring(0, $i).Trim()
    $v = $line.Substring($i + 1).Trim()
    $h[$k] = $v
  }
  return $h
}

$exeNames = @(
  "myhomegames-server-win-x64.exe",
  "myhomegames-server-node18-win-x64.exe"
)
$serverExe = $null
foreach ($n in $exeNames) {
  $p = Join-Path $ScriptDir $n
  if (Test-Path -LiteralPath $p) {
    $serverExe = $p
    break
  }
}

if (-not $serverExe) {
  $errMsg = "Server executable not found in:`n$ScriptDir`n`nExpected one of:`n" + ($exeNames -join "`n") + "`n`nRe-extract the full MyHomeGames-*-win-x64-tray.zip or copy the server .exe here."
  [Console]::Error.WriteLine("MyHomeGames tray: $errMsg")
  [System.Windows.Forms.MessageBox]::Show(
    $errMsg,
    "MyHomeGames Server",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Error
  ) | Out-Null
  exit 1
}

$envPath = Join-Path $ScriptDir ".env"
$envMap = Read-DotEnv $envPath

$httpsOn = ($envMap["HTTPS_ENABLED"] -eq "true")
$httpsPort = if ($envMap["HTTPS_PORT"]) { $envMap["HTTPS_PORT"] } else { "41440" }
$httpPort = if ($envMap["HTTP_PORT"]) { $envMap["HTTP_PORT"] } else { if ($envMap["PORT"]) { $envMap["PORT"] } else { "4000" } }
$apiBase = $envMap["API_BASE"]
if (-not $apiBase) {
  if ($httpsOn) {
    $apiBase = "https://localhost:$httpsPort"
  } else {
    $apiBase = "http://localhost:$httpPort"
  }
}
$frontendUrl = $envMap["FRONTEND_URL"]
if (-not $frontendUrl) {
  $frontendUrl = $apiBase
}

$infoPath = Join-Path $ScriptDir "server-info.json"
$aboutText = "MyHomeGames Server"
if (Test-Path -LiteralPath $infoPath) {
  try {
    $j = Get-Content -LiteralPath $infoPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $lines = @("MyHomeGames Server")
    if ($j.version) { $lines += "Version: $($j.version)" }
    if ($j.buildDate) { $lines += "Build: $($j.buildDate)" }
    if ($j.creator) { $lines += "Creator: $($j.creator)" }
    if ($j.community) { $lines += "Community: $($j.community)" }
    if ($j.website) { $lines += "Website: $($j.website)" }
    $lines += ""
    $lines += "API: $apiBase"
    $aboutText = $lines -join [Environment]::NewLine
  } catch {
    $aboutText = "MyHomeGames Server`n`nAPI: $apiBase"
  }
} else {
  $aboutText = "MyHomeGames Server`n`nAPI: $apiBase"
}

# Start server process without a console window
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $serverExe
$psi.WorkingDirectory = $ScriptDir
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.RedirectStandardOutput = $false
$psi.RedirectStandardError = $false

try {
  $global:ServerProcess = [System.Diagnostics.Process]::Start($psi)
} catch {
  $full = $_.Exception.ToString()
  if ($_.ScriptStackTrace) { $full = $full + [Environment]::NewLine + $_.ScriptStackTrace }
  Write-TrayErrorLog -Section "Could not start server process" -Detail $full
  $em = "Could not start server: $($_.Exception.Message)"
  [Console]::Error.WriteLine("MyHomeGames tray: $em")
  [System.Windows.Forms.MessageBox]::Show(
    ($em + "`n`nFull details saved to:`n$TrayErrorLog"),
    "MyHomeGames Server",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Error
  ) | Out-Null
  exit 1
}

$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
# Same graphic as macOS AppIcon - MyHomeGames-Tray.png from the release zip (build copies icon_32x32 from iconset)
$global:TrayBitmap = $null
$trayIconPath = Join-Path $ScriptDir "MyHomeGames-Tray.png"
if (Test-Path -LiteralPath $trayIconPath) {
  try {
    $global:TrayBitmap = [System.Drawing.Bitmap]::FromFile((Resolve-Path -LiteralPath $trayIconPath).Path)
    $notifyIcon.Icon = [System.Drawing.Icon]::FromHandle($global:TrayBitmap.GetHicon())
  } catch {
    $notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
  }
} else {
  $notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
}
$notifyIcon.Visible = $true
$notifyIcon.Text = "MyHomeGames Server - running"

$menu = New-Object System.Windows.Forms.ContextMenuStrip

$itemOpenWeb = New-Object System.Windows.Forms.ToolStripMenuItem("Open web app")
$itemOpenWeb.add_Click({
  try { Start-Process $frontendUrl } catch {}
})
[void]$menu.Items.Add($itemOpenWeb)

$itemOpenApi = New-Object System.Windows.Forms.ToolStripMenuItem("Open API (browser)")
$itemOpenApi.add_Click({
  try { Start-Process $apiBase } catch {}
})
[void]$menu.Items.Add($itemOpenApi)

[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

$itemAbout = New-Object System.Windows.Forms.ToolStripMenuItem("About...")
$itemAbout.add_Click({
  [System.Windows.Forms.MessageBox]::Show(
    $aboutText,
    "About MyHomeGames Server",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information
  ) | Out-Null
})
[void]$menu.Items.Add($itemAbout)

$itemExit = New-Object System.Windows.Forms.ToolStripMenuItem("Quit server")
$itemExit.add_Click({
  try {
    if ($global:ServerProcess -and -not $global:ServerProcess.HasExited) {
      Stop-Process -Id $global:ServerProcess.Id -Force -ErrorAction SilentlyContinue
    }
  } catch {}
  $notifyIcon.Visible = $false
  if ($global:TrayBitmap) {
    try { $global:TrayBitmap.Dispose() } catch {}
  }
  $notifyIcon.Dispose()
  [System.Windows.Forms.Application]::Exit()
})
[void]$menu.Items.Add($itemExit)

$notifyIcon.ContextMenuStrip = $menu

$notifyIcon.add_DoubleClick({
  try { Start-Process $frontendUrl } catch {}
})

# Balloon on start
$notifyIcon.ShowBalloonTip(
  4000,
  "MyHomeGames Server",
  "Running. API: $apiBase",
  [System.Windows.Forms.ToolTipIcon]::Info
)

# Exit tray if server process exits on its own
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2000
$timer.add_Tick({
  if ($global:ServerProcess -and $global:ServerProcess.HasExited) {
    $timer.Stop()
    $notifyIcon.ShowBalloonTip(
      5000,
      "MyHomeGames Server",
      "Server process ended.",
      [System.Windows.Forms.ToolTipIcon]::Warning
    )
    $notifyIcon.Text = "MyHomeGames Server - stopped"
  }
})
$timer.Start()

[System.Windows.Forms.Application]::Run()
