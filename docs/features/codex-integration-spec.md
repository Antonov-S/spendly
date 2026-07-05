# Codex Integration Spec

> How to run OpenAI **Codex CLI** alongside **Claude Code** in the Spendly repo —
> **fully project-scoped, no global install** — and how far we can share a single
> set of instructions, prompts, agents, and MCP servers between the two.

_Status: proposal • Platform: Windows 10 + PowerShell • Last updated: 2026-07-04_

> **2026-06-30 revision** — reconciled with the live repo. Three assumptions in the
> original draft were stale: (1) `AGENTS.md` **already exists** as a Next.js-managed file
> (so the symlink plan is dropped — see Step 2); (2) MCP is now **remote HTTP** in
> `.mcp.json` (neon HTTP/OAuth, context7 HTTP+key, playwright stdio), not npx-stdio with a
> `NEON_API_KEY` (Step 3 rewritten to Codex's HTTP `[mcp_servers]` syntax — the `env` block
> is **forbidden** for HTTP transport); (3) there is no `.claude/commands/` — the workflow
> is the dir-based `feature` **Skill** (Step 4). `CODEX_HOME` must also point at a directory
> that **already exists** or Codex errors at startup.

> **2026-07-04 revision** — capability claims re-verified against current Codex docs
> (context7 `/openai/codex`). Three "Codex can't" claims in this spec were stale:
> (1) Codex now has **native subagents** — TOML **agent roles** auto-discovered from
> `$CODEX_HOME/agents/*.toml` plus `[agents.<role_name>]` blocks in `config.toml`
> (§4, Step 5, §13 corrected; porting our fleet remains a *decision* not to, no longer a
> limitation). (2) Codex now supports **skills in the same `SKILL.md` format Claude uses**
> — Step 4b added as the higher-fidelity port path for the `feature` workflow; the flat
> prompts remain the shipped baseline. (3) **`AGENTS.override.md`** exists and, when
> present, **replaces** `AGENTS.md` for that directory — a live footgun for this repo
> (would silently drop the Next.js block *and* the Neon guardrails); see the §7 note and
> the Step 0 gitignore additions. Same-day hardening pass: exact version pin (`0.142.5`,
> §10) + a minimum-capabilities table; tracked `codex-setup/` templates + `codex:sync`
> script single-sourcing the AGENTS.md preamble and `config.toml` (Step 6b); an automated
> `verify:codex` smoke test (Step 7); §12 recovery is now template-driven, not manual.

> **2026-07-05 revision — flat prompts dropped on the pin; workflow ships as skills.**
> Verified live against the pinned build (`codex-cli 0.142.5`): the flat
> `$CODEX_HOME/prompts/*.md` custom-command loader **no longer exists** — every `prompts`
> string in the binary is an MCP protocol method or a skill sample, and there is no `prompts`
> subcommand. The custom-command mechanism is now **skills** (`SKILL.md`), which Codex itself
> confirms by populating `.codex/skills/.system/` with its built-in skills. So the three
> workflow commands were **converted from flat prompts to skills** (Step 4b taken, not the
> Step-4 baseline):
> - Tracked source moved `shared-prompts/*.md` → **`shared-skills/<name>/SKILL.md`** (YAML
>   frontmatter `name` + `description` + `metadata.short-description`; the only allowed
>   frontmatter keys are `name`/`description`/`license`/`allowed-tools`/`metadata`, and
>   `description` may not contain `<`/`>` — Codex's own `quick_validate.py` enforces this,
>   so **`argument-hint` is not allowed** and the hint was folded into `description`).
> - `scripts/sync-codex.ps1` now copies `shared-skills/<name>/SKILL.md` →
>   `.codex/skills/<name>/`; `scripts/verify-codex.ps1` checks those instead of
>   `.codex/prompts/`. The dead `.codex/prompts/` was removed.
> - **Invocation changed from `/feature-load` to `$feature-load`** — skills are triggered by
>   `$<skill-name>` followed by the spec reference as free text (there is no `$ARGUMENTS`
>   token substitution; the model reads the argument from the invocation line). Confirmed:
>   `codex exec -s read-only "list your feature-* skills"` returns
>   `feature-complete, feature-load, feature-start`.
> `shared-prompts/` is retained but **legacy** (superseded by `shared-skills/`); the §4 /
> §4b / §13 prose below still describes the flat-prompt baseline and should be read through
> this note.

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

### Why project-local, not the default global install

Codex defaults to a global footprint: a `~/.codex` config home and an `npm i -g` binary.
We deliberately override both. The reasoning, for future contributors:

- **No cross-repo leakage.** A global `~/.codex` holds one model/sandbox/MCP config shared
  by *every* repo on the machine. Pinning `CODEX_HOME` per-repo means Spendly's Neon
  guardrails, sandbox policy, and MCP servers can't bleed into (or be overwritten by)
  another project — and another project's looser config can't accidentally apply here.
- **Secrets stay scoped + disposable.** The context7 key lives only in this repo's gitignored
  `.codex/`. Deleting the repo deletes 100% of Codex's state and secrets — nothing lingers in
  your home directory.
- **Reproducible + pinnable.** A local `devDependency` means the Codex version is captured in
  `package.json`/lockfile and upgrades are a reviewable diff, not a silent machine-wide
  `npm i -g` that drifts between contributors.
