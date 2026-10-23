$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
Write-Host 'Instalando dependencias. No ejecuta pruebas ni compilaciones.'
& npm.cmd install
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron instalar las dependencias.' }
