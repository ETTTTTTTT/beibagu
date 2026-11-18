# Dev install: junction this folder into VS Code extensions.
# End users should install the packaged .vsix instead.
$ErrorActionPreference = "Stop"
$src = $PSScriptRoot

$pkgPath = Join-Path $src "package.json"
if (-not (Test-Path $pkgPath)) {
  throw "package.json not found: $pkgPath"
}
$ver = (Get-Content $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json).version
if (-not $ver) { throw "cannot read version from package.json" }

$id = "huaxin.beibagu"
$legacyIds = @("huaxin.shiroha-quiz-cursor", "huaxin.beibagu")
$extRoot = Join-Path $env:USERPROFILE ".vscode\extensions"
$dest = Join-Path $extRoot "$id-$ver"

$vscodePresent =
  (Test-Path $extRoot) -or
  [bool](Get-Command code -ErrorAction SilentlyContinue) -or
  (Test-Path (Join-Path $env:LOCALAPPDATA "Programs\Microsoft VS Code"))

if (-not $vscodePresent) {
  Write-Host "VS Code not detected."
  Write-Host "Install VS Code, or use releases/*.vsix via Install from VSIX."
  throw "VS Code not found"
}

New-Item -ItemType Directory -Force -Path $extRoot | Out-Null

Get-ChildItem $extRoot -Directory -ErrorAction SilentlyContinue |
  Where-Object {
    $n = $_.Name
    $legacyIds | Where-Object { $n -like "$_-*" }
  } |
  ForEach-Object {
    $p = $_.FullName
    cmd /c "rmdir `"$p`"" | Out-Null
    if (Test-Path $p) {
      Remove-Item $p -Recurse -Force -ErrorAction SilentlyContinue
    }
  }

if (Test-Path $dest) {
  cmd /c "rmdir `"$dest`"" | Out-Null
  if (Test-Path $dest) {
    Remove-Item $dest -Recurse -Force -ErrorAction SilentlyContinue
  }
}

cmd /c mklink /J "$dest" "$src" | Out-Null
if (-not (Test-Path $dest)) {
  throw "junction failed: $dest"
}

Write-Host "OK [VS Code] $dest -> $src"
Write-Host "Reload Window ONCE in VS Code."