- **Symmetry with Claude Code.** Claude's footprint is already in-repo and gitignored
  (`.claude/`, `.mcp.json`, `CLAUDE.md`). Containing Codex the same way keeps one mental
  model: *AI tooling is local, per-repo, and uncommitted.*

If you don't need isolation (a throwaway box, a single-repo machine), the global default is
simpler — but on a multi-project dev machine the isolation is the whole point.

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
├─ AGENTS.md              ← Codex instructions (already exists — append preamble, see Step 2)
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
| Project instructions / memory | `CLAUDE.md` (+ `@docs/*`) | `AGENTS.md` (root + nested, auto-loaded) | **Partial** | `AGENTS.md` already exists (tool-managed) — append a Codex preamble + inlined Neon rules; no symlink |
| Persistent auto-memory | `~/.claude/.../memory/` + `MEMORY.md` | _none native_ | **No** | Codex has no cross-session memory store |
| Slash commands / prompts | `.claude/skills/*` (dir-based Skills; no `.claude/commands/`) | `$CODEX_HOME/prompts/*.md` (flat) **or** Codex skills (Step 4b) | **Partial** | Flat prompts shipped; skill port is the higher-fidelity option |
| Subagents | `.claude/agents/*` + `Agent` tool | `.codex/agents/*.toml` (agent roles) | **Partial** | Same intent, different wrapper (MD+YAML vs TOML); fleet port stays out of scope (Step 5) |
| MCP servers | `.mcp.json` / settings | `config.toml [mcp_servers]` | **Yes (servers)** | Same servers, two config syntaxes |
| Skills | `Skill` tool / `.claude/skills` | Codex skills — **same `SKILL.md` standard** | **Yes (format)** | Same frontmatter (`name`/`description`) + bundled resources; Claude-specific tool names/hooks need edits (Step 4b) |
| Hooks | `settings.json` hooks | `notify` + limited | **Partial** | Re-implement per tool |

**Bottom line:** MCP servers share cleanly (same URLs, two syntaxes), and **skills now share
at the format level** — Codex adopted the same `SKILL.md` standard, so the `feature` workflow
can port as a skill (Step 4b) rather than only as flat prompts. The instructions file shares
*partially* — `AGENTS.md` already exists and is tool-managed, so append rather than replace.
**Subagents have a Codex counterpart now** (TOML agent roles) but we deliberately don't port
the fleet; **persistent memory still doesn't transfer** — Claude-Code-specific, stays
Claude-only.

---

## 4. Codex fundamentals (verified)

- **Config home:** `$CODEX_HOME`; defaults to `~/.codex` only if unset. **We override it
  to the repo.** Note: Codex requires the path to **already exist as a directory** and
  errors at startup if it doesn't — the launcher (Step 1) creates `.codex/` on first run.
- **Main config:** `$CODEX_HOME/config.toml` (TOML). Model/profile, sandbox, approval
  policy, `[mcp_servers]`, `[profiles.*]`.
- **Instructions file:** `AGENTS.md`. Scope = directory tree rooted at its folder. Root
  `AGENTS.md` (and any from CWD up to root) auto-injected into the developer message.
  Deeper `AGENTS.md` wins on conflict; direct prompt instructions override all `AGENTS.md`.
- **Custom prompts (slash commands):** Markdown in `$CODEX_HOME/prompts/`. `name.md`
  → `/name`. Supports `$1`, `$2`, … and `$ARGUMENTS`. With `CODEX_HOME` pinned to the
  repo, these become effectively **project-local** prompts.
- **MCP:** `[mcp_servers.<name>]` blocks. **stdio** servers use `command` + `args` +
  `[….env]`; **remote HTTP** servers use `url` + `bearer_token_env_var` / `http_headers` /
  `env_http_headers` — `env` is rejected for HTTP transport.
- **Subagents (agent roles) — native as of 2026.** TOML files auto-discovered from
  `$CODEX_HOME/agents/*.toml`, plus explicit `[agents.<role_name>]` blocks in `config.toml`
  (`description`, `config_file`, `nickname_candidates`). With `CODEX_HOME` pinned to the
  repo this is `.codex/agents/` — containment holds with zero extra work. (Older builds had
  none; multi-agent was `codex exec` sub-processing only.)
- **Skills — same `SKILL.md` standard as Claude.** YAML frontmatter (`name`/`description`
  required) + Markdown instructions, with optional bundled `scripts/` / `references/` /
  `assets/`. Discovery roots (verified 2026-07-04): the **project config folder's
  `skills/`** at repo scope, and at user scope `~/.agents/skills/` with
  **`$CODEX_HOME/skills/` marked deprecated** in the loader as a fallback for
  user-installed skills. Under the repo pin, `.codex/skills/` is both the project-scope
  root and the (deprecated) `$CODEX_HOME` fallback, so it works today — but the
  deprecation means the `.agents/skills/` convention is where Codex is heading; the Step 0
  `.agents/` gitignore entry is load-bearing, not just precautionary. **Re-verify the
  roots on the pinned version** (ask Codex to list skills) before and after any bump.
- **`AGENTS.override.md` — first-match shadow, not a merge.** In each directory Codex checks
  `AGENTS.override.md` *before* `AGENTS.md` and loads only the **first** file found — an
  override file **replaces** `AGENTS.md` for that directory entirely. Never create one in
  this repo (see §7): it would silently drop both the tool-managed Next.js block and the
  Step-2 Neon guardrails.

---

## 5. Repo reality check

