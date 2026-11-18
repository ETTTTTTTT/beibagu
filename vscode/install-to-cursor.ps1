# Dev install: junction this folder into Cursor and/or VS Code extensions.
# End users should install the packaged .vsix instead.
param(
  [ValidateSet("cursor", "vscode", "all", "auto")]
  [string]$Target = "auto"
)

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

$candidates = @(
  @{ Name = "Cursor";  Key = "cursor"; Root = (Join-Path $env:USERPROFILE ".cursor\extensions") },
  @{ Name = "VS Code"; Key = "vscode"; Root = (Join-Path $env:USERPROFILE ".vscode\extensions") }
)

function Test-EditorPresent([string]$key, [string]$root) {
  if ($key -eq "cursor") {
    return (Test-Path $root) -or
      [bool](Get-Command cursor -ErrorAction SilentlyContinue) -or
      (Test-Path (Join-Path $env:LOCALAPPDATA "Programs\cursor"))
  }
  if ($key -eq "vscode") {
    return (Test-Path $root) -or
      [bool](Get-Command code -ErrorAction SilentlyContinue) -or
      (Test-Path (Join-Path $env:LOCALAPPDATA "Programs\Microsoft VS Code"))
  }
  return $false
}

function Install-Junction([string]$name, [string]$extRoot) {
  $dest = Join-Path $extRoot "$id-$ver"
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
    throw "junction failed ($name): $dest"
  }
  Write-Host "OK [$name] $dest -> $src"
}

$selected = @()
switch ($Target) {
  "cursor" { $selected = @($candidates | Where-Object { $_.Key -eq "cursor" }) }
  "vscode" { $selected = @($candidates | Where-Object { $_.Key -eq "vscode" }) }
  "all"    { $selected = $candidates }
  default {
    $selected = @($candidates | Where-Object { Test-EditorPresent $_.Key $_.Root })
  }
}

if ($selected.Count -eq 0) {
  Write-Host "No Cursor / VS Code detected."
  Write-Host "  .\install-to-cursor.ps1 -Target cursor"
  Write-Host "  .\install-to-cursor.ps1 -Target vscode"
  Write-Host "Or install releases/*.vsix via Install from VSIX."
  throw "no editor target"
}

foreach ($ed in $selected) {
  Install-Junction $ed.Name $ed.Root
}

Write-Host "Reload Window ONCE in the editor you use."
