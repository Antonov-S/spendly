# codex.ps1 - run Codex CLI fully scoped to this repo.
#
# Two containment levers (see docs/features/codex-integration-spec.md Sec 2):
#   1. CODEX_HOME pinned to .\.codex  -> no files written to ~/.codex
#   2. local node_modules binary       -> no global `npm i -g` footprint
#
# CODEX_HOME must point at a directory that ALREADY EXISTS or Codex errors at
# startup, so this launcher creates .codex/ on first run.
#
# Secrets: if a gitignored .codex.env exists next to this script, its KEY=value
# lines are loaded into the environment (e.g. CONTEXT7_API_KEY for the context7
# MCP header) so you never export them by hand. Copy .codex.env.example to get
# started. The file is gitignored and never committed.
#
# Usage:  ./codex.ps1 [codex args...]   e.g.  ./codex.ps1 --version

$env:CODEX_HOME = Join-Path $PSScriptRoot ".codex"
if (-not (Test-Path $env:CODEX_HOME)) {
    New-Item -ItemType Directory $env:CODEX_HOME | Out-Null
}

$envFile = Join-Path $PSScriptRoot ".codex.env"
if (Test-Path $envFile) {
    foreach ($line in Get-Content $envFile) {
        $t = $line.Trim()
        if ($t -eq "" -or $t.StartsWith("#") -or ($t -notmatch "=")) { continue }
        $name, $value = $t -split "=", 2
        Set-Item -Path "Env:$($name.Trim())" -Value $value.Trim()
    }
}

$codex = Join-Path $PSScriptRoot "node_modules\.bin\codex.cmd"
if (-not (Test-Path $codex)) {
    Write-Error "Local Codex binary not found at $codex. Run: npm i -D @openai/codex@0.142.5"
    exit 1
}

& $codex @Args