`.gitignore` already excludes `CLAUDE.md`, `AGENTS.md`, `context/`, `.claude/`, and
`.mcp.json` (so the context7 key is already kept out of git). `.codex/` has now been added
to the same "AI coding tools" block, so the new config home (which will hold the context7
key + session/log cache) is never committed. This integration is local-developer setup, not
committed team config. The tracked artifacts are this spec plus its **secret-free sources**:
`shared-prompts/` (workflow prompts), `codex-setup/` (the AGENTS.md preamble +
`config.template.toml`, Step 6b), and `scripts/sync-codex.ps1` / `scripts/verify-codex.ps1`
(Step 6b / Step 7).

---

## 6. Step-by-step integration plan

### Step 0 — Prerequisites
1. Add `.codex/` to `.gitignore` **before** creating any config (it will hold the
   context7 key). Also add **`AGENTS.override.md`** and **`.agents/`** to the same
   AI-tooling block preemptively: the override file is a footgun that must never be
   committed (§7), and `.agents/` covers the possibility of project-level Codex skills
   landing there in a future version (§4 skills note).
2. Install Codex as a **local** dev dependency (no global), pinned exactly (§10):
   ```powershell
   npm i -D @openai/codex@0.142.5
   ```
3. Confirm `npm run test:run` and `npm run build` still pass (unchanged baseline).

### Step 1 — Create the launcher (pins CODEX_HOME + uses local binary)
Create `codex.ps1` at repo root so every run is contained, regardless of shell state.
**`CODEX_HOME` must point at a directory that already exists** — Codex errors at startup
with "path does not exist" otherwise — so the launcher creates it on first run:
```powershell
# codex.ps1 — run Codex fully scoped to this repo
$env:CODEX_HOME = Join-Path $PSScriptRoot ".codex"
if (-not (Test-Path $env:CODEX_HOME)) { New-Item -ItemType Directory $env:CODEX_HOME | Out-Null }
& "$PSScriptRoot\node_modules\.bin\codex.cmd" @Args
```
Usage: `./codex.ps1` (instead of bare `codex`). This guarantees no `~/.codex` writes and
no global binary. _Optionally_ add an npm script: `"codex": "codex"` — but only after
`CODEX_HOME` is set in the environment; the launcher is the safer default.

### Step 2 — Unify project instructions (CLAUDE.md ↔ AGENTS.md)
Codex won't read `CLAUDE.md`; Claude won't auto-read `AGENTS.md`.

> **Repo reality:** `AGENTS.md` **already exists** at the repo root, but it is a small
> tool-managed file (`<!-- BEGIN:nextjs-agent-rules -->` … `<!-- END -->`) carrying the
> "this is not the Next.js you know" warning — content that is **not** in `CLAUDE.md` and
> is regenerated by tooling (`codex /init` and the Next.js rules injector both write here).
> **Do not symlink `AGENTS.md` → `CLAUDE.md`** (the original plan): it would clobber the
> Next.js block and fight whatever regenerates the file. The symlink approach is retired.

- **Decision:** keep `AGENTS.md` a **real file**. Append a Codex preamble **outside** the
  managed markers (so regeneration leaves it intact), pointing at the same docs Claude reads
  plus the critical guardrails inlined:
  ```markdown
  <!-- BEGIN:nextjs-agent-rules -->
  …tool-managed; do not edit…
  <!-- END:nextjs-agent-rules -->

  # Spendly — project rules for Codex
  Before working, read: docs/project-overview.md, docs/coding-standards.md,
  docs/ai-interaction.md, docs/current-feature.md.

  Neon (NON-NEGOTIABLE): project `lucky-hat-53091250`, branch `development`
  (`br-hidden-bonus-aqksw1pa`) only. NEVER touch production (`br-falling-haze-aqyvxnbq`).
  Schema changes via `prisma migrate dev` — never `db push`. Read-only MCP by default.
  Run `npm run test:run` + `npm run build` before proposing a commit; ask before committing;
  no agent attribution in commit messages.
  ```
- **Why inline the Neon rules, not just a "read the docs" pointer:** Codex ingests
  `AGENTS.md` literally and does **not** expand Claude's `@docs/...` import syntax, so a bare
  pointer can be skipped. The Neon production prohibition + migrations-not-`db push` are the
  highest-risk rules to lose — duplicate them directly into `AGENTS.md` as a safety net.
- This file is gitignored (`.gitignore` line 49), so the preamble stays local-only.
- **Anti-drift (2026-07-04):** the preamble's tracked source of truth is
  `codex-setup/agents-preamble.md`; `npm run codex:sync` (Step 6b) applies it idempotently
  between its own `<!-- BEGIN:spendly-codex -->` … `<!-- END:spendly-codex -->` markers
  (outside the Next.js block). A rules change is a one-file template edit + re-sync — never
  a hand-edit of `AGENTS.md`.

### Step 3 — Wire MCP servers (into the repo-local config.toml)
Create `.codex/config.toml` by copying the tracked, secret-free template
`codex-setup/config.template.toml` (Step 6b — `npm run codex:sync` does this when the file
is missing) and keep the servers mirrored from the live `.mcp.json`. The template must use
the `env_http_headers` form below (key read from the environment) so it never contains a
secret; the inline `http_headers` form is allowed only in the gitignored
`.codex/config.toml` itself.

