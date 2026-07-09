# Transaction Tags — Implementation Spec

> **✅ Shipped (`feature/transaction-tags`, POST-MVP §16).** Free-form, user-owned labels orthogonal to
> categories (`vacation-2026`, `reimbursable`) — many per transaction, created inline in the drawer,
> filterable in the feed (match-any), and managed on `/settings`. Two additive models (`Tag` +
> `TransactionTag`) + a `--create-only` functional `(lower(name), userId)` unique index; no existing
> table changed. Income/expense only (transfers untouched, §7); hard delete + confirm (no undo);
> `createTransaction`/`updateTransaction` stay the sole writers (atomic `$transaction`, all-or-nothing
> tag-ownership check, unchanged-set skip on update). Not Pro-gated, no count limit. Export/import of
> tags **intentionally deferred** (§12). 36 new tests (741 total pass), build + lint clean (0 errors).
> Confirmed numbers: `TAG_NAME_MAX = 32`, `TAG_MAX_PER_TRANSACTION = 12`, `TAG_CHIPS_VISIBLE_MAX = 3`.
> **Deviation:** feed-row chips render on the full `/transactions` feed only; the dashboard's compact
> recent-transactions list keeps its existing form (it uses a separate `TransactionRow` type/component)
> — `TAG_CHIPS_VISIBLE_MAX` stays the shared constant for when dashboard chips are added.

> This was POST-MVP-ROADMAP **§16**, Delivery Sequence **slot #8** — the first committed item after Data
> Import (§15) and the first slice in this backlog to add a **new schema model** since the MVP. It
> **supersedes Category Hierarchy (§12)**, which stays parked.

> **Goal:** Give users **free-form labels orthogonal to categories** — `tax-deductible`,
> `reimbursable`, `vacation-2026`, `business-trip` — that a single transaction can carry several of,
> creatable inline in the transaction drawer, filterable in the feed, and managed from `/settings`.
> Categories stay single and spending-bucket-shaped; tags are the **cross-cutting dimension**.

This spec follows [entity-crud-architecture.md](../entity-crud-architecture.md) and the field rules in
[entity-types.md](../entity-types.md). It deliberately mirrors the just-shipped **User Category
Management** slice ([user-category-management-spec.md](./user-category-management-spec.md)) —
tags are "categories without the FK-cascade drama plus a many-to-many join" — so most patterns
(inline `<…PickerField>`, `/settings` manage card, case-insensitive dedup via a functional unique
index, hard-delete-with-confirm) are lifted directly. Where tags differ from categories, this spec
says so explicitly.

---

## 1. Why this slice

Categories answer *"what kind of spending is this?"* — one per transaction, and they drive budgets
and the Reports breakdown. Users repeatedly need a **second, cross-cutting** axis that a single
category can't express:

- **A trip** touches Dining, Transport, Groceries, and Entertainment — `vacation-2026` groups them.
- **Reimbursables** and **tax-deductible** spend span every category — a boolean-ish label, not a bucket.
- **A project / event** (`wedding`, `business-trip`, `home-reno`) is orthogonal to what was bought.

**Why tags, not category hierarchy (the §12 it replaces).** Nesting (`Food → Groceries / Dining`)
solves *some* grouping but forces a tree onto categories: a self-referencing `parentId`, parent/child
budget roll-up, Reports grouping rework, and a break to the flat `@@unique([name, userId])` model —
high blast radius for weak value. Tags solve the same "group across categories" need with **more**
flexibility (many per transaction, any combination) at a **fraction** of the cost: one new model, one
join, and no change to how budgets or the category system work. ROADMAP §12/§16 make this the explicit
call; this slice realizes it.

**Not a Pro feature.** Tags are core organization, not analytical depth — free on both tiers, no count
limit (same stance as user categories; Monetization gates nothing here).

---

## 2. Scope

### In scope

- **Schema:** a `Tag` model (`id`, `name`, `color?`, `userId`, `createdAt`) + a `TransactionTag`
  many-to-many join (`transactionId`, `tagId`). One additive migration; no existing table changes.
- **Validation:** Zod schemas for create/update tag, plus a `tagIds` array threaded into the existing
  transaction create/update schemas.
- **Actions:** a new `src/actions/tags.ts` (`createTag`, `updateTag`, `deleteTag`, `getTagForEdit`
  proxy). `createTransaction` / `updateTransaction` extended to write the join rows.
- **DB reads:** `getUserTags(userId)` (all own tags, for pickers/filter) and
  `getManageableTags(userId)` (own tags + usage count, for the manage list). Feed query includes tags.
- **Inline create** from a shared `<TagPickerField>` (multi-select) in the transaction drawer — a
  "+ New tag" affordance that auto-selects the new tag, mirroring `<CategoryPickerField>`.
- **Feed:** a **tag filter pill** on `/transactions` (URL-driven, multi-select, **match-any / OR**);
  tag chips rendered on feed rows; tag name folded into the existing text search.
- **Management:** a "Tags" card on `/settings` (create / edit / delete), with a confirm-delete dialog.
- A centralized `revalidateTagViews()` helper.
- Vitest unit tests for the actions + pure helpers.

### Out of scope (explicit)

- **Tags on transfers.** v1 tags **income/expense only**, exactly like the category field in the
  drawer — `createTransfer` / `updateTransfer` are untouched. (A transfer is a money *move*, not a
  spend; tagging both legs raises "which leg / do they diverge?" questions not worth it for v1. The
  join model would physically allow it later.) Documented in §7.
- **A Reports tag-breakdown chart.** ROADMAP §16 lists it as "optionally." Deferred to keep blast
  radius small — this slice makes tags *exist and filter*; a `/reports` tag chart is a clean follow-up
  slice (the join is already query-ready). See §11.
- **Budgets or goals by tag.** Budgets remain per-category. No tag-scoped spending ceiling.
- **Tag hierarchy / tag groups.** Flat list, same as categories.
- **Bulk-tagging existing transactions** (a "select 20 rows → add tag" tool). Post-MVP; tags are set
  per-transaction in the drawer.
- **AI tag suggestion.** The §3 AI foundation could suggest tags later; not in v1.
- **Soft delete / undo for tags.** `Tag` has no `deletedAt`; deletion is a hard delete guarded by a
  confirm dialog (mirrors categories/goals), not the 8-second snackbar. The join rows cascade away.
- **A `/tags` route.** Management lives inline (drawer) + a `/settings` card — no new page (same call
  as category management).
