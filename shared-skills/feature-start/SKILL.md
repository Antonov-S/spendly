---
name: feature-start
description: Step 2 of the Spendly feature workflow. Branch and implement a loaded feature spec following project conventions, add Vitest tests for new actions/lib, and run test:run + build until green. Leaves everything UNCOMMITTED. Run after feature-load, before feature-complete. Invoke as $feature-start followed by the spec reference (a filename under docs/features/ or docs/fixes/, a path, or inline prose).
metadata:
  short-description: Implement + test a feature (uncommitted)
---

<!-- Tracked source: shared-skills/feature-start/SKILL.md — synced into .codex/skills/ by scripts/sync-codex.ps1. Edit here, not in .codex/. -->

You are implementing the feature described in the specification. The spec is **always**
provided as input.

**Input:** the spec reference given in your invocation (the text after `$feature-start`) — a
filename under `docs/features/` or `docs/fixes/`, a path, or inline description. Read it before
writing code. If `$feature-load` already populated `docs/current-feature.md`, use its
Goals/Notes as the contract; if Goals are empty, derive them from your invocation argument first.

## Do this

1. **Re-read the contract:** the spec from your invocation argument, `docs/current-feature.md`,
   and `AGENTS.md` (Neon guardrails: development branch only, never production, migrations via
   `prisma migrate dev` — never `db push`).

   **Follow the specification as written.** Implement exactly what it describes — do not add,
   drop, or reinterpret scope. Deviate **only** when the spec is ambiguous, internally
   contradictory, or conflicts with the codebase/`AGENTS.md`/coding standards. When that
   happens: prefer pausing to ask the user; if you must proceed, pick the smallest reasonable
   resolution and **record the deviation and its rationale** in the `## Notes` section of
   `docs/current-feature.md` so `$feature-complete` can audit it.
2. **Set up the branch.** Set `## Status` to `In Progress` in `docs/current-feature.md`, then
   create and checkout a branch named `feature/<name>` (or `fix/<name>` for fixes), derived
   from the feature name.
3. **Implement the goals one by one**, following the project's conventions:
   - architecture: reads through `src/lib/db/*` (`server-only`), mutations through
     `"use server"` actions in `src/actions/*` returning `{ success, data?, error? }`,
     auth-guarded and `userId`-scoped; validate input with Zod
   - `docs/coding-standards.md`: TypeScript strict (no `any`), server components by default,
     Tailwind v4 CSS-config (no `tailwind.config.*`), constants in `src/lib/constants.ts` /
     `src/lib/system-constants.ts` (no magic values), kebab-case filenames
   - reuse existing helpers, types, and patterns from neighbouring code rather than inventing
     parallel ones
   - if the schema changes, create a Prisma migration (`prisma migrate dev`) against the
     development branch — never `db push`
4. **Add tests.** Vitest coverage for any new/changed `src/actions/**` and `src/lib/**`
   (validation, branching, error paths, the caller contract). Components are out of scope.
   Tests live under `test/` mirroring `src/`, mock `@/lib/prisma` and other I/O — never hit a
   real database or external service.
5. **Verify.** Run `npm run test:run` and `npm run build`; fix every failure before
   continuing. Run `npm run lint` and clear warnings you introduced.
6. **Iterate** until the goals are met and the checks are green.
7. **Stop before committing.** Do **not** commit — summarise what you implemented and what
   remains, and hand off to `$feature-complete`. (Committing is gated on explicit user
   approval per `docs/ai-interaction.md`.)

**Expected output:** the completed code changes implementing the goals, Vitest tests for new
`src/actions/**` / `src/lib/**`, green `npm run test:run` + `npm run build`, any deviation
notes recorded in `## Notes` — all **uncommitted** on the feature branch.

**Lifecycle:** step 2 of 3 (`$feature-load` → **`$feature-start`** → `$feature-complete`).