> **Repo reality:** the current `.mcp.json` uses **remote HTTP** transport, not local
> npx-stdio. There is **no `NEON_API_KEY`** (neon is HTTP + OAuth); the only secret is the
> context7 API key, passed as an HTTP header. Translate to Codex's HTTP `[mcp_servers]`
> form — `url` plus header/token fields. **The `env` block is forbidden for HTTP transport
> and fails config validation** (it is stdio-only); use `http_headers` / `env_http_headers`
> / `bearer_token_env_var` instead.
```toml
# .codex/config.toml   (gitignored — contains the context7 key)

# neon — remote HTTP, OAuth (browser auth on first use); no API key
[mcp_servers.neon]
url = "https://mcp.neon.tech/mcp"

# context7 — remote HTTP, key via header. Prefer sourcing from the environment:
[mcp_servers.context7]
url = "https://mcp.context7.com/mcp"
env_http_headers = { CONTEXT7_API_KEY = "CONTEXT7_API_KEY" }   # reads $CONTEXT7_API_KEY
# …or inline the literal value (kept local — .codex/ is gitignored):
# http_headers = { CONTEXT7_API_KEY = "ctx7sk-…" }

# playwright — local stdio (env IS allowed for stdio transport)
[mcp_servers.playwright]
command = "npx"
args = ["@playwright/mcp@latest"]
```
- Copy the exact `url` / header name from the current `.mcp.json` so they match. After
  editing `config.toml`, Codex picks it up on the next turn (or re-launch).
- **Critical:** the Neon read-only + `development`-only + never-production rules live in
  the instructions file (Step 2), **not** MCP config. The HTTP Neon server can reach
  production; only the Step-2 guardrails keep Codex off it. Codex loses those guardrails if
  Step 2 isn't right.

### Step 4 — Port the slash commands you use (now project-local)
With `CODEX_HOME=.codex`, prompts in `.codex/prompts/` are effectively per-project.