- **Export / import of tags — intentionally deferred this release (not an integration oversight).**
  The CSV/JSON export and the `/import` pipeline are knowingly left untouched; tags are neither written
  to an export nor read from an import in v1. See the **NOTE** below and §12 for the consequence (a JSON
  round-trip loses tag *associations*) and the additive follow-up that closes it.

> **NOTE — reviewers: the export/import omission is deliberate.** This slice adds a new
> `Transaction`↔`Tag` relationship but **does not** extend `src/lib/db/export.ts`, the JSON envelope, or
> `src/lib/import/*`. That is a conscious scope boundary (keep the slice small), **not** a missed
> integration. A lossless round-trip of tags is a separate, additive slice (a `tags` array on the export
> envelope + read-on-import, `schemaVersion` bump). Full rationale in §12; scope-up option in §15 Open.

---

## 3. Data model

**New models — the one schema change in this slice.** A regular `prisma migrate dev` migration
(additive: two new tables, no column change to any existing table).

```prisma
// ─── Tag ──────────────────────────────────────────────
// Free-form, user-owned label orthogonal to Category. Flat list, no hierarchy.
// A transaction carries many tags via the TransactionTag join.
model Tag {
  id        String   @id @default(cuid())
  name      String
  color     String?  // optional hex accent; null → a neutral default chip color at render
  createdAt DateTime @default(now())

  userId String

  user         User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  transactions TransactionTag[]

  @@unique([name, userId])       // name unique per owner (case-insensitive hardened by a functional index — §6)
  @@index([userId])
}

// ─── TransactionTag ───────────────────────────────────
// Explicit many-to-many join (chosen over a text[] column so feed/report
// filtering and a future tag breakdown stay first-class SQL — ROADMAP §16).
model TransactionTag {
  transactionId String
  tagId         String

  transaction Transaction @relation(fields: [transactionId], references: [id], onDelete: Cascade)
  tag         Tag         @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@id([transactionId, tagId])   // composite PK = a tag can't be applied to the same tx twice
  @@index([tagId])               // "all transactions with tag X" (filter + usage count)
  @@index([transactionId])       // "all tags on transaction X" (feed include)
}
```

Add the back-relation to the existing models (no other change to them):

```prisma
model User        { /* … */ tags Tag[] }
model Transaction { /* … */ tags TransactionTag[] }
```

