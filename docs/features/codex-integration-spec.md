# Codex Integration Spec

> How to run OpenAI **Codex CLI** alongside **Claude Code** in the Spendly repo —
> **fully project-scoped, no global install** — and how far we can share a single
> set of instructions, prompts, agents, and MCP servers between the two.

_Status: proposal • Platform: Windows 10 + PowerShell • Last updated: 2026-06-07_

---

## 1. Goal

Let either agent (Claude Code or Codex CLI) work in this repo without:
- maintaining two divergent sets of configuration, **and**
- a **global** Codex footprint. Everything Codex needs (binary + config + prompts +
  MCP) lives **inside the repo** and is gitignored. Nothing lands in `~/.codex`,
  nothing is `npm i -g`'d.

Concretely:
- Both agents read the **same project instructions** (`CLAUDE.md` + `docs/*.md`).
- Codex's config home is pinned to a repo-local folder via `CODEX_HOME`.
- MCP servers (Neon, context7) defined once per tool, pointing at the same servers.
- Be explicit about what **cannot** be shared so we don't fake it.

---

## 2. Containment model (the key decision)

Codex resolves its config home from the **`CODEX_HOME`** env var, defaulting to
`~/.codex` only when unset. Point it at the repo and the whole footprint moves in-tree:

```
spendly/
├─ .codex/                ← CODEX_HOME (gitignored)
│  ├─ config.toml         ← model, sandbox, [mcp_servers], profiles
│  ├─ prompts/            ← project slash commands (/name → prompts/name.md)
│  └─ …                   ← sessions, logs, cache — all contained here
├─ AGENTS.md              ← Codex instructions (symlink/pointer to CLAUDE.md)
├─ codex.ps1             ← launcher: sets CODEX_HOME + runs local binary
└─ node_modules/.bin/codex ← local dev dependency, NOT global
```

Two independent "no global" levers, use **both**:
1. **Config containment:** `CODEX_HOME=<repo>\.codex` → no files in `~/.codex`.
2. **Binary containment:** install `@openai/codex` as a local `devDependency` (run via
   `npx codex` / `node_modules\.bin\codex`) → no `npm i -g`.

Result: deleting the repo deletes 100% of Codex's state. No surprise files in your home
directory, no machine-wide binary.

---

## 3. TL;DR — what is actually shareable

| Artifact | Claude Code | Codex CLI | Shared? | Mechanism |
| --- | --- | --- | --- | --- |
| Project instructions / memory | `CLAUDE.md` (+ `@docs/*`) | `AGENTS.md` (root + nested, auto-loaded) | **Yes** | Canonical file; other is symlink/pointer |
| Persistent auto-memory | `~/.claude/.../memory/` + `MEMORY.md` | _none native_ | **No** | Codex has no cross-session memory store |
| Slash commands / prompts | `.claude/commands/*.md` | `$CODEX_HOME/prompts/*.md` | **Partial** | Different format; share via symlink + light rewrite |
| Subagents | `.claude/agents/*` + `Agent` tool | _none native_ | **No** | Codex has no first-class subagent system |
| MCP servers | `.mcp.json` / settings | `config.toml [mcp_servers]` | **Yes (servers)** | Same servers, two config syntaxes |
| Skills | `Skill` tool / `.claude/skills` | Codex skills (dir-based) | **Partial** | Different runtime; re-author if needed |
| Hooks | `settings.json` hooks | `notify` + limited | **Partial** | Re-implement per tool |

**Bottom line:** instructions/memory file and MCP servers share cleanly. Slash commands
share with a thin translation layer. **Subagents and persistent memory don't transfer** —
Claude-Code-specific, stay Claude-only.

---

## 4. Codex fundamentals (verified)

- **Config home:** `$CODEX_HOME`; defaults to `~/.codex` only if unset. **We override it
  to the repo.**
- **Main config:** `$CODEX_HOME/config.toml` (TOML). Model/profile, sandbox, approval
  policy, `[mcp_servers]`, `[profiles.*]`.