> **Repo reality:** there is **no `.claude/commands/` directory** — the original draft's
> source path is stale. Claude's workflows are now **Skills** under `.claude/skills/`. The
> daily-driver workflow is the dir-based [`feature`](../../.claude/skills/feature/) Skill,
> which has multiple actions (`start` / `test` / `review` / `complete` / `explain` / `load`)
> plus its own `SKILL.md`. A multi-action Skill does **not** flatten 1:1 into a single Codex
> `prompts/<name>.md` — porting means **re-authoring**, not symlinking. The runtime-bound
> Skills (`/code-review`, `/verify`, `/run`, `/feature`'s harness hooks) **cannot** port —
> mark them Claude-only.

1. Pick the portable *intent* (e.g. the `feature` start→test→commit loop) and re-author it
   as a flat prompt; don't try to mirror the Skill's action sub-files.
2. Create `.codex/prompts/<name>.md`, written to Codex args (`$ARGUMENTS` / `$1`). Claude
   Skill frontmatter (`description`, `allowed-tools`) is ignored by Codex.
3. Dedup: keep bodies in the tracked `shared-prompts/` folder and copy (or symlink, where
   symlinks are allowed) into `.codex/prompts/`. Don't expect byte-for-byte reuse with the
   Claude Skill — arg syntax + permission models differ.

> **Shipped with this spec — the `feature` loop, ported.** Three flat prompts in
> [`shared-prompts/`](../../shared-prompts/) re-author Claude's `/feature` Skill for Codex:
> [`feature-load.md`](../../shared-prompts/feature-load.md) →
> [`feature-start.md`](../../shared-prompts/feature-start.md) →
> [`feature-complete.md`](../../shared-prompts/feature-complete.md). Install them with:
> ```powershell
> Copy-Item .\shared-prompts\feature-*.md .\.codex\prompts\
> ```
> Intended workflow: hand Codex a Markdown spec, then run `/feature-load <spec>` (plan, no
> code) → `/feature-start <spec>` (implement + test + build) → `/feature-complete <spec>`
> (review against spec, run gates, then the gated commit/merge/reset). The spec reference is
> passed as `$ARGUMENTS` to each. They are a **partial** port — see the §13 matrix for what
> does and doesn't survive the move from Skill to flat prompt.

#### Step 4b — Higher-fidelity alternative: port as a Codex **skill** (2026-07-04)

Codex now supports skills in the **same `SKILL.md` format Claude uses** (§4), which makes a
much better port target than flat prompts — bundled `references/` survive, and the
`shared-prompts/` ↔ `.claude/skills/feature/` drift shrinks because both tools speak the
same file shape.

1. Create `.codex/skills/<name>/SKILL.md` (with `CODEX_HOME` pinned, `$CODEX_HOME/skills/`
   is `.codex/skills/` — containment holds). Start from the Claude Skill's content, not the
   flat prompts.
2. Adapt the deltas: Claude-specific frontmatter (`allowed-tools`, harness hooks) is
   ignored or unsupported — strip it; tool names referenced in the body (`Grep`, `Agent`,
   Skill-to-Skill calls) need rewording to Codex equivalents; the runtime-bound actions
   (`/code-review`, `/verify`, harness gates) still **cannot** port — same exclusions as
   Step 4.
3. Keep the tracked source of truth in `shared-prompts/` (or a sibling `shared-skills/`)
   and copy into `.codex/skills/`, mirroring the Step 4 `Copy-Item` pattern.
4. **Before adopting:** verify the pinned Codex version actually discovers
   `.codex/skills/` (ask Codex to list skills) — the skills feature is newer than this
   spec's original §10 baseline, and the loader marks the `$CODEX_HOME/skills/` user-scope
   root **deprecated** in favor of `.agents/skills/` (§4). If discovery fails or the
   fallback is removed in a later build, relocate to the repo's `.agents/skills/`
   (already gitignored per Step 0) and update this step.

**Recommendation:** **new** Codex workflows should be authored as skills (4b) from the
start; the three existing flat prompts remain the shipped, known-working baseline and are
kept for backward compatibility — migrate them to a skill only when one next needs real
editing, not as a standalone rewrite task.

#### Prompt discovery & invocation

- **Where they live:** every `*.md` under `.codex/prompts/` is a custom prompt. The filename
  is the command — `feature-load.md` → `/feature-load`, `feature-start.md` → `/feature-start`,
  `feature-complete.md` → `/feature-complete`. (`.codex/prompts/` is gitignored; the tracked
  source of truth is [`shared-prompts/`](../../shared-prompts/), copied in per Step 4.)
- **How to invoke:** inside a `./codex.ps1` session, type `/` to list available prompts, then
  run `/<name> <args>` — e.g. `/feature-load docs/features/my-thing.md`. The text after the
  command name is substituted into the prompt's `$ARGUMENTS` (or `$1`, `$2`, …).
- **These are project-specific prompts, not built-in Codex commands.** `feature-load`,
  `feature-start`, and `feature-complete` exist **only** because they're files in this repo's
  `.codex/prompts/`. They are not part of Codex itself, won't appear in another repo, and
  carry no special engine support — they're plain Markdown instructions. If `/feature-load`
  isn't listed, the files weren't copied into `.codex/prompts/` (re-run the Step 4
  `Copy-Item`).

#### Workflow lifecycle & expected artifacts

The three prompts are designed to run **sequentially as the standard implementation
lifecycle**, mirroring Claude Code's `/feature` loop — one feature spec carried through all
three, in order:

| Step | Prompt | Does | Expected artifact |
| --- | --- | --- | --- |
| 1 | `/feature-load <spec>` | Read spec + architecture, surface ambiguities | **Implementation plan** + updated `current-feature.md` + open questions — **no code** |
| 2 | `/feature-start <spec>` | Branch + implement to the plan, test, build | **Completed code changes** + Vitest tests, green `test:run`/`build`, uncommitted |
| 3 | `/feature-complete <spec>` | Verify vs spec, run gates, gated wrap-up | **Final validation report** (per-requirement checklist) + gated commit/merge/reset |

Run them in that order; each assumes the previous one's output. `/feature-load` **stops for
clarification** if the spec is incomplete or conflicts with the codebase rather than guessing;
`/feature-complete` **checks every spec requirement** and reports each as implemented,
deferred, or unresolved.

### Step 5 — Explicitly don't share subagents / memory
- **Subagents** (`auth-auditor`, `code-scanner`, `refactor-scanner`, `ui-reviewer`,
  `docs-explorer` — all under `.claude/agents/`) stay **Claude-only**. This is now a
  **decision, not a limitation**: Codex *does* have a native loader (TOML agent roles in
  `.codex/agents/`, §4), but we are **not** rebuilding the fleet — the agents lean on
  Claude-specific tools and the maintenance cost of a second fleet isn't justified. If one
  is ever wanted, pilot with a single port (e.g. `auth-auditor` →
  `.codex/agents/auth-auditor.toml`, converting the Markdown body into the role's
  instructions) before committing to more.
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

### Step 6b — Single-source templates + sync script (anti-drift, 2026-07-04)

The two hand-maintained artifacts (the Step-2 preamble and the Step-3/6 `config.toml`) are
exactly where drift happens. Single-source them in a tracked, **secret-free** `codex-setup/`
folder and apply them with a script:

```
codex-setup/                  ← tracked (no secrets, ever)
├─ agents-preamble.md         ← source of the Step-2 Spendly preamble
└─ config.template.toml       ← Step-3 [mcp_servers] + Step-6 sandbox/approval; context7
                                 key via env_http_headers (reads $CONTEXT7_API_KEY)
scripts/
├─ sync-codex.ps1             ← idempotent: (1) re-applies the preamble between the
│                                spendly-codex markers in AGENTS.md (outside the Next.js
│                                block); (2) copies config.template.toml →
│                                .codex/config.toml when missing (-Force to overwrite);
│                                (3) copies shared-prompts/*.md → .codex/prompts/
└─ verify-codex.ps1           ← smoke test (Step 7)
```

npm scripts: `"codex:sync": "powershell -File scripts/sync-codex.ps1"` and
`"verify:codex": "powershell -File scripts/verify-codex.ps1"`.

**Rules:** never hand-edit `.codex/config.toml` or the AGENTS.md preamble — edit the
template and re-run `npm run codex:sync` (the same discipline as the tool-managed Next.js
block). The template stays secret-free by construction because the context7 key is read
from the environment at runtime. If you insist on the inline `http_headers` key form, that
edit lives only in the gitignored `.codex/config.toml` and must be re-applied manually
after any sync `-Force` or reset (§12).

### Step 7 — Verify

**Automated first — `npm run verify:codex`** (`scripts/verify-codex.ps1`, Step 6b) must
pass before the manual checks. It asserts:
1. `codex-setup/` templates + both scripts exist; `git check-ignore` confirms `.codex/`,
   `AGENTS.md`, and `AGENTS.override.md` are ignored.
2. **No `AGENTS.override.md` exists anywhere in the repo** (§7 ban).
3. `AGENTS.md` contains both marker pairs (`nextjs-agent-rules`, `spendly-codex`) **and**
   the literal Neon branch IDs (`br-hidden-bonus-aqksw1pa`, `lucky-hat-53091250`).
4. `.codex/config.toml` exists, parses as TOML, contains `[mcp_servers.neon]` +
   `[mcp_servers.context7]`, and contains **no inline `ctx7sk-` secret**.
5. `.codex/prompts/` holds the three `feature-*.md` prompts, byte-identical to
   `shared-prompts/` (sync is current).
6. **Containment:** snapshot `~/.codex` (or note its absence), run
   `./codex.ps1 --version`, assert `~/.codex` is unchanged/still absent and the reported
   version equals the §10 pin.

The conversational checks stay manual — a script can't interrogate the model:
- `./codex.ps1` in repo root → ask "what are the Neon branch rules?" → must answer
  `development` / `br-hidden-bonus-aqksw1pa` + production prohibition. Else Step 2 failed.
- Confirm **containment:** after a session, `~/.codex` does **not** exist / is untouched;
  all new files are under `.\.codex\`.
- Ask Codex to list MCP tools → neon + context7 (+ playwright) appear. First neon call
  triggers the OAuth browser flow (no API key in config).
- Run a ported `/<name>` prompt → expands correctly.
- Claude Code behavior unchanged (`AGENTS.md` preamble lives outside the managed markers, so
  the Next.js block and `CLAUDE.md` are untouched).

---

## 7. Windows / containment notes
- `CODEX_HOME` set **per launch** by `codex.ps1` — never rely on a global/user env var
  (defeats the purpose and risks leaking to other repos).
- **Never create `AGENTS.override.md` in this repo.** Codex loads it *instead of*
  `AGENTS.md` (first match per directory, §4) — it would silently drop both the
  tool-managed Next.js block and the Step-2 Neon guardrails, this spec's stated worst
  failure mode. It's gitignored preemptively (Step 0) so an accidental one can't be
  committed, but the guardrail loss happens locally regardless — if you find one, delete it
  and fold anything useful into the Step-2 preamble.
- Symlinks need Developer Mode or elevation. Step 2 no longer uses a symlink; only the
  optional Step 4 `shared-prompts/` dedup does — skip it (copy the prompt instead) if
  symlinks are blocked.
- The only secret is the **context7 key**. It is **not** stored in the tracked template;
  both launchers (`codex.ps1` / `codex.sh`) auto-load `KEY=value` lines from a gitignored
  **`.codex.env`** at repo root into the environment before starting Codex, and the
  `env_http_headers` form in `.codex/config.toml` reads `$CONTEXT7_API_KEY` from there — so
  the key is never typed by hand and never committed. `.codex.env.example` is the tracked,
  placeholder-only template (copy it to `.codex.env` and fill in). Both `.codex.env` and
  `.codex/` are gitignored; `git status` should never show either. (neon needs no key — it
  authenticates via a one-time `codex mcp login neon` OAuth flow whose token persists in the
  gitignored `.codex/`.)
- Local binary lives in `node_modules/` — already gitignored, never global.
- **Reset:** if config gets corrupted, delete `.codex/` and re-run `./codex.ps1` (it
  recreates the dir); then `npm run codex:sync` restores config + prompts from the tracked
  templates (Step 6b). See §12 for the full procedure.

---

## 8. Acceptance criteria
- [x] `.codex/` added to `.gitignore` (2026-06-30); nothing under it is tracked.
- [ ] `AGENTS.override.md` + `.agents/` added to `.gitignore` (Step 0); **no**
      `AGENTS.override.md` exists anywhere in the repo.
- [ ] Codex installed as a **local devDependency**, not global; launched via `codex.ps1`.
- [ ] `codex.ps1` creates `.codex/` if missing (CODEX_HOME must pre-exist as a directory).
- [ ] A session creates **zero** files in `~/.codex`.
- [ ] `AGENTS.md` Codex preamble sits **outside** the `nextjs-agent-rules` markers (no symlink).
- [ ] Codex loads the same project rules as Claude (Neon-branch question passes).
- [ ] Neon + context7 MCP usable from Codex.
- [ ] Production-branch prohibition + migrations-not-`db push` present in Codex's context.
- [ ] At least the core workflow prompt available as a Codex slash command.
- [ ] Codex loads prompts from `.codex/prompts/` — a `/<name>` from that folder is listed
      and expands correctly (guards against a broken `CODEX_HOME` or moved prompts dir).
- [ ] The three workflow prompts are installed and **discoverable**: `/feature-load`,
      `/feature-start`, and `/feature-complete` all appear in the `/` list.
- [ ] Each workflow prompt **functions**: `/feature-load <spec>` expands with the spec as
      `$ARGUMENTS` and produces a plan (no code); `/feature-start` / `/feature-complete`
      expand and pick up the same spec reference.
- [ ] _If Step 4b is taken:_ Codex lists the skill(s) from `.codex/skills/` and invoking
      one loads its instructions (discovery verified on the pinned version).
- [ ] `codex-setup/` templates + `scripts/sync-codex.ps1` exist and are tracked;
      `npm run codex:sync` is **idempotent** (a second run produces no diff in
      `AGENTS.md` or `.codex/`).
- [ ] `npm run verify:codex` passes clean (the automated half of this checklist, Step 7).
- [ ] §10 "Verified" slot filled with the exact passing version.
- [ ] Claude Code behavior unchanged; no secrets committed.

---

## 9. Out of scope / open decisions
- Rebuilding the Claude subagent fleet as Codex **agent roles** (`.codex/agents/*.toml`) —
  natively possible as of 2026 (§4), but still out of scope by decision (Step 5); the
  single-agent pilot is the re-entry point if ever needed.
- Porting the `feature` workflow as a Codex **skill** (Step 4b) — documented upgrade path;
  the flat prompts are the shipped baseline until someone takes it.
- Two-way memory sync between Codex and Claude's `MEMORY.md`.
- Committed, team-wide Codex config (current `.gitignore` keeps AI tooling local).
- ~~Canonical instructions approach (inline vs preamble).~~ **Resolved (Step 2):** Codex
  reads a "read these docs" preamble **with the Neon guardrails inlined**, appended to the
  existing tool-managed `AGENTS.md` outside its markers. No symlink (would clobber the
  Next.js block).

---

## 10. Compatibility matrix

Versions this setup targets. These are the known-good baselines to pin against — fill in the
"verified" column once the integration is actually built and a session has run clean.

| Component | Target / known-good | How to check | Notes |
| --- | --- | --- | --- |
| Codex CLI (`@openai/codex`) | **Pin: `0.142.5`** (selected 2026-07-04). **Verified: — (fill in at implementation)** | `./codex.ps1 --version` | Pin the **exact** version in `package.json` `devDependencies` (`npm i -D @openai/codex@0.142.5`, no `^`). At implementation, run the §8 checks — including skill + `[agents.*]` discovery if Step 4b/agent roles are taken — and record the passing version in the "Verified" slot. On any bump: re-run §8 + `npm run verify:codex` and re-check the capability list below. |
| Node.js | 20 LTS (≥ 20.x) | `node -v` | Matches Next 16 / Prisma 7 toolchain; the repo has no `engines` pin, so keep dev boxes on 20 LTS. |
| npm | ≥ 10 (ships with Node 20) | `npm -v` | Used for the local `-D` install + `npx`. |
| Windows | 10 (build 19045) and up | — | Symlinks (optional Step 4 dedup) need Developer Mode or elevation. |
| PowerShell | Windows PowerShell 5.1 | `$PSVersionTable.PSVersion` | `codex.ps1` uses only 5.1-safe syntax. PowerShell 7+ also works. |

> When you bump any row, re-run the §8 acceptance checks before trusting the new version.

### Minimum required Codex capabilities

A version number alone doesn't capture what this setup depends on. Any pinned build must
support **all** of the following — check each when bumping the pin (they are the
engine-side prerequisites behind the §8 checks):

| Capability | Required for | Availability |
| --- | --- | --- |
| `CODEX_HOME` env override (dir must pre-exist) | Containment (Steps 1–2) | Long-standing |
| `AGENTS.md` root + nested discovery | Instructions (Step 2) | Long-standing |
| Custom prompts in `$CODEX_HOME/prompts/` (`$ARGUMENTS` / `$1`) | Step 4 | ≥ `0.75.0` |
| **HTTP** `[mcp_servers]` (`url` + `http_headers` / `env_http_headers` / `bearer_token_env_var`; `env` rejected) | Step 3 — neon + context7 are HTTP | ≥ `0.75.0` |
| stdio `[mcp_servers]` (`command` / `args` / `env`) | Step 3 — playwright | Long-standing |
| Skills from `.codex/skills/<name>/SKILL.md` (project-scope root; the `$CODEX_HOME` user-scope root is **deprecated** — §4) | Step 4b (optional) | 2026 builds — **verify on the pin** |
| Agent roles (`$CODEX_HOME/agents/*.toml` + `[agents.*]`) | Step 5 pilot (optional) | 2026 builds — **verify on the pin** |
| `AGENTS.override.md` first-match shadow | §7 ban (behavioral awareness only) | 2026 builds |

---

## 11. Maintenance — keeping in sync as the tools evolve

Codex and Claude Code both move fast; their config/instruction formats drift. Revisit this
spec when any of the following change, and update the named artifact:

| If this changes… | Update | Watch for |
| --- | --- | --- |
| Claude project rules (`CLAUDE.md` / `docs/*.md`, esp. **Neon branch IDs**) | `codex-setup/agents-preamble.md`, then `npm run codex:sync` (Steps 2 + 6b) | The Neon rules are still **duplicated** (they don't auto-sync from `CLAUDE.md`) — but now into one tracked template, not a hand-edited `AGENTS.md`. Stale branch IDs = the worst failure mode. |
| `.mcp.json` (server URLs, the context7 key, a new server) | `codex-setup/config.template.toml`, then `npm run codex:sync -- -Force` (Steps 3 + 6b) | stdio↔HTTP transport differences; `env` is forbidden for HTTP; never put the key inline in the template. |
| Claude Skills under `.claude/skills/` (esp. `feature`) | The Codex port — `.codex/skills/` copy (Step 4b) or `.codex/prompts/*.md` (Step 4) | Same `SKILL.md` format now, but Claude-specific frontmatter/tool names don't auto-translate; multi-action sub-files still don't flatten 1:1 into prompts. |
| Claude agents under `.claude/agents/` | The matching `.codex/agents/*.toml` — **only if** a role was ported (Step 5 pilot) | MD+YAML ↔ TOML; role prompt transfers, wrapper + execution model differ. No sync needed while the fleet stays Claude-only. |
| Codex `config.toml` schema / `AGENTS.md` semantics / prompt-arg syntax / skill + agent-role discovery paths | Steps 2–4 + §4 fundamentals | Verify against current Codex docs (context7 `/openai/codex`) before editing — don't trust memory. Skill roots and `AGENTS.override.md` behavior are newer surfaces that may still move. |
| Codex or Node version (see §10) | §10 matrix + the `package.json` pin | Re-run §8 acceptance after any bump. |

**Cadence:** a 5-minute pass whenever you touch the Neon rules or `.mcp.json`, and a quick
docs check (`/openai/codex` via context7) before any Codex version bump. The managed
`nextjs-agent-rules` block in `AGENTS.md` is regenerated by tooling — never hand-edit inside
its markers; only the appended Spendly preamble is yours to maintain.

---

## 12. Recovery / reset

If `.codex/` gets corrupted (bad `config.toml`, broken auth/session cache, MCP won't load),
reset the local environment — it's fully disposable:

```powershell
# from repo root
Remove-Item -Recurse -Force .\.codex      # nuke all Codex state (config + sessions + cache)
.\codex.ps1                                # recreates .codex/ (empty) on launch
```

Then restore the pieces — **`.codex/config.toml` is not recreated by hand; it is restored
from the tracked template**:
1. Run `npm run codex:sync` (Step 6b) — recreates `.codex/config.toml` from
   `codex-setup/config.template.toml`, re-copies `shared-prompts/*.md` into
   `.codex/prompts/`, and re-applies the AGENTS.md preamble if missing. (Manual recreation
   per Steps 3/4/6 is the fallback only if the Step-6b templates were never adopted.)
2. Re-apply local-only extras the template deliberately doesn't carry: an inline
   `http_headers` context7 key (only if you use that form instead of the env var), and —
   if adopted — `.codex/skills/<name>/SKILL.md` (Step 4b) and `.codex/agents/*.toml` +
   `[agents.<role>]` blocks (Step 5 pilot) from their tracked sources. Anything authored
   only inside the gitignored `.codex/` is gone — keep sources tracked.
3. Re-auth neon MCP (browser OAuth on first neon call).
4. Re-run `npm run verify:codex`, then the manual §8 checks.

Because everything lives under the gitignored `.codex/`, this never touches `~/.codex`,
`CLAUDE.md`, `AGENTS.md`, or the repo's tracked files. With the Step-6b template in place
no out-of-repo backup is needed — the only state worth backing up personally is a
local-only deviation from the template (e.g. an inline key).

---

## 13. Claude Code feature compatibility

Which Claude Code capabilities have a usable Codex equivalent, and which don't. "Partial"
means the *intent* is reproducible but the mechanism/fidelity differs; "Not supported" means
Codex has no equivalent and the capability is simply unavailable.

| Claude Code feature | Codex equivalent | Status | Notes |
| --- | --- | --- | --- |
| Skills (`.claude/skills/*`) | Codex skills (`.codex/skills/<name>/SKILL.md`, Step 4b) or custom prompts (`.codex/prompts/*.md`, Step 4) | **Supported (format)** | Same `SKILL.md` standard — frontmatter + bundled `references/`/`scripts/` survive. Claude-specific frontmatter (`allowed-tools`) and harness hooks do not. |
| `/feature load` | [`feature-load`](../../shared-prompts/feature-load.md) prompt (or a 4b skill) | **Partial** | Reproduces plan-before-code; relies on the prompt body to pull project context (no Skill auto-loading). |
| `/feature start` | [`feature-start`](../../shared-prompts/feature-start.md) prompt (or a 4b skill) | **Partial** | Implements + tests + builds; spec passed as `$ARGUMENTS`. |
| `/feature complete` | [`feature-complete`](../../shared-prompts/feature-complete.md) prompt (or a 4b skill) | **Partial** | Review + gated commit/merge/reset; no harness-enforced gates. |
| Subagents (`.claude/agents/*` + `Agent` tool) | Agent roles (`.codex/agents/<name>.toml` + `[agents.*]` in `config.toml`) | **Supported (not ported)** | Native loader exists as of 2026; our fleet stays Claude-only by decision (Step 5). MD+YAML ↔ TOML conversion needed per agent. |
| Persistent auto-memory (`MEMORY.md` + `memory/`) | _none_ | **Not supported** | No cross-session memory store. Durable facts must go into `AGENTS.md` (Step 2). |
| Skill composition / multi-action workflows | Manual prompt/skill chaining | **Partial** | The user runs `feature-load` → `feature-start` → `feature-complete` by hand; no single orchestrating Skill. |
| Hooks (`settings.json`) | `notify` + limited | **Partial** | Codex exposes only narrow lifecycle hooks; pre/post-tool gating isn't reproducible. |
| `allowed-tools` restrictions (per-prompt) | _none_ | **Not supported** | Tool access is governed globally by `approval_policy` / `sandbox_mode`, not per prompt. |
| `CLAUDE.local.md` personal override | `AGENTS.override.md` | **Supported (banned here)** | Semantics differ: Claude's local file *adds to* `CLAUDE.md`; Codex's override **replaces** `AGENTS.md` for that directory — which is why it's banned in this repo (§7). |

**Read this as:** the gap has narrowed. Skills now share at the format level and subagents
have a native Codex counterpart — what stays Claude-only is by **decision** (the agent fleet,
Step 5) or genuine absence (persistent memory, per-prompt tool scoping, harness-enforced
gates). The shipped flat-prompt chain remains the baseline; Step 4b is the upgrade path.
