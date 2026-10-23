$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$nodeVersion = [version]((& node --version).Trim().TrimStart('v'))
if ($LASTEXITCODE -ne 0 -or $nodeVersion.Major -lt 22 -or ($nodeVersion.Major -eq 22 -and $nodeVersion.Minor -lt 13) -or ($nodeVersion.Major -eq 23 -and $nodeVersion.Minor -lt 4)) {
  throw 'SQLite integrado requiere Node 22.13+ (rama 22), 23.4+ o 24+. Se recomienda Node 22.21.1.'
}
if (-not (Test-Path 'node_modules')) { throw 'Ejecuta primero .\Instalar.ps1' }
Write-Host 'Al iniciar se crea/abre SQLite y se importan los JSON de proyectos conservando los originales. Deten primero cualquier servidor anterior.'
Write-Host 'Abre http://127.0.0.1:4310. Ctrl+C para detener.'
. (Join-Path $PSScriptRoot 'Resolver-Codex.ps1')
$env:AIPB_CODEX_BIN = Resolve-AipbCodex
Write-Host "Codex localizado: $env:AIPB_CODEX_BIN"
& node server/index.js