- **Instructions file:** `AGENTS.md`. Scope = directory tree rooted at its folder. Root
  `AGENTS.md` (and any from CWD up to root) auto-injected into the developer message.
  Deeper `AGENTS.md` wins on conflict; direct prompt instructions override all `AGENTS.md`.
- **Custom prompts (slash commands):** Markdown in `$CODEX_HOME/prompts/`. `name.md`
  → `/name`. Supports `$1`, `$2`, … and `$ARGUMENTS`. With `CODEX_HOME` pinned to the
  repo, these become effectively **project-local** prompts.
- **MCP:** `[mcp_servers.<name>]` blocks with `command`, `args`, `[…​.env]`.
- **No native subagents.** Multi-agent only via sub-processing `codex exec` or 3rd-party
  layers (out of scope).

---

## 5. Repo reality check

`.gitignore` already excludes `CLAUDE.md`, `AGENTS.md`, `context/`, `.claude/`. We must
**add `.codex/`** so the new config home (which will hold secrets) is never committed.
This integration is local-developer setup, not committed team config. The one tracked
artifact is this spec.

---

## 6. Step-by-step integration plan

### Step 0 — Prerequisites
1. Add `.codex/` to `.gitignore` **before** creating any config (it will hold the Neon
   API key).
2. Install Codex as a **local** dev dependency (no global):
   ```powershell
   npm i -D @openai/codex
   ```
3. Confirm `npm run test:run` and `npm run build` still pass (unchanged baseline).

### Step 1 — Create the launcher (pins CODEX_HOME + uses local binary)
Create `codex.ps1` at repo root so every run is contained, regardless of shell state:
```powershell
# codex.ps1 — run Codex fully scoped to this repo
$env:CODEX_HOME = Join-Path $PSScriptRoot ".codex"
& "$PSScriptRoot\node_modules\.bin\codex.cmd" @Args
```
Usage: `./codex.ps1` (instead of bare `codex`). This guarantees no `~/.codex` writes and
no global binary. _Optionally_ add an npm script: `"codex": "codex"` — but only after
`CODEX_HOME` is set in the environment; the launcher is the safer default.

### Step 2 — Unify project instructions (CLAUDE.md ↔ AGENTS.md)
Codex won't read `CLAUDE.md`; Claude won't auto-read `AGENTS.md`. Single source of truth:
- **Decision:** keep `CLAUDE.md` canonical; add `AGENTS.md` as a symlink to it.
  ```powershell
  New-Item -ItemType SymbolicLink -Path ".\AGENTS.md" -Target ".\CLAUDE.md"
  ```
  (Needs Developer Mode or an elevated shell. Fallback below if symlinks are blocked.)
- **Caveat:** Codex ingests `AGENTS.md` literally and does **not** expand Claude's
  `@docs/project-overview.md` import syntax. Resolutions:
  - **(a)** inline the essential rules in the canonical file, or
  - **(b)** add a short literal preamble: "Codex: read `docs/project-overview.md`,
    `coding-standards.md`, `ai-interaction.md`, `current-feature.md` before working."
  - **Recommended: (b)** — ~10 lines, no duplication drift.
- **Fallback (no symlink):** make `AGENTS.md` a tiny real file containing only the (b)
  preamble + the critical Neon guardrails. Slightly duplicated, but robust.
- Make sure the Neon rules (project `lucky-hat-53091250`, `development` branch
  `br-hidden-bonus-aqksw1pa`, never touch production, migrations-not-`db push`) land in
  whatever Codex actually reads. Highest-risk rules to lose.

### Step 3 — Wire MCP servers (into the repo-local config.toml)
Create `.codex/config.toml`. Translate each Claude MCP server to a `[mcp_servers]` block;
servers are identical, only syntax differs:
```toml
# .codex/config.toml   (gitignored — contains secrets)
[mcp_servers.neon]
command = "npx"
args = ["-y", "@neondatabase/mcp-server-neon", "start"]
[mcp_servers.neon.env]
NEON_API_KEY = "…"          # never commit; .codex/ is gitignored

[mcp_servers.context7]
command = "npx"
args = ["-y", "@upstash/context7-mcp"]
```
- Copy exact `command`/`args`/`env` from the current Claude config so they match.
- **Critical:** the Neon read-only + `development`-only + never-production rules live in
  the instructions file (Step 2), **not** MCP config. Codex loses those guardrails if
  Step 2 isn't right.

