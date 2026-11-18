$ErrorActionPreference = "Stop"
$src = $PSScriptRoot
$extRoot = Join-Path $env:USERPROFILE ".cursor\extensions"
$ver = (& node -p "require(require('path').join(process.argv[1], 'package.json')).version" $src).Trim()
if (-not $ver) { throw "cannot read version from package.json" }
$id = "huaxin.beibagu"
$legacyIds = @("huaxin.shiroha-quiz-cursor", "huaxin.beibagu")
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

cmd /c mklink /J "$dest" "$src"
if (-not (Test-Path $dest)) {
  throw "junction failed: $dest"
}

Write-Host "OK junction: $dest -> $src"
Write-Host "Reload Window ONCE. Later media changes hot-reload; use Refresh UI button if needed."
