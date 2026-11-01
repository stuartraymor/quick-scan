<#
Builds the Quick Scan setup executable from a packaged app folder.

  .\build-installer.ps1 -AppDir "..\desktop-build\Quick Scan-win32-x64" -OutDir C:\out

Version comes from ..\package.json. The packaged folder is only read, never
changed. Prints the output path and SHA-256.

Code signing (optional). Set these in the environment, never on the command line
or in a file in the repo:
  QS_SIGN_PFX       path to a .pfx code-signing certificate
  QS_SIGN_PFX_PASS  its password
  QS_SIGN_TIMESTAMP timestamp server (default http://timestamp.digicert.com)
  QS_SIGNTOOL       path to signtool.exe (found in the Windows SDK if unset)
Without QS_SIGN_PFX the installer is built unsigned.
#>
param(
  [Parameter(Mandatory)] [string] $AppDir,
  [string] $OutDir = (Join-Path $PSScriptRoot 'out'),
  [string] $RepoUrl = 'https://github.com/stuartraymor/quick-scan',
  [string] $Iscc
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$AppDir = (Resolve-Path -LiteralPath $AppDir).Path
if (-not (Test-Path (Join-Path $AppDir 'Quick Scan.exe'))) { throw "No Quick Scan.exe in $AppDir" }
$version = (Get-Content (Join-Path $here '..\package.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw "Unexpected version '$version'" }
if (-not $Iscc) {
  $Iscc = @("$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe", "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $Iscc) { throw 'Inno Setup 6 not found. Install it (winget install JRSoftware.InnoSetup) or pass -Iscc.' }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir = (Resolve-Path -LiteralPath $OutDir).Path
$target = Join-Path $OutDir "Quick-Scan-Setup-$version.exe"
if (Test-Path $target) { throw "$target already exists; installers are immutable. Bump the version or choose another -OutDir." }

$isccArgs = @("/DAppVersion=$version", "/DSourceDir=$AppDir", "/DOutputDirectory=$OutDir", "/DRepoUrl=$RepoUrl", '/Qp')
if ($env:QS_SIGN_PFX) {
  $signtool = $env:QS_SIGNTOOL
  if (-not $signtool) {
    $signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match '\\x64\\' } | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
  }
  if (-not $signtool) { throw 'QS_SIGN_PFX is set but signtool.exe was not found. Set QS_SIGNTOOL.' }
  $ts = if ($env:QS_SIGN_TIMESTAMP) { $env:QS_SIGN_TIMESTAMP } else { 'http://timestamp.digicert.com' }
  # Inno substitutes $f with the file being signed.
  $isccArgs += '/DSign=1'
  $isccArgs += "/Sqs=`"$signtool`" sign /fd sha256 /td sha256 /tr $ts /f `"$($env:QS_SIGN_PFX)`" /p `"$($env:QS_SIGN_PFX_PASS)`" `$f"
  Write-Host 'Signing enabled.'
} else {
  Write-Host 'No QS_SIGN_PFX set: building an UNSIGNED installer.'
}
& $Iscc @isccArgs (Join-Path $here 'quick-scan.iss')
if ($LASTEXITCODE -ne 0) { throw "ISCC failed ($LASTEXITCODE)" }
$hash = (Get-FileHash $target -Algorithm SHA256).Hash.ToLower()
"$hash  $(Split-Path $target -Leaf)" | Set-Content -Encoding ascii "$target.sha256"
Write-Host "Installer: $target"
Write-Host "SHA-256:   $hash"