> **Why the join table, not `Transaction.tags String[]` (ROADMAP §16 open decision — resolved:
> join table).** A `text[]` column stores names, not references: renaming a tag would need a
> write across every row, filtering is a array-contains scan, a usage count is a full scan, and there
> is no per-user tag registry to power the picker or the manage list. The explicit join gives
> first-class `WHERE tagId IN (…)` filtering, an O(1)-indexed usage count via `_count`, rename/recolor
> in one row, and referential integrity (a deleted tag's joins cascade). The extra table is cheap; it
> is the same call the roadmap recommends.

### Ownership + uniqueness

```
A tag is mutable  ⇔  tag.userId === session.user.id      (there are NO system tags — every tag is user-owned)
```

Unlike `Category`, there is **no system/shared tier** — tags are always owned, so the ownership rule
is simpler (no `isSystem` axis). `@@unique([name, userId])` makes names unique per owner but is
**case-sensitive**; §6 adds the case-insensitive functional index, exactly as categories did.

### On-delete behavior (much simpler than categories)

| Referencing | FK rule | Effect of deleting the tag |
|---|---|---|
| `TransactionTag.tagId` | `onDelete: Cascade` | Join rows vanish; **transactions survive, just lose the label** ✅ |

There is **no budget-cascade landmine** here (the single most dangerous part of the category slice) —
deleting a tag never deletes a transaction, budget, or anything else. It only removes the association.
This makes the delete-impact copy a one-liner ("removes this tag from N transactions").

---

## 4. File plan

| Layer | File | Action |
|---|---|---|
| Schema | `prisma/schema.prisma` | **modify** — add `Tag` + `TransactionTag`; back-relations on `User`/`Transaction` |
| Migration | `prisma/migrations/<ts>_add_tags/` | **create** (`prisma migrate dev`) — two tables + FKs/indexes |
| Migration | `prisma/migrations/<ts>_tag_name_ci_unique/` | **create** (`--create-only`, raw SQL) — functional unique index `(lower(name), userId)` (§6) |
| Validation | `src/lib/validations/tag.ts` | **create** — `createTagSchema`, `updateTagSchema` |
| Validation | `src/lib/validations/transaction.ts` | **modify** — add optional `tagIds: string[]` to create/update schemas |
| Actions | `src/actions/tags.ts` | **create** — `createTag`, `updateTag`, `deleteTag`, `getTagForEdit` proxy |
| Actions | `src/actions/transactions.ts` | **modify** — write/replace join rows in `createTransaction`/`updateTransaction`; return `tagIds` in `getTransactionForEdit`; add tags to `getDrawerFormData` |
| DB reads | `src/lib/db/tags.ts` | **create** — `getUserTags`, `getManageableTags`, `getTagForEdit` |
| DB reads | `src/lib/db/transactions.ts` | **modify** — include tags in `FEED_INCLUDE`; map into `TransactionLeg` |
| Filter | `src/lib/transactions.ts` | **modify** — `buildTransactionWhere` handles `tagIds` (relation filter, OR) + tag name in search; pass tags through `collapseTransfers` |
| Constants | `src/lib/constants.ts` | **modify** — `TAG_COLORS` tuple + `DEFAULT_TAG_COLOR` |
| Constants | `src/lib/system-constants.ts` | **modify** — `TAG_NAME_MAX`, `TAG_MAX_PER_TRANSACTION` |
| Types | `src/types/tags.ts` | **create** — `TagOption`, `ManageableTag`, `EditableTag` |
| Types | `src/types/transactions.ts` | **modify** — `tags` on `TransactionLeg`/`FeedTransaction`; `tagIds` on `TransactionFilters`/`EditableTransaction`; `tags` on `DrawerFormData` |
| Revalidation | `src/lib/revalidation.ts` | **modify** — add `revalidateTagViews()`; call it from transaction mutations |
| Components | `src/components/tags/tag-picker-field.tsx` | **create** — multi-select chips + "+ New tag" |
| Components | `src/components/tags/tag-form-drawer.tsx` | **create** — Sheet: name + color |
| Components | `src/components/tags/manage-tags.tsx` | **create** — the `/settings` list |
| Components | `src/components/tags/confirm-delete-dialog.tsx` | **create** — native `<dialog>`, usage-impact copy |
| Components | `src/components/tags/tag-chip.tsx` | **create** — shared chip (feed rows, picker, manage list) |
| Cross-cut | `src/components/transactions/transaction-drawer.tsx` | **modify** — add `<TagPickerField>` (income/expense mode only) |
| Cross-cut | `src/components/transactions/transaction-row.tsx` | **modify** — render tag chips |
| Cross-cut | `src/components/transactions/filter-bar.tsx` | **modify** — add the tag filter pill |
| Cross-cut | `src/app/transactions/page.tsx` | **modify** — parse `?tag=`, fetch `getUserTags`, pass to `FilterBar` |
| Cross-cut | `src/app/settings/page.tsx` | **modify** — fetch `getManageableTags`, render `<ManageTags>` |
| Tests | `test/actions/tags.test.ts` | **create** |
| Tests | `test/lib/validations/tag.test.ts` | **create** |
| Tests | `test/lib/transactions.test.ts` | **modify** — `buildTransactionWhere` tag cases |
| Tests | `test/actions/transactions.test.ts` | **modify** — tag write/ownership on create/update |

> **No new route.** Creation is inline in the drawer; edit/delete on `/settings` — no `/tags` page,
> mirroring categories.

---

## 5. Validation

### `src/lib/validations/tag.ts`

Mirror `validations/category.ts`. `color` is **optional** (a tag can be name-only). `userId` is never
client-supplied.

```ts
import { z } from "zod";
import { TAG_NAME_MAX } from "@/lib/system-constants";

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Pick a valid color");

export const createTagSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(TAG_NAME_MAX),
  color: hexColor.optional(),
});

export const updateTagSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, "Name is required").max(TAG_NAME_MAX).optional(),
  color: hexColor.nullish(), // allow clearing back to null (neutral chip)
});

export type CreateTagInput = z.infer<typeof createTagSchema>;
export type UpdateTagInput = z.infer<typeof updateTagSchema>;
```

> **Tag color is a free hex, not an enum.** Unlike category `icon` (which must map to a Lucide
> component via `icon-map.ts`, hence the whitelist), a tag has **no icon** — only an optional accent
> color rendered as a chip dot/background. A free hex regex is sufficient; the UI still offers a
> `TAG_COLORS` swatch palette for consistency, but any valid hex is accepted. Name-only tags (no
> color) render with a neutral default chip.

### `src/lib/validations/transaction.ts` (extend)

Add an optional, bounded `tagIds` to both create and update. Kept lenient (defaults to `[]`) so
existing callers and the AI/quick-add draft path don't break.

```ts
import { TAG_MAX_PER_TRANSACTION } from "@/lib/system-constants";

const tagIds = z
  .array(z.string().min(1))
  .max(TAG_MAX_PER_TRANSACTION, `Up to ${TAG_MAX_PER_TRANSACTION} tags`)
  .optional()
  .transform((v) => v ?? []);

// add `tagIds` to createTransactionSchema (and thus updateTransactionSchema = createTransactionSchema)
```

> `transferSchema` is **not** extended — transfers carry no tags in v1 (§7).

---

## 6. Server actions — `src/actions/tags.ts`

`"use server"`. Same shape as `actions/categories.ts`: `MutationResult`, `NOT_AUTHED`, `auth()` →
`safeParse` → ownership scope by `session.user.id` → `revalidateTagViews()`. Reuse the **three-layer
dedup** pattern from categories, minus the system-collision layer (there are no system tags, so a
single owner axis — the functional index — covers everything; the app pre-check remains for a friendly
instant error).

| Action | Behavior |
|---|---|
| `createTag(input)` | Validate → dedup pre-check (case-insensitive, own tags only) → insert `{ name, color?, userId }`. **Returns the persisted `TagOption`** so `<TagPickerField>` appends-and-selects it without an optimistic guess (the `createCategory` precedent). |
| `updateTag(input)` | Patch `name` / `color` (color settable to `null`). Ownership gate `where: { id, userId }`; dedup check if `name` changes (excluding the row itself). |
| `deleteTag(id)` | Hard delete, ownership-gated. `TransactionTag` joins cascade away; transactions untouched. |
| `getTagForEdit(id)` | Thin auth-guarded proxy → `EditableTag` or `null`. |

### Ownership (every mutation)

```ts
const session = await auth();
if (!session?.user?.id) return NOT_AUTHED;
const userId = session.user.id;
// Scope EVERY query so another user's tag can never be touched: where: { id, userId }
```

A mutation targeting a foreign tag matches zero rows → single `{ success: false, error: "Tag not
found." }` (collapse not-found/forbidden, non-enumerable, matching every other slice).

### Dedup — two layers (app pre-check + DB functional index + `P2002` catch)

Same defense-in-depth as categories, one layer lighter (no system tier):

1. **App pre-check** (UX + instant friendly error): reject a name colliding case-insensitively with
   one of the user's **own** tags (`findFirst` with `name: { equals, mode: "insensitive" }`,
   `userId`, `NOT: { id: editingId }`).
2. **DB functional unique index** `(lower(name), userId)` (§ migration below) — the race-proof
   backstop; concurrent `"vacation"`/`"Vacation"` inserts can't both win.
3. **`P2002` catch** → the **same** friendly "A tag with that name already exists." message, never a 500.

Factor the shared pieces into module-private `assertTagNameAvailable(userId, name, editingId?)` and
`mapTagWriteError(e)` (the `assertNameAvailable` / `mapCategoryWriteError` precedent), reused by
`createTag` + `updateTag`.

**Casing:** store the user's original casing verbatim; only *comparison* is case-insensitive. Recasing
your own tag (`"vacation"` → `"Vacation"`) is allowed; renaming one tag onto another's name modulo case
is rejected. (Copied verbatim from the category rules — do not lower-case the column.)

#### `--create-only` migration for the functional index

```sql
-- prisma/migrations/<ts>_tag_name_ci_unique/migration.sql
-- Case-insensitive uniqueness of a user's own tag names, enforced atomically.
CREATE UNIQUE INDEX "Tag_lower_name_userId_key" ON "Tag" (lower("name"), "userId");
```

