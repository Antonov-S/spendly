# Data Portability Hardening — Implementation Spec

> Close the two known **JSON export → import round-trip gaps** so a user's own
> backup can be restored without silent data loss: **(1) split transactions** — a
> `schemaVersion: 2` re-import currently flattens a split back to Uncategorized
> (the documented top post-release follow-up from Split Transactions §17) — and
> **(2) transaction tags** — a round-trip currently loses every tag association
> (the deliberate deferral from Transaction Tags §16). Plus **(3)** a golden
> **round-trip fixture test** that proves the property and keeps it proven. No
> schema change, no migration, no new route, no Pro gate — this is the first real
> code slice of §20 Launch Readiness.

> **✅ Shipped (`feature/data-portability-hardening`, 2026-07-09).** JSON export is now
> `schemaVersion: 3` with split category names, per-transaction tag names, and a top-level
> tag registry. JSON import restores split lines and transaction tag joins for rows it creates,
> including same-user v2 split backups via owned/system category-id fallback. Invalid split
> payloads degrade visibly to flat rows with `split` preview issues; skipped duplicates are
> still not retro-repaired. Final gates passed: `npm.cmd run test:run` (1094 tests),
> `npm.cmd run build`, and `npm.cmd run lint` (0 errors; 16 pre-existing warnings).
> The §12 real-browser v2 smoke was waived at completion; unit and round-trip coverage lock
> the fallback behavior.

