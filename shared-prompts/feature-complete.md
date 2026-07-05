# feature-complete

Tracked source for the Codex `/feature-complete` prompt. Copy or symlink into
`.codex/prompts/feature-complete.md` (see `docs/features/codex-integration-spec.md` Step 4).
Step 3 of: **feature-load → feature-start → feature-complete**.

---

You are doing the final review and wrap-up after the feature is implemented.

**Input (`$ARGUMENTS`):** the spec reference (filename, path, or inline description) — the
same one used for `/feature-load` / `/feature-start`. Read it again as the source of truth.

## Part A — Review (always)

1. **Verify against the original specification.** Walk every goal / acceptance criterion in
   `$ARGUMENTS` (the original spec) and `docs/current-feature.md`, and confirm each is
   actually met by the code. Produce an explicit per-item status — **done**,
   **incomplete**, **intentionally deferred**, or **omitted** — and for anything not
   "done", state why (cross-check the deviation notes `/feature-start` recorded in
   `## Notes`). Nothing in the spec should be silently dropped.
2. **Edge cases.** Check the boundaries the spec implies (empty/zero, archived/soft-deleted,
   ownership/`userId` scoping, currency = EUR, mixed/transfer rows, rate limits, fail-open
   paths) and confirm they're handled.
3. **Conventions & security.** Confirm Server Actions are auth-guarded and `userId`-scoped,
   Zod-validated, `server-only` on DB fetchers, no magic values, no `any`, kebab-case files,
   and the Neon guardrails were respected (no production access, no `db push`).
4. **Run the gates:** `npm run test:run`, `npm run build`, `npm run lint`. Report results
   honestly — if anything fails, fix it (or list it) rather than glossing over it.
5. **Summarise:** the per-item spec scorecard from step 1 (done / incomplete / deferred /
   omitted), any known limitations, and follow-up items worth a separate spec/branch. Make
   deferred and omitted items explicit — never imply full coverage when scope was cut.

If review surfaces real problems, fix them (or report and stop) **before** Part B.

## Part B — Wrap-up (only after the user approves the commit)

Mirrors Claude Code's `/feature complete`. Ask before committing; never add agent attribution
to commit messages.

1. Stage all changes and commit with a Conventional Commit message (`feat:` / `fix:` /
   `chore:` …) describing the feature.
2. Switch to `main` and merge the feature branch (no push yet).
3. Delete the local feature branch.
4. Reset `docs/current-feature.md`: H1 back to `# Current Feature`, clear Goals/Notes (keep
   placeholder comments), and append a feature summary to the **end** of `## History`.
5. Commit the reset: `chore: reset current-feature.md after completing <feature>`.
6. Push `main` to origin **once** (a single push with all changes).
7. If the feature branch was previously pushed, delete it from origin.

**Expected output:** a final validation report — a concise checklist mapping **every**
requirement in the original spec to one of **implemented**, **deferred** (intentionally, with
reason), or **unresolved** (incomplete/omitted/needs follow-up) — plus the gate results
(`test:run` / `build` / `lint`) and a short completed-work summary. Confirm no spec
requirement is missing from the checklist. Part B (commit/merge/reset) runs only after the
user approves.

**Lifecycle:** step 3 of 3 (`/feature-load` → `/feature-start` → **`/feature-complete`**).