Prisma's `@@unique([name, userId])` stays in the schema; the functional index is strictly stronger on
the name axis and added via raw SQL (the DSL can't express `lower(name)`). Same pattern as
`category_name_ci_unique` and the recurring partial-unique index.

### Writing tags on a transaction (`actions/transactions.ts`)

`createTransaction` and `updateTransaction` gain `tagIds` handling. **Validate ownership of every tag
id** (a client could send a foreign id), then write the join rows atomically with the transaction:

- **Ownership guard:** `const owned = await prisma.tag.count({ where: { id: { in: tagIds }, userId } });`
  if `owned !== tagIds.length` → `{ success: false, error: "Tag not found." }` (all-or-nothing; never
  silently drop an unknown id). Skip entirely when `tagIds` is empty.
- **Create:** wrap the transaction insert + `transactionTag.createMany` in a `prisma.$transaction`, so
  a tx never lands without its tags (and vice-versa). Dedup the input array first (`[...new Set(tagIds)]`).
- **Update:** replace the set — inside `$transaction`, `transactionTag.deleteMany({ where: {
  transactionId: id } })` then `createMany` the new set. (Diffing add/remove is a needless
  optimization at MVP volumes — replace is simpler and correct.)
- **Unchanged-set skip (the one intentional optimization).** Because a transaction edit re-submits the
  whole drawer, most updates arrive with the tag set **identical** to what's stored. Before touching the
  join table, compare the **normalized** incoming set (deduped `new Set`) against the current
  `tagId`s: if they're equal, **skip the delete/recreate entirely** — the join write is a no-op and the
  churn (and its needless index writes) is avoided. This is a deliberate, explicit shortcut, *not* a
  general diff engine: the sets are tiny (≤ `TAG_MAX_PER_TRANSACTION`), so an equality check is trivial
  and worth it given how often the set is unchanged. When the sets **differ at all**, fall back to the
  full replace above (do not attempt a partial add/remove diff — replace stays the single correct path).
  The non-tag fields of the transaction still update normally regardless; only the *join* write is
  short-circuited.

> **`createTransaction` stays the sole writer of ledger + tags.** The AI "Suggest"/"Quick add" paths
> feed the same action; they never write directly. No new write path — consistent with the AI-features
> contract. Tags are just extra fields on the existing writer.

### Revalidation

```ts
/** Revalidate every surface that lists or assigns tags. Narrower than categories:
 *  tags don't touch budgets/goals/reports (no tag Reports chart in v1). */
export function revalidateTagViews() {
  revalidatePath("/settings");     // the manage list
  revalidatePath("/transactions"); // picker + filter pill + feed chips
  revalidatePath("/dashboard");    // recent-transactions rows may show chips
}
```

Transaction mutations that change tag assignment already call `revalidateTransactionViews()` (which
touches `/transactions` + `/dashboard`); the tag **management** actions call `revalidateTagViews()`.
A tag **rename/recolor** must repaint every feed chip — hence `/transactions` + `/dashboard` here too.

> Deliberately **not** `/budgets` or `/reports`: tags don't feed budget spend or any chart in v1
> (contrast `revalidateCategoryViews`, which must, because categories drive both). If the deferred
> Reports tag chart (§11) ships, add `/reports` there.

---

## 7. Tags on transfers — excluded in v1

The transaction drawer only renders `<TagPickerField>` in **income/expense** mode, exactly like the
category field. `transferSchema` has no `tagIds`; `createTransfer`/`updateTransfer` are untouched.

Rationale: a transfer is a money *move* between the user's own accounts, not a spend — the two legs
already share merchant/note and carry no category, so there is no natural "what is this labeled?"
moment. The `TransactionTag` join would physically allow tagging a leg later, but wiring it means
deciding whether both legs share tags, how the collapsed single-row feed presents them, and how
edit-via-delete-and-recreate carries them across the new pair — cost with little v1 value. Excluded and
documented; revisit only if requested.

---

## 8. DB fetchers — `src/lib/db/tags.ts`

```ts
import "server-only";
import { prisma } from "@/lib/prisma";
import type { TagOption, ManageableTag, EditableTag } from "@/types/tags";

/** All of the user's tags, for the drawer picker + the feed filter pill. */
export async function getUserTags(userId: string): Promise<TagOption[]> {
  return prisma.tag.findMany({
    where: { userId },
    select: { id: true, name: true, color: true },
    orderBy: { name: "asc" },
  });
}

/** The user's tags + usage count, for the /settings manage list + delete dialog. */
export async function getManageableTags(userId: string): Promise<ManageableTag[]> {
  const tags = await prisma.tag.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      color: true,
      _count: {
        select: {
          // Count only assignments to still-visible (non-deleted) transactions,
          // so the impact number matches what the user sees in the feed.
          transactions: { where: { transaction: { deletedAt: null } } },
        },
      },
    },
    orderBy: { name: "asc" },
  });
  return tags.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    transactionCount: t._count.transactions,
  }));
}

/** Single tag for edit pre-fill; scoped so a foreign row returns null. */
export async function getTagForEdit(userId: string, id: string): Promise<EditableTag | null> {
  return prisma.tag.findFirst({
    where: { id, userId },
    select: { id: true, name: true, color: true },
  });
}
```

> **Usage count scopes to non-deleted transactions** — one consistent "count what the user will
> notice" rule (the category-slice precedent). A soft-deleted transaction's join row still exists (and
> the tag cascade would remove it), but it's out of the feed, so it's excluded from the headline count.

### Feed include (`src/lib/db/transactions.ts`)

Extend `FEED_INCLUDE` and `toLeg` to carry tags:

```ts
const FEED_INCLUDE = {
  category: { select: { name: true, color: true, icon: true } },
  financialAccount: { select: { name: true } },
  tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
} satisfies Prisma.TransactionInclude;

// in toLeg: tags: tx.tags.map((t) => t.tag),  // FeedTag[] = { id, name, color }
```

`collapseTransfers` passes `tags` through on the canonical leg (transfers have none in v1, so the
transfer-row projection sets `tags: []`).

> **N+1 check.** Tags come back in the same `findMany` via the nested include — no extra round-trip per
> row. The counterparty backfill query already exists for transfers; tags on it are irrelevant (empty).

---

## 9. Filtering & search (`src/lib/transactions.ts`)

Extend `TransactionFilters` with `tagIds?: string[]` and `buildTransactionWhere`:

