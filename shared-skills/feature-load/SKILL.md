---
name: feature-load
description: Step 1 of the Spendly feature workflow. Load and analyse a feature specification, study the architecture, raise ambiguities, and produce an implementation plan, updating docs/current-feature.md. Writes NO code. Run before feature-start. Invoke as $feature-load followed by a spec reference (a filename under docs/features/ or docs/fixes/, a path, or inline prose).
metadata:
  short-description: Load a feature spec and plan (no code)
---

<!-- Tracked source: shared-skills/feature-load/SKILL.md — synced into .codex/skills/ by scripts/sync-codex.ps1. Edit here, not in .codex/. -->

You are loading and analysing a feature specification before any code is written. **Do not
implement anything in this step** — the goal is understanding and a plan.

**Input:** the spec reference given in your invocation (the text after `$feature-load`). It may be:
- a filename → look for `docs/features/<name>.md` or `docs/fixes/<name>.md`
- a path → read it directly
- inline prose → treat it as the feature description
- empty → stop and ask the user for a spec file or description

## Do this

1. **Load project context.** Read `AGENTS.md` and `docs/project-overview.md`,
   `docs/coding-standards.md`, `docs/ai-interaction.md`, `docs/current-feature.md`.
   Honour the Neon guardrails in `AGENTS.md` (development branch only, never production,
   `prisma migrate dev` not `db push`).
2. **Read the spec** identified from your invocation argument in full.
3. **Study the architecture** relevant to the spec before planning:
   - `docs/entity-crud-architecture.md` (reads via `src/lib/db/*`, mutations via
     `src/actions/*`, Server Actions over REST)
   - `prisma/schema.prisma` for the data model
   - existing siblings in `src/actions/`, `src/lib/`, `src/components/`, `src/types/`,
     `src/lib/validations/` to match patterns
4. **Identify dependencies & blast radius:** which files/modules you'll add or touch, which
   existing helpers/constants to reuse, whether a Prisma migration is required, and which
   surfaces need revalidation.
5. **Raise ambiguities — and stop if the spec is incomplete or conflicts.** List anything
   underspecified, contradictory, or risky as explicit questions. If the spec is missing
   information you need, or it conflicts with the existing codebase / `AGENTS.md` / coding
   standards, **do not assume or paper over the gap** — surface the specific issue and stop
   for clarification before producing a final plan. Only proceed to a complete plan once the
   spec is unambiguous and consistent with the repo.
6. **Produce an implementation plan:** ordered steps, the test surface (which
   `src/actions/**` / `src/lib/**` get Vitest coverage — components are out of scope), and
   any docs to update.
7. **Update `docs/current-feature.md`:**
   - set the H1 to `# Current Feature: <name>`
   - write success criteria as bullets under `## Goals`
   - capture spec context, decisions, and open questions under `## Notes`
   - set `## Status` to `Not Started`
8. **Confirm** the spec is loaded and print a concise feature summary + the plan + any open
   questions. Wait for the user before running `$feature-start`.

**Expected output:** an implementation plan (ordered steps + test surface + docs to touch),
an updated `docs/current-feature.md` (Goals/Notes/Status), and a list of open questions —
**no code changes**. If blocked by an incomplete/conflicting spec, the output is the blocking
questions instead of a plan.

**Lifecycle:** this is step 1 of 3 — run `$feature-start` next, then `$feature-complete`.
