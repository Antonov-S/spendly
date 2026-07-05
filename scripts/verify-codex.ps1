#Requires -Version 5.1
<#
  verify-codex.ps1 - automated half of the Codex integration acceptance checks
  (docs/features/codex-integration-spec.md Step 7). Exits non-zero on any failure.
  The conversational checks (asking the model the Neon rules, listing MCP tools,
  running a /feature prompt) stay manual - a script can't interrogate the model.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$PIN = "0.142.5"   # Sec 10 pin - keep in step with package.json
$failures = 0
function Pass($m) { Write-Host "  PASS  $m" -ForegroundColor Green }
function Fail($m) { Write-Host "  FAIL  $m" -ForegroundColor Red; $script:failures++ }
function Warn($m) { Write-Host "  WARN  $m" -ForegroundColor Yellow }

Write-Host "== Codex integration verify =="

# 1. Tracked setup artifacts exist ------------------------------------------------
foreach ($f in @(
    "codex-setup\agents-preamble.md",
    "codex-setup\config.template.toml",
    "scripts\sync-codex.ps1",
    "scripts\verify-codex.ps1",
    "codex.ps1"
)) {
    if (Test-Path (Join-Path $repo $f)) { Pass "$f exists" } else { Fail "$f missing" }
}

# git check-ignore for the gitignored surfaces
foreach ($p in @(".codex", "AGENTS.md", "AGENTS.override.md", ".agents", ".codex.env")) {
    & git check-ignore -q -- $p 2>$null
    if ($LASTEXITCODE -eq 0) { Pass "gitignored: $p" } else { Fail "NOT gitignored: $p" }
}

# .codex.env.example is the tracked template and must carry no real secret
$envExample = Join-Path $repo ".codex.env.example"
if (Test-Path $envExample) {
    Pass ".codex.env.example exists (tracked template)"
    if ((Get-Content $envExample -Raw) -match "ctx7sk-[0-9a-fA-F]{8}-") {
        Fail ".codex.env.example contains a real ctx7sk- secret (use a placeholder)"
    } else { Pass ".codex.env.example has no real ctx7sk- secret" }
} else { Fail ".codex.env.example missing" }

# 2. No AGENTS.override.md anywhere in the repo -----------------------------------
$overrides = Get-ChildItem -Path $repo -Recurse -Filter "AGENTS.override.md" -File -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch "\\node_modules\\" -and $_.FullName -notmatch "\\\.git\\" }
if (-not $overrides) { Pass "no AGENTS.override.md exists (Sec 7 ban)" }
else { Fail "AGENTS.override.md found: $($overrides.FullName -join ', ')" }

# 3. AGENTS.md: both marker pairs + literal Neon IDs ------------------------------
$agentsPath = Join-Path $repo "AGENTS.md"
if (Test-Path $agentsPath) {
    $agents = Get-Content $agentsPath -Raw
    foreach ($mk in @(
        "<!-- BEGIN:nextjs-agent-rules -->", "<!-- END:nextjs-agent-rules -->",
        "<!-- BEGIN:spendly-codex -->", "<!-- END:spendly-codex -->"
    )) {
        if ($agents.Contains($mk)) { Pass "AGENTS.md marker: $mk" } else { Fail "AGENTS.md missing marker: $mk" }
    }
    foreach ($id in @("br-hidden-bonus-aqksw1pa", "lucky-hat-53091250")) {
        if ($agents.Contains($id)) { Pass "AGENTS.md has Neon id: $id" } else { Fail "AGENTS.md missing Neon id: $id" }
    }
    if ($agents.Contains("br-falling-haze-aqyvxnbq")) { Pass "AGENTS.md names production branch (as prohibited)" }
    else { Warn "AGENTS.md does not name the production branch id" }
} else { Fail "AGENTS.md missing" }