```ts
// Tag filter — match-any (OR): a row matches if it carries AT LEAST ONE selected tag.
if (filters.tagIds && filters.tagIds.length > 0) {
  where.tags = { some: { tagId: { in: filters.tagIds } } };
}

// Fold tag name into the existing free-text search OR:
if (filters.q) {
  const contains = { contains: filters.q, mode: "insensitive" as const };
  where.OR = [
    { merchant: contains },
    { note: contains },
    { category: { name: contains } },
    { tags: { some: { tag: { name: contains } } } }, // ← new
  ];
}
```

> **OR (match-any) is the default, and applies to transfers too (unlike the category filter).**
> Selecting `vacation-2026` + `reimbursable` shows transactions carrying *either* — the natural
> multi-select default and consistent with how the category filter uses `{ in }` (also OR). A
> match-**all** (AND) mode ("both tags") is a reasonable future toggle but adds UI and query surface;
> v1 ships OR only. **Note the divergence from the category filter**, which force-skips itself for
> `type === "TRANSFER"` (transfers have no category); the tag filter has **no such guard** — a
> transfer *could* be excluded by a tag filter, but since v1 never tags transfers, a tag filter simply
> yields no transfer rows, which is correct. Do not copy the `type !== "TRANSFER"` guard onto tags.

URL param: `?tag=id1,id2` (comma-joined, mirroring `?category=`). Parsed in
`src/app/transactions/page.tsx` the same way `category` is.

### 9.1 Filter pill is id-based — rename, delete, and ordering behavior

The filter carries tag **ids** in the URL, not names, which makes three edge behaviors clean and
explicit:

- **Filter chips render in the same alphabetical order (§10.1).** Both the filter pill's dropdown menu
  *and* the selected-tag pills (whatever "N selected" summary or chip row the pill shows) sort by name
  ascending — the identical rule used by the picker, `/settings`, and feed chips. A contributor must not
  render selected filter pills in URL/click order; resolve the selected ids against the sorted
  `getUserTags` list so their on-screen order matches everywhere else.
- **Rename while a `?tag=<id>` filter is active just works.** Because the filter is id-based, renaming a
  tag on `/settings` does **not** break or change the active filter — the same transactions stay
  matched. Only the **displayed label** (in the pill and on feed chips) updates, and only after
  `revalidateTagViews()` repaints `/transactions` on the next navigation/refresh. No URL rewrite, no
  lost selection. (Same id-stability principle as the open-drawer rename case, §10.4.)
- **Deleting a tag that's currently selected in the filter resolves gracefully.** After `deleteTag`, its
  `TransactionTag` joins have cascaded away, so the `tags.some.tagId.in:[deletedId]` query matches
  nothing for that id — no error, no crash. Two things must hold in the UI: (1) the deleted id
  **disappears from the available tag list** (`getUserTags` no longer returns it after revalidation), so
  it's simply absent from the filter menu; and (2) when resolving the URL's selected ids to pills, an id
  that no longer resolves to a tag is **silently dropped from the displayed selection** (filter/`map`
  over the known list — never render an "unknown"/blank pill). The stale id may linger in the URL until
  the next filter interaction rewrites it; that's harmless (it just narrows to that one now-empty
  predicate). If *every* selected tag was deleted, the feed shows its normal "no results · clear
  filters" empty state — not a broken screen. Do **not** add special-case error handling for this; the
  id-based query + resolve-against-known-list rendering make it degrade correctly on its own.

---

## 10. UI

### Constants

```ts
// src/lib/constants.ts — swatch palette offered in the tag drawer (any hex still valid).
export const TAG_COLORS = [
  "#7F77DD", "#378ADD", "#0EA5E9", "#10B981", "#1D9E75", "#EF9F27",
  "#F97316", "#D85A30", "#D4537E", "#EC4899", "#6366F1", "#888780",
] as const;
export const DEFAULT_TAG_COLOR = null; // name-only by default; user opts into a color

// src/lib/system-constants.ts
export const TAG_NAME_MAX = 32;            // shorter than category (labels are terse); tune in review
export const TAG_MAX_PER_TRANSACTION = 12; // guardrail against unbounded join writes
export const TAG_CHIPS_VISIBLE_MAX = 3;    // feed row shows N chips, then a "+N" overflow (§10.3)
```

### 10.1 Ordering — alphabetical everywhere (one rule)

**Tags render in ascending case-insensitive name order in *every* surface** — the drawer picker, the
filter pill's menu, the `/settings` manage list, and the chips on a feed row. There is **no
creation-order and no user-defined ordering** in v1 (no `sortOrder` column, no drag-to-reorder). One
rule, applied consistently, so a tag sits in the same relative position wherever the user sees it.

- The DB fetchers already sort (`orderBy: { name: "asc" }` in `getUserTags` / `getManageableTags`) —
  keep it. Postgres `asc` on a `String` is byte-order; for the mixed-case, mostly-ASCII label set this
  is effectively alphabetical. If a locale-correct/case-folded order is ever wanted, do it **once** in a
  shared client comparator so all four surfaces stay identical — never sort ad-hoc in one component.
- **Feed-row chips are sorted by name too** (not by insertion/`TransactionTag` PK order), so the same
  transaction always shows its tags in the same order across renders. Sort the `tags` array in
  `toLeg` (or a shared helper) before it reaches the row — do not rely on the join's returned order.
- Inline-created tags (appended locally in `<TagPickerField>` before the next refresh) are the one
  transient exception: they may appear at the end of the *picker's selected list* until a refresh
  re-sorts from the server. This is cosmetic and acceptable (§10.2 / §10.4).

> **Why alphabetical, not "most-recently-used" or manual.** Deterministic name order is
> predictable and needs no extra state; MRU/manual ordering are personalization features with real
> cost (a `sortOrder` column or a usage-recency signal, plus reconciliation) and no demonstrated demand.
> If MRU is ever wanted, it's an additive follow-up, not a v1 concern.

### 10.2 Picker scalability — search-first, virtualization only if needed

The typical user has a **small** tag set (a handful to a few dozen), and `<TagPickerField>` is built
for that. But it must **not degrade to unusable** as a power user's list grows:

- **Search-first is the primary interaction, not an add-on.** The "Add tag" control is a text-filtered
  combobox from day one (type to narrow), so finding a tag is O(type-a-few-chars) regardless of list
  size — the same interaction whether the user has 8 tags or 200. Do not ship a plain unfiltered
  `<select>`/scroll list that only works for tiny sets.
