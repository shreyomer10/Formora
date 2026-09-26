# Build the zip to upload to the Chrome Web Store: manifest, source and icons only.
# Usage (from the repo root):  powershell -ExecutionPolicy Bypass -File pack.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$manifest = Get-Content (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json
$out = Join-Path $root ("dist\formora-" + $manifest.version + ".zip")
New-Item -ItemType Directory -Force (Join-Path $root 'dist') | Out-Null
if (Test-Path $out) { Remove-Item $out -Force }
$items = @('manifest.json', 'src', 'icons', 'privacy.html') | ForEach-Object { Join-Path $root $_ }
Compress-Archive -Path $items -DestinationPath $out -CompressionLevel Optimal
Write-Host ("Wrote " + $out + " (" + [math]::Round((Get-Item $out).Length / 1KB) + " KB). Upload this at https://chrome.google.com/webstore/devconsole")
