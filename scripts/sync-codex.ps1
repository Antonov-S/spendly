#Requires -Version 5.1
<#
  sync-codex.ps1 - apply the tracked Codex setup into the gitignored .codex/ home
  and AGENTS.md. Idempotent: a second run produces no diff.

  Actions (docs/features/codex-integration-spec.md Step 6b):
    1. Re-apply codex-setup/agents-preamble.md into AGENTS.md between the
       <!-- BEGIN:spendly-codex --> / <!-- END:spendly-codex --> markers, OUTSIDE
       the tool-managed nextjs-agent-rules block.
    2. Copy codex-setup/config.template.toml -> .codex/config.toml when missing
       (-Force to overwrite; the template is secret-free - context7 key is read
       from $CONTEXT7_API_KEY at runtime).
    3. Copy shared-prompts/*.md -> .codex/prompts/ (always, keeps them current).

  Never hand-edit .codex/config.toml or the AGENTS.md preamble - edit the tracked
  source (codex-setup/, shared-prompts/) and re-run this script.
#>
[CmdletBinding()]
param([switch]$Force)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot

$agentsPath   = Join-Path $repo "AGENTS.md"
$preamblePath = Join-Path $repo "codex-setup\agents-preamble.md"
$configTmpl   = Join-Path $repo "codex-setup\config.template.toml"
$codexHome    = Join-Path $repo ".codex"
$promptsDir   = Join-Path $codexHome "prompts"
$configOut    = Join-Path $codexHome "config.toml"
$sharedPromptsDir = Join-Path $repo "shared-prompts"

$BEGIN = "<!-- BEGIN:spendly-codex -->"
$END   = "<!-- END:spendly-codex -->"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Read-Text($path)  { [System.IO.File]::ReadAllText($path) }
function Write-Text($path, $text) { [System.IO.File]::WriteAllText($path, $text, $utf8NoBom) }

# -- 1. AGENTS.md preamble ----------------------------------------------------
if (-not (Test-Path $preamblePath)) { throw "Missing template: $preamblePath" }
$preamble = (Read-Text $preamblePath).Trim()
$block = "$BEGIN`n$preamble`n$END"

if (-not (Test-Path $agentsPath)) {
    Write-Text $agentsPath "$block`n"
    Write-Host "AGENTS.md: created with Spendly preamble."
} else {
    $agents  = Read-Text $agentsPath
    $pattern = [regex]::Escape($BEGIN) + "(?s).*?" + [regex]::Escape($END)
    if ([regex]::IsMatch($agents, $pattern)) {
        $updated = [regex]::Replace($agents, $pattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $block })
        if ($updated -ne $agents) { Write-Text $agentsPath $updated; Write-Host "AGENTS.md: preamble re-applied." }
        else { Write-Host "AGENTS.md: preamble already current." }
    } else {
        $updated = $agents.TrimEnd() + "`n`n" + $block + "`n"
        Write-Text $agentsPath $updated
        Write-Host "AGENTS.md: preamble appended."
    }
}

# -- 2. .codex/config.toml ----------------------------------------------------
if (-not (Test-Path $configTmpl)) { throw "Missing template: $configTmpl" }
if (-not (Test-Path $codexHome)) { New-Item -ItemType Directory $codexHome | Out-Null }
if ((Test-Path $configOut) -and -not $Force) {
    Write-Host "config.toml: exists (use -Force to overwrite)."
} else {
    Copy-Item $configTmpl $configOut -Force
    Write-Host "config.toml: written from template."
}

# -- 3. .codex/prompts/ -------------------------------------------------------
if (-not (Test-Path $promptsDir)) { New-Item -ItemType Directory $promptsDir | Out-Null }
$copied = 0
Get-ChildItem (Join-Path $sharedPromptsDir "*.md") | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $promptsDir $_.Name) -Force
    $copied++
}
Write-Host "prompts: $copied file(s) synced to .codex/prompts/."

Write-Host "codex:sync complete."