- **Virtualization is explicitly deferred, not designed-in.** At the realistic v1 scale, rendering the
  full filtered list is fine; a windowing library (e.g. react-window) is **not** added now (YAGNI). The
  seam: because selection flows through `value: string[]` + `onChange`, swapping the menu's list
  rendering for a virtualized one later is a self-contained change with no API impact. Recording this is
  the deliverable — do not pre-build it.
- **Soft UX cap signal.** If a user's tag count grows past what a single scannable filtered menu
  comfortably shows (~a few hundred), that's the trigger to add virtualization and/or grouping — not a
  code limit today. There is intentionally **no hard cap on tag count** (§2), only the
  per-transaction `TAG_MAX_PER_TRANSACTION` guardrail.

### 10.3 Feed-row chip overflow — defined, not left to implementation

A feed row renders at most **`TAG_CHIPS_VISIBLE_MAX` (= 3)** tag chips (in the alphabetical order of
§10.1), followed by a **`+N`** affordance when the row carries more (`N = total − 3`). This keeps every
row's height and visual weight bounded and consistent no matter how many tags a transaction has — tags
are metadata, never the row's headline (Design System: "visual weight serves information").

- The `+N` is a plain non-interactive count in v1 (a muted pill). It is **not** a popover/tooltip
  listing the hidden tags — clicking the row already opens the drawer, which shows the full set in the
  picker. (A hover-reveal of the remainder is a possible later polish, not v1.)
- The exact number is a single constant (`TAG_CHIPS_VISIBLE_MAX`) so it's tunable in one place and can't
  drift between the full feed and the dashboard's recent-transactions rows — both read the same constant.
- The chip placement (inline after the description/category vs. a dedicated second line) is a layout
  detail for the component, but the **count and overflow rule are fixed here** so contributors don't
  each invent their own truncation.

### 10.4 Renaming a tag while a drawer is open — stale-until-refresh is acceptable

The transaction drawer is a **single instance mounted once in `AppShell`**; its tag list comes from
`getDrawerFormData`, fetched when the drawer opens. If a user renames/recolors a tag on `/settings`
(another tab, or before this drawer was opened) while a drawer is already open, the open drawer may show
the **stale** name/color until its data is next fetched. **This is acceptable and intended** — do not
add cross-tab live sync:

- **What refreshes it, and when.** `updateTag` calls `revalidateTagViews()` (touches `/settings`,
  `/transactions`, `/dashboard`), so the server-rendered surfaces repaint on the next navigation/refresh,
  and the **next time the drawer opens** it re-fetches `getDrawerFormData` and shows the new name. A
  rename made *while the same drawer is held open* simply isn't reflected in that already-open instance —
  the user closes and reopens (or the route refreshes) and it's correct. No data corruption is possible:
  the picker binds tag **ids**, and a rename never changes the id, so a save from a stale-labelled drawer
  still writes the right join rows.
- **Why not proactively refetch the open drawer.** Renames are rare and the staleness is purely
  cosmetic (a label, never a wrong write). Wiring the open drawer to a live tag subscription (or polling)
  is real complexity for a cosmetic edge — off-thesis for a "clarity, not machinery" product and
  inconsistent with the app's "refetch on window focus / navigation," no-WebSocket stance
  (project-overview: *Refetch on window focus*). The inline-create path is the one case that **does**
  update the open drawer immediately (it appends the returned `TagOption`), because that tag was just
  created *from* this drawer and must be selectable at once (§10 picker).

### `tag-chip.tsx` (shared)

A tiny presentational chip: colored dot/pill + name. Used on feed rows, in the picker's selected list,
and in the manage list. Neutral styling when `color` is null.

### `tag-picker-field.tsx` (drawer, income/expense only)

Multi-select analog of `<CategoryPickerField>`:

- Props: `tags: TagOption[]`, `value: string[]`, `onChange(ids: string[])`, plus the inline-create
  affordance.
- Renders selected tags as removable chips + an "Add tag" control (a small combobox/menu of the user's
  tags with a text filter) + a "+ New tag" button that opens `<TagFormDrawer>` in create mode.
- **On create success**, append the returned `TagOption` to the local list **and** add it to the
  selection (`onChange([...value, created.id])`) — the just-created tag is immediately applied, no
  optimistic guess, no dependency on `router.refresh()` (the `createCategory`-returns-the-row pattern).
- Enforce `TAG_MAX_PER_TRANSACTION` client-side (disable "Add" at the cap) as well as server-side.

### `tag-form-drawer.tsx`

shadcn **Sheet** (right panel ≥768px / bottom sheet <768px, `useMediaQuery` + `BREAKPOINTS.mobile`),
exactly like the category/goal drawers. Fields: **name** (text) + **color** (a `TAG_COLORS` swatch row
with a "no color" option). Live preview chip on top. Create + edit modes; submit via `useTransition` →
`createTag` / `updateTag`; surface `{ error }` inline.

### `manage-tags.tsx` (on `/settings`)

A "Tags" card (rendered after "Categories"), matching the `<ManageCategories>` visual pattern: heading
+ "Add tag" button; a list of `getManageableTags` rows (tag chip + name + muted "used by N
transactions", omitting the clause at zero); per-row Edit / Delete. **Empty state** (the common first
case): "You haven't created any tags yet. Add tags to a transaction to group spending across
categories — like `vacation-2026` or `reimbursable`."

### `confirm-delete-dialog.tsx`

Native `<dialog>` (mirror categories/goals). Copy is a one-liner from the row's count — no cascade
scare, because there's no destructive cascade:

> Delete "vacation-2026"? This removes the tag from **N transactions**. The transactions are kept.
> This can't be undone.

Omit the "from N transactions" clause when the count is zero. On confirm → `deleteTag` → toast →
`router.refresh()`.

### Feed row & drawer wiring

- `transaction-row.tsx`: render up to `TAG_CHIPS_VISIBLE_MAX` `<TagChip>`s (alphabetical, §10.1) with a
  `+N` overflow per the fixed rule in **§10.3** — do not invent a different truncation here. Keep it
  subtle: tags are metadata, not the row's headline (Design System: "visual weight serves information").
- `transaction-drawer.tsx`: mount `<TagPickerField>` below the category field, **only** when
  `type !== "TRANSFER"`. Pre-fill `value` from `EditableTransaction.tagIds` on edit. `getDrawerFormData`
  now also returns `tags` (add `getUserTags` to its `Promise.all`).

---

## 11. Reports tag breakdown — deferred (documented seam)

