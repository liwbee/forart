param(
  [string]$Version = (Get-Content -Path (Join-Path $PSScriptRoot "..\VERSION") -Raw).Trim(),
  [string]$Image = "liwbee/forart-server"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $Version) {
  throw "Version is required."
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$serverDir = Join-Path $repoRoot "server"

docker build `
  -t "${Image}:${Version}" `
  -t "${Image}:latest" `
  $serverDir

docker push "${Image}:${Version}"
docker push "${Image}:latest"