### Step 4 — Port the slash commands you use (now project-local)
With `CODEX_HOME=.codex`, prompts in `.codex/prompts/` are effectively per-project.
1. Pick portable Claude commands (e.g. a `feature`-style workflow prompt). Skill-backed,
   runtime-bound commands (`/code-review ultra`, `/verify`, `/run`) **cannot** port — mark
   Claude-only.
2. For each, create `.codex/prompts/<name>.md`, rewriting to Codex args (`$ARGUMENTS` /
   `$1`). Claude frontmatter (`allowed-tools`, `argument-hint`) is ignored by Codex.
3. Optional dedup: keep bodies in a tracked `shared-prompts/` folder and symlink into
   `.codex/prompts/`. Don't expect byte-for-byte reuse — arg syntax + permission models
   differ.

### Step 5 — Explicitly don't share subagents / memory
- **Subagents** (`auth-auditor`, `code-scanner`, `refactor-scanner`, …) stay
  **Claude-only**; Codex has no loader. We are **not** rebuilding the fleet for Codex.
- **Auto-memory** (`MEMORY.md` + `memory/`) stays **Claude-only**. If a fact must reach
  Codex, put it in the shared instructions file (Step 2), not the memory store.

### Step 6 — Align sandbox / approval with our workflow
In `.codex/config.toml`, match `ai-interaction.md` discipline:
```toml
approval_policy = "on-request"
sandbox_mode    = "workspace-write"
[sandbox_workspace_write]
network_access = true   # needed for npm/prisma; tighten if undesired
```
Reinforce in the instructions file: never `db push`, always `prisma migrate dev`, run
`npm run test:run` + `npm run build` before proposing a commit, ask before committing,
never add agent attribution to commit messages.

### Step 7 — Verify
- `./codex.ps1` in repo root → ask "what are the Neon branch rules?" → must answer
  `development` / `br-hidden-bonus-aqksw1pa` + production prohibition. Else Step 2 failed.
- Confirm **containment:** after a session, `~/.codex` does **not** exist / is untouched;
  all new files are under `.\.codex\`.
- Ask Codex to list MCP tools → Neon + context7 appear.
- Run a ported `/<name>` prompt → expands correctly.
- Claude Code behavior unchanged (symlink didn't break `CLAUDE.md`).

---

## 7. Windows / containment notes
- `CODEX_HOME` set **per launch** by `codex.ps1` — never rely on a global/user env var
  (defeats the purpose and risks leaking to other repos).
- Symlinks need Developer Mode or elevation; use the Step 2 fallback otherwise.
- Secrets (`NEON_API_KEY`) live only in `.codex/config.toml`, which is gitignored. Double
  check with `git status` before any commit that `.codex/` is untracked.
- Local binary lives in `node_modules/` — already gitignored, never global.

---

## 8. Acceptance criteria
- [ ] `.codex/` added to `.gitignore`; nothing under it is tracked.
- [ ] Codex installed as a **local devDependency**, not global; launched via `codex.ps1`.
- [ ] A session creates **zero** files in `~/.codex`.
- [ ] Codex loads the same project rules as Claude (Neon-branch question passes).
- [ ] Neon + context7 MCP usable from Codex.
- [ ] Production-branch prohibition + migrations-not-`db push` present in Codex's context.
- [ ] At least the core workflow prompt available as a Codex slash command.
- [ ] Claude Code behavior unchanged; no secrets committed.

---

## 9. Out of scope / open decisions
- Rebuilding Claude subagents as Codex orchestration (`codex exec` fan-out / Oh My Codex).
- Two-way memory sync between Codex and Claude's `MEMORY.md`.
- Committed, team-wide Codex config (current `.gitignore` keeps AI tooling local).
- **Decision needed:** canonical instructions approach — (a) inline everything vs (b)
  literal "read these files" preamble. Spec recommends **(b)**, with the Neon guardrails
  duplicated into `AGENTS.md` directly as a safety net.
