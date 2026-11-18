# Dev install: junction this folder into Cursor and/or VS Code extensions.
# End users: install the packaged .vsix (no clone / no Node required).
param(
  # cursor | vscode | all | auto(default: whatever is installed)
  [ValidateSet("cursor", "vscode", "all", "auto")]
  [string]$Target = "auto"
)

$ErrorActionPreference = "Stop"
$src = $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "需要 Node.js 在 PATH 中（仅开发联接安装需要；普通用户请改用 .vsix）"
}

$ver = (& node -p "require(require('path').join(process.argv[1], 'package.json')).version" $src).Trim()
if (-not $ver) { throw "cannot read version from package.json" }

$id = "huaxin.beibagu"
$legacyIds = @("huaxin.shiroha-quiz-cursor", "huaxin.beibagu")

$candidates = @(
  @{ Name = "Cursor";  Key = "cursor"; Root = (Join-Path $env:USERPROFILE ".cursor\extensions") },
  @{ Name = "VS Code"; Key = "vscode"; Root = (Join-Path $env:USERPROFILE ".vscode\extensions") }
)

function Test-EditorPresent([string]$key, [string]$root) {
  if ($key -eq "cursor") {
    return (Test-Path $root) -or (Get-Command cursor -ErrorAction SilentlyContinue) -or (Test-Path (Join-Path $env:LOCALAPPDATA "Programs\cursor"))
  }
  if ($key -eq "vscode") {
    return (Test-Path $root) -or (Get-Command code -ErrorAction SilentlyContinue) -or (Test-Path (Join-Path $env:LOCALAPPDATA "Programs\Microsoft VS Code"))
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
  throw @"
未检测到 Cursor 或 VS Code。
- 已安装请指定: .\install-to-cursor.ps1 -Target cursor
                 .\install-to-cursor.ps1 -Target vscode
- 普通用户请用 releases 里的 .vsix：扩展面板 → Install from VSIX…
"@
}

foreach ($ed in $selected) {
  Install-Junction $ed.Name $ed.Root
}

Write-Host "Reload Window ONCE in the editor you use. Later media changes hot-reload; use Refresh UI if needed."