Authoritative sources: `docs/POST-MVP-ROADMAP.md` §20 item 2;
`docs/features/data-export-spec.md` (envelope, `schemaVersion` from day one, C1/C2
scoping, D1–D9); `docs/features/data-import-spec.md` (pipeline, D1–D9, S1–S6);
`docs/features/split-transactions-spec.md` §12 ("Deferred round-trip — treat split
import as the top post-release follow-up");
`docs/features/transaction-tags-spec.md` §12 ("Export/import intentionally omit
tags in this release" + the follow-up sketch: "a `tags` array on the export
envelope + read-on-import, `schemaVersion` bump").

This is a **superset** of the shipped export + import slices: every existing rule
(row-level ownership, tier-agnostic / no `isPro` read, per-user rate limit,
count-based dedup, atomic write, tolerant-partial row handling, one target
account, transfers skipped) still holds. This slice only widens **what one JSON
transaction row carries** — split lines and tag names — end to end.

---

## 1. Goal

After this slice, the following property holds and is enforced by a fixture test:

> **A Spendly JSON export, re-imported by the same user into a fresh (or
> otherwise non-duplicate) target account, loses no split attribution and no tag
> associations on any row the import creates.** Split parents arrive split (same
> lines, same per-line categories and notes); tagged transactions arrive with the
> same tags (tags created on the fly if missing, with their exported color).
> The "rows actually created" framing is deliberate: the unchanged dedup key
> (D5) means rows skipped as duplicates — e.g. remnants of an earlier flattened
> import — are **not** retro-repaired; import creates rows, it never mutates
> existing ones.

Concretely, three deliverables:

1. **Split round-trip.** JSON export gains the split line's **category name**
   (today it exports only `categoryId`, which the name-based import pipeline
   cannot resolve); JSON import reads the `splits` array, validates it against
   the same invariants as the drawer (EXPENSE-only, positive magnitudes, sum to
   the parent to the cent, line caps), resolves each line's category, and writes
   the `TransactionSplit` child rows. **v2 files are repaired too** — see D2.
2. **Tag round-trip.** JSON export gains per-transaction `tags` (name array) and
   a top-level `data.tags` registry (`id`, `name`, `color`, `createdAt`) so tag
   colors survive; JSON import reads the names, resolves them against the user's
   tags case-insensitively, creates missing ones (registry color when the file
   carries it), and writes the `TransactionTag` join rows.
3. **Round-trip fixture.** A test that pushes a representative export envelope
   (split + tagged + plain + transfer + uncategorized rows) through the real
   import pipeline and asserts the write payload preserves everything the
   envelope carried. This is the regression lock §20 asks for ("proving
   important user data is not silently lost").

### Non-goals (explicit)

- **CSV stays untouched, both directions.** CSV remains the flat interchange
  format (a split is one `Split`-labelled row; no tag column). JSON is the
  lossless format — that division of labor is already documented in the export
  spec and stays. Adding a CSV `Tags` column would change the shipped ledger
  contract for every consumer; not worth it for a migration format (see §11 open
  decisions if demand appears).
- **No repair of already-imported rows.** Dedup identity is unchanged (D5), so
  re-importing a file over a *previous v1/v2 import* skips the flattened rows as
  duplicates rather than upgrading them in place. Documented honestly in D5 —
  in-place repair is a mutation of existing ledger rows, which import must never
  do.
- **No import of accounts / budgets / goals / recurring templates.** Import
  still reads only `data.transactions` (+ the new `data.tags` registry as a
  lookup). Whole-app restore is a different, larger feature.
- **No transfer import.** Unchanged (D1 of the import spec) — and transfers
  carry no tags or splits anyway, so nothing new is lost by skipping them.
- **No Pro gate, no new rate limit, no schema change, no migration.** All the
  models involved (`TransactionSplit`, `Tag`, `TransactionTag`) already exist.

---

## 2. What already exists (reuse, don't rebuild)

| Asset | Location | Use |
|---|---|---|
| Versioned envelope + `EXPORT_JSON_SCHEMA_VERSION = 2` | `src/lib/export/json.ts`, `src/lib/system-constants.ts` | Bump to `3`; the envelope was built for exactly this (export spec §6.2) |
| `getTransactionsForExport` (already selects `splits`) | `src/lib/db/export.ts` | Extend the `splits` select with the category **name**; add a `tags` select |
| `getFullExport` | `src/lib/db/export.ts` | Add the `data.tags` registry query (user-owned only — every tag is user-owned) |
| `ExportTransactionRow` / `ExportSplit` / `FullExport` | `src/types/export.ts` | Widen (additive fields only) |
| `parseImportEnvelope` (accepts versions `1..CURRENT`) | `src/lib/import/json.ts` | Accepts `1..3` after the bump; carry `splits`/`tags` through instead of dropping them |
| `normalizeJsonRow` / `NormalizedImportRow` | `src/lib/import/parse.ts`, `src/types/import.ts` | Extend with defensively-coerced `splits` + `tags` (CSV rows always get `[]`) |
| Category resolution (`buildCategoryIndex`, `resolveCategory`, `normalizeCatKey`) | `src/lib/import/resolve.ts` | Reuse for split-line categories; mirror the pattern for tags |
| `normalizeLabelKey` (trim→collapse→NFC→lower) | `src/lib/text.ts` | The tag-name match key (same normalizer family the tag CI-unique index assumes) |
| Split invariants (EXPENSE-only, ≥2 lines, sum-to-cent, caps) | `src/lib/validations/transaction.ts` (`superRefine`), `SPLIT_MIN_LINES`/`SPLIT_MAX_LINES`/`SPLIT_NOTE_MAX` | Mirror the *same rules* in the import pipeline's split gate (§5.2) |
| Tag caps + write conventions | `TAG_NAME_MAX`, `TAG_MAX_PER_TRANSACTION`; `createTransaction`'s all-or-nothing owned-tag check + `createMany` join write | Mirror semantics; import creates joins inside its own atomic write |
| `round2` | `src/lib/money.ts` | The one cent-rounding helper (sum check + stored amounts) |
| Atomic commit (`$transaction`, categories→transactions) | `src/actions/import.ts` `commitImport` | Extend the same transaction with tag creation + child-row writes (§6) |
| Count-based dedup (`dedupKey`, `partitionForWrite`) | `src/lib/import/dedup.ts` | **Unchanged** (D5) |
| Rate limit | `RATE_LIMITS.import` | Reuse — no new entry |
| Preview / issues UI | `src/components/import/*` | Small additions: split/tag counts + a new issue kind (§7) |

---

## 3. Format — `schemaVersion: 3` (D1)

Additive only; a v3 file is a strict superset of v2. `EXPORT_JSON_SCHEMA_VERSION`
`2 → 3`; import accepts `1..3` (the existing range check already generalizes —
only the constant moves).

### 3.1 Per-transaction additions

```jsonc
{
  // ...existing v2 fields unchanged...
  "isSplit": true,
  "splits": [
    // v2 shape + the new `category` name — the round-trip key (D2)
    { "categoryId": "clx…", "category": "Groceries", "amount": 55, "note": null },
    { "categoryId": "clx…", "category": "Household", "amount": 25, "note": "cleaning" }
  ],
  // NEW: tag names, sorted ascending (matches the feed's name-sorted include)
  "tags": ["reimbursable", "vacation-2026"]
}
```

- `splits[].category` — the split line's category **name** at export time, or
  `null` when the line is uncategorized (its category was deleted → SetNull).
  `categoryId` is kept for same-user id-fallback resolution (D2) and debugging.
- `tags` — names only on the row. `[]` for untagged rows and always `[]` for
  transfer legs (transfers carry no tags by the §16 contract).

### 3.2 Top-level addition — the tag registry

```jsonc
"data": {
  // ...accounts, categories, budgets, goals, recurringTemplates, transactions...
  "tags": [
    { "id": "clt…", "name": "reimbursable", "color": "#378ADD", "createdAt": "…" },
    { "id": "clt…", "name": "vacation-2026", "color": null, "createdAt": "…" }
  ]
}
```

Classification: `tag` is **global** in `EXPORT_ENTITY_CLASS` terms (like
categories — a label registry is not account-bound; add the row to the map, which
is mandatory before any new entity may be exported). Every tag is user-owned (no
system tier), so no `isSystem` filter is needed.

Import uses the registry only as a **color lookup** when creating a missing tag;
association truth lives on each row's `tags` array. A v3 file with rows-with-tags
but a missing/foreign registry still imports (tags created colorless) — lenient
shape, per T3.

---

## 4. Export changes

All in `src/lib/db/export.ts` + `src/types/export.ts`; CSV helpers untouched.

- `getTransactionsForExport`: extend the existing `splits` select with
  `category: { select: { name: true } }`; add
  `tags: { select: { tag: { select: { name: true } } }, orderBy: { tag: { name: "asc" } } }`;
  map to `splits[].category` and `tags: string[]`. Still one query; no N+1.
- `getFullExport`: add a `prisma.tag.findMany({ where: { userId }, orderBy: { name: "asc" }, select: { id, name, color, createdAt } })`
  to the existing `Promise.all`; map to `FullExport.tags`.
- Types: `ExportSplit` gains `category: string | null`; `ExportTransactionRow`
  gains `tags: string[]`; new `ExportTag`; `FullExport` gains `tags: ExportTag[]`.
- `EXPORT_ENTITY_CLASS` gains `tag: "global"`.
- Constant: `EXPORT_JSON_SCHEMA_VERSION = 3`.

CSV export reads only the columns it knows — it compiles and behaves identically
with the widened row type (assert in tests that the CSV snapshot is unchanged).

---

## 5. Import pipeline changes

### 5.1 Envelope + normalization

- `parseImportEnvelope` (`src/lib/import/json.ts`): the lenient `txSchema` gains
  `splits: z.unknown().optional()` and `tags: z.unknown().optional()` (Zod 4:
  optional, or a malformed row structurally rejects the file — the shipped §15
  lesson). Surface `data.tags` (defensively coerced registry — string names;
  colors kept only when they pass the tag hex rule, else `null`, §5.4) alongside
  the rows so the action can build the color lookup. Version range check: `1..EXPORT_JSON_SCHEMA_VERSION`
  (already written against the constant — no logic change).
- `normalizeJsonRow` (`src/lib/import/parse.ts`): defensively coerce
  - `splits` → `{ category: string | null, categoryId: string | null, amount: number, note: string | null }[]`
    — non-array/malformed **entry** drops that entry; each note runs the D9 text
    pass against `SPLIT_NOTE_MAX`; amounts must be finite numbers > 0 (else the
    entry is dropped). *Whether the surviving set constitutes a valid split is
    decided later, per row, by the split gate (§5.2) — normalization never
    rejects the row.*
  - `tags` → `string[]` — non-string entries dropped; each name trimmed;
    empty/over-`TAG_NAME_MAX` names dropped (mirror of the D9 category rule:
    never a truncated label); de-duplicated case-insensitively within the row;
    clamped to `TAG_MAX_PER_TRANSACTION` (first N kept, name order as given).
- `normalizeCsvRow`: emits `splits: []` and `tags: []` — CSV has no such concept
  and the downstream pipeline stays format-agnostic.
- `NormalizedImportRow` gains `splits` + `tags` (always present, possibly empty).

### 5.2 The split gate (mirrors the drawer's invariants — D3)

A row's normalized `splits` are **accepted as a split** only if *all* hold,
mirroring `createTransactionSchema`'s `superRefine`:

- row `type === "EXPENSE"` (and not a transfer — transfers are already skipped);
- `SPLIT_MIN_LINES ≤ lines ≤ SPLIT_MAX_LINES`;
- every `round2(amount) > 0`;
- `round2(Σ line amounts) === round2(row magnitude)` — sum-to-parent to the cent.

**Failure degrades, never rejects (D3):** an invalid split set imports the row
**unsplit** (flat, category per the row's own `categoryText`) and emits a preview
issue (`kind: "split"`, e.g. *"Split ignored — lines don't add up to the
amount."*). The parent amount is the single source of truth for balances (§17's
core rule), so degrading loses attribution only — exactly what v2 does today,
but now *visible* instead of silent.

### 5.3 Split-line category resolution (D2 — the v2 repair)

Per accepted split line, resolve the category in this order:

1. **Name match** (`category`, v3 files): against the existing
   `buildCategoryIndex` (system + own, case-insensitive) → the matched id.
2. **Id fallback** (`categoryId` — the safety net): when the name is absent
   (v2 files) **or present but unmatched** (renamed category, hand-edited
   backup), accept the id if it exists in the user's owned + system category
   set (the same ownership universe `buildCategoryIndex` is built from —
   extend `getImportTargets` to also return ids, or index by id alongside
   name). A foreign/unknown id resolves onward, never errors — ownership-safe.
   The id check deliberately runs **before** the name-create policy: for a
   category renamed since export, the id still points at the right row, and
   creating a fresh category under the stale exported name would be worse.
3. **Name policy** (nothing matched by name or id): the unmatched name runs the
   user's chosen `categoryResolution` policy via `resolveCategory` —
   to-be-created name (CREATE) or `null` (UNCATEGORIZED).
4. Nothing at all → `null` (an uncategorized split line is valid; the model
   allows it).

This step is why the roadmap's "a schemaVersion: 2 JSON re-import currently
flattens a split to Uncategorized" is *fixed* and not merely *versioned away*:
the overwhelmingly common restore case is the same user re-importing their own
backup, where v2's raw `categoryId`s still resolve.

### 5.4 Tag resolution (D4)

- Build a tag index once per run: `getImportTargets` extended to also return the
  user's tags (`id`, `name`), indexed by `normalizeLabelKey(name)`.
- Per row tag name: matched → existing tag id; unmatched → **create** (there is
  no "skip" policy knob — tags are lightweight, user-owned labels with no system
  tier and no Uncategorized fallback; a tag the file names is a tag the user
  had). Creation color comes from the file's `data.tags` registry entry matched
  by the same key, else `null`. **Registry colors are validated before use**: a
  color must match the same rule the tag actions enforce
  (`/^#[0-9A-Fa-f]{6}$/` in `src/lib/validations/tag.ts`); anything else —
  wrong shape, wrong type, hand-edited junk — degrades to `null` (a neutral
  chip), never rejects the tag, the row, or the file. The check lives in the
  registry coercion (§5.1's `data.tags` pass) so unvalidated color text can
  never reach the `tag.createMany` payload.
- New tag names are collected once per run (first-seen casing wins, mirroring
  `newNameByKey` for categories) and created via `createMany({ skipDuplicates })`
  + re-query inside the commit transaction — the same race-safe pattern the
  category write uses, and P2002-proof against the `(lower(name), userId)`
  functional index.

### 5.5 Dedup — unchanged (D5)

The identity tuple stays `(date, signedAmount, type, merchant, note)`. Splits
and tags are attribution/labels, not identity — the same reasoning that already
excludes `category`. Consequences, stated honestly:

- Re-importing the same v3 file is idempotent (the §15 guarantee holds).
- Re-importing a v3 file **over rows created by an earlier v1/v2 import** (or
  over the live originals) skips those rows as duplicates and therefore does
  **not** retro-attach their splits/tags. Import creates rows; it never mutates
  existing ones. The user-facing path to a full restore into a polluted account
  is `skipDuplicates: false` into a fresh account, or trash-then-reimport.
  Document this in the `/help` Data & privacy item (§9).

---

## 6. The write — extending the atomic commit (D6)

`commitImport`'s `$transaction` grows two phases; everything stays inside the
one transaction so a parent can never land without its children:

1. **Categories** (existing) — unchanged, now also fed by to-be-created split
   line categories (they flow into the same `newNameByKey` collection).
2. **Tags** (new) — `tag.createMany({ skipDuplicates })` for collected new names
   → re-query owned tags → fresh id index (mirror of the category flow).
3. **Transactions:**
   - Rows with **no** splits and **no** tags — the fast path — keep the existing
     flat `transaction.createMany` (the common case for external/CSV migrations
     stays exactly as fast as today).
   - Rows carrying splits and/or tags — per-row `tx.transaction.create` with
     nested `splits: { createMany }` and a follow-up `transactionTag.createMany`
     (or nested `tags: { createMany }`), sequentially inside the transaction.
     Split amounts stored as `round2` positive magnitudes; parent `categoryId`
     **nulled** when split (the §17 invariant — split status is derived from
     child-row presence; display category comes from the lines).

   *Alternative considered:* `createManyAndReturn` + batched child `createMany`s
   keeps the enriched path fully batched, but couples correctness to returned-row
   ordering and complicates the source-row mapping. Per-row `create` for enriched
   rows is simple, provably correct, and bounded (`IMPORT_MAX_ROWS` ceiling; a
   real-world enriched restore is thousands of rows, not millions). Revisit only
   if the perf smoke (§10.4) says so.

`ImportResult` gains `tagsCreated`; `divergedFromPreview` semantics unchanged.
The `import_committed` analytics event keeps its registered props (bucketed
counts only) — extending the registry with split/tag counters is optional and
**not** part of this slice's contract.

---

## 7. Preview & UI (small, additive)

- `ImportPreview` gains: `splitTransactions` (count of rows that will be created
  split), `tagsToLink` (distinct tag names that will be attached), `newTags`
  (names to be created — rendered like `newCategories`).
- New `ImportIssueKind: "split"` for degraded splits (§5.2), listed in the
  existing issues table.
- Preview sample rows may show a `Split · N` marker next to the category label
  (reuse `SPLIT_LABEL`); tags shown as a compact `+N tags` suffix — keep it
  minimal, the preview is a confirmation surface, not a feed.
- The `/import` page copy for JSON gains one line: *"Spendly JSON backups
  restore split categories and tags."* No new step, no new route, no layout
  change.

---

## 8. File plan

| File | Change |
|---|---|
| `src/lib/system-constants.ts` | `EXPORT_JSON_SCHEMA_VERSION` `2 → 3` (comment: v3 = split category names + tags) |
| `src/types/export.ts` | `ExportSplit.category`; `ExportTransactionRow.tags`; new `ExportTag`; `FullExport.tags` |
| `src/lib/db/export.ts` | splits select + tag include in `getTransactionsForExport`; tag registry in `getFullExport`; `EXPORT_ENTITY_CLASS.tag = "global"` |
| `src/types/import.ts` | `NormalizedImportRow.splits/.tags`; `ResolvedRow.splits/.tagIds/.createTagNames`; `ImportPreview` + `ImportResult` additions; `ImportIssueKind` + `"split"` |
| `src/lib/import/json.ts` | lenient `splits`/`tags` fields on `txSchema`; surface the coerced `data.tags` registry (colors validated against the tag hex rule, invalid → `null`) |
| `src/lib/import/parse.ts` | `normalizeJsonRow` split/tag coercion (§5.1); `normalizeCsvRow` emits empty arrays |
| `src/lib/import/split-gate.ts` *(new, pure)* | the §5.2 gate — `acceptSplits(row) → { splits } \| { degraded: reason }` (kept its own module so the invariant mirror is unit-testable in isolation) |
| `src/lib/import/resolve.ts` | id-indexed category lookup for the D2 fallback; tag index + `resolveTag` (mirror of `resolveCategory`, create-always policy) |
| `src/lib/db/import.ts` | `getImportTargets` returns category ids (for the id fallback) + user tags |
| `src/actions/import.ts` | pipeline: split gate + line resolution + tag resolution; commit: tag `createMany` phase + hybrid transaction write (§6); preview additions |
| `src/components/import/import-preview.tsx` | split/tag count lines + `"split"` issue rendering |
| `src/lib/help/content.ts` | Data & privacy: round-trip now preserves splits + tags; note the D5 no-retro-repair consequence (maintenance contract) |
| Docs | this spec → shipped banner; `data-export-spec.md` + `data-import-spec.md` v3 notes; `split-transactions-spec.md` §12 + `transaction-tags-spec.md` §12 deferral notes flipped to "closed by …"; `POST-MVP-ROADMAP.md` §20 item 2 checked; `project-overview.md` Data Portability + feature-note lines |

No new schema, no migration, no new route, no new `RATE_LIMITS` entry, no new
color/token, no new page.

---

## 9. Constants

No new system constants expected. Reused: `SPLIT_MIN_LINES`, `SPLIT_MAX_LINES`,
`SPLIT_NOTE_MAX`, `TAG_NAME_MAX`, `TAG_MAX_PER_TRANSACTION`, `IMPORT_MAX_ROWS`,
`EXPORT_MAX_TRANSACTIONS`, `RATE_LIMITS.import`. The only constant change is the
`EXPORT_JSON_SCHEMA_VERSION` bump. (Worst-case write volume is bounded by
`IMPORT_MAX_ROWS × SPLIT_MAX_LINES` — acceptable; assert in the perf smoke
rather than adding a new cap.)

---

## 10. Testing (`test/`, Vitest, mock `@/lib/prisma` — never a real DB)

### 10.1 Pure-helper tests

- `test/lib/import/split-gate.test.ts` *(new)* — every §5.2 rule: non-EXPENSE →
  degrade; 1 line → degrade; > `SPLIT_MAX_LINES` → degrade; zero/negative line →
  degrade; off-by-a-cent sum → degrade; exact-cent sum → accept; float-noise sums
  (`0.1 + 0.2` style) accepted via `round2`.
- `test/lib/import/parse.test.ts` *(extend)* — `normalizeJsonRow`: malformed
  split entries dropped; note D9 pass at `SPLIT_NOTE_MAX`; tag coercion (trim,
  case-insensitive in-row dedup, over-max name dropped, clamp to
  `TAG_MAX_PER_TRANSACTION`); `normalizeCsvRow` emits `[]`/`[]`.
- `test/lib/import/json.test.ts` *(extend)* — v1/v2/v3 files all parse; v4
  rejected with the "newer version" message; rows carry `splits`/`tags`; registry
  surfaced; missing registry tolerated.
- `test/lib/import/resolve.test.ts` *(extend)* — split-line resolution order:
  name match wins; unmatched name + owned id → the id (the renamed-category
  case); v2 rows (id only) resolve via the fallback; foreign/unknown id +
  unmatched name → the name policy (create vs null per `categoryResolution`);
  nothing → null. Tag resolve matches via `normalizeLabelKey` and collects
  creates first-casing.

### 10.2 DB / export tests

- `test/lib/db/export.test.ts` *(extend)* — splits select includes the category
  name; tags include shape + name-asc order; `getFullExport` tag registry query
  is `userId`-scoped; `EXPORT_ENTITY_CLASS.tag === "global"`.
- `test/lib/export/csv.test.ts` — unchanged snapshot (proves CSV is untouched by
  the widened row type).

### 10.3 Action tests — `test/actions/import.test.ts` *(extend)*

- Commit write shape: split row → per-row `create` with nested
  `splits.createMany`, parent `categoryId: null`, `round2` magnitudes; tagged row
  → join `createMany` with resolved ids; plain rows still go through the flat
  `transaction.createMany`; tag-creation phase runs `skipDuplicates` + re-query;
  everything inside one `$transaction`.
- Degraded split imports flat + emits the `"split"` issue.
- Dedup: identical file twice → second run all-duplicates (splits/tags don't
  perturb the key).

### 10.4 The round-trip fixture — `test/lib/import/round-trip.test.ts` *(new — the §20 deliverable)*

A golden fixture envelope (built from the real `ExportEnvelope`/`FullExport`
types, so a type change breaks the fixture loudly) containing: a 3-line split
expense (one line uncategorized), a tagged income, a tagged + split expense at
the caps, a transfer pair, a plain uncategorized row, a v2-shaped split
(ids only, no names), and a v3 split line whose name no longer matches but
whose id is owned (the renamed-category safety net). Run it through `parseImportEnvelope` → normalize → gate →
resolve → `partitionForWrite` and assert the resolved write payload preserves:
every split line (category label or id-fallback id, amount, note), every tag
name, the transfer skipped+counted, and nothing else dropped. Plus a perf smoke:
`IMPORT_MAX_ROWS`-scale input with splits stays within the existing time bound.

---

## 11. Decisions

### Resolved (D1–D7)

- **D1 — `schemaVersion: 3`, additive.** Import accepts `1..3`; only the
  constant and the lenient schema move. v3 is a strict superset of v2.
- **D2 — split categories resolve name-first, owned-id safety net, then name
  policy.** A name match wins; an unmatched-or-absent name falls back to the
  raw `categoryId` when it exists in the user's owned + system set — which
  makes *existing* v2 backups round-trip for the same user (fixing the
  roadmap's stated bug rather than only future-proofing) **and** keeps v3
  files robust to categories renamed since export or hand-edited names. Only
  when both name and id fail does the `categoryResolution` policy
  (create/null) apply. Foreign/unknown ids → resolve onward, never an error.
- **D3 — invalid splits degrade to a flat row, never reject it.** The parent
  amount is the source of truth; degrading loses only attribution (today's v2
  behavior) but now surfaces a preview issue instead of being silent. Split
  invariants mirror the drawer's `superRefine` exactly — one rule set, two
  enforcement points, both tested.
- **D4 — tags are create-always, registry-colored.** No resolution policy knob
  (unlike categories there is no system tier and no Uncategorized fallback);
  missing tags are created with the registry color when present. In-row clamp
  to `TAG_MAX_PER_TRANSACTION`; over-long names dropped, never truncated.
- **D5 — dedup identity unchanged.** Splits/tags excluded from the key (same
  rationale as the existing category exclusion). Idempotent re-import is
  preserved; the no-retro-repair consequence is documented in `/help` and §5.5.
- **D6 — hybrid write.** Plain rows keep the flat `createMany` fast path;
  enriched rows go per-row nested `create` inside the same `$transaction`.
  `createManyAndReturn` noted as a perf fallback, not taken now.
- **D7 — CSV untouched both directions.** JSON is the lossless format; CSV is
  the flat one. (Also keeps this slice out of `src/lib/export/csv.ts` and the
  column mapper entirely.)

- **D8 — minimal preview markers.** The preview shows the aggregate count lines
  (§7) plus a `Split · N` marker on sample rows and a compact `+N tags` suffix —
  no per-line split rendering in the preview. It is a confirmation surface, not
  a feed.
- **D9 — no new analytics props.** `import_committed` keeps its registered
  props; bucketed `splitBucket`/`tagBucket` counters are deferred (they would
  require a registry entry, and §20 item 4's smoke validation doesn't need
  them).
- **D10 — inline, typed fixture.** The §10.4 round-trip fixture is an inline
  literal typed against `ExportEnvelope<FullExport>` (not a checked-in `.json`
  file) so any envelope/type drift fails compilation loudly.

*(D8–D10 were open decisions in the first draft; resolved 2026-07-07. Restate
them in `current-feature.md` when the slice starts, per the workflow.)*

---

## 12. Workflow (per [ai-interaction.md](../ai-interaction.md))

1. Document in `docs/current-feature.md`; branch `feature/data-portability-hardening`.
2. Export side first (types → db → constant bump) — export tests green.
3. Import pipeline (json/parse/split-gate/resolve/db) — pure tests green.
4. Action + write path — action tests green.
5. Round-trip fixture (§10.4) — the slice's acceptance test.
6. Preview UI + `/help` + docs flips.
7. `npm run test:run` + `npm run build` + lint; browser pass:
   - export a seeded demo-pro JSON (verify v3 shape), re-import into a fresh
     account, confirm splits render split and tags render as chips;
   - **v2 same-user backup smoke (mandatory, not unit-tests-only):** take a real
     pre-bump `schemaVersion: 2` export (capture one *before* the constant bump,
     or fixture one from a live v2 file), import it as the same user, and
     confirm the split arrives **split with its original categories** via the D2
     id fallback — this is the slice's most important backward-compatibility
     promise, so it gets exercised end-to-end, not just in `resolve.test.ts`.
8. Commit only after gates pass and with permission; merge; delete branch; mark
   complete in `current-feature.md` + history.

---

## 13. Acceptance criteria

- [ ] JSON export is `schemaVersion: 3`: split lines carry `category` names,
      rows carry `tags`, `data.tags` registry present; CSV byte-identical for
      the same data.
- [ ] Importing a v3 export into a fresh account recreates every split (lines,
      categories, notes, parent `categoryId: null`) and every tag association
      (missing tags created with registry color).
- [ ] Importing a **v2** export resolves split-line categories via the owned-id
      fallback — the flatten-to-Uncategorized bug is fixed for existing backups.
      Verified both in unit tests **and** in the §12 browser smoke with a real
      pre-bump export.
- [ ] Invalid registry colors (wrong shape/type) degrade to `null` on the
      created tag — never rejected, never written unvalidated.
- [ ] v1 files still import exactly as today; a v4 file is rejected with the
      "newer version" message.
- [ ] An invalid `splits` payload degrades that row to a flat import with a
      visible `"split"` preview issue — never rejects the row or the file.
- [ ] Re-importing the same file is still idempotent (dedup key unchanged).
- [ ] The round-trip fixture test exists and fails if any carried field is
      dropped anywhere in the pipeline.
- [ ] No schema change, no migration, no new route, no `isPro` read, no new
      `RATE_LIMITS` entry; all existing export/import tests pass unmodified or
      with additive-only edits.