ROADMAP §16 lists an optional tag breakdown in Reports. **Not built in v1** to keep this slice
contained. The seam is clean: the `TransactionTag` join is already query-ready, so a follow-up
`getTagBreakdown(userId, period)` in `src/lib/db/reports.ts` (group `TransactionTag` by `tagId`, join
to signed transaction amounts within the period window) plus one more SVG chart is a self-contained
slice. When it ships, extend `revalidateTagViews()` to touch `/reports`. Recording the seam is the
deliverable; do not add a dormant fetcher now.

---

## 12. Edge cases & rules

- **No system tags.** Every tag is user-owned; ownership is a single `userId` axis (no `isSystem`).
  Simpler than categories.
- **Name dedup is case-insensitive, own-tags only (§6).** `"Vacation"` rejected when `"vacation"`
  exists. Functional `(lower(name), userId)` index is the race-proof backstop; the app pre-check is the
  instant UX error; `P2002` catch turns a lost race into the same message.
- **`name` stores original casing.** No write-time normalization (the category rule).
- **All tag ids on a transaction must be owned.** Create/update reject if any `tagIds` entry isn't the
  user's — all-or-nothing, never silently dropped.
- **Duplicate ids in the input are collapsed** (`new Set`) before writing; the composite PK
  `@@id([transactionId, tagId])` is the DB backstop.
- **Delete is a hard delete with a confirm dialog** — joins cascade, transactions survive. No
  `deletedAt`, no snackbar undo.
- **Tags excluded from transfers (§7).** Picker hidden in transfer mode; schemas/actions for transfers
  untouched.
- **Filter is match-any (OR); no `TRANSFER` guard (§9).** Do not copy the category filter's transfer
  skip.
- **No count limit on tags themselves; per-transaction cap is `TAG_MAX_PER_TRANSACTION`.** Tags are
  unlimited and free; only the assignments-per-transaction are bounded as a write guardrail.
- **Alphabetical order in every surface; feed rows cap at `TAG_CHIPS_VISIBLE_MAX` + `+N` (§10.1/§10.3).**
  Sort the row's `tags` array by name in `toLeg` — don't rely on the join's returned order.
- **An open drawer may show a stale tag label after a rename (§10.4)** — acceptable; the picker binds
  ids, so a stale label never writes the wrong tag. No cross-tab sync.
- **Update no-ops the join write when the tag set is unchanged (§6)** — normalized-set equality check;
  differing sets fall back to full replace.
- **Active `?tag=` filter is id-based (§9.1)** — a rename keeps it matching (label repaints only); a
  deleted selected id drops from the menu/pills and the feed falls back to its empty state; never render
  an unknown/blank pill.
- **Export/import intentionally omit tags in this release (deliberate scope decision, not a gap).**
  The CSV/JSON export and import pipelines are **knowingly left untouched** — a shipped transaction's
  tags are **not** written to an export and **not** read from an import in v1. This is a conscious
  scope boundary to keep the slice's blast radius small, **not** an oversight: reviewers should read the
  absence of tag columns/fields in export/import as *by design for this release*. Consequence to state
  plainly: a JSON export→import round-trip in this release **loses tag associations** (the transactions
  and the tag registry both survive if separately re-imported, but the *links* between them do not). The
  follow-up that closes this is a separate additive slice — add a `tags` array to the export envelope
  and read it on import, bumping `schemaVersion` (the envelope was built for exactly this kind of
  additive growth). If a reviewer wants it pulled **into** this slice instead, that's an explicit
  scope-up call (§15 Open) — otherwise it stays deferred and documented here so no one mistakes it for a
  bug.

---

## 13. Testing (`test/`, Vitest, mock `@/lib/prisma` + `@/auth`)

**`test/lib/validations/tag.test.ts`**
- `createTagSchema`: rejects empty/whitespace name, name > `TAG_NAME_MAX`, non-hex color; accepts
  name-only (no color) and name+valid-color; trims name.
- `updateTagSchema`: name/color optional; `id` required; color settable to `null`.

**`test/actions/tags.test.ts`** (mock `@/lib/prisma`, `@/auth`)
- Unauthorized → `NOT_AUTHED` for all mutations.
- `createTag`: inserts with session `userId`; client-supplied `userId` ignored; returns the persisted
  `TagOption` (assert the resolved value carries id/name/color — the picker depends on it).
- `createTag` dedup pre-check: rejects a case-insensitive own-name clash, no insert.
- `createTag` dedup race: pre-check passes but `create` throws `{ code: "P2002" }` → same friendly
  message, no rethrow; a non-`P2002` error rethrows.
- `updateTag`: ownership scoping (`where` includes `userId`); foreign id → "Tag not found."; name-change
  dedup excludes the row itself (recasing own name allowed); color can be cleared to null.
- `deleteTag`: hard delete scoped by `userId`; foreign id → not found, no delete.

**`test/lib/transactions.test.ts`** (extend)
- `buildTransactionWhere`: `tagIds` produces `tags.some.tagId.in`; empty/undefined → no tag clause;
  `q` search OR includes the `tags.some.tag.name.contains` branch; **no** `TRANSFER` guard on tags.

**`test/actions/transactions.test.ts`** (extend)
- `createTransaction` with `tagIds`: validates every id is owned (mock `tag.count`); writes join rows
  in the same `$transaction`; a foreign/unknown id → "Tag not found.", no transaction created.
- `updateTransaction` with `tagIds`: replaces the join set (deleteMany then createMany) inside
  `$transaction`; empty `tagIds` clears all joins.
- Duplicate ids in input are deduped before write.

Run `npm run test:run` and `npm run build` before commit (per
[ai-interaction.md](../ai-interaction.md)). Per the testing standard, **do not** hit a real DB — mock
`@/lib/prisma`. The functional index's real-DB behavior is verified **once manually** at migration time
against the `development` Neon branch (the category-slice precedent):

```sql
-- after applying tag_name_ci_unique on development:
-- 1) same user, case-variant duplicate → expect unique violation on Tag_lower_name_userId_key
-- 2) same name for a DIFFERENT user → succeeds (per-owner scoping holds)
```

### Manual QA

1. Transaction drawer (expense) → "+ New tag" → create `vacation-2026` (pick a color) → it's added to
   the selection and shows as a chip; add a second existing tag; save → feed row shows both chips.
2. `/transactions` → open the Tag filter → select `vacation-2026` → feed narrows to matching rows;
   select a second tag → match-any broadens (OR). Clear filters resets.
