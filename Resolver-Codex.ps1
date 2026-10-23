function Resolve-AipbCodex {
    # Return a native executable: the Node adapter intentionally uses shell:false.
    if ($env:AIPB_CODEX_BIN) {
        if ((Test-Path -LiteralPath $env:AIPB_CODEX_BIN -PathType Leaf) -and
            ([IO.Path]::GetExtension($env:AIPB_CODEX_BIN) -ieq '.exe')) {
            return (Get-Item -LiteralPath $env:AIPB_CODEX_BIN).FullName
        }
        Write-Warning 'AIPB_CODEX_BIN no apunta a un ejecutable disponible. Buscando Codex instalado...'
    }
    $command = Get-Command codex.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { return $command.Source }

    $bases = @()
    if ($env:LOCALAPPDATA) { $bases += Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin' }
    if ($env:USERPROFILE) { $bases += Join-Path $env:USERPROFILE 'AppData\Local\OpenAI\Codex\bin' }
    $candidates = @(
        foreach ($base in ($bases | Select-Object -Unique)) {
            if (-not (Test-Path -LiteralPath $base -PathType Container)) { continue }
            $direct = Join-Path $base 'codex.exe'
            if (Test-Path -LiteralPath $direct -PathType Leaf) { Get-Item -LiteralPath $direct }
            foreach ($version in (Get-ChildItem -LiteralPath $base -Directory -ErrorAction SilentlyContinue)) {
                $exe = Join-Path $version.FullName 'codex.exe'
                if (Test-Path -LiteralPath $exe -PathType Leaf) { Get-Item -LiteralPath $exe }
            }
        }
    )
    $candidate = $candidates | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($candidate) { return $candidate.FullName }
    throw 'No se encontro codex.exe. Abre o instala Codex, o define $env:AIPB_CODEX_BIN con la ruta completa al ejecutable nativo antes de repetir.'
}