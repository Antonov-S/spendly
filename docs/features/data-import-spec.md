# Data Import — Implementation Spec

> **Goal:** Ship the **migration** counterpart to the shipped export — let any user (Free *or* Pro)
> bring existing history **into** Spendly from a **CSV** (a flat ledger, with a column-mapping step) or
> a **JSON** (Spendly's own versioned export envelope). This is
> [POST-MVP-ROADMAP.md](../POST-MVP-ROADMAP.md) **§15 — Data Import** (Delivery Sequence slot **7**).
>
> It removes the single biggest switching cost for the target user — *"already track, struggle to
> maintain it"* — who today must re-enter a spreadsheet / Mint / YNAB / Monarch history by hand.

This spec follows [entity-crud-architecture.md](../entity-crud-architecture.md) and is the **inverse**
of [data-export-spec.md](./data-export-spec.md). Where export is a **read that produces a download**
(and therefore had to be an API route), import is a **mutation that consumes an upload** — so it is a
**Server Action**, like every other write in the app (§2).

**How to read this spec (layering).** Ordered **contract → model → implementation → tests**:

| Layer | Section | What it is |
|---|---|---|
| **Contract** | §1 | Every binding rule, stated **once**. The single source of truth. |
| **Why a Server Action** | §2 | The architecture decision + scope (in/out). |
| **Model** | §3 | The pipeline both formats funnel through — normalize → resolve → dedup → write. |
| **Implementation** | §5 (CSV), §6 (JSON), §7 (pipeline/write), §8 (UI) | Format/transport specifics that *reference* §1/§3, never restate them. |
| **Tests / process** | §10–§13 | Test plan, decisions, workflow, acceptance. |

If a later section ever appears to contradict §1, **§1 wins** — the prose elsewhere is rationale.

---

## 1. The contract (single source of truth)

Every binding rule lives here, once — terse, testable assertions. Each is tagged **MUST/SHOULD/MAY**
(RFC-2119) and either **`[inv]`** (hard invariant — correctness/security; a change is a bug) or
**`[prod]`** (a product reading that may evolve). The `[prod]` rules — **C1, C2, D1, D4, D5, D8, D9,
T5** — are the decisions deliberately open to revisiting; everything else is frozen.

### 1.1 Security & access — MUST (all `[inv]`)

- **S1** Every action (`inspectCsv`, `previewImport`, `commitImport`) calls `auth()` and returns the
  standard `{ success: false, error }` (never throws, no `401`/redirect — this is a Server Action, not
  a route) when there is no `session.user.id`.
- **S2** **Every** read and write is scoped by the session `userId`. The target `accountId` and any
  `categoryId` are verified **owned** before use; client-supplied source ids from the file are
  **never** trusted for linking (§3.4, §6.1).
- **S3** All three actions are **rate-limited per `userId`** (`RATE_LIMITS.import`) **before** any file
  parsing or DB work.
- **S4** Inputs are bounded **before** parsing: a byte cap (`IMPORT_MAX_FILE_BYTES`) rejects an
  oversized upload; a row cap (`IMPORT_MAX_ROWS`) rejects an over-large dataset as a **whole-import
  error** (never a partial import — D5).
- **S5** Import treats every file value as **inert data** — fields are stored as plain strings, never
  evaluated. CSV-formula-injection neutralization is the **export** layer's job (`escapeCsvTextField`);
  the importer does **not** re-escape on the way in and does **not** strip a leading `'`/`=` (that
  would corrupt a legitimate merchant). A value's safety is re-established only when it is *re-exported*.
- **S6** Import is **tier-agnostic** — available to Free and Pro alike; `isPro` is **never read**
  (mirrors export S6; data portability is not a Pro gate — [project-overview.md](../project-overview.md)
  → Data Portability).
- **S7** `parseCsv` caps **each cell** at `IMPORT_MAX_CELL_CHARS` (a `system-constants` knob, tunable
  without touching the parser; hard truncate during the scan, §5.1) so a single pathological field
  can't exhaust memory/CPU even when the file is under `IMPORT_MAX_FILE_BYTES` (S4). The cap counts
  **total accumulated characters of one field**, so it applies **equally to a quoted multi-line field**
  (embedded newlines count toward the limit) — a never-closed quote can't grow an unbounded cell. This
  is a parse-time safety bound, *distinct* from the per-field *product* caps in D9 (merchant/note
  semantics, not abuse).

### 1.2 Targets & resolution — MUST

- **C1** `[prod]` **One target account for the whole import** (CSV *and* JSON v1). The user picks an
  active account; every created transaction lands in it. Any account name/column in the file is
  **informational only** — surfaced in the preview, **never** used for routing. Multi-account restore
  is **v2** (§11). The target is verified `{ id, userId, isArchived: false }` — archived accounts
  cannot receive imports (mirrors `createTransaction`).
- **C2** `[prod]` **Category resolution** is one source of truth (`resolveCategory`, §3.4): match the
  row's category text against the user's visible categories (system + own) under a **single normalized
  key** — `trim()` → collapse internal whitespace runs to one space → Unicode **NFC** → lower-case
  (locale-independent). Both sides of the match (incoming text and existing names) go through the
  *same* `normalizeCatKey`, so `"  Coffee  "`, `"coffee"`, and an NFC/NFD-divergent `"café"` all
  resolve to one category. Matched → that `categoryId`. Unmatched **non-empty** → per the chosen
  `CategoryResolution` policy: **`CREATE`** (a new user category, default icon/color) or
  **`UNCATEGORIZED`** (`categoryId: null`). Empty/blank → `null`. Names to be created are **deduped on
  the normalized key within the batch** and against existing categories, so an import never creates two
  "Coffee" rows (the created row stores the *trimmed/collapsed* display name; the key is only for
  matching).

### 1.3 Dataset & normalization — MUST

These define *what* a successful import writes and *how every value is shaped*, identically for CSV
and JSON. Stated once here; §3.3 implements this list.

- **D1** `[prod]` **v1 imports `INCOME` and `EXPENSE` only.** Rows resolving to **`TRANSFER`** are
  **skipped and counted** (`transfersSkipped`) — never imported. A transfer needs two accounts, which
  the single-target model (C1) cannot express; fabricating two income/expense legs would double-count
  and corrupt totals. Transfer restoration is **v2** (§11).
- **D2** `[inv]` Stored **amount is signed, derived from `type`** (`EXPENSE` → negative magnitude,
  `INCOME` → positive), magnitude rounded to 2 dp — exactly as `createTransaction` does. **Currency is
  stamped from the target account** (EUR); any currency symbol/column/field in the file is **ignored**
  (no FX conversion — EUR-only, mirrors export D9). Because this silently overrides the file, the
  preview shows a **currency notice** ("All imported transactions will use *{account}*'s currency
  (EUR); any currency in the file is ignored") so the override is never invisible — surfaced
  unconditionally in v1 (every account is EUR), and the natural seam for a real "differs from target"
  warning when multi-currency lands.
- **D3** `[inv]` Stored **date is a calendar `@db.Date` at UTC midnight** via `dateInputToUtc`, from a
  normalized `YYYY-MM-DD`. CSV tolerant date parsing (§5.3) normalizes a small whitelist of input
  formats to `YYYY-MM-DD` first; JSON dates are already `YYYY-MM-DD` (export D3).
- **D4** `[prod]` **Dedup is count-based (multiset), per target account.** Identity tuple =
  `(date, signedAmount, type, merchant, note)` (category is **not** identity — re-categorizing must not
  create a phantom). For each identical tuple, create `max(0, incomingCount − existingNonDeletedCount)`.
  This makes **re-importing the same file idempotent** while preserving *legitimate* duplicates (two €3
  coffees, same day). User toggle **"Skip rows already in this account"** (default **on**); off → every
  valid row is created.
- **D5** `[prod]` **Tolerant, partial success.** A *row*-level failure (unparseable date/amount,
  missing required field, `TRANSFER`) **skips that row and reports it**; valid rows still import. A
  *structural* failure is a **whole-import error with zero writes**, each with a **distinct, specific
  message** (not one generic catch-all) so the UI and tests can branch: **empty upload** (zero-byte or,
  for CSV, header-only with no data rows / for JSON, `transactions: []`) → "This file has no
  transactions to import."; **unreadable** (CSV with no parseable header / invalid JSON syntax) → "We
  couldn't read this file — is it a valid CSV/JSON export?"; **over `IMPORT_MAX_ROWS`** → "This file has
  more than N rows…"; **bad/unknown JSON envelope** (T3) → its own version/shape message. The empty case is
  explicitly **not** folded into "unreadable" — a valid-but-empty file is a different, friendlier story.
- **D6** `[inv]` **Preview equals commit.** `previewImport` (dry-run) and `commitImport` run the
  **identical** parse → resolve → dedup pipeline (§3); only the terminal write differs. The numbers the
  user confirms are exactly what gets written **unless the ledger changed between the two calls** — the
  commit is always authoritative (it re-derives `toCreate` against current DB state). To keep that
  honest, the client passes the preview's `toCreate` count into `commitImport` (`expectedCreate`); when
  the actual created count differs, `ImportResult.divergedFromPreview = true` and the UI surfaces a
  calm notice ("N fewer/more rows than the preview — the account changed since you previewed"). The
  commit never silently does something other than what it reports.
- **D7** `[inv]` **The write is atomic** — created categories then transactions inside one
  `prisma.$transaction` via `createMany` (§7.2). All-or-nothing: a mid-write failure leaves the ledger
  untouched.
- **D8** `[prod]` **No schema change, no import-provenance column.** Imported rows are ordinary
  `Transaction`s. Consequently **one-click "undo this import" is out of scope** — rows are deletable /
  trashable individually like any other. A future `importBatchId` (for batch rollback) is v2 (§11).
- **D9** `[prod]` **Text fields are deterministic.** Every text cell is `trim()`-ed first; a value that
  is empty or **whitespace-only** → `null` (applies to `merchant`, `note`, **and** `category` text —
  a blank category resolves to "no category", never a created `""` category). An over-length
  `merchant` (> 120) / `note` (> 500) is **truncated, not rejected** — a migration must not lose a
  whole row to a long note. (Truncation is silent at the data layer; the preview's per-row flag notes
  "merchant/note truncated" so it isn't invisible.) Category text is **not** truncated — it is matched
  whole or, under `CREATE`, would create an over-long name, so category text longer than the category
  name cap is treated as **invalid for creation** and falls back to `null` rather than minting a
  truncated category.

### 1.4 Transport & UI — MUST / SHOULD

- **T1 (MUST)** The whole feature is **Server Actions** in `src/actions/import.ts` — no API route, no
  new write path beyond these actions (rationale §2).
- **T2 (MUST)** Entry point: a **"Import data"** affordance in the `/settings` **"Data & privacy"**
  card (beside the export links), linking to a dedicated **`/import`** page (`AppShell`, auth-guarded,
  **not** onboarding-gated — escape hatch like `/settings`). A user with **zero active accounts** sees
  an empty state with a "Create an account first" CTA (no target to import into — C1).
- **T3 (MUST)** **JSON requires a known envelope.** `schemaVersion === EXPORT_JSON_SCHEMA_VERSION` →
  parse; a **higher/unknown** version is rejected ("This file was exported by a newer version of
  Spendly") rather than best-effort parsed (the importer side of export §6.2). Shape is Zod-validated.
  **Compatibility policy:** the `schemaVersion` is strict, but the *shape* is **lenient to unknown
  fields** — Zod parses **non-strict** (extra keys on the envelope or on a transaction object are
  ignored, not errors), so a future additive envelope extension under the same version still imports.
  The version gate is the only hard compatibility line; unknown *fields* are forward-compatible.
- **T4 (SHOULD)** The flow is **upload → map (CSV only) → preview → confirm**, matching the roadmap.
  The CSV mapping step auto-suggests a mapping (§5.2) the user can correct; JSON skips mapping (the
  envelope is self-describing).
- **T5 (MUST, `[prod]`)** **The preview surfaces what was auto-detected and warns on a bad-looking
  import.** (a) The CSV inspection exposes the detected **dialect** — delimiter, decimal separator,
  date format — so the user can eyeball auto-detection *before* committing (a wrong date format is the
  classic silent corruption). (b) When the share of rows that will **not** be created
  (`(duplicatesSkipped + invalidSkipped + transfersSkipped) / totalRows`) is `≥ IMPORT_HIGH_SKIP_RATIO`,
  the preview shows a prominent warning ("Most rows won't be imported — check your column mapping / date
  format") rather than a quiet count. It never *blocks* commit (a 95%-duplicate re-import is legitimate),
  it just makes the likely-misconfiguration case loud.

### 1.5 Free choices — MAY

- Date-format **override** in the CSV mapping UI when auto-detection (§5.3) is wrong.
- Tuning `RATE_LIMITS.import` / `IMPORT_MAX_*` after observing real usage (config edits).
- Drag-and-drop vs a plain `<input type="file">` for the upload affordance (§8).

---

## 2. Why a Server Action, not an API route

Export is the documented render-cycle exception **because a file download cannot be a Server Action**
— it must set `Content-Disposition` and stream a `Response` ([data-export-spec.md](./data-export-spec.md)
§2). **Import is the mirror image and the rationale does not transfer:**

- A **file upload** *can* be a Server Action — Next.js 16 / React 19 pass `File`/`FormData` to actions
  natively. The action receives the bytes, returns a typed `{ success, data?, error? }` the client
  consumes with `useActionState`/`useTransition` — exactly the multi-step preview→confirm UX this needs.
- Import **writes to the ledger**, and the architecture routes **all** entity mutations through
  `"use server"` actions ([entity-crud-architecture.md](../entity-crud-architecture.md)). Making it a
  route would re-implement the auth/ownership/rate-limit/`revalidate*` glue that actions already own.
- There is **no streaming-to-browser, no special headers, no `Content-Disposition`**. The bytes go
  **in**, a small JSON-able result comes **out**.

> **On "file uploads → API route" (coding-standards.md).** That guidance targets **large or
> progress-tracked** uploads. This import is **size-capped** (S4) and finishes in one request at MVP
> volume, so the Server-Action path is correct. If a future "Export v2 async job" (export §7.2) ever
> motivates a streamed/resumable upload, that is the moment to revisit — not now. *(Decisions over
> options — [project-overview.md](../project-overview.md) #5.)*

### Scope

**In:** `inspectCsv` / `previewImport` / `commitImport` Server Actions; pure parsers + normalizers
(`src/lib/import/*`); the dedup algorithm; the resolution helpers; a `/import` page with a CSV
column-mapper + a shared preview; a `/settings` entry point; unit tests.

**Out (explicit, all documented as v2 in §11):** importing **TRANSFER** rows / multi-account routing
(C1, D1); importing **budgets / goals / recurring templates** (v1 imports **transactions** only, plus
categories created *as a side effect of resolution* — C2); one-click **undo-an-import** / import
provenance (D8); a **REST/route** importer or a public ingest endpoint; **background/async** import;
**XLSX / OFX / QIF** formats (CSV + Spendly-JSON only); editing individual rows inside the preview
(it's confirm-or-cancel, not a grid editor); **scheduled / repeated** import of any kind (this is a
one-time migration, **not** bank-sync — §2.1).

### 2.1 Philosophy check — migration, not sync

A **one-time, user-initiated, preview-and-confirm** import is *not* the continuous auto-import the
product thesis rejects. There is **no feed, no schedule, no silent ledger write** — the user explicitly
chooses a file and confirms a preview before a single row is created (the same suggest-and-confirm
discipline as recurring drafts and the AI helpers). Copy frames it as **"Import / migrate your
history,"** never "sync," so it can never be conflated with the out-of-scope *bank account
synchronization* ([project-overview.md](../project-overview.md) → Out of Scope).

---

## 3. Model — the import pipeline

Both formats funnel into **one** pipeline. CSV and JSON differ only at the **front** (how raw rows are
produced); from `NormalizedImportRow[]` onward the logic — resolve, dedup, write — is shared and is the
**only** place the contract's resolution (C2), normalization (D1–D3), and dedup (D4) rules live.

```
CSV  → parseCsv → applyMapping → normalizeCsvRow ─┐
                                                  ├→ NormalizedImportRow[] → resolve → dedup → (preview | write)
JSON → parseEnvelope → normalizeJsonRow ──────────┘
```

- **Pure** (`src/lib/import/*`): everything above is string/shape transforms — no Prisma, no `auth`,
  fully unit-testable (§10.1).
- **Model** (`src/lib/db/import.ts`, `import "server-only"`): the owned-targets read and the dedup
  candidate query (§3.5).
- **Action** (`src/actions/import.ts`): `auth` → rate-limit → size guard → call pure pipeline → (return
  preview | atomic write). HTTP-free orchestration only.

### 3.1 The normalized row — the convergence point

```ts
// src/types/import.ts
export interface NormalizedImportRow {
  /** Original 1-based line/element index, for issue reporting. */
  source: number;
  /** "YYYY-MM-DD" (D3) — already normalized; null if unparseable. */
  date: string | null;
  /** Positive magnitude; sign is applied at write from `type` (D2). null if unparseable. */
  amount: number | null;
  /** "INCOME" | "EXPENSE" | "TRANSFER" — TRANSFER is skipped downstream (D1). */
  type: TransactionTypeValue | null;
  /** Raw category text from the file (resolved later, C2). */
  categoryText: string | null;
  merchant: string | null;
  note: string | null;
}
```

A row with any required field `null` (`date`/`amount`/`type`) becomes an **invalid** issue (D5); a row
with `type === "TRANSFER"` becomes a **transfer-skipped** issue (D1). Surviving rows proceed to
resolution + dedup.

### 3.2 The two phases (stateless)

| Action | Writes? | Returns | Purpose |
|---|---|---|---|
| `inspectCsv(formData)` | no | `CsvInspection { headers, sampleRows, suggestedMapping, dataRowCount, dialect }` where `dialect = { delimiter, decimal, dateFormat }` is the auto-detected guess (T5) | Drive the CSV mapping UI (§5.2) and show the detected dialect for verification. JSON skips this. |
| `previewImport(formData, opts)` | **no** | `ImportPreview` | Full parse + resolve + dedup, **dry-run** (D6). |
| `commitImport(formData, opts)` | **yes** | `ImportResult` | The identical pipeline, then the atomic write (D6/D7). |

**Stateless by design.** The browser keeps the chosen `File` in memory and **re-sends it** on each
call (inspect → preview → commit); nothing is staged server-side between phases. At the size cap (S4)
the re-parse cost is trivial, and it avoids a temp-storage / cache-invalidation surface entirely. A
server-side staging table is the documented alternative **only** if Export-v2-style large async import
is ever built (§11).

### 3.3 Normalization (realizes D1–D3)

- **`normalizeCsvRow(rawCols, mapping, dateFormat, decimal)`** — pulls each mapped column, runs
  `parseDateFlexible` (§5.3) → `YYYY-MM-DD`, `parseAmount` (§5.4) → positive magnitude, `resolveType`
  (§5.5) → enum, and applies the D9 text rules: `trim()` every text cell, whitespace-only → `null`,
  and truncate `merchant` (≤ 120) / `note` (≤ 500) to the drawer's caps (flagging the truncation for
  the preview). JSON rows go through the same D9 text pass.
- **`normalizeJsonRow(exportRow)`** — maps an `ExportTransactionRow`
  ([src/types/export.ts](../../src/types/export.ts)) straight through: `date` is already `YYYY-MM-DD`,
  `amount` is signed → `Math.abs` for magnitude + keep `type`, `category` name → `categoryText`,
  `merchant`/`note` as-is. `account` (name) and `transferPairId` are **ignored** (C1, D1).

### 3.4 Category resolution — `resolveCategory` (realizes C2)

```ts
// src/lib/import/resolve.ts — pure
export type CategoryResolution = "CREATE" | "UNCATEGORIZED";

/** Normalize a category name to its match key: trim → collapse whitespace → NFC → lower-case (C2). */
export function normalizeCatKey(name: string): string;

/** normalizeCatKey(name) → categoryId, built once from the user's visible categories. */
export function buildCategoryIndex(cats: { id: string; name: string }[]): Map<string, string>;

/**
 * Returns { categoryId } for an existing match, { createName } for a to-be-created
 * category (policy CREATE), or { categoryId: null } (matched-empty or policy
 * UNCATEGORIZED). Pure: the action turns `createName`s into one createMany (§7.2),
 * de-duplicating names case-insensitively first.
 */
export function resolveCategory(
  text: string | null,
  index: Map<string, string>,
  policy: CategoryResolution,
): { categoryId: string } | { createName: string } | { categoryId: null };
```

The resolver **never** invents an id and **never** trusts a source id — it works purely off the row's
category *text* against the owned index (S2). System categories are matchable (so "Groceries" links to
the seeded row) but never created (creation is always a `userId`-owned, `isSystem:false` row).

### 3.5 DB layer — `src/lib/db/import.ts` (`server-only`)

| Fetcher | Returns | Realizes |
|---|---|---|
| `getImportTargets(userId)` | `{ accounts: {id,name}[] (active only), categories: {id,name}[] (system + own) }` — feeds the target picker + the resolution index. | C1, C2, S2 |
| `countExistingForDedup(userId, accountId, keys)` | For the batch's distinct identity tuples, the count of matching **non-deleted** existing rows in the target account — the `existingCount` half of D4. One `groupBy`/bounded `findMany`, **not** N+1. | D4, S2 |

Both are read-only. The **write** lives in the action (§7.2), not here, so the `$transaction` (D7) is
co-located with `revalidate*`.

---

## 4. File plan

| Layer | File | Action |
|---|---|---|
| Pure — CSV parse | `src/lib/import/csv.ts` | **create** — `parseCsv(text): string[][]` (RFC-4180 state machine, §5.1), `stripBomAndSepHint` |
| Pure — mapping | `src/lib/import/mapping.ts` | **create** — `IMPORT_FIELDS`, `suggestMapping(headers)`, `applyMapping(row, mapping)` |
| Pure — value parse | `src/lib/import/parse.ts` | **create** — `parseDateFlexible`, `parseAmount`, `resolveType`, `normalizeCsvRow`, `normalizeJsonRow` |
| Pure — resolve | `src/lib/import/resolve.ts` | **create** — `buildCategoryIndex`, `resolveCategory` |
| Pure — dedup | `src/lib/import/dedup.ts` | **create** — `dedupKey(row)`, `partitionForWrite(rows, existingCounts, skipDuplicates)` |
| Pure — JSON | `src/lib/import/json.ts` | **create** — `parseImportEnvelope(text): { rows, error? }` (schemaVersion + Zod shape, T3) |
| Model — DB reads | `src/lib/db/import.ts` | **create** — `getImportTargets`, `countExistingForDedup` |
| Types | `src/types/import.ts` | **create** — `NormalizedImportRow`, `ImportMapping`, `ImportOptions`, `CsvDialect`, `CsvInspection`, `ImportPreview`, `PreviewRow`, `ImportIssue`, `ImportResult`, `CategoryResolution` |
| Validation | `src/lib/validations/import.ts` | **create** — Zod for `ImportOptions`/`ImportMapping` + the JSON envelope shape |
| Actions | `src/actions/import.ts` | **create** — `inspectCsv`, `previewImport`, `commitImport` |
| Constants (system) | `src/lib/system-constants.ts` | **modify** — `IMPORT_MAX_ROWS`, `IMPORT_MAX_FILE_BYTES`, `IMPORT_PREVIEW_SAMPLE_SIZE`, `IMPORT_MAX_ISSUES`; add `import` to `RATE_LIMITS` |
| Constants (UI/domain) | `src/lib/constants.ts` | **modify** — `IMPORT_FIELDS`, `IMPORT_DATE_FORMATS`, `CATEGORY_RESOLUTION_OPTIONS` |
| UI — page | `src/app/import/page.tsx` | **create** — `AppShell`, fetch `getImportTargets`, render `<ImportFlow>` / zero-account empty state |
| UI — flow | `src/components/import/import-flow.tsx` | **create** — coordinator (format tabs → upload → map/preview → confirm; Sonner result toast; `router.refresh()`) |
| UI — mapper | `src/components/import/column-mapper.tsx` | **create** — per-field `<select>` of source headers + date-format/decimal/target/resolution/dedup controls |
| UI — preview | `src/components/import/import-preview.tsx` | **create** — counts summary + sample table + issues list |
| UI — entry | `src/components/settings/data-privacy` (existing) / `src/app/settings/page.tsx` | **modify** — add "Import data" link to `/import` beside export |
| Auth | `src/auth.config.ts` | **modify** — add `/import` to `isProtected` |
| Tests | `test/lib/import/*.test.ts`, `test/lib/db/import.test.ts`, `test/actions/import.test.ts` | **create** (§10) |

> No new API route, no ESLint import-boundary override (that was an export-route concern). No schema
> change, no migration (D8).

---

## 5. Implementation — CSV

CSV is a **flat ledger**, so it imports **transactions into the one target account** (C1). Its columns
mirror the export's seven (`EXPORT_CSV_COLUMNS`) but **any** layout is accepted via mapping.

### 5.1 Parsing — `parseCsv` (RFC 4180, tolerant)

A single-pass state-machine `parseCsv(text): string[][]` — **no dependency** (mirrors the
dependency-free `src/lib/export/csv.ts`). It MUST handle, because real exports (including Spendly's own)
produce them:

- **BOM** stripped if present; an optional leading **`sep=,` hint line** (the export writes one) dropped
  before the header (`stripBomAndSepHint`).
- **Quoted fields** (`"..."`) with embedded commas, `CR`/`LF`, and escaped quotes (`""` → `"`).
- **`\r\n` and `\n`** line endings; a trailing newline does not yield a phantom empty row.
- **Ragged rows** (column count ≠ header count) are parsed but flagged by `applyMapping`/`normalize`
  as invalid (missing required cell → D5), never silently shifted.
- **Per-cell cap (S7):** the scanner truncates any single field at `IMPORT_MAX_CELL_CHARS`
  (`system-constants`) as it reads — counting all accumulated characters, **including the newlines of a
  quoted multi-line field** — so a malformed/never-closed quote or a megabyte-long field can't balloon
  memory before the row cap even applies. Truncation here is the abuse bound; the *product* caps on
  merchant/note (D9) apply later in normalization.

The first surviving line is the **header**; the rest are data rows. `dataRowCount` over
`IMPORT_MAX_ROWS` → structural error (S4/D5) before any normalization. `parseCsv` also returns/derives
the detected **dialect** (delimiter, decimal separator from a sample of the amount column, date format
from a sample of the date column) for `CsvInspection` (T5).

### 5.2 Column mapping — `suggestMapping` / `applyMapping`

The user maps the file's columns onto the Spendly fields (`IMPORT_FIELDS`):

| Field key | Required? | Notes |
|---|---|---|
| `date` | **yes** | → `parseDateFlexible` |
| `amount` | **yes** | → `parseAmount`; sign is meaningful only if there is **no** `type` column |
| `type` | no | mapped → `resolveType`; **unmapped → derived from amount sign** (§5.5) |
| `category` | no | free text → `resolveCategory` (C2) |
| `merchant` | no | trimmed ≤ 120 |
| `note` | no | trimmed ≤ 500 |

`suggestMapping(headers)` pre-selects a mapping by case-insensitive header matching (`"Date"`→`date`,
`"Amount"`→`amount`, `"Merchant"`/`"Payee"`/`"Description"`→`merchant`, …) so a Spendly-exported CSV
maps with zero clicks. The user can override any selection; **`date` and `amount` must be mapped** to
proceed (validated in `ImportOptions`). The `account` column, if present, is **not** a mappable target
(C1) — it may be shown in the inspection sample as context only.

**Mapping is by column index, never by header name.** `ImportMapping` stores the **0-based column
position** for each Spendly field, and `applyMapping(row, mapping)` reads `row[index]`. This makes
**duplicate header names** unambiguous: if a file has two `Amount` columns, the mapper lists each as a
distinct option (e.g. `Amount (col 2)` / `Amount (col 5)`) and the user picks the right one — the
importer never silently binds to "the first matching header." `suggestMapping`, when two headers tie on
name, suggests the **first** and leaves the rest unselected (the user disambiguates).

### 5.3 Tolerant date parsing — `parseDateFlexible`

Normalizes a **whitelisted** set of formats (`IMPORT_DATE_FORMATS`) to `YYYY-MM-DD`, **auto-detected**
from the column and **user-overridable** in the mapper:

`YYYY-MM-DD` (ISO, the export's own) · `MM/DD/YYYY` · `DD/MM/YYYY` · `DD.MM.YYYY`.

Ambiguous day/month (e.g. `03/04/2026`) resolves by the chosen format; auto-detect picks ISO when it
matches, else infers from the column (a value with a >12 first component forces `DD/...`). Anything
outside the whitelist → `null` → invalid row (D5). No timezone math — the result is fed to
`dateInputToUtc` (D3), the same path `createTransaction` uses.

### 5.4 Tolerant amount parsing — `parseAmount`

Returns a **positive magnitude** + (when no type column) a derived sign, from messy input:

- Strip currency symbols (`€ $ £`), spaces, and thousands separators.
- Decimal convention: **auto** (last `.`/`,` is the decimal) with a **decimal-separator override**
  (`.` vs `,`) in the mapper for European files (`1.234,56` → `1234.56`).
- Leading `-` or parenthesized `(1,23)` → negative.
- Non-numeric → `null` → invalid row (D5).

### 5.5 Type resolution — `resolveType`

- **Type column mapped:** case-insensitive `INCOME`/`EXPENSE`/`TRANSFER` (and the obvious synonyms
  `income`→INCOME, `expense`→EXPENSE). Unknown token → `null` → invalid (D5).
- **No type column:** **derive from sign** — negative amount → `EXPENSE`, positive → `INCOME`.
- **`TRANSFER`** (however it arises) → row is **skipped + counted** (D1), not written.

---

## 6. Implementation — JSON

### 6.1 Envelope handling — `parseImportEnvelope` (realizes T3)

`JSON.parse` → validate the [data-export-spec §6.1](./data-export-spec.md) envelope with Zod:

- `schemaVersion` is a number and **`=== EXPORT_JSON_SCHEMA_VERSION`** (currently `1`). A **higher**
  value → structural error `"This file was exported by a newer version of Spendly. Update and try
  again."` (the importer half of export §6.2 — never best-effort-parse a future shape). A lower known
  version would get an explicit branch *if/when* the version bumps; v1 only knows version 1.
- `data.transactions` is an array of the export row shape; each element is **non-strict** Zod-validated
  (unknown fields ignored — T3 forward-compat) and mapped by `normalizeJsonRow` (§3.3). **Only
  `transactions` is read** — `accounts`, `categories`, `budgets`, `goals`, `recurringTemplates` in the
  envelope are **ignored** in v1 (transactions-only scope; §2), as is any unrecognized future key.
  Categories still come into being via resolution (C2) off each row's `category` **name**, not the
  envelope's `categories[]` ids (S2).

Because the envelope is self-describing, JSON import **has no mapping step** — it goes straight upload →
preview → confirm (T4). It still chooses a **target account**, dedup toggle, and category-resolution
policy like CSV (C1/C2/D4).

> **Round-trip honesty.** A user who exported N transactions and re-imports will see
> `transfersSkipped` for any transfer legs (D1) and `duplicatesSkipped` if importing into the same
> account they exported from (D4) — both surfaced in the preview so "I got fewer than N" is never a
> mystery. Full-fidelity round-trip (accounts + transfers + budgets/goals/recurring) is **v2** (§11).

---

## 7. Implementation — resolve, dedup & the atomic write

### 7.1 Dedup — `partitionForWrite` (realizes D4)

```ts
// src/lib/import/dedup.ts — pure
/** Stable identity key — category is intentionally excluded (D4). */
export function dedupKey(r: { date: string; amount: number; type: string;
  merchant: string | null; note: string | null }): string;

/**
 * Count-based multiset dedup. For each identity key, create
 * max(0, incoming − existing). When skipDuplicates is false, create all.
 * Returns the rows to write + the skipped-duplicate count.
 */
export function partitionForWrite(
  rows: ResolvedRow[],
  existingCounts: Map<string, number>,
  skipDuplicates: boolean,
): { toCreate: ResolvedRow[]; duplicatesSkipped: number };
```

`existingCounts` comes from `countExistingForDedup` (§3.5). `amount` in the key is the **signed**
stored value (so a +10 income and a −10 expense never collide). The function is pure and is the headed
target of the heaviest unit tests (idempotent re-import; legitimate duplicates preserved; toggle off).

### 7.2 The write — atomic, batched (realizes D7)

Inside `commitImport`, after resolve + dedup, in **one** `prisma.$transaction`:

1. **Create missing categories** (policy `CREATE`): de-duplicate the `createName`s case-insensitively,
   `category.createMany({ data: names.map(name => ({ name, userId, isSystem: false, icon: DEFAULT_CATEGORY_ICON, color: DEFAULT_CATEGORY_COLOR })), skipDuplicates: true })`, then re-query the
   user's categories to resolve those names → ids (handles a concurrent creator via the
   `(lower(name), userId)` unique index — `skipDuplicates` + re-query is race-safe).
2. **Create transactions** — `transaction.createMany({ data: toCreate.map(r => ({ userId, type: r.type, amount: r.type === "EXPENSE" ? -mag : mag, currency: targetAccount.currency, date: dateInputToUtc(r.date), financialAccountId: targetAccountId, categoryId: r.categoryId, merchant: r.merchant, note: r.note })) })` (D2/D3).

`createMany` keeps the write to two statements regardless of row count (no N+1). On success call
`revalidateTransactionViews()` (already touches `/transactions`, `/dashboard`, `/budgets`, `/reports`,
`/trash`) and, because new categories may exist, `revalidateCategoryViews()`. Return `ImportResult`.

> **Why re-validate everything in `commitImport` even though `previewImport` already did (D6).** The
> two calls are independent requests; the user (or another tab) could have changed state between them,
> and the client payload is never trusted (S2). The commit re-runs the **whole** pipeline on the
> re-sent file and writes its *own* freshly-computed `toCreate` — the preview is advisory, the commit is
> authoritative.

### 7.3 Rate limiting (realizes S3)

Reuse the fail-open limiter (`src/lib/rate-limit.ts`) at the **top of each action**, before parsing:

```ts
// src/lib/system-constants.ts → RATE_LIMITS
import: { limit: 5, window: "1 m" }   // per-userId; shared by inspect/preview/commit
```

Keyed by `session.user.id` (authenticated; per-user not per-IP). All three actions share the one
`import` bucket — a few inspect/preview cycles plus the commit fit comfortably; a script hammering
import does not. Fail-open when Upstash is unconfigured (local dev needs no setup).

---

## 8. Implementation — UI

A dedicated **`/import`** page (room for the mapping + preview tables that a `/settings` card lacks),
reached from the **"Data & privacy"** card (T2). `src/app/import/page.tsx` is an `AppShell` server
component: `auth` guard, **not** onboarding-gated, fetches `getImportTargets`. If `accounts.length === 0`
it renders an empty state ("Create an account first to import into it" → `/accounts`); otherwise
`<ImportFlow accounts={…} categories={…} />`.

`<ImportFlow>` (client) is the coordinator:

1. **Format toggle** — CSV / JSON.
2. **Upload** — a file `<input>` (drag-drop is a MAY). On select: CSV → `inspectCsv`; JSON → straight to
   step 3.
3. **Configure** — CSV shows `<ColumnMapper>` (per-field header `<select>`s pre-filled by
   `suggestMapping`, plus date-format + decimal-separator, both **seeded from the detected `dialect`**
   and editable — T5); both formats show the **target account** selector, **category-resolution** radio
   (`CREATE` / `UNCATEGORIZED`), and the **"Skip duplicates"** toggle (default on). The detected dialect
   (delimiter · decimal separator · date format) is shown as a small "Detected: …" line so the user
   verifies auto-detection before previewing.
4. **Preview** — calls `previewImport`; `<ImportPreview>` renders the counts (`toCreate`,
   `duplicatesSkipped`, `invalidSkipped`, `transfersSkipped`, `newCategories`), a **sample table**
   (first `IMPORT_PREVIEW_SAMPLE_SIZE` normalized rows with resolved category + per-row flag, including
   any "truncated" flag from D9), and a capped **issues list** (`IMPORT_MAX_ISSUES`). When the skipped
   share is `≥ IMPORT_HIGH_SKIP_RATIO` it leads with the **high-skip warning** (T5) — a loud "check your
   mapping / date format" banner above the counts, without blocking Confirm. A quieter **currency
   notice** (D2) states that every row will take the target account's currency.
5. **Confirm** — `commitImport` (passing the preview's `toCreate` as `expectedCreate`, D6); on success a
   Sonner toast (`"Imported N transactions"`) + `router.refresh()`; the result panel offers "View
   transactions" → `/transactions`. If `divergedFromPreview` is set, a calm inline notice explains the
   count drifted because the account changed since the preview (D6).

The destructive moment (a write) is always **behind the preview** — nothing is created until the user
sees the numbers and clicks Confirm (the conscious-capture guarantee, §2.1).

---

## 9. Constants

```ts
// src/lib/system-constants.ts
/** Hard cap on data rows accepted per import (mirrors EXPORT_MAX_TRANSACTIONS; can diverge later). */
export const IMPORT_MAX_ROWS = 10_000;
/** Reject an upload larger than this before parsing (cheap first guard, S4). */
export const IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
/** Rows shown in the preview sample table. */
export const IMPORT_PREVIEW_SAMPLE_SIZE = 20;
/** Max per-row issues listed in the preview before "and N more". */
export const IMPORT_MAX_ISSUES = 50;
/** Per-cell hard truncation during the CSV scan — abuse bound, not a product cap (S7). */
export const IMPORT_MAX_CELL_CHARS = 10_000;
/** Skipped-row share at/above which the preview shows the "most rows won't import" warning (T5). */
export const IMPORT_HIGH_SKIP_RATIO = 0.8;
// + RATE_LIMITS.import = { limit: 5, window: "1 m" }   (§7.3)
```

```ts
// src/lib/constants.ts
/** The mappable Spendly fields, in display order. Drives the column mapper + suggestMapping. */
export const IMPORT_FIELDS = ["date", "amount", "type", "category", "merchant", "note"] as const;
/** Whitelisted CSV date input formats (auto-detected, user-overridable). */
export const IMPORT_DATE_FORMATS = ["YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY", "DD.MM.YYYY"] as const;
/** Category-resolution policy options for the radio control (C2). */
export const CATEGORY_RESOLUTION_OPTIONS = [
  { value: "CREATE", label: "Create missing categories" },
  { value: "UNCATEGORIZED", label: "Leave unmatched as Uncategorized" },
] as const;
```

`DEFAULT_CATEGORY_ICON` / `DEFAULT_CATEGORY_COLOR` already exist (`src/lib/constants.ts`, from user
category management) — reuse for created categories (§7.2). No magic strings/numbers in actions or
components (coding standards).

---

## 10. Testing (`test/`, Vitest, mock `@/lib/prisma` — never a real DB)

Per coding standards: cover `src/lib/**` and `src/actions/**`; **no component tests**. The pure layer
carries the risk, so it carries the bulk of the tests.

### 10.1 Pure-helper tests

- **`test/lib/import/csv.test.ts`** — `parseCsv`: plain rows; quoted field with comma/CRLF/`""`; BOM +
  `sep=,` hint stripped; `\r\n` vs `\n`; trailing newline → no phantom row; ragged row preserved (not
  shifted); a cell longer than `IMPORT_MAX_CELL_CHARS` is truncated (S7); detected `dialect`
  (delimiter/decimal/date format) on representative samples (T5); a **zero-byte** input and a
  **header-only** input both yield "no rows" (the empty case, distinct from unreadable — D5).
  `stripBomAndSepHint` idempotent.
- **`test/lib/import/parse.test.ts`** — `parseDateFlexible` each whitelisted format → ISO; ambiguous
  `03/04/2026` honors chosen format; `>12` first component forces `DD/...`; junk → null.
  `parseAmount`: `€1.234,56`→1234.56 (decimal `,`), `1,234.56`→1234.56 (decimal `.`), `(12.00)`→−12,
  `-47.00`→−47, junk → null. `resolveType`: enum + synonyms + sign-derivation when no type column;
  unknown → null; TRANSFER preserved (skipped downstream). `normalizeCsvRow` D9 text rules:
  whitespace-only merchant/note/category → null; over-cap merchant/note truncated (+ flagged);
  over-cap category text → null (not a truncated category).
- **`test/lib/import/mapping.test.ts`** — `applyMapping` reads by **column index**, not header name;
  two same-named columns resolve to the chosen index (no silent first-match bind); `suggestMapping`
  suggests the first of tied headers and leaves required fields explicit.
- **`test/lib/import/resolve.test.ts`** — `normalizeCatKey`: trims, collapses internal whitespace,
  applies NFC, lower-cases (an NFD `"café"` and an NFC `"café"` produce the *same* key). `resolveCategory`:
  matches existing (system + own) under the normalized key; unmatched + CREATE → `createName` (preserving
  the trimmed display name); unmatched + UNCATEGORIZED → null; empty/whitespace → null; never returns an
  id absent from the index.
- **`test/lib/import/dedup.test.ts`** — `dedupKey` excludes category, includes signed amount;
  `partitionForWrite`: **idempotent re-import** (existing N, incoming N → 0 created); **legitimate
  duplicate preserved** (existing 1, incoming 2 → 1 created); toggle off → all created; category
  difference does **not** dedupe-split.
- **`test/lib/import/json.test.ts`** — `parseImportEnvelope`: valid v1 → rows; `schemaVersion: 2` →
  structural (version) error; **unknown extra fields** on the envelope and on a transaction object are
  **ignored, not errors** (T3 forward-compat); invalid JSON syntax → unreadable error; `transactions:
  []` → empty error (distinct from unreadable, D5); a TRANSFER row normalized then flagged downstream.

### 10.2 DB query-contract tests — `test/lib/db/import.test.ts`

Mock `@/lib/prisma`; assert the `where`/scoping: `getImportTargets` queries active accounts + (system +
own) categories scoped to `userId`; `countExistingForDedup` scopes `userId` + `financialAccountId` +
`deletedAt: null` and does **not** scan other accounts.

### 10.3 Action tests — `test/actions/import.test.ts`

Mock `@/auth`, `@/lib/prisma`, `@/lib/rate-limit`, `@/lib/revalidation`: unauthenticated → `{ success:
false }` (S1); over-cap rows → whole-import error, **no** `createMany` (S4/D5); target account not
owned/archived → error (C1/S2); **preview performs no write** (D6 — assert `createMany` not called);
commit writes categories-then-transactions in a `$transaction` with signed amounts + account currency
(D2/D7); `transfersSkipped`/`invalidSkipped` counts correct; the preview's high-skip flag flips at
`IMPORT_HIGH_SKIP_RATIO` (T5); `isPro` never read (S6). **Concurrent category create (race-safety,
§7.2):** simulate the `createMany({ skipDuplicates: true })` inserting **0** rows (a parallel import
already created the name) and assert the **re-query** still resolves that name → an existing id and the
transactions link to it — i.e. a lost create-race never produces an unlinked/duplicate category or a
dropped transaction. **Preview/commit determinism (D6):** with the **same mocked DB state**,
`previewImport` and `commitImport` over the same file produce **identical** counts + issue summary
(`commitImport`'s created count === the preview's `toCreate`, and `divergedFromPreview` is false).
**Divergence (D6):** when `countExistingForDedup` returns a *higher* existing count at commit than at
preview (a row landed in between), the created count drops accordingly and `divergedFromPreview` is
true. **Distinct structural errors (D5):** empty file, unreadable file, and over-cap each return their
own message and write nothing.

### 10.4 Bound/performance smoke — `test/lib/import/perf.test.ts`

A lightweight guard at the configured ceiling: build `IMPORT_MAX_ROWS` synthetic rows and run the **pure
pipeline** (`parseCsv` → normalize → resolve → `partitionForWrite`) end-to-end, asserting it completes
well within a generous time budget and that `partitionForWrite` is sub-quadratic (map-based, not a
nested scan) at that size. No DB, no I/O — this pins the pure layer's complexity so a future refactor
can't silently turn dedup or parsing into an O(n²) hot path at the 10K boundary. (Not a benchmark; a
correctness-of-complexity smoke.)

Run `npm run test:run` **and** `npm run build` green before commit.

---

## 11. Decisions

Binding rules are the §1 contract — not repeated. This records **why** the contentious calls went the
way they did, and what is deferred.

- **Server Action, not a route** (§2) — a file *upload* can be an action; export's route rationale is
  download-only. Import is a mutation; mutations are actions.
- **Single target account (C1)** — CSV has no reliable account identity, and the roadmap says "bulk
  create into a chosen account." Sidesteps cross-file account id-remapping entirely.
- **Transactions-only (§2 scope)** — the migration value is *history*; budgets/goals/recurring import
  is high-complexity, low-frequency. Categories arrive only as a *resolution side effect* (C2).
- **Skip transfers (D1)** — a transfer needs two accounts; under C1 the only honest options are skip or
  corrupt-by-double-count. We skip and *report*.
- **Count-based dedup (D4)** — the only algorithm that is **both** idempotent on re-import *and*
  faithful to legitimate duplicate transactions; cheaper than a stored content-hash column and needs no
  schema change.
- **Preview == commit (D6)** — one pipeline, `dryRun` flag — structurally prevents the classic
  "preview said 90, import made 110" drift.
- **No provenance column / no import undo (D8)** — keeps the slice schema-free; imported rows are normal
  transactions (trashable individually). Batch undo is a clean v2 once `importBatchId` is justified.
- **Tolerant + partial (D5)** — a migration file with three bad rows should import the other 997, not
  fail wholesale; structural problems still hard-fail.

### Deferred to v2 (documented, not built)

- **Multi-account routing + transfer restoration** — route each row to its original account (creating
  missing accounts), re-pair transfer legs via `transferPairId`. The honest "full round-trip."
- **Budgets / goals / recurring import** — restore the rest of the JSON envelope (id-remapping by
  natural key; goal `currentAmount` recomputed from contributions; budget unique-constraint handling).
- **`importBatchId`** provenance column → one-click "undo this import."
- **Async/staged import** for very large files (the upload mirror of Export-v2 §7.2) + server-side
  staging between phases (replacing the stateless re-upload, §3.2).
- **More formats** (XLSX / OFX / QIF) and per-row editing inside the preview.

### Still open (MAY — record the pick in `current-feature.md`)

- Drag-and-drop vs plain file input (§8).
- `RATE_LIMITS.import` / `IMPORT_MAX_*` tuning after real traffic (config edits).

---

## 12. Workflow (per [ai-interaction.md](../ai-interaction.md))

1. **Document** in `docs/current-feature.md`.
2. **Branch** `feature/data-import`.
3. **Implement** (contract → model → impl → tests): constants + types → pure helpers + their tests
   (`csv`, `parse`, `resolve`, `dedup`, `json`) → `src/lib/db/import.ts` + query-contract test → the
   three actions + action tests → `/import` page + `<ImportFlow>`/`<ColumnMapper>`/`<ImportPreview>` →
   `/settings` "Import data" link → `auth.config.ts` `isProtected`.
4. **Test:** §10 specs; `npm run test:run` + `npm run build`; browser pass as `demo-pro` and
   `demo-nonpro` (no gate, S6): export a CSV then re-import it (auto-mapping, then re-import again →
   **zero** new rows, D4); import a foreign-format CSV (European dates/amounts) via manual mapping;
   import the JSON export (transfers + duplicates reported); confirm invalid rows are skipped + listed;
   confirm a zero-account user sees the empty state; confirm signed-out returns the unauthorized result.
5. **Iterate**, then **commit** on green (conventional `feat:`, **no agent attribution** per CLAUDE.md),
   **merge** to `main`, **delete** branch, mark done in `current-feature.md` history.

**Docs to update in-slice** (commit with the code, per the team rule): `POST-MVP-ROADMAP.md` §15 +
Delivery Sequence row 7 marked shipped; `project-overview.md` — add the `/import` route row, and extend
the Data Portability section with an import note; `entity-crud-architecture.md` — note import as a
Transaction *write* path (Server Action, not a route); the `/help` "Data & privacy" section gains an
"Importing your data" item.

---

## 13. Acceptance criteria

- [ ] **CSV** (§5, C1/C2, D1–D5): upload → auto-suggested mapping (correctable) → preview → confirm;
      tolerant date/amount parsing; type from column or sign; transfers/invalid rows skipped + counted;
      imports into the chosen target account.
- [ ] **JSON** (§6, T3): v1 envelope accepted, higher `schemaVersion` rejected; transactions imported,
      other envelope sections ignored; no mapping step.
- [ ] **Resolution** (C2): existing categories matched case-insensitively; unmatched → created (CREATE)
      or null (UNCATEGORIZED); batch name de-dup; created rows are `userId`-owned, `isSystem:false`.
- [ ] **Dedup** (D4): re-importing the same file into the same account creates **zero** rows;
      legitimate duplicates preserved; toggle off imports all.
- [ ] **Own-CSV round-trip** (regression anchor): exporting transactions to CSV (`/api/export/csv`) then
      importing that file back maps with **zero manual mapping** and reproduces every non-transfer row
      losslessly (date, signed amount via type, category by name, merchant, note) — modulo the
      documented transfer (D1) and dedup (D4) behavior. This is the feature's primary regression test.
- [ ] **Text determinism** (D9): whitespace-only merchant/note/category → null; over-cap merchant/note
      truncated (+ flagged in the preview); over-cap category text → null, never a truncated category.
- [ ] **Detected dialect + high-skip warning** (T5): the CSV inspection reports delimiter / decimal
      separator / date format and seeds the mapper; the preview shows a loud warning (non-blocking) when
      the skipped share is `≥ IMPORT_HIGH_SKIP_RATIO`.
- [ ] **Parse hardening** (S7): a single field over `IMPORT_MAX_CELL_CHARS` is truncated during the
      scan (including a quoted multi-line field); a file over `IMPORT_MAX_FILE_BYTES` is rejected before
      parsing.
- [ ] **Currency notice** (D2): the preview states imported rows take the target account's currency
      (file currency ignored).
- [ ] **Category create race-safety** (§7.2, §10.3): a `createMany({ skipDuplicates })` that inserts
      zero rows still re-queries the name → an existing id; no unlinked/duplicate category, no dropped
      transaction.
- [ ] **Bound/perf smoke** (§10.4): the pure pipeline over `IMPORT_MAX_ROWS` rows completes within the
      budget; `partitionForWrite` is map-based (no O(n²) at the ceiling).
- [ ] **Normalization** (D2/D3): amounts stored signed from type, magnitude 2dp, currency from target
      account; dates `@db.Date` at UTC midnight.
- [ ] **Atomic + bounded** (D7/S4): one `$transaction` (categories then transactions via `createMany`);
      over `IMPORT_MAX_ROWS` / oversized file / bad envelope → whole-import error, no writes.
- [ ] **Preview == commit** (D6): `previewImport` writes nothing; over an unchanged DB both actions
      produce identical counts/issues; when the ledger changed in between, `commitImport` is
      authoritative and sets `divergedFromPreview` (UI shows a calm notice).
- [ ] **Duplicate CSV headers** (§5.2): mapping is by column index; two same-named columns are
      distinguishable and never silently first-match-bound.
- [ ] **Category match normalization** (C2): trim + whitespace-collapse + NFC + case-insensitive, both
      sides through `normalizeCatKey`; NFC/NFD-identical names resolve to one category.
- [ ] **Distinct structural errors** (D5): empty (zero-byte / header-only / `transactions: []`),
      unreadable, over-cap, and bad-envelope each return their own message, zero writes.
- [ ] **JSON forward-compat** (T3): unknown extra fields are ignored; only an unknown `schemaVersion`
      is rejected.
- [ ] **Access** (S1/S2/S3/S6): every action `auth`-guarded (action-result, not 401), `userId`-scoped,
      target ownership verified, per-user rate-limited, **no `isPro` read**.
- [ ] **UI** (T2): `/settings` → `/import`; zero-account empty state; counts + sample + issues in the
      preview; Sonner result toast + refresh.
- [ ] **Tests** (§10): pure parsers/resolver/dedup/JSON, DB query contracts, and action paths covered.
- [ ] `npm run test:run` and `npm run build` pass; **no schema change**, no migration, no `db push`.
