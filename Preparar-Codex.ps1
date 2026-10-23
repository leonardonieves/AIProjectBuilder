$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
. (Join-Path $PSScriptRoot 'Resolver-Codex.ps1')
$codex = Resolve-AipbCodex
Write-Host "Codex localizado: $codex"
$previousHome = $env:CODEX_HOME
$env:CODEX_HOME = Join-Path $PSScriptRoot 'data\codex-home'
try {
  New-Item -ItemType Directory -Path $env:CODEX_HOME -Force | Out-Null
  Write-Host 'Inicia sesión para AI Project Builder. No se copian credenciales ni configuración de otros proyectos.'
  & $codex login
  if ($LASTEXITCODE -ne 0) { throw 'No se completó el inicio de sesión.' }
} finally {
  $env:CODEX_HOME = $previousHome
}
