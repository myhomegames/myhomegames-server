# Pack and sign the staged MSIX layout. Requires the Windows 10/11 SDK (makeappx, signtool).
# The manifest Publisher is CN=MyHomeGames. A matching code-signing cert is created in
# CurrentUser and trusted for sideload when one is not already present.
param(
  [Parameter(Mandatory = $true)][string]$Layout,
  [Parameter(Mandatory = $true)][string]$OutFile
)

$ErrorActionPreference = "Stop"
$subject = "CN=MyHomeGames"

function Find-SdkTool([string]$name) {
  $kits = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
  if (-not (Test-Path -LiteralPath $kits)) {
    throw "Windows SDK not found at $kits. Install the Windows 10 or 11 SDK."
  }
  $tool = Get-ChildItem -Path $kits -Filter $name -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.DirectoryName -match '\\x64$' } |
    Sort-Object FullName -Descending |
    Select-Object -First 1
  if (-not $tool) {
    throw "$name not found under $kits. Install the Windows SDK (App Packaging tools)."
  }
  return $tool.FullName
}

$makeappx = Find-SdkTool "makeappx.exe"
$signtool = Find-SdkTool "signtool.exe"

& $makeappx pack /d $Layout /p $OutFile /o
if ($LASTEXITCODE -ne 0) {
  throw "makeappx pack failed with exit code $LASTEXITCODE"
}

$cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -eq $subject } | Select-Object -First 1
if (-not $cert) {
  $cert = New-SelfSignedCertificate `
    -Type Custom `
    -Subject $subject `
    -KeyUsage DigitalSignature `
    -FriendlyName "MyHomeGames MSIX" `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3")
  $store = New-Object System.Security.Cryptography.X509Certificates.X509Store("TrustedPeople", "CurrentUser")
  $store.Open("ReadWrite")
  $store.Add($cert)
  $store.Close()
  Write-Host "Trusted self-signed publisher $subject ($($cert.Thumbprint)) for this user."
}

& $signtool sign /fd SHA256 /sha1 $cert.Thumbprint $OutFile
if ($LASTEXITCODE -ne 0) {
  throw "signtool failed with exit code $LASTEXITCODE"
}

Write-Host "Signed $OutFile"
Write-Host "Install: Add-AppxPackage -Path `"$OutFile`""
