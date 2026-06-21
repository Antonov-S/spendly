# Data Export — Implementation Spec

> **Goal:** Ship the **data portability** slice — let any user (Free *or* Pro) download their full
> financial history as a **CSV** (flat transaction ledger) or a **JSON** (complete structured dump),
> scoped to the current account filter. This is the `/api/export/*` pair that
> [project-overview.md](../../docs/project-overview.md) → Data Portability and
> [ROADMAP.md](../ROADMAP.md) §6 (Delivery Sequence slot #5) call for.

This spec follows [entity-crud-architecture.md](../entity-crud-architecture.md) and mirrors the
already-shipped slices. It is the **first feature in the codebase to use a non-auth API route** —
and that is correct, not a deviation (§2).

**How to read this spec (layering).** It is ordered **contract → model → implementation → tests**:

| Layer | Section | What it is |
|---|---|---|
| **Contract** | §1 | Every binding rule, stated **once**. The single source of truth. |
| **Model** | §3 | The dataset the contract operates on — fetchers, scoping, normalization. |
| **Implementation** | §5 (CSV), §6 (JSON), §7 (routes), §8 (UI) | Format/transport specifics that *reference* §1/§3, never restate them. |
| **Tests / process** | §10–§13 | Test plan, decisions, workflow, acceptance. |

If a later section ever appears to contradict §1, **§1 wins** — the prose elsewhere is rationale.

---

## 1. The contract (single source of truth)

Every binding rule lives here, once — terse, testable assertions. Rationale lives in §3/§11, not
inline. Each rule is tagged **MUST/SHOULD/MAY** (RFC-2119) and either **`[inv]`** (hard invariant —
correctness/security; a change is a bug) or **`[prod]`** (a product reading that may evolve, but only
under a `schemaVersion` bump §6.2, so consumers can detect it). The five `[prod]` rules — **C2, D4,
D5, D6, D8** — are the only decisions open to revisiting; everything else is frozen.

### 1.1 Security & access — MUST (all `[inv]`)

- **S1** Both routes call `auth()` and return **401** (no redirect) when there is no `session.user.id`.
- **S2** **Every** query is scoped by the session `userId`. A client-supplied `?account=` only
  *narrows within* the user's own data — never trusted for ownership.
- **S3** Both routes are **rate-limited per `userId`** before any DB work (baseline in §7.3).
- **S4** **No financial data in the URL** — only the opaque `?account=<cuid>`.
- **S5** CSV free-text columns are **formula-injection-neutralized**; numeric/enum columns are not (§5.2).
- **S6** Export is **tier-agnostic** — available to Free and Pro alike; `isPro` is **never read**.

### 1.2 Scoping — MUST

- **C1** `[inv]` One source of truth for transaction scoping: `exportTxWhere(userId, accountId)`
  (§3.1). No `?account=` → all accounts but **active only**; explicit `?account=<id>` → that account
  **by id, archived allowed**; foreign/unknown id → **empty** (ownership-safe).
- **C2** `[prod]` **JSON scoping is intentionally asymmetric** (rationale §3.2). Account-bound
  entities scope to `?account=`; account-independent entities are always included in full. **Do not
  "normalize" this**; changing it is a `schemaVersion` bump.

### 1.3 Dataset & normalization — MUST

These define *what* the export contains and *how every value is shaped*, identically for CSV and
JSON. Stated once here; §3.3 is the implementation of this list.

- **D1** `[inv]` **Soft-deleted transactions (`deletedAt != null`) are excluded everywhere.**
- **D2** `[inv]` Amounts are exported **signed** (`INCOME` +, `EXPENSE` −, transfers two opposite
  legs); `Decimal` → `number` at the fetcher boundary (safe at `Decimal(12,2)`).
- **D3** `[inv]` `@db.Date` → `YYYY-MM-DD` from **UTC components** (never a shifted `toISOString()`
  date); timestamps (`createdAt`, `exportedAt`) → full **ISO 8601**.
- **D4** `[prod]` **Transfers** export as **both legs** — CSV as two separate rows, JSON via
  `transferPairId` + `isTransferLeg`. The feed's display-time collapse is **not** replicated.
- **D5** `[prod]` **Null category** → empty `Category` field (CSV) / `categoryId: null` (JSON). The
  CSV does **not** synthesize "Uncategorized" (that is a display label, not a ledger value).
- **D6** `[prod]` Every entity has an **export class** — *account-bound* (scoped to `?account=`),
  *global* (always full), or *never* (auth rows, transient drafts); categories are **user-owned
  only**. The map is §3.4; a new entity MUST be classified there before it can be exported (no default).
- **D7** `[inv]` **Empty export is valid** — a user with no transactions gets a header-only CSV and an
  empty-arrays JSON envelope. The routes **never 500 and never redirect**.
- **D8** `[prod]` **Size cap** (§7.2): the transaction query takes `EXPORT_MAX_TRANSACTIONS + 1`; over
  the cap → CSV truncates with a marker row, JSON returns **413** (never a partial-but-complete dump).
- **D9** `[inv]` **EUR-only:** every `currency` is `EUR`; no FX, no mixed-currency path.

### 1.4 Transport defaults — SHOULD / MUST

- **T1 (MUST)** Routes are `runtime = "nodejs"` + `dynamic = "force-dynamic"` (Prisma + Web streams
  need Node; never cached).
- **T2 (MUST)** `Content-Disposition: attachment; filename="spendly-export-YYYY-MM-DD.<ext>"` (§7.1).
- **T3 (SHOULD)** CSV streams **incrementally**; JSON is **serialized whole then enqueued** (§7).
- **T4 (SHOULD)** JSON is **pretty-printed** (2-space) — a deliberate readability-over-bytes tradeoff (§6.3).
- **T5 (SHOULD)** The entry point lives on **`/accounts`**, links carrying the current `?account=` (§8).

### 1.5 Free choices — MAY

- `Popover`-API menu vs two plain links for the entry point (§8).
- Tuning the rate-limit window *upward* once real usage is observed (§7.3).

---

## 2. Why an API route, not a Server Action

The app routes **all** entity CRUD through server-only fetchers + Server Actions, reserving `/api/*`
for "webhooks, file uploads, or operations callable outside the Next.js render cycle"
([entity-crud-architecture.md](../entity-crud-architecture.md)). A **file download** is exactly that:

- A Server Action returns a serializable value to a React transition — it **cannot** set
  `Content-Disposition`, stream a file, or trigger a browser "Save as…". An `<a href>`/GET returning
  a `Response` with download headers can.
- [ROADMAP.md](../ROADMAP.md) → Spec Alignment Notes is explicit: *"The only new API routes are the
  Stripe webhook and the data-export streaming routes (`/api/export/*`, a genuine 'callable outside
  the render cycle' case — architecturally required)."*

So this slice adds two GET routes and **no Server Actions**. Like Reports, it is **read-only** — no
mutations, no `revalidate*`. And it is **not a Pro gate** (contract S6): withholding a user's own
financial data erodes trust ([project-overview.md](../../docs/project-overview.md) → Data
Portability; Monetization table: "Data export ✓ Free ✓ Pro").

### Scope

**In:** `GET /api/export/csv` (flat ledger, UTF-8 BOM), `GET /api/export/json` (versioned structured
dump); the pure helpers (`src/lib/export/*`), the fetchers (`src/lib/db/export.ts`), a minimal
`/accounts` entry point, and unit tests.

**Out (explicit):** any mutation / Pro gate / `isPro` read; **re-import** (the envelope is versioned
so it's cheap later — §6.2 — but no importer is built); PDF/XLSX/chart export; date-range or category
filtering of the export (**only** the account filter scopes it); a `/settings` host (Settings §7
ships later); background/emailed export (synchronous only — see the Export-v2 map in §7.2); system
categories in the JSON dump (contract D6).

---

## 3. Model — the export dataset

This is the single data layer both formats consume. The fetchers in `src/lib/db/export.ts`
(`import "server-only"`) are the **only** place the contract's scoping (C1/C2), ownership (D6), and
normalization (D1–D5) rules are realized; CSV and JSON are pure transforms over their output.

### 3.1 Transaction scoping — `exportTxWhere` (realizes C1, S2, D1)

```ts
// src/lib/db/export.ts
/** user scope + soft-delete + account scoping — the single source for export WHERE. */
export function exportTxWhere(userId: string, accountId: string | undefined) {
  return {
    userId,
    deletedAt: null,
    financialAccount: accountId ? { id: accountId } : { isArchived: false },
  };
}
```

Same shape as `reportTxWhere` (`src/lib/db/reports.ts`) — keep them consistent. Exporting it makes
the security-critical scoping rule directly unit-testable (§10): a regression that drops `userId` or
leaks archived accounts in the all-accounts view fails fast.

### 3.2 The JSON scoping asymmetry — the rationale for C2

When `?account=` is set, account-bound entities scope to it; global entities (user categories,
budgets, goals + contributions) are still included **in full**. **Why:** clamping a per-category
budget or a virtual goal "to an account" is meaningless (no `financialAccountId`, no balance touch) —
scoping them would either drop them (a misleading backup) or fabricate a join. Including them whole
is the honest reading of "scoped to this account's data."

Two consequences, both load-bearing:

- **Don't "normalize" it.** A refactor that drops budgets/goals when scoped, *or* invents a join onto
  them, breaks the export's meaning. Note it in the route comment so it reads as intentional.
- **It's export-format behavior, not global data semantics.** Future consumers (importer, reporting
  reuse, integrations) make their **own** scoping decision — they don't inherit this. A change to it
  is a `schemaVersion` bump (C2 is `[prod]`).

### 3.3 Fetchers

| Fetcher | Returns | Realizes |
|---|---|---|
| `getTransactionsForExport(userId, accountId)` | `ExportTransactionRow[]` — joined account name + category name, all values normalized per D2–D5, `take: EXPORT_MAX_TRANSACTIONS + 1` (D8). **No `type` filter** (all of INCOME/EXPENSE/TRANSFER; D4). Feeds CSV and the JSON `transactions` array. | C1, D1–D5, D8 |
| `getFullExport(userId, accountId)` | `FullExport` — the §6.1 object: account-bound entities scoped (C2/§3.2), global entities by `userId` only, **categories `isSystem: false`** (D6), account `balance` derived (`deriveBalance` / the `getAccountsWithBalances` two-query pattern, no N+1). | C2, D6 |

Both convert every `Decimal` to `number` **before** returning (D2) — a Prisma `Decimal` must never
reach a pure helper or the response body.

### 3.4 Entity classification map (realizes D6) — the explicit decision point

The ownership classification is **data, not narrative** — a single map `getFullExport` reads, so
scoping a new entity is a one-line, reviewable change with a forced decision rather than a buried
`if`. Co-locate it with the fetcher:

```ts
// src/lib/db/export.ts
/**
 * Export membership for every entity. "bound" = scoped to ?account= (§3.2);
 * "global" = always included in full; "never" = excluded (auth/transient).
 * Adding an export entity REQUIRES adding it here first — there is no default,
 * so a new model can't silently leak (e.g. shipped account-global by accident).
 */
export const EXPORT_ENTITY_CLASS = {
  financialAccount:  "bound",
  transaction:       "bound",
  recurringTemplate: "bound",
  category:          "global",   // + isSystem:false filter (D6)
  budget:            "global",
  goal:              "global",   // incl. nested contributions
  recurringDraft:    "never",    // transient (D6)
  user:              "never",    // credentials/billing (D6)
} as const;
```

This is the formal answer to "what happens when a new entity is added later" (a real risk the review
flagged): the build fails the reviewer's eye, not silently — a new model has **no** entry, and the
spec rule (D6) says it can't be exported until it gets one. Keeps the asymmetry honest as the domain grows.

---

## 4. File plan

| Layer | File | Action |
|---|---|---|
| Pure — CSV | `src/lib/export/csv.ts` | **create** — `escapeCsvField`, `escapeCsvTextField`, `csvRow`, `transactionsToCsv`, `EXPORT_CSV_HEADER` |
| Pure — JSON | `src/lib/export/json.ts` | **create** — `buildExportEnvelope(data)` |
| Pure — filename | `src/lib/export/filename.ts` | **create** — `exportFilename(kind, date)` |
| Model — DB reads | `src/lib/db/export.ts` | **create** — `exportTxWhere`, `getTransactionsForExport`, `getFullExport` |
| Types | `src/types/export.ts` | **create** — `ExportTransactionRow`, `FullExport`, `ExportEnvelope<T>` |
| Constants (system) | `src/lib/system-constants.ts` | **modify** — `EXPORT_JSON_SCHEMA_VERSION`, `EXPORT_FILENAME_PREFIX`, `EXPORT_MAX_TRANSACTIONS`; add `export` to `RATE_LIMITS` |
| Constants (UI/domain) | `src/lib/constants.ts` | **modify** — `EXPORT_CSV_COLUMNS` |
| Route | `src/app/api/export/csv/route.ts` | **create** — GET; transport per §7 |
| Route | `src/app/api/export/json/route.ts` | **create** — GET; transport per §7 |
| UI | `src/components/accounts/export-links.tsx` | **create** |
| UI wiring | `src/app/accounts/page.tsx` | **modify** — read `?account=`, render `<ExportLinks>` |
| Tests (pure) | `test/lib/export/{csv,json,filename}.test.ts` | **create** (§10.1) |
| Tests (query contract) | `test/lib/db/export.test.ts` | **create** (§10.2) |

> No nav change — the entry point is in-page on `/accounts`; the routes are not navigation targets.

---

## 5. Implementation — CSV format

Flat ledger: **one row per non-deleted `Transaction`** (transfers = two rows per D4). Columns
(`EXPORT_CSV_COLUMNS`, in order — matches [ROADMAP.md](../ROADMAP.md) §6):

| Column | Source | Notes |
|---|---|---|
| `Date` | `transaction.date` | `YYYY-MM-DD` (D3) |
| `Amount` | `transaction.amount` | signed bare number (e.g. `-47.00`) — no `€`, no separators (machine-readable; D2) |
| `Type` | `transaction.type` | `INCOME` / `EXPENSE` / `TRANSFER` |
| `Category` | `category.name` | empty when null (D5) |
| `Account` | `financialAccount.name` | — |
| `Merchant` | `transaction.merchant` | empty when null |
| `Note` | `transaction.note` | empty when null |

> `transferPairId` is **not** a CSV column — keep CSV to these seven. Both legs still appear as rows,
> so `SUM(Amount)` reconciles to the true net (D4). JSON carries the pair linkage for full fidelity.

### 5.1 Encoding (RFC 4180)

- **Quoting** (`escapeCsvField`): a field containing comma, `"`, CR, or LF is wrapped in double
  quotes with embedded quotes doubled (`"`→`""`). Null/empty → empty field (not the string `"null"`).
- **UTF-8 BOM** prefixed **once** before the header so Excel detects UTF-8 (`€`, accented merchants).
  Prepended in the route's stream, **not** in `transactionsToCsv`, so the pure function stays a clean
  string transform tests can assert byte-for-byte.
- **Line ending** `\r\n`.

### 5.2 Formula-injection safety (realizes S5) — and the app-wide CSV contract

A cell starting with `=`, `+`, `-`, `@`, or leading tab/CR can be executed as a formula by
Excel/Sheets; RFC-4180 quoting does **not** neutralize it. The only attacker-influenced fields are
**merchant/note** (and category/account names), so neutralization is part of this slice.
`escapeCsvTextField` prefixes a single quote (`'`) when the first char is one of `= + - @ \t \r`,
**then** applies RFC-4180 quoting.

- **Which columns get which escaper:** the four free-text columns (`Category`, `Account`, `Merchant`,
  `Note`) use `escapeCsvTextField`; the controlled columns (`Date`, `Amount`, `Type`) use
  `escapeCsvField` and are **exempt** — `Amount` legitimately leads with `-`, `Date` with a digit,
  `Type` is a fixed enum. `transactionsToCsv` owns this mapping; keep it a small explicit pairing, not
  a branch ladder (and not a configurable pipeline — §11).
- **Single CSV authority.** `escapeCsvField` / `escapeCsvTextField` / `csvRow` are generic string
  utilities (only `transactionsToCsv` knows about transactions) — any future CSV surface reuses them
  rather than re-implementing escaping; promote them to `src/lib/csv.ts` unchanged if a second surface
  appears.

```ts
// src/lib/export/csv.ts — all pure
export const EXPORT_CSV_HEADER = EXPORT_CSV_COLUMNS.join(",");
export function escapeCsvField(value: string | number | null | undefined): string { /* RFC 4180 only */ }
export function escapeCsvTextField(value: string | null | undefined): string { /* formula-prefix THEN RFC 4180 */ }
export function csvRow(values: (string | number | null | undefined)[]): string { /* escaped join + \r\n */ }
export function transactionsToCsv(rows: ExportTransactionRow[]): string { /* header + rows, no BOM */ }
```

---

## 6. Implementation — JSON format

### 6.1 Envelope & dump contents

Wrap the payload in a **versioned envelope** from day one — never emit the bare object:

```ts
// src/types/export.ts
export interface ExportEnvelope<T> {
  schemaVersion: number;   // EXPORT_JSON_SCHEMA_VERSION
  exportedAt: string;      // ISO 8601 (D3)
  data: T;
}

// src/lib/export/json.ts — pure
export function buildExportEnvelope<T>(data: T, now: Date = new Date()): ExportEnvelope<T> {
  return { schemaVersion: EXPORT_JSON_SCHEMA_VERSION, exportedAt: now.toISOString(), data };
}
```

`data` (`FullExport`) — produced by `getFullExport` (§3.3), normalized per D2–D6:

| Key | Contents | Scope (per §3.2) |
|---|---|---|
| `accounts` | `{ id, name, type, currency, startingBalance, balance, color, icon, isArchived, createdAt }` | account-bound; `balance` derived |
| `categories` | `{ id, name, icon, color, createdAt }` | global; **user-owned only** (D6) |
| `budgets` | `{ id, amount, currency, month, year, isArchived, categoryId, createdAt }` | global |
| `goals` | `{ …, contributions: { id, amount, date, note, createdAt }[] }` | global |
| `recurringTemplates` | `{ id, name, type, amount, currency, cadence, nextOccurrence, isActive, financialAccountId, categoryId, createdAt }` | account-bound |
| `transactions` | the §5 columns + `id, isTransferLeg, transferPairId, financialAccountId, categoryId, recurringTemplateId, createdAt` | account-bound (D1) |

Exclusions (`RecurringDraft`, `User`/auth rows) are the contract's D6 — not restated here.

### 6.2 Versioning policy (forward contract for a future importer)

`schemaVersion` exists to make a future re-import cheap. Pin the policy now:

- **What bumps it:** any **structural** change to `data` — rename/remove a key, change a field's
  type/units, change date/number encoding. **Additive** changes (new key/array) bump it too; never
  silently add under the same version.
- **Encoding is part of the contract:** the D2–D6 guarantees above. Changing any is a version bump.
- **Importer expectation:** read `schemaVersion` **first**; handle known versions explicitly;
  **reject** an unknown (higher) version with "exported by a newer version of Spendly" rather than
  best-effort parsing.
- **Backward compatibility:** old dumps are immutable files — an importer **reads** older versions for
  as long as we advertise importable; dropping a version is an explicit, documented deprecation.
- Only the version field + this written contract ship now; the importer is a future slice.

### 6.3 Pretty-printing — a deliberate tradeoff (realizes T4)

Enqueue **`JSON.stringify(envelope, null, 2)`**.

> **Don't "optimize" this to compact.** A portability/trust artifact should be human-readable and
> diff-friendly; HTTP gzip erases the whitespace on the wire, so compact JSON buys almost nothing.
> Switching to `JSON.stringify(envelope)` "for performance" is a **regression of an intentional
> product decision** — if bandwidth ever truly matters, the answer is the Export-v2 async path
> (§7.2), not stripping whitespace.

---

## 7. Implementation — routes, streaming & transport

### 7.0 Pure ↔ HTTP boundary (what lives where)

A hard separation, so the testable logic never tangles with stream/HTTP concerns:

- **Pure helpers** (`src/lib/export/*`): string/shape transforms only — no `Request`/`Response`, no
  Prisma, no streams. `escapeCsv*`, `csvRow`, `transactionsToCsv`, `buildExportEnvelope`,
  `exportFilename`. Fully unit-tested (§10.1).
- **Model** (`src/lib/db/export.ts`): all Prisma + scoping/ownership/normalization (§3). No HTTP.
- **Route handlers** (`src/app/api/export/*`): **HTTP/stream glue only** — `auth()`, rate-limit,
  read `?account=`, call the fetcher, feed the pure helper into a `ReadableStream`, set headers,
  handle the 413/marker overflow. **No business logic** beyond wiring these together.

> **Enforce the boundary structurally, not just by prose (SHOULD).** Documentation drift is exactly
> how "no Prisma in route handlers" regresses. Add an ESLint `no-restricted-imports` override for
> `src/app/api/export/**` forbidding `@/lib/prisma` (and `@/generated/prisma`) — route handlers reach
> the DB **only** through `src/lib/db/export.ts`. Cheap to add, and it turns the §7.0 rule from a
> hope into a lint failure. (If the repo's ESLint config makes a scoped override awkward, this stays a
> review-checklist item — but the import rule is the preferred mechanism.)

### 7.1 Streaming, headers & filename

Both routes return a `Response` built on a `ReadableStream` ([ROADMAP.md](../ROADMAP.md) §6).

- **CSV — incremental (T3).** Enqueue BOM → `EXPORT_CSV_HEADER + "\r\n"` → rows (a single bounded
  `findMany` then chunked enqueue is fine at MVP volume; the cursor upgrade is §7.2). Peak memory
  stays bounded.
- **JSON — whole then enqueued (T3).** Assemble `FullExport`, `buildExportEnvelope`, enqueue the one
  pretty-printed string. **The JSON path is not incremental** — the `ReadableStream` is only a uniform
  response wrapper. Say so in the route comment; do not imply per-section streaming.

```
Content-Type:        text/csv; charset=utf-8        (CSV)
                     application/json; charset=utf-8 (JSON)
Content-Disposition: attachment; filename="spendly-export-2026-06-20.csv"   (T2)
Cache-Control:       no-store
```

```ts
// src/lib/export/filename.ts — pure
export function exportFilename(kind: "csv" | "json", now: Date = new Date()): string {
  const d = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
  return `${EXPORT_FILENAME_PREFIX}-${d}.${kind}`;   // UTC components (D3)
}
```

```ts
// src/app/api/export/csv/route.ts (json mirrors it; body builder + headers differ)
export const runtime = "nodejs";            // T1
export const dynamic = "force-dynamic";     // T1
import { auth } from "@/auth";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return exportError(401, "Unauthorized");   // S1, §7.1.1
  // rate-limit (§7.3) → read ?account= → fetch (§3) → stream via pure helper → headers
}
```

> **No `requireOnboarded` here.** That guard `redirect()`s and is for *pages*. A zero-account user
> gets a valid empty file (D7), not a redirect. `401` (S1) is the only gate.

#### 7.1.1 Unified failure contract

Every **pre-stream** failure — `401` (S1), `429` (S3), `413` (D8) — returns the **same minimal JSON
error envelope**, so a frontend or external consumer can treat both formats interchangeably on the
error path even though their success bodies differ:

```ts
// shared by both routes
type ExportError = { error: string; code: "unauthorized" | "rate_limited" | "too_large" };
function exportError(status: number, error: string, code: ExportError["code"]): Response {
  return Response.json({ error, code }, { status });
}
```

- Failures are always decided **before** the `ReadableStream` starts (auth → rate-limit → count
  check all precede the first `enqueue`), so a half-written CSV/JSON body can never carry an error —
  the response is *either* a clean `2xx` stream *or* a JSON error, never a mix.
- `429` reuses the existing `tooManyRequestsResponse` shape (it already returns JSON + `Retry-After`);
  align its body to `{ error, code: "rate_limited" }` so all three errors are one shape.
- This is the **only** structured-error surface; success bodies remain the raw file (CSV text / JSON
  envelope). The CSV truncation **marker row** (D8) is *not* an error — it is a successful `200` with
  an in-band notice, because the file is still valid and complete-as-far-as-it-goes.

### 7.2 Size & overflow (realizes D8) + the Export-v2 map

MVP ceiling is **≤10K transactions/user** ([project-overview.md](../../docs/project-overview.md) →
Out of Scope). `EXPORT_MAX_TRANSACTIONS` caps it; the fetcher takes `cap + 1` so overflow is
detectable. The route **degrades predictably**:

- **CSV:** stop at the cap, append a commented marker row (leading `#` keeps it out of the data grid),
  e.g. `# Export truncated at 10000 transactions. Contact support for a full archive.` — still a valid
  file, not a silent truncation.
- **JSON:** over the cap → **413** via the unified failure contract (§7.1.1):
  `exportError(413, "Export exceeds the maximum size. Contact support.", "too_large")`. A partial JSON
  backup that *looks* complete is worse than an explicit failure.
- A **safety rail, not the expected path** — no normal MVP user hits it; it defines the boundary
  behavior instead of an OOM/hang.

**Runtime/timeout:** `runtime="nodejs"` (T1); on serverless the platform function timeout (~10–15s)
is the effective ceiling, and the row cap keeps a single export well inside it. `maxDuration` is the
known knob if a host needs more.

**Above the envelope — "Export v2" (documented, not built; §2 out-of-scope):** in effort order —
(1) **cursor-paginated CSV streaming** (swap the bounded `findMany` for a keyset cursor loop into the
same stream → constant memory, **no API change**; the `getTransactionsForExport` boundary is the
seam); (2) **async job** (enqueue → `202` → file to object storage → time-limited signed link; the
only sane path for multi-MB JSON); (3) **aggregate snapshots** (shared with Reports §7.1) if queries,
not serialization, dominate.

### 7.3 Rate limiting (realizes S3) — production baseline

The export pair is the **heaviest authenticated read in the app**, and a download link is trivially
re-triggerable. Reuse the existing fail-open limiter (`src/lib/rate-limit.ts`). **Ship this exact
value:**

```ts
// src/lib/system-constants.ts → RATE_LIMITS
export: { limit: 10, window: "1 m" }   // 10 exports / minute / user, sliding window
```

- **Key:** the session `userId` — `checkRateLimit("export", session.user.id)`. Per-user, not per-IP
  (authenticated route; shared-NAT users mustn't throttle each other; can't dodge via IP rotation).
- **Burst behavior** *is* the sliding window (same algorithm as the auth policies) — 10 requests in
  any rolling 60s is the ceiling; no separate burst bucket.
- **Placement:** top of each route, **before any DB work**; on exceed return
  `tooManyRequestsResponse(retryAfterSeconds)` (real **429** + `Retry-After`).
- **Shared budget:** both routes use the same `export` policy/key (a user can't 10× CSV *and* 10× JSON).
- **Fail-open** when Upstash is unconfigured — local dev needs no setup.

Definitive baseline, not a placeholder. Only *upward* tuning after observing traffic is open (§11) —
a config edit, not a design change.

---

## 8. Implementation — UI entry point (`/accounts`)

Minimal, per [ROADMAP.md](../ROADMAP.md) §6 ("a simple link is sufficient — no UI beyond that"):

- **`src/components/accounts/export-links.tsx`** — two `<a download href="/api/export/csv?account=…">`
  / `…/json?account=…` links (a small "Export" group; a Popover-API menu is a MAY, plain links are simpler).
- **Carry the current `?account=` scope** so the export matches what the user sees. `accounts/page.tsx`
  adds `searchParams`, reads `account`, passes it to `<ExportLinks accountId={…} />` which appends
  `?account=` only when set. `download` makes the browser save; the server's `Content-Disposition`
  filename (T2) still wins for the saved name.
- **Placement:** the page header area (near "Add account"), a quiet secondary affordance. Renders even
  with zero accounts (empty export is valid, D7) — **not** inside the `accounts.length === 0` branch.
- **Host-agnostic:** the component takes only an optional `accountId`, so when `/settings` (§7) ships
  it can be mounted there too — no route change.

---

## 9. Constants

```ts
// src/lib/system-constants.ts
/** Bump on ANY structural change to the JSON export envelope (§6.2). */
export const EXPORT_JSON_SCHEMA_VERSION = 1;
/** Download filename stem: spendly-export-YYYY-MM-DD.<ext>. */
export const EXPORT_FILENAME_PREFIX = "spendly-export";
/** Hard cap on transactions per export (D8 / §7.2). Safety rail, not the expected path. */
export const EXPORT_MAX_TRANSACTIONS = 10_000;
// + RATE_LIMITS.export = { limit: 10, window: "1 m" }   (§7.3)
```

```ts
// src/lib/constants.ts
/** CSV column headers, in output order. Drives EXPORT_CSV_HEADER and the row builder. */
export const EXPORT_CSV_COLUMNS = [
  "Date", "Amount", "Type", "Category", "Account", "Merchant", "Note",
] as const;
```

No magic strings/numbers in routes or components — pull from these (coding standards).

---

## 10. Testing (`test/`, Vitest, mock `@/lib/prisma` — never a real DB)

Per coding standards: cover `src/lib/**`; **no component tests**. Split by layer (§7.0): pure-helper
tests assert *transforms*; query-contract tests assert the *`where`/`take` shape* the model passes to
Prisma. The route handlers are thin glue (§7.0) and carry no logic to unit-test beyond what these cover.

### 10.1 Pure-helper tests

**`test/lib/export/csv.test.ts`**
- `escapeCsvField`: plain unchanged; comma/`"`/`\n`/`\r` → quoted (embedded `"` doubled);
  null/undefined/empty → empty field (not `"null"`); numeric → string form; a value leading with
  `=`/`-` is **not** formula-prefixed (this helper is RFC-4180 only — Amount relies on leading `-` surviving).
- `escapeCsvTextField`: leading `=`/`+`/`-`/`@`/tab/CR → `'`-prefixed and quoted as needed
  (`=cmd()`→`'=cmd()`); plain unchanged; comma/quote/newline still RFC-4180 quoted; combined
  (`=a,b"c`) does both.
- `csvRow`: comma-join, `\r\n` terminator, field order, mixed null/number/text.
- `transactionsToCsv`: first line `EXPORT_CSV_HEADER`; one row per tx; `-47.00` stays un-prefixed
  (proves Amount uses `escapeCsvField`); a `Note` of `=cmd()` is neutralized (proves text columns use
  `escapeCsvTextField`); null fields empty; a merchant with `",\n"` round-trips; **no** BOM.

**`test/lib/export/json.test.ts`** — `buildExportEnvelope`: `schemaVersion === EXPORT_JSON_SCHEMA_VERSION`;
ISO `exportedAt` (fixed `now`); `data` passed through unchanged; empty `data` still valid.

**`test/lib/export/filename.test.ts`** — `exportFilename`: `spendly-export-YYYY-MM-DD.{csv,json}`,
zero-padded, UTC components (assert near a UTC day boundary).

### 10.2 DB query-contract tests — `test/lib/db/export.test.ts`

Mock `@/lib/prisma`; assert the arguments each fetcher passes (the rules pure helpers can't reach):

- **`exportTxWhere`** (C1, S2, D1): `userId` + `deletedAt: null` always; no `accountId` →
  `financialAccount: { isArchived: false }`; with `accountId` → `financialAccount: { id }`, **no**
  `isArchived` filter (archived honored). Mirrors the `reportTxWhere` test.
- **`getFullExport` scoping asymmetry** (C2/§3.2): with `accountId`, account-bound queries
  (`financialAccount`, `transaction`, `recurringTemplate`) scope to it; **global** queries
  (`budget`, `goal`) are `userId`-only — **no** `financialAccountId` filter.
- **Category filter** (D6): categories queried with `where: { userId, isSystem: false }`.
- **No `type` filter** (D4): `getTransactionsForExport` does not filter by `type`.
- **Row cap** (D8): the transaction query passes `take: EXPORT_MAX_TRANSACTIONS + 1`.
- **Classification completeness** (§3.4): a drift guard asserting every exportable Prisma model has an
  `EXPORT_ENTITY_CLASS` entry (and that `recurringDraft`/`user` are `"never"`) — so a future model
  can't be silently omitted.

Run `npm run test:run` **and** `npm run build` green before commit.

---

## 11. Decisions

All binding rules are the §1 contract — not repeated here. This section records only **why** the
contentious ones went the way they did, plus what's open.

- **API routes, not Server Actions** — file downloads are the documented render-cycle exception (§2).
- **CSV = one row per transaction** (D4) — the feed's collapse is display-only; the raw ledger must
  reconcile.
- **CSV signed bare-number Amount** (D2) — machine-readable/reconcilable; `€` and separators are
  display concerns.
- **JSON scoping asymmetry** (C2/§3.2) — the only coherent reading of "scoped to the account filter"
  given the data model; flagged do-not-normalize.
- **JSON pretty-printed** (T4/§6.3) — readability over bytes; gzip erases the cost.
- **Rate limiting in-slice, `{ limit: 10, window: "1 m" }`** (S3/§7.3) — not deferred.
- **Hard size cap + defined overflow** (D8/§7.2) — async export is the documented fix above it.
- **`schemaVersion` forward contract** (§6.2) — field + policy ship now; importer later.

### Deliberately not doing (over-engineering for the MVP — documented future evolution)

The project ethos is "decisions over options; pick one implementation"
([project-overview.md](../../docs/project-overview.md) #5). Two reviewer suggestions are the *right*
post-MVP direction but premature now; recorded so the decision is explicit, not an oversight:

- **A general cell-sanitizer *pipeline* framework.** We adopt declarative per-column escapers (§5.2)
  — the 80% win — but **not** a configurable multi-stage pipeline abstraction. Seven fixed columns
  don't justify it; revisit only if a CSV surface with dynamic/user-defined columns ever appears.
- **Cost-based rate limiting (rows/bytes/query-weight).** Export cost genuinely varies (CSV vs JSON,
  account size), but the existing limiter is request-count sliding-window and the size cap (D8) already
  bounds the worst case per request. A weighted limiter is the **documented evolution** if abuse or
  cost variance shows up in real traffic — pair it with the Export-v2 async path (§7.2), where a job
  queue is the natural place to meter cost. Not built now.

### Still open (MAY — record the pick in `current-feature.md`)

- **Rate-limit window tuned *upward*** after real traffic (§7.3) — a config edit.
- **Entry point: Popover menu vs plain links** (§8) — cosmetic.

---

## 12. Workflow (per [ai-interaction.md](../../docs/ai-interaction.md))

1. **Document** in `docs/current-feature.md`.
2. **Branch** `feature/data-export`.
3. **Implement** (contract → model → impl → tests): constants + types → pure helpers + their tests →
   `src/lib/db/export.ts` (`exportTxWhere`, fetchers) + query-contract test → the two routes →
   `<ExportLinks>` + `/accounts` wiring.
4. **Test:** §10 specs; `npm run test:run` + `npm run build`; browser pass — download CSV and JSON as
   `demo-pro` (all accounts) and with one account selected (`?account=` carried); open the CSV in a
   spreadsheet to confirm BOM/encoding and that a comma-bearing merchant survives; confirm soft-deleted
   rows absent; confirm `demo-nonpro` (Free) can export both (no gate, S6); confirm `401` when signed out.
5. **Iterate**, then **commit** on green (conventional `feat:`, **no agent attribution** per CLAUDE.md),
   **merge** to `main`, **delete** branch, mark done in `current-feature.md` history.

---

## 13. Acceptance criteria

- [ ] **CSV** (§5, contract D1–D5, S5, T2): UTF-8 BOM, seven `EXPORT_CSV_COLUMNS`, one row per
      non-deleted tx (transfers = two rows), signed bare-number amounts, RFC-4180 quoting (comma/quote
      round-trips), text-column formula neutralization with `Amount`'s leading `-` preserved, and the
      `Content-Disposition` filename.
- [ ] **JSON** (§6, contract D2–D6): `{ schemaVersion: 1, exportedAt, data }`, pretty-printed; `data`
      has accounts (derived balance), **user-owned** categories, budgets, goals + nested contributions,
      recurring templates, non-deleted transactions; all `Decimal`→`number`, `@db.Date`→`YYYY-MM-DD`.
- [ ] **Access** (S1, S2, S6): `auth()`-guarded (`401`, no redirect), every query `userId`-scoped,
      no `isPro` read anywhere.
- [ ] **Scoping** (C1, C2): `?account=` — all-accounts excludes archived; explicit id honored
      (archived allowed); foreign id → empty. JSON asymmetry per §3.2.
- [ ] **Rate limiting** (S3): shared `export` policy keyed by `userId`, fail-open, `429` + `Retry-After`.
- [ ] **Unified failure contract** (§7.1.1): `401`/`429`/`413` all return `{ error, code }` JSON,
      decided before any stream byte; success bodies remain the raw file.
- [ ] **Size cap** (D8): query takes `EXPORT_MAX_TRANSACTIONS + 1`; CSV truncates with a marker row,
      JSON returns `413` over the cap.
- [ ] **Empty export** (D7): header-only CSV / empty-arrays JSON — never 500 or redirect.
- [ ] **UI** (T5): `/accounts` shows "Export CSV" / "Export JSON" links carrying the current `?account=`.
- [ ] **Tests** (§10): pure helpers (`escapeCsvField`, `escapeCsvTextField`, `csvRow`,
      `transactionsToCsv`, `buildExportEnvelope`, `exportFilename`) unit-tested; query-contract tests
      assert `exportTxWhere`, the JSON scoping asymmetry, the `isSystem: false` filter, the no-`type`
      rule, and the `take` cap.
- [ ] `npm run test:run` and `npm run build` pass; **no schema change**, no `db push`.
```