3. Search a tag name → matching rows surface (tag folded into search).
4. `/settings` → Tags → `vacation-2026` shows "used by N transactions"; Edit → recolor → chips repaint
   in the feed and dashboard.
5. Delete a tag → dialog says "removes this tag from N transactions; transactions kept" → confirm → the
   chips disappear, the transactions remain.
6. Create a tag named `Vacation` while `vacation` exists → rejected with the dedup message.
7. Confirm the tag picker is **absent** in transfer mode; a transfer saves with no tags.

---

## 14. Implementation order

1. Schema: add `Tag` + `TransactionTag` + back-relations → `prisma migrate dev --name add_tags`; apply
   to the `development` Neon branch; `prisma migrate status` clean.
2. `--create-only` migration `tag_name_ci_unique` (functional index, §6); apply to dev; run the manual
   index-verification SQL (§13) once.
3. Constants (`TAG_COLORS`, `TAG_NAME_MAX`, `TAG_MAX_PER_TRANSACTION`) + types (`src/types/tags.ts`,
   `tags`/`tagIds` on transaction types) + Zod (`tag.ts` + `tagIds` on transaction schemas).
4. `src/lib/db/tags.ts` (`getUserTags`, `getManageableTags`, `getTagForEdit`); extend `FEED_INCLUDE` +
   `toLeg` for tags.
5. `buildTransactionWhere` tag filter + search; `collapseTransfers` tag pass-through.
6. `revalidateTagViews()`; `src/actions/tags.ts` (dedup, ownership, `P2002` catch, returns `TagOption`);
   thread `tagIds` (owned-check + join writes) into `createTransaction`/`updateTransaction`; return
   `tagIds` from `getTransactionForEdit`; add tags to `getDrawerFormData`. **Tests for 3–6.**
7. Components: `tag-chip`, `tag-form-drawer`, `tag-picker-field`; wire into the transaction drawer
   (income/expense only) + feed row chips.
8. `filter-bar` tag pill + `/transactions` page `?tag=` parse & `getUserTags` fetch.
9. `manage-tags` + `confirm-delete-dialog`; render the Tags card on `/settings` (`getManageableTags`).
10. `npm run test:run` + `npm run build`; full manual pass (§13).

---

## 15. Decisions

### Resolved (baked into this spec)

- **Join table, not `text[]`** (ROADMAP §16 open decision) — first-class filtering, indexed usage
  count, rename-in-one-row, referential integrity. §3.
- **Tags are free, not Pro-gated, and uncapped in count** — core organization, not depth. Per-tx
  assignment capped at `TAG_MAX_PER_TRANSACTION` as a write guardrail only.
- **No system tags** — every tag is user-owned; ownership is a single `userId` axis (simpler than
  categories' `isSystem` split).
- **Optional color, no icon** — hex free-string (swatch palette offered); name-only tags allowed. §5.
- **Case-insensitive per-user dedup** via app pre-check + functional `(lower(name), userId)` index +
  `P2002` catch; original casing stored. §6.
- **`createTag` returns the persisted `TagOption`** so the picker appends-and-selects with no
  optimistic guess. §6/§10.
- **Filter is match-any (OR), tag name folded into search, no `TRANSFER` guard on the tag clause.** §9.
- **Tags excluded from transfers in v1** — picker hidden in transfer mode; transfer schemas/actions
  untouched. §7.
- **Hard delete + confirm dialog** — joins cascade, transactions survive; no `deletedAt`, no snackbar.
  §3/§10.
- **Creation inline in the drawer; management on `/settings`** — no `/tags` route. §4.
- **`createTransaction` stays the sole writer** of ledger + tag joins (all-or-nothing ownership check);
  no new write path. §6.
- **Alphabetical ordering everywhere** — picker, filter, `/settings`, and feed-row chips all render
  tags in ascending case-insensitive name order; no creation-order/MRU/user-defined ordering in v1.
  §10.1.
- **Search-first picker; virtualization deferred** — the "Add tag" control is a text-filtered combobox
  from day one so it scales to large tag sets; windowing is a self-contained later change, not built
  now. §10.2.
- **Feed-row chip overflow is fixed at `TAG_CHIPS_VISIBLE_MAX` (= 3) + `+N`** — one constant, one rule,
  identical in the full feed and dashboard rows; `+N` is a non-interactive count in v1. §10.3.
- **Rename-while-drawer-open is stale-until-refresh** — an already-open drawer may show a stale tag
  label until it re-fetches; no cross-tab live sync (the picker binds ids, so a stale label never causes
  a wrong write). §10.4.
- **Update replaces the join set, with an unchanged-set skip** — an edit re-submits the whole set;
  compare normalized sets and **no-op the join write when identical**, else full delete/recreate (no
  partial diff). §6.
- **Filter is id-based — rename/delete/order all resolve cleanly** — a rename keeps the active `?tag=`
  filter working (only the label repaints); a deleted selected tag drops from the menu and the displayed
  pills and the feed degrades to its normal empty state; selected filter pills sort alphabetically like
  everywhere else. §9.1.

### Deferred (documented seams, not built)

- **Reports tag-breakdown chart** — clean follow-up; the join is query-ready. §11.
- **Export/import of tags — shipped in Data Portability Hardening (POST-MVP §20).** JSON export now
  includes per-transaction tag names plus a `data.tags` registry for colors; JSON import creates
  missing tags and writes `TransactionTag` joins for rows it creates. CSV remains unchanged.
- **Historical note: export/import of tags were intentionally omitted from the original tags release**
  (deliberate scope decision, not an
  implementation gap): a JSON round-trip loses tag *associations* in v1; the fix is an additive envelope
  field + `schemaVersion` bump in a separate slice. §12.
- **Picker virtualization / grouping** — only if a user's tag count outgrows a filtered menu (§10.2).
- **Match-all (AND) filter mode, MRU/manual tag ordering, bulk-tagging, AI tag suggestion, tags on
  transfers** — post-v1.

### Open (surface in review)

- `TAG_NAME_MAX` (proposed 32), `TAG_MAX_PER_TRANSACTION` (proposed 12), and `TAG_CHIPS_VISIBLE_MAX`
  (proposed 3) — confirm the numbers.
- Chip **placement** (inline after the description/category vs. a dedicated second line) — a layout
  detail left to the component; the count/overflow *rule* is fixed (§10.3), only the visual position is
  open.
- Whether export/import of tags should be pulled **into** this slice rather than deferred (§12) —
  a scope call for the reviewer.
