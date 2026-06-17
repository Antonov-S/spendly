# Documentation

Canonical, committed home for all durable Spendly documentation.

## Where docs live (and why duplicates happen)

There are two doc trees. They are split by **purpose**, not by stage, and **no document may live in
both**:

| Tree | Tracked by git? | Holds | Edit here? |
|---|---|---|---|
| `docs/` | ✅ committed | **All durable docs**: the project brief (`project-overview.md`), standards (`coding-standards.md`, `ai-interaction.md`), the working changelog (`current-feature.md`), plus feature/fix specs, research, architecture, roadmap, entity reference | ✅ canonical |
| `context/` | ❌ git-ignored (`.gitignore`) | Local-only **scratch**: `context/research/` prompts (throwaway skill inputs), `context/screenshots/`, the `context/new project setup/` starter template | never durable docs |

> **History note.** `project-overview.md`, `coding-standards.md`, `ai-interaction.md`, and
> `current-feature.md` used to live in the git-ignored `context/` tree. They moved into `docs/` so
> there is a single committed source of truth. `CLAUDE.md` now imports them via `@docs/…`.

### The one rule

> **A document has exactly one home.** If it's worth keeping, it lives **only** in `docs/`. The
> git-ignored `context/` tree must never hold a second copy of anything that belongs in `docs/`.

The drift this prevents: copying a finished doc from `context/` into `docs/` and leaving the
original behind. Because `context/` is git-ignored, that stale copy is **invisible to `git status`**
and silently rots out of sync. (This is exactly how `entity-types.md`, `entity-crud-architecture.md`,
and several specs ended up with divergent copies.)

## Layout

```
docs/
  ROADMAP.md
  entity-types.md                 ← canonical entity field reference
  entity-crud-architecture.md     ← canonical read/mutation contract
  features/                       ← one *-spec.md per feature slice
  fixes/                          ← one *-spec.md per fix
  research/                       ← research deliverables (committed output)
```

## How the skills use these trees

- **`/feature load <name>`** reads the spec from `docs/features/<name>.md` or `docs/fixes/<name>.md`
  — author specs directly in `docs/`, committed from the start. The workflow tracks current state in
  `docs/current-feature.md` (committed, so the `complete.md` "commit the reset" step is real).
- **`/research <name>`** reads a throwaway prompt from `context/research/<name>.md` (local input)
  and writes the **deliverable to `docs/`** (e.g. `docs/research/`). The prompt is scratch; the
  output is committed.

## Guard

`npm run docs:check` fails if any `.md` basename exists in both `docs/` and `context/`. Run it before
committing (and consider wiring it into a pre-commit hook). It ignores the self-contained
`context/new project setup/` starter template.