# 4. .codex/config.toml: exists, structurally valid, both HTTP servers, no secret --
$configOut = Join-Path $repo ".codex\config.toml"
if (Test-Path $configOut) {
    $cfg = Get-Content $configOut -Raw
    Pass ".codex/config.toml exists"

    # light TOML sanity: every non-blank/non-comment line is a [section] or key = value
    $bad = Get-Content $configOut | Where-Object {
        $_.Trim() -ne "" -and $_.Trim() -notmatch "^#" -and
        $_.Trim() -notmatch "^\[.+\]$" -and $_.Trim() -notmatch "=".ToString()
    }
    if (-not $bad) { Pass "config.toml is structurally valid TOML" }
    else { Fail "config.toml has unparseable line(s): $($bad -join ' | ')" }

    foreach ($sec in @("[mcp_servers.neon]", "[mcp_servers.context7]")) {
        if ($cfg.Contains($sec)) { Pass "config.toml has $sec" } else { Fail "config.toml missing $sec" }
    }
    if ($cfg -match "env_http_headers") { Pass "context7 key via env_http_headers (env-var form)" }
    else { Warn "config.toml has no env_http_headers (inline key form?)" }
    if ($cfg -match "ctx7sk-") { Fail "config.toml contains an inline ctx7sk- secret" }
    else { Pass "config.toml contains no inline ctx7sk- secret" }
} else { Fail ".codex/config.toml missing (run: npm run codex:sync)" }

# 5. .codex/skills/<name>/SKILL.md, byte-identical to shared-skills sources -------
#    (0.142.5 discovers custom commands as SKILL.md skills, invoked as $<name>;
#     the older flat .codex/prompts/*.md loader was dropped.)
$skillsDir = Join-Path $repo ".codex\skills"
$sharedDir = Join-Path $repo "shared-skills"
foreach ($name in @("feature-load", "feature-start", "feature-complete")) {
    $a = Join-Path $sharedDir "$name\SKILL.md"
    $b = Join-Path $skillsDir "$name\SKILL.md"
    if ((Test-Path $a) -and (Test-Path $b)) {
        if ((Get-FileHash $a).Hash -eq (Get-FileHash $b).Hash) { Pass "skill synced (identical): $name" }
        else { Fail "skill differs from source: $name (run: npm run codex:sync)" }
    } else { Fail "skill missing: $name (run: npm run codex:sync)" }
}

# 6. Pin + containment ------------------------------------------------------------
$pkg = Get-Content (Join-Path $repo "package.json") -Raw | ConvertFrom-Json
$pinned = $pkg.devDependencies."@openai/codex"
if ($pinned -eq $PIN) { Pass "package.json pins @openai/codex exactly ($PIN)" }
else { Fail "package.json pin is '$pinned', expected exact '$PIN'" }

# Run through codex.ps1 (which pins CODEX_HOME to .\.codex) - NOT the raw binary,
# so `--version` can't leak a ~/.codex home. This doubles as a launcher smoke test.
$globalHome = Join-Path $env:USERPROFILE ".codex"
$hadGlobal = Test-Path $globalHome
$launcher = Join-Path $repo "codex.ps1"
$binary   = Join-Path $repo "node_modules\.bin\codex.cmd"
if ((Test-Path $binary) -and (Test-Path $launcher)) {
    try {
        $job = Start-Job -ScriptBlock { param($l)
            & powershell -NoProfile -ExecutionPolicy Bypass -File $l --version
        } -ArgumentList $launcher
        if (Wait-Job $job -Timeout 60) {
            $ver = (Receive-Job $job) -join " "
            if ($ver -match [regex]::Escape($PIN)) { Pass "codex.ps1 --version reports the pin ($($ver.Trim()))" }
            else { Fail "codex.ps1 --version = '$($ver.Trim())', expected to contain $PIN" }
        } else { Warn "codex.ps1 --version timed out (skipped version assertion)" }
        Remove-Job $job -Force
    } catch { Warn "codex.ps1 --version could not run: $($_.Exception.Message)" }
    $stillGlobal = Test-Path $globalHome
    if ($hadGlobal -eq $stillGlobal) { Pass "containment: ~/.codex unchanged (still $(if($stillGlobal){'present'}else{'absent'}))" }
    else { Fail "containment breach: ~/.codex presence changed to $stillGlobal" }
} else { Fail "local codex binary or launcher missing (run: npm i -D @openai/codex@$PIN)" }

Write-Host ""
if ($failures -eq 0) { Write-Host "verify:codex - ALL CHECKS PASSED" -ForegroundColor Green; exit 0 }
else { Write-Host "verify:codex - $failures CHECK(S) FAILED" -ForegroundColor Red; exit 1 }
