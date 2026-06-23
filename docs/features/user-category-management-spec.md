# User Category Management — Implementation Spec

> **✅ Shipped (`feature/user-category-management`).** Implemented per this spec. Notable realized details:
> the `--create-only` migration `category_name_ci_unique` adds the functional unique index
> `(lower(name), userId)` (applied to the `development` Neon branch; no `schema.prisma` change) — backing
> the three-layer dedup (app pre-check spanning system + own, the index, and a `P2002` catch, all mapping
> to one friendly message). `createCategory` returns the persisted `CategoryOption` so the shared
> `<CategoryPickerField>` auto-selects the real row (no optimistic guess); it is swapped into the
> transaction / budget / recurring drawers (recurring: create mode only; budget: can create even when all
> existing categories are budgeted). `getManageableCategories` carries three usage counts scoped to
> user-visible rows; the `/settings` `<ManageCategories>` card + `ConfirmDeleteCategoryDialog` state the FK
> impact (transactions + templates → Uncategorized via SetNull, budgets deleted via Cascade). `icon-map.ts`
> needed **no** edit — all 20 `CATEGORY_ICONS` were already registered (a drift-guard test enforces this);
> the live-preview icon is rendered via a `PreviewChip` subcomponent (icon passed as a prop) to satisfy the
> "component created during render" lint rule. 28 new Vitest tests (506 total); `npm run test:run` +
> `npm run build` pass; no schema model change. See `docs/ROADMAP.md` §3 for the realized-slice note.

> **Goal:** Give users a real read/write stack for their own `Category` rows so they can create,
> edit, and delete custom categories (icon + color + name) alongside the 20 seeded system
> categories — surfaced **inline in the existing category pickers** and managed from a "Categories"
> section on `/settings`.

This spec follows the patterns in [entity-crud-architecture.md](../entity-crud-architecture.md)
and the field-level rules in [entity-types.md](../entity-types.md). It mirrors the already-shipped
**Budgets**, **Goals**, **Financial Account**, and **Recurring** slices, and implements
[ROADMAP.md](../ROADMAP.md) §3 (Delivery Sequence slot **#8** — the deferrable power-user feature,
last before Pre-Launch Polish).

---

## 1. Why this slice

Categories are **read-only** today. [src/lib/db/categories.ts](../../src/lib/db/categories.ts)
exposes a single `getUserCategories(userId)` that returns system categories (`userId = null`) plus
the user's own — but **no user has any own categories**, because `src/actions/categories.ts` does
not exist. Every category in the app came from `prisma/seed.ts` (the 20 system categories). A user
can read and assign them, but cannot create, rename, recolor, or delete a category of their own.

The `Category` model already has everything needed (`isSystem`, nullable `userId`, the
`@@unique([name, userId])` constraint), and the pickers already render whatever
`getUserCategories` returns. This slice is the **write half** plus a thin management surface.

> **Deferrable by design (ROADMAP §3).** The app is fully usable without this — the 20 system
> categories close the core loop (`capture → organize → control → understand`). This has **no
> downstream dependencies**; nothing else in the roadmap needs it. It is the first feature to cut to
> post-launch if the schedule tightens. Kept for MVP completeness ("user extensions" in the MVP
> Definition).

---

## 2. Scope

### In scope

- Zod validation schemas: create/update category.
- Server actions in a new `src/actions/categories.ts`: `createCategory`, `updateCategory`,
  `deleteCategory`, plus a thin `getCategoryForEdit` proxy.
- A new `getManageableCategories(userId)` fetcher in `src/lib/db/categories.ts` (the user's **own**
  categories, with usage counts, for the manage list) alongside the existing `getUserCategories`.
- Pure helpers + constants: an icon whitelist (`CATEGORY_ICONS`) and a color palette
  (`CATEGORY_COLORS`), both backed by `icon-map.ts`.
- **Inline create** from the existing category pickers (transaction drawer, budget form drawer,
  recurring template drawer): a "+ New category" affordance that opens a `CategoryFormDrawer`, and
  on success auto-selects the new category.
- A **"Categories" management section** on `/settings` to edit/delete existing user categories.
- A centralized `revalidateCategoryViews()` helper in `src/lib/revalidation.ts`.
- Vitest unit tests for the actions + pure helpers.

### Out of scope (explicit)

- **Editing or deleting system categories.** System categories (`isSystem = true`, `userId = null`)
  are immutable and shared. Every mutation rejects them. No "hide system category" / favourites /
  visibility model (post-MVP — same call as the onboarding preset question in ROADMAP §1).
- **Category hierarchy / subcategories.** Flat list only (overview "Out of Scope").
- **Reassigning transactions on delete via a picker.** Delete relies on the schema's FK behavior
  (see §7) — there is no "move these 12 transactions to category X first" UI in MVP.
- **Per-category budgets/reports drill-down beyond what exists.** This slice changes *what categories
  exist*, not how budgets or reports consume them.
- **Soft delete / undo for categories.** `Category` has no `deletedAt`; deletion is a hard delete
  guarded by a confirm dialog (mirrors Goals), not the 8-second snackbar.
- **Adding category management to the onboarding flow.** See §10 — the recommendation is **not** to
  add it; the seeded categories are sufficient for first run.

---

## 3. Data model recap

From [project-overview.md](../../docs/project-overview.md) Prisma schema. **No table/column change.**
One small `--create-only` index migration hardens dedup at the DB level (§6) — no Prisma model edit.

### `Category`

| Field | Type | Notes |
|---|---|---|
| `name` | `String` | required, user label (≤50 chars per ROADMAP §3) |
| `icon` | `String` | Lucide icon name — **must** be in `icon-map.ts` or it renders as `HelpCircle` |
| `color` | `String` | hex (`#RRGGBB`) |
| `isSystem` | `Boolean` | `false` for user categories; **true ones are immutable** |
| `userId` | `String?` | `null` for system; the owner for user categories |

### The ownership + uniqueness rules

```
A category is mutable  ⇔  isSystem === false  AND  userId === session.user.id
```

```prisma
@@unique([name, userId])   // name unique *per owner* (null counts as its own owner)
```

> **Subtlety the constraint does NOT cover.** `@@unique([name, userId])` makes `("Groceries", null)`
> (system) and `("Groceries", "user_123")` (user) **distinct** rows — so the DB would happily let a
> user create a category named exactly like a system one, producing two "Groceries" in every picker.
> The constraint is also **case-sensitive**: `("groceries", "user_123")` and `("Groceries",
> "user_123")` are distinct rows too. Two complementary mechanisms close these gaps (§6):
> 1. A **functional unique index** `(lower(name), userId)` makes the *own-name* rule **case-insensitive
>    and race-proof at the DB** — concurrent inserts of "Groceries"/"groceries" by the same user can
>    no longer both win; the loser gets a unique violation the action maps to a friendly message.
> 2. A **server-side case-insensitive cross-check** rejects a name colliding with a **system**
>    category. This *cannot* be an index: the rule is "unique across `userId = null` **OR** `userId =
>    me`," a cross-row predicate over two owners that no single unique index can express. So the
>    system-collision case stays an app-level pre-check (with the same friendly error).

### FK on-delete behavior (critical — see §7)

When a user category is deleted, the three relations that point at it behave **differently**, per the
schema:

| Referencing model | FK rule | Effect of deleting the category |
|---|---|---|
| `Transaction.categoryId` | `onDelete: SetNull` | Transactions survive, become **Uncategorized** ✅ |
| `RecurringTemplate.categoryId` | `onDelete: SetNull` | Templates survive, become **Uncategorized** ✅ |
| `Budget.categoryId` | **`onDelete: Cascade`** | The category's **budgets are DELETED** ⚠️ |

> **ROADMAP §3 only mentions `Transaction.categoryId = null`.** It missed that `Budget` has a
> **required** `categoryId` with `onDelete: Cascade` — so deleting a custom category silently deletes
> any budget that used it. This spec surfaces and handles that explicitly (§7); it is the single most
> important behavior in the slice.

---

## 4. File plan

| Layer | File | Action |
|---|---|---|
| Migration | `prisma/migrations/<ts>_category_name_ci_unique/` | **create** (`--create-only`, raw SQL) — functional unique index `(lower(name), userId)` for race-proof case-insensitive own-name dedup |
| Validation | `src/lib/validations/category.ts` | **create** — `createCategorySchema`, `updateCategorySchema` |
| Actions | `src/actions/categories.ts` | **create** — `createCategory`, `updateCategory`, `deleteCategory`, `getCategoryForEdit` proxy |
| DB reads | `src/lib/db/categories.ts` | **modify** — add `getManageableCategories(userId)` (own categories + usage counts); keep `getUserCategories` unchanged |
| Constants (UI) | `src/lib/constants.ts` | **modify** — add `CATEGORY_ICONS` (tuple) + `CATEGORY_COLORS` + `DEFAULT_CATEGORY_COLOR`/`DEFAULT_CATEGORY_ICON` |
| Icons | `src/lib/icon-map.ts` | **modify** — register any `CATEGORY_ICONS` name not already mapped |
| Types | `src/types/categories.ts` | **create** — `ManageableCategory`, `EditableCategory` (`CategoryOption` already exists in `types/transactions.ts`) |
| Revalidation | `src/lib/revalidation.ts` | **modify** — add `revalidateCategoryViews()` |
| Components | `src/components/categories/category-form-drawer.tsx` | **create** — shadcn Sheet: name + icon picker + color picker |
| Components | `src/components/categories/category-picker-field.tsx` | **create** — wraps the `<select>` + "+ New category" affordance, shared by the three drawers |
| Components | `src/components/categories/manage-categories.tsx` | **create** — the `/settings` list (edit/delete user categories) |
| Components | `src/components/categories/confirm-delete-dialog.tsx` | **create** — native `<dialog>`, states usage impact (mirror recurring/goals) |
| Cross-cut | `src/components/transactions/transaction-drawer.tsx` | **modify** — replace inline category `<select>` with `<CategoryPickerField>` |
| Cross-cut | `src/components/budgets/budget-form-drawer.tsx` | **modify** — same picker swap |
| Cross-cut | `src/components/recurring/template-form-drawer.tsx` | **modify** — same picker swap (create mode only — category is locked on edit there) |
| Cross-cut | `src/app/settings/page.tsx` | **modify** — render `<ManageCategories>` section + fetch `getManageableCategories` |
| Tests | `test/actions/categories.test.ts` | **create** |
| Tests | `test/lib/validations/category.test.ts` | **create** |

> **No new route.** Category management is inline (pickers) + a section on the existing `/settings`
> page — there is no `/categories` page in the spec's Pages table, and ROADMAP §3 explicitly places
> management on `/settings`.

---

## 5. Validation (`src/lib/validations/category.ts`)

Mirror [validations/financial-account.ts](../../src/lib/validations/financial-account.ts): `icon` is
an `z.enum(CATEGORY_ICONS)` whitelist (an unmapped icon renders blank), `color` is a hex string,
`name` is trimmed and length-capped. `userId` and `isSystem` are **never** accepted from the client.

```ts
import { z } from "zod";
import { CATEGORY_ICONS } from "@/lib/constants";

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Pick a valid color");
const categoryIcon = z.enum(CATEGORY_ICONS);

/** Create: name + icon + color. isSystem/userId are server-set. */
export const createCategorySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(50),
  icon: categoryIcon,
  color: hexColor,
});

/** Update: same fields, patchable. id identifies the row; ownership checked server-side. */
export const updateCategorySchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, "Name is required").max(50).optional(),
  icon: categoryIcon.optional(),
  color: hexColor.optional(),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
```

> **Why `icon` is an enum, not a free string.** Same reasoning as `ACCOUNT_ICONS`: an icon name with
> no `icon-map.ts` entry falls back to `HelpCircle` and looks broken. The whitelist is the contract
> between the picker, the schema, and `resolveIcon`. Every name in `CATEGORY_ICONS` **must** be
> registered in `resolveIcon`.

---

## 6. Server actions (`src/actions/categories.ts`)

`"use server"`. Reuse the established shape exactly: `MutationResult`, `NOT_AUTHED`
(`"You must be signed in."`), `auth()` guard → Zod `safeParse` → ownership scope by
`session.user.id` → `{ success, error? }` → `revalidateCategoryViews()`.

| Action | Behavior |
|---|---|
| `createCategory(input)` | Validate. **Dedup check** (case-insensitive name vs system + the user's own). Insert with `userId` from session, `isSystem: false`. **Returns the new category** as a `CategoryOption` so the picker can select it without guessing (see §9). |
| `updateCategory(input)` | Patch `name` / `icon` / `color`. Ownership gate `where: { id, userId, isSystem: false }`; dedup check if `name` changes (excluding the row itself). |
| `deleteCategory(id)` | **Hard delete**, ownership-gated. FK rules apply: transactions/templates → `SetNull`, **budgets → cascade-deleted** (§7). |
| `getCategoryForEdit(id)` | Thin auth-guarded proxy over a DB read; returns `EditableCategory` or `null` if not found / not owned (mirror `getBudgetForEdit`). |

> **`createCategory` returns a typed result, not the bare `MutationResult`.** Its shape is
> `{ success: true; data: CategoryOption } | { success: false; error: string }` (the `getDrawerFormData`
> precedent — a mutation that returns data). The picker uses `data` to append-and-select the new option
> directly, eliminating the optimistic-guess-then-reconcile dance (§9). `updateCategory` /
> `deleteCategory` keep the plain `MutationResult`.

### Ownership pattern (every mutating action)

```ts
const session = await auth();
if (!session?.user?.id) return NOT_AUTHED;
const userId = session.user.id;
// Scope EVERY query so a system category or another user's row can never be touched:
//   where: { id, userId, isSystem: false }
```

A mutation targeting a system category (`isSystem: true`, `userId: null`) or another user's row
matches **zero rows** under this `where` → return a single `{ success: false, error: "Category not
found." }` (collapse not-found and forbidden so ownership stays non-enumerable, matching the account
and goal slices).

### Dedup — three layers (app pre-check + DB index + catch)

Duplicate prevention is **defense in depth**, because no single mechanism covers every case:

**Layer 1 — app pre-check (UX + the only thing that catches system collisions).** Before insert (and
before a name-changing update), reject a name that collides **case-insensitively** with a system
category or one of the user's own:

```ts
const clash = await prisma.category.findFirst({
  where: {
    name: { equals: name, mode: "insensitive" },
    OR: [{ userId: null }, { userId }],
    NOT: { id: editingId }, // omit on create
  },
  select: { id: true },
});
if (clash) return { success: false, error: "A category with that name already exists." };
```

**Layer 2 — DB functional unique index (race-proof own-name dedup).** A `--create-only` migration adds:

```sql
-- prisma/migrations/<ts>_category_name_ci_unique/migration.sql
-- Case-insensitive uniqueness of a USER's own category names, enforced atomically.
-- (System rows have userId = NULL → treated as distinct by Postgres, controlled by the seed.)
CREATE UNIQUE INDEX "Category_lower_name_userId_key"
  ON "Category" (lower("name"), "userId");
```

This is the piece that **eliminates the race** Layer 1 can't: two concurrent requests both pass the
`findFirst` pre-check (neither sees the other's uncommitted row), but only one `INSERT` can win the
unique index — the loser raises a Postgres unique violation (`P2002`). The Prisma `@@unique([name,
userId])` stays in `schema.prisma` as-is; this functional index is strictly stronger on the name axis
and is added via raw SQL because Prisma's schema DSL can't express `lower(name)`. (Pattern precedent:
the recurring partial-unique-index migration.)

**Layer 3 — catch the violation.** Wrap the write in `try/catch`; a `P2002` (the index firing on a
race, or any path the pre-check missed) maps to the **same** friendly message, never a 500:

```ts
try {
  const created = await prisma.category.create({ data: { name, icon, color, userId, isSystem: false } });
  // ...return { success: true, data: toCategoryOption(created) }
} catch (e) {
  if (isUniqueConstraintError(e)) {
    return { success: false, error: "A category with that name already exists." };
  }
  throw e;
}
```

> **Why all three.** Layer 1 is the only one that can enforce the **system-collision** rule (a
> cross-`userId` predicate no index expresses) and gives an instant, friendly error on the common path.
> Layer 2 is the only one that is **atomic under concurrency** for own-name duplicates. Layer 3 turns
> the rare race that reaches the DB into the same UX instead of a crash. Dropping any one re-opens a
> gap: no Layer 2 ⇒ a true race double-inserts; no Layer 1 ⇒ system collisions slip through; no Layer 3
> ⇒ the race surfaces as a 500.

#### Casing: store as typed, compare case-insensitively (feedback #2 + #5)

The **stored `name` keeps the user's original casing** ("Groceries", "BBQ", "iTunes") — there is **no
normalization to lower/title case on write**. Only the *uniqueness comparison* is case-insensitive
(Layer 1's `mode: "insensitive"`, Layer 2's `lower(name)`). A future dev must not "tidy this up" by
lower-casing the column or adding a normalized shadow field: the display name is the user's, and a
`lower()` functional index already provides the case-insensitive guarantee without mangling stored
data. (If a normalized column is ever wanted for search, it must be *additive* — never overwrite
`name`.)

This makes two rename cases unambiguous:

- **Recasing your own category (`"groceries"` → `"Groceries"`) is allowed.** The pre-check excludes the
  row itself (`NOT: { id: editingId }`), and the functional index permits a row to update to a value
  whose `lower()` equals its own current `lower()` (no second row is created). The new casing is saved
  verbatim.
- **Renaming one category onto another's name modulo case (`"Food"` → `"GROCERIES"` while a
  `"groceries"` already exists) is rejected** — `lower("GROCERIES") = lower("groceries")` collides on a
  *different* row, so Layer 1 (or Layer 2 on a race) returns "A category with that name already
  exists." Same rule whether the existing row is the user's own or a system category.

#### Share the write-path logic, don't duplicate it (feedback #1)

`createCategory` and `updateCategory` share the dedup pre-check and the `P2002`→message mapping. Factor
those into **two small module-private helpers** in `actions/categories.ts` (not a new "repository"
layer — that abstraction isn't a codebase norm; the established shape is `actions/*` over
`lib/db/*`):

```ts
// internal to actions/categories.ts — keep the duplication out of both actions.
async function assertNameAvailable(userId: string, name: string, editingId?: string): Promise<string | null>; // returns an error message or null
function mapCategoryWriteError(e: unknown): MutationResult | null; // P2002 → friendly result, else null (caller rethrows)
```

Both actions call `assertNameAvailable` before the write and run the write inside a `try/catch` that
defers to `mapCategoryWriteError`. This keeps ownership scoping in the action (where the `where` clause
is read in context) but centralizes the two genuinely-shared pieces, so adding e.g. a future `mergeCategory`
action reuses them rather than re-deriving the rules.

### Revalidation

Add to [src/lib/revalidation.ts](../../src/lib/revalidation.ts):

```ts
/** Revalidate every surface that lists or assigns categories. */
export function revalidateCategoryViews() {
  revalidatePath("/settings");     // the manage list
  revalidatePath("/transactions"); // pickers + the feed's category labels
  revalidatePath("/budgets");      // picker + budget rows
  revalidatePath("/recurring");    // picker + template rows
  revalidatePath("/dashboard");    // recent-transactions + budget panel show category names/colors
  revalidatePath("/reports");      // spending-by-category chart
}
```

> Categories fan out widely (every transaction/budget/recurring/report surface renders a category
> name or color), so this helper touches more paths than the other slices. A rename or recolor must
> propagate everywhere the category is shown; a delete must clear it from feeds and charts.

---

## 7. Delete semantics — the budget-cascade decision

Deleting a user category is a **hard delete** (no `deletedAt` on `Category`). The schema's existing
FK rules then fire automatically:

- **Transactions** referencing it → `categoryId` set to `null` → render as **Uncategorized**
  (the `UNCATEGORIZED` constant, already extracted in `src/lib/constants.ts`). ✅ Designed, safe.
- **Recurring templates** referencing it → `categoryId` set to `null` → **Uncategorized**. ✅
- **Budgets** referencing it → **cascade-deleted** (Budget requires a `categoryId`). ⚠️

### Decision: warn-and-proceed (do not migrate the FK)

The confirm dialog **must state the concrete impact before the user commits**, computed from
`getManageableCategories`' usage counts (no extra query at delete time), distinguishing the
**uncategorized** (SetNull) outcomes from the **deleted** (Cascade) one:

> Delete "Hobbies"? This leaves **12 transactions** and **1 recurring template** uncategorized, and
> **deletes 2 budgets** that use this category. This can't be undone.

Each clause is conditional on a non-zero count (omit "and 0 recurring templates"). Only after explicit
confirmation does `deleteCategory` run.

> **Why warn-and-cascade, not block or reassign:**
> - **Blocking** ("remove the budgets/transactions first") makes deleting a lightly-used category
>   tedious and is hostile for a power-user convenience feature.
> - **Reassigning budgets to Uncategorized** is unsafe: `Budget` has `@@unique([userId, categoryId,
>   month, year])`, so moving a category's budgets onto `Uncategorized` could collide with an existing
>   Uncategorized budget for the same month and throw. Transactions/templates use `SetNull` and don't
>   have this problem, which is exactly why the schema treats them differently.
> - **Changing `Budget.onDelete` to `Restrict`/`SetNull`** is a schema migration with its own
>   trade-offs (SetNull can't apply — `Budget.categoryId` is non-nullable; Restrict reintroduces the
>   blocking UX). Out of scope for a deferrable slice. The honest, no-migration path is to **show the
>   impact and let the user decide**, consistent with the hard-delete-with-confirm pattern Goals
>   already established.

The usage counts come from `getManageableCategories` (§8), already loaded into the `/settings` list —
the dialog reads `category.transactionCount` / `category.recurringCount` / `category.budgetCount`
straight from the row, **no delete-time round-trip** (mirrors the Goals delete-dialog contribution
count).

> **Future hardening seam — block-on-budgets is a documented option, not built (feedback #3).** A
> "refuse deletion while active budgets reference this category" rule was considered. It is **not**
> shipped: it adds a second delete code path (blocked vs allowed) and a dual-state dialog for a
> *deferrable* power-user slice, which cuts against "Decisions over options — pick one implementation."
> The warn-and-proceed dialog above is the one decision. **If** post-launch feedback shows budget loss
> is genuinely surprising, the cleanest enable point is a single guard at the **top of
> `deleteCategory`**: `if (BLOCK_DELETE_WITH_ACTIVE_BUDGETS && budgetCount > 0) return { success:
> false, error: "Remove this category's budgets first." }` (constant in `system-constants.ts`, count
> from the same `_count`). The dialog already has `budgetCount`, so the UI could pre-disable the
> button with no new query. Recording the seam here is the deliverable — **do not** add the flag or the
> branch now; a dormant dual-path with no caller is exactly the speculative surface area to avoid.

---

## 8. DB fetchers (`src/lib/db/categories.ts`)

Keep `getUserCategories(userId)` **exactly as is** — it backs every picker and the transactions
filter bar (system + user, ordered by name). Add one fetcher for the manage list:

```ts
/**
 * The user's OWN categories (isSystem = false), with usage counts for the manage
 * list + delete-impact dialog. System categories are intentionally excluded —
 * they are immutable and don't belong in a "your categories" management view.
 */
export async function getManageableCategories(
  userId: string
): Promise<ManageableCategory[]> {
  const categories = await prisma.category.findMany({
    where: { userId, isSystem: false },
    select: {
      id: true,
      name: true,
      icon: true,
      color: true,
      _count: {
        select: {
          transactions: { where: { deletedAt: null } },
          budgets: { where: { isArchived: false } },
          recurringTemplates: { where: { isActive: true } },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  return categories.map((c) => ({
    id: c.id,
    name: c.name,
    icon: c.icon,
    color: c.color,
    transactionCount: c._count.transactions,
    budgetCount: c._count.budgets,
    recurringCount: c._count.recurringTemplates,
  }));
}
```

> **Count semantics — all three affected relations.** The delete dialog must reflect **every** entity
> the cascade touches, not just the destructive ones. `transactionCount` and `recurringCount` are the
> **`SetNull`** relations — those rows survive but go Uncategorized; `budgetCount` is the **`Cascade`**
> relation — those rows are **deleted**. Surfacing only transactions + budgets, as the first draft did,
> would hide the templates the delete silently uncategorizes. `_count` keeps this one query — no N+1.
> The dialog phrasing distinguishes the two outcomes (uncategorized vs deleted) so "deletes N budgets"
> never gets mistaken for "uncategorizes N templates."
>
> **All three counts deliberately scope to *user-visible* rows (feedback #4).** Each `where` filters to
> the rows the user actually sees: `deletedAt: null` (transactions), `isArchived: false` (budgets),
> **`isActive: true`** (templates — `RecurringTemplate` has no `isArchived`; "paused" = `isActive:
> false` is its hidden state). This is one consistent philosophy — *count what the user will notice
> changing* — not three ad-hoc filters. The FK action at the DB still fires on the hidden rows too
> (a soft-deleted transaction's `categoryId` is also nulled; a **paused template** is also nulled; an
> **archived budget is also cascade-deleted**), but those are already out of the user's view, so the
> headline impact number omits them to avoid alarming about invisible data. The one with teeth —
> an archived budget being *deleted*, not just hidden — is called out as an accepted trade-off (§14);
> if QA shows it matters, switching `budgetCount` to count all budgets is a one-line `where` change.

`getCategoryForEdit(userId, id)` (used by the action proxy) returns `{ id, name, icon, color }` scoped
`where: { id, userId, isSystem: false }`, or `null`.

---

## 9. UI

### Constants (`src/lib/constants.ts`)

```ts
/**
 * Category icon whitelist for the create/edit picker. A tuple so the Zod schema
 * can `z.enum` it. EVERY name must be registered in `icon-map.ts`. Superset of the
 * seeded system-category icons so a user's palette feels familiar.
 */
export const CATEGORY_ICONS = [
  "ShoppingCart", "UtensilsCrossed", "Bus", "Home", "Zap", "Heart",
  "Gamepad2", "Briefcase", "Laptop", "Tv", "Shirt", "BookOpen",
  "Shield", "Gift", "Plane", "Landmark", "PawPrint", "TrendingUp",
  "MoreHorizontal", "HelpCircle",
] as const;

/** Category accent swatches offered in the drawer (semantic-system aligned). */
export const CATEGORY_COLORS = [
  "#EF9F27", "#D85A30", "#7F77DD", "#1D9E75", "#F59E0B", "#D4537E",
  "#378ADD", "#6366F1", "#EC4899", "#0EA5E9", "#10B981", "#888780",
] as const;

export const DEFAULT_CATEGORY_COLOR = CATEGORY_COLORS[0];
export const DEFAULT_CATEGORY_ICON = CATEGORY_ICONS[0];
```

> Every `CATEGORY_ICONS` name above is **already** registered in `resolveIcon`
> ([icon-map.ts](../../src/lib/icon-map.ts) maps all 20 system-category icons). If the final list adds
> a new name, register it in `icon-map.ts` in the same change — the Zod enum and the map must stay in
> lockstep.

#### Palette extension strategy (feedback #4 — keep growth safe + scannable)

As more icons/colors are wanted over time, follow one rule and one guardrail so the picker doesn't
rot:

- **`CATEGORY_ICONS` is the single source of truth.** The Zod enum, the picker grid, and (transitively)
  what `resolveIcon` must support all derive from this one tuple. Never hardcode an icon name in the
  drawer — map over the tuple. Adding an icon is a **three-line, one-commit** change: append to the
  tuple → add the import+entry in `icon-map.ts` → done. **No data migration** is ever needed: existing
  rows store icon *names* as strings, and widening the allowed set only *adds* valid choices (it never
  invalidates a stored value, since the set only grows).
- **The icon↔map test is the drift guard.** The §12 test asserting every `CATEGORY_ICONS` name resolves
  to a non-fallback fails CI the moment someone extends the tuple without touching the map — so the two
  can never silently diverge. That test *is* the extension safety net; keep it.
- **Soft UX cap, not a hard limit.** Keep the picker scannable: target **≤ ~24 icons** and **≤ ~12
  colors** (a single tidy grid / swatch row). This is a design ceiling, not a code constraint — if a
  future need pushes past it, that's the signal to add **search/grouping** to the icon picker rather
  than an ever-taller wall of icons. Don't pre-build grouping now (YAGNI); revisit only when the cap is
  actually hit.
- **Never shrink the set casually.** *Removing* an icon/color from the tuple is the one risky edit: a
  stored row referencing the removed name would fall back to `HelpCircle` (icon) or render an
  off-palette color. If a value must be retired, keep it resolvable in `icon-map.ts` even after dropping
  it from the *picker* tuple, or run a one-shot backfill — treat removal as a migration, not a tuple
  trim.

### `category-picker-field.tsx` (shared across the three drawers)

A small client component that renders the existing category `<select>` **plus** a "+ New category"
affordance and owns the create-drawer open state. Replaces the raw `<select>` currently inlined in
the transaction drawer (and the equivalent selects in the budget/recurring drawers).

- Props: `categories: CategoryOption[]`, `value: string`, `onChange(id)`, plus an
  `allowUncategorized?: boolean` (transactions/recurring allow an empty "Uncategorized" option;
  budgets require a category).
- Renders the `<select>` (unchanged styling) and, below it, a `+ New category` text button.
- Clicking it opens `<CategoryFormDrawer>` in **create** mode.
- **On create success the new category is auto-selected, using the row `createCategory` returns**
  (feedback #6): the field appends `result.data` (a `CategoryOption`) to its local list and calls
  `onChange(result.data.id)` — the option is real and selectable **immediately**, with no optimistic
  guess to reconcile. A `router.refresh()` still fires afterward to propagate the new category to the
  other surfaces (feed labels, reports), but the host drawer no longer *depends* on the refresh to
  make the new option selectable.

> **Why the returned row beats optimistic-insert-then-refresh.** The first draft prepended a
> client-built guess of the new option and waited for `router.refresh()` to replace it with the real
> one — two representations of the same row that can briefly disagree (id mismatch, server-trimmed
> name). Returning the persisted `CategoryOption` from `createCategory` collapses that to one source of
> truth: the field selects the exact row the DB created. Simpler component, no reconcile window.

> **Why a shared field, not three edits.** The transaction drawer, budget drawer, and recurring
> drawer each render a near-identical category `<select>`. Extracting `<CategoryPickerField>` means
> "+ New category" is implemented once and behaves identically everywhere (matches the
> codebase's "one job per component" + DRY norms).

### `category-form-drawer.tsx`

- shadcn **Sheet** — right panel ≥768px / bottom sheet <768px (`useMediaQuery` + `BREAKPOINTS.mobile`),
  exactly like the goal/budget drawers.
- Fields: **name** (text), **icon** (a grid of `CATEGORY_ICONS` rendered via `resolveIcon`, single
  select), **color** (a swatch row of `CATEGORY_COLORS`, single select). A live preview chip (icon on
  color) at the top.
- Create + edit modes (edit pre-fills from `getCategoryForEdit`). Submit via `useTransition` →
  `createCategory` / `updateCategory`; surface `{ error }` inline.
- Defaults in create mode: `DEFAULT_CATEGORY_ICON` / `DEFAULT_CATEGORY_COLOR` (named constants, not
  `[0]` coupling — same rule as `DEFAULT_ACCOUNT_*`).

### `manage-categories.tsx` (on `/settings`)

- A new card section "Categories" on the existing `/settings` page (alongside Preferences, Billing,
  Your data). Heading + "Add category" button (opens the create drawer).
- Lists `getManageableCategories` rows: icon chip + name + a muted "used by N transactions · M
  budgets · K recurring" line (omit zero-count clauses); per-row Edit (opens drawer) and Delete (opens
  confirm dialog).
- **Empty state** (user has no custom categories yet — the common case): a one-line "You haven't
  created any categories yet. The 20 built-in categories are always available." + the Add button.
  Active guidance, not a blank panel (onboarding principle).

### `confirm-delete-dialog.tsx`

- Native `<dialog>` (mirror recurring/goals). Copy states the **delete impact** from the row's counts
  (§7): "leaves N transactions uncategorized and deletes M budgets." On confirm → `deleteCategory` →
  toast → `router.refresh()`.

---

## 10. Should category management be a step in Onboarding? — **Recommendation: No**

The user asked whether to fold this into the (already-shipped) onboarding flow. **Recommendation: do
not add a category step to onboarding.** Reasons:

1. **The seeded categories already cover first run.** All 20 system categories exist for every user
   from signup (`userId = null`, no per-user seeding needed). A brand-new user can capture, budget,
   and report immediately — there is nothing a category step would *unblock*. Onboarding's job is to
   get the user to a usable state, and categories are already usable.
2. **Onboarding is deliberately minimal (1 mandatory step + 2 optional).** The shipped flow is
   account → starter budgets → done, and its design note is explicit that completion is derived from
   `activeAccountCount > 0` and that extra screens are convenience only
   ([onboarding-currency-spec.md](./onboarding-currency-spec.md) §6.4). Adding a "create categories"
   screen contradicts that minimalism and the "Decisions over options / never UI without backing
   function" principles — most users never need a custom category.
3. **It's the most deferrable feature in the roadmap.** ROADMAP §3 marks this as the first thing to
   cut. Wiring a cut-candidate into the critical first-run path is backwards.
4. **The right entry point is contextual, not upfront.** A user discovers they want a custom category
   *when assigning one to a transaction/budget* — which is exactly where the inline "+ New category"
   affordance (§9) lives. That is "just-in-time" creation at the moment of need, which fits the
   product's conscious-capture philosophy far better than asking someone to invent categories before
   they have a single transaction.

**What to do instead (already in this spec):** surface creation **inline in the pickers** (so it's
discoverable exactly when relevant) and centralize edit/delete on `/settings`. If onboarding ever
wants to *mention* categories, the lightest touch is a one-line reassurance on the existing
budgets/done step ("20 categories are ready; add your own anytime") — copy only, **no** new step,
**no** new flow state. That is the most this should ever take in onboarding.

---

## 11. Edge cases & rules

- **System categories are immutable.** Every mutation scopes `where: { id, userId, isSystem: false }`.
  A request targeting a system row or another user's row returns `"Category not found."` (non-
  enumerable). Never expose an edit/delete affordance for system categories in the UI — the manage
  list only renders `getManageableCategories` (own, non-system).
- **Name dedup is case-insensitive and spans system + own (§6).** "groceries" is rejected when
  "Groceries" exists (system or own). The functional `(lower(name), userId)` index is the race-proof
  backstop for own-name; the app pre-check is the UX *and* the only enforcement of the system-collision
  rule; the `P2002` catch turns a lost race into the same friendly error.
- **Delete impact covers all three relations (§7/§8).** The confirm dialog reports transactions **and
  recurring templates** going Uncategorized (SetNull) *and* budgets being deleted (Cascade). Counting
  only transactions + budgets would hide the templates the delete silently uncategorizes.
- **Delete cascades to budgets, nulls transactions/templates (§7).** This is the headline behavior —
  the confirm dialog must state it. Do not assume "delete only affects transactions" (the ROADMAP's
  wording); budgets are removed.
- **`Uncategorized` is the display fallback, not a reassignment target.** Transactions/templates whose
  category was deleted render via the existing `UNCATEGORIZED` constant because `categoryId` is now
  `null` — we do **not** repoint them at the seeded "Uncategorized" category row. (The seeded
  "Uncategorized" system category remains the *picker* fallback label; the `SetNull` path produces a
  literal `null`, which the existing render code already maps to "Uncategorized".)
- **No category count limit.** Nothing in Monetization gates categories; this is not a Pro feature. Do
  not add a cap.
- **Auto-select after inline create.** Creating from a picker must select the new category in the host
  drawer (§9) — otherwise the user creates it and then has to find it, defeating the 5-second-capture
  goal.
- **Recurring edit locks the category.** The recurring template drawer disables category on **edit**
  (existing behavior); the "+ New category" affordance therefore appears only in **create** mode there.
  Transaction and budget drawers allow it in both modes.
- **Icon ↔ map lockstep.** A `CATEGORY_ICONS` entry with no `icon-map.ts` mapping renders blank.
  Adding an icon means adding it to both the tuple and `resolveIcon` in one change (a test asserts
  every `CATEGORY_ICONS` name resolves to a non-fallback — §12).
- **Revalidation is broad (§6).** A rename/recolor/delete must refresh transactions, budgets,
  recurring, dashboard, reports, and settings — categories are rendered on all of them.
- **Empty manage list is the norm.** Most users will have zero custom categories; the section must
  render its guidance empty state, never a blank card.

---

## 12. Testing (`test/`, Vitest, mock `@/lib/prisma` + `@/auth`)

**`test/lib/validations/category.test.ts`**
- `createCategorySchema`: rejects empty/whitespace name, name > 50 chars, an icon outside
  `CATEGORY_ICONS`, a non-hex color; accepts a valid triple; trims name.
- `updateCategorySchema`: all of name/icon/color optional; `id` required.
- **Icon ↔ map guard:** every `CATEGORY_ICONS` name resolves via `resolveIcon` to something **other
  than** the `HelpCircle` fallback (except `"HelpCircle"` itself) — catches a whitelist entry missing
  from `icon-map.ts`.

**`test/actions/categories.test.ts`** (mock `@/lib/prisma`, `@/auth`)
- Unauthorized (no session) → `NOT_AUTHED` for all three mutations.
- `createCategory`: valid input inserts with session `userId` and `isSystem: false`; a client-supplied
  `userId`/`isSystem` is ignored; invalid input → validation error, no prisma write.
- `createCategory` **dedup (pre-check)**: rejects a name matching a system category (case-insensitive)
  and a name matching the user's own existing category; no insert on clash. Returns the new
  `CategoryOption` (`{ success: true, data }`) on the happy path — assert the action's resolved value
  carries the created row's id/name/icon/color, since the picker relies on it (feedback #6).
- `createCategory` **dedup (race / `P2002` catch)**: when the pre-check passes but `prisma.category.create`
  rejects with a Prisma unique-constraint error (`code: "P2002"` — the functional index firing on a
  concurrent insert that slipped past `findFirst`), the action returns the **same** friendly
  `"A category with that name already exists."` and does **not** rethrow / 500. Mock `create` to throw a
  `PrismaClientKnownRequestError`-shaped `{ code: "P2002" }`; assert the mapped message. A non-`P2002`
  error must still propagate (assert it rethrows). This is the unit-level proof of the concurrency
  contract — true DB races are enforced by the index (§6 Layer 2), which a mocked-Prisma test can't
  exercise directly (feedback #5).
- `updateCategory` **name-change race**: same `P2002` → friendly-message mapping on the update path.
- `updateCategory`: ownership scoping (`where` includes `userId` **and** `isSystem: false`); a system
  category id or foreign id → `"Category not found."`, no write; name-change dedup excludes the row
  itself (renaming to its own current name is allowed).
- `deleteCategory`: hard `delete` scoped by `userId` + `isSystem: false`; system/foreign id → not
  found, no delete. (The FK cascade is a DB behavior — assert the action issues the scoped delete; the
  cascade itself is covered by the schema, not unit-mocked.)
- `getManageableCategories` shape: returns own non-system rows with `transactionCount`/`budgetCount`
  derived from `_count` (can live in a `test/lib/db` file if a DB-fetcher test is added; otherwise
  assert via the action proxy).

Run `npm run test:run` and `npm run build` before commit (per
[ai-interaction.md](../ai-interaction.md) workflow).

> **On a real-Postgres integration test for the functional index (feedback #3) — out of the unit
> suite, into migration verification.** The suggestion is sound in spirit (a mocked Prisma can't prove
> the `lower(name)` index actually rejects a case-variant duplicate), but the project's testing
> standard is explicit: *"Never hit a real database in tests. Mock `@/lib/prisma`."* (coding-standards
> → Testing). Adding a live-PG test would need a new harness (test DB lifecycle, container/branch,
> seeding) that doesn't exist and contradicts that rule — disproportionate for a deferrable slice.
> Instead, the index's real-DB behavior is verified **once, manually, at migration time** against the
> `development` Neon branch — promote it from "nice idea" to a checklist item in §13 step 2:
>
> ```sql
> -- After applying the migration on `development` (read-only confirmation it bites):
> -- 1) a case-variant duplicate for the SAME user must fail with a unique violation:
> --    INSERT ... ('groceries', '<userId>')  → expect: duplicate key on Category_lower_name_userId_key
> -- 2) the same name for a DIFFERENT user must succeed (per-owner scoping holds).
> ```
>
> Run this by hand on the dev branch when the migration lands (it is throwaway verification, not
> committed test code). If a DB-integration harness is ever added to the project, this index is a
> good first candidate to cover there — but standing one up is its own slice, not part of this one.

### Manual QA

1. Transaction drawer → "+ New category" → create "Hobbies" (icon + color) → it's auto-selected and
   appears in the list; save the transaction → feed shows the Hobbies color/icon.
2. `/settings` → Categories → "Hobbies" listed with "used by 1 transaction"; Edit → recolor → the
   change propagates to the transaction feed and dashboard.
3. Create a budget for "Hobbies" → manage list shows "1 budget".
4. Delete "Hobbies" → confirm dialog states "leaves 1 transaction uncategorized and deletes 1 budget"
   → confirm → transaction now shows Uncategorized, the Hobbies budget is gone.
5. Try creating "Groceries" (a system name) → rejected with the dedup message.
6. Confirm system categories never show Edit/Delete controls.

---

## 13. Implementation order

1. Constants (`CATEGORY_ICONS`, `CATEGORY_COLORS`, defaults) + register any new icon in `icon-map.ts`
   + types (`src/types/categories.ts`, incl. `recurringCount` on `ManageableCategory`) + Zod schemas
   (no deps). Add the icon↔map validation test.
2. **Migration** — `prisma migrate dev --create-only --name category_name_ci_unique`, hand-edit the
   SQL to the functional unique index (§6 Layer 2), apply to the `development` Neon branch
   (`br-hidden-bonus-aqksw1pa`), verify `prisma migrate status` clean. (Production at launch.) Before
   applying, a read-only check for existing case/owner-duplicate names is prudent — the index creation
   fails if duplicates already exist; none should, but confirm. **After** applying, run the manual
   index-verification SQL (§12) once on `development` to confirm the index actually rejects a
   case-variant own-name duplicate and allows the same name across users — the real-DB proof the
   mocked unit tests can't give.
3. `getManageableCategories` (with all three `_count`s) in `db/categories.ts` (leave `getUserCategories`
   untouched).
4. `revalidateCategoryViews()` in `revalidation.ts`.
5. Server actions + `test/actions/categories.test.ts` (ownership, system-rejection, dedup pre-check,
   the `P2002`-catch race contract, and `createCategory`'s returned `CategoryOption`).
6. `category-form-drawer.tsx` + `category-picker-field.tsx` (select via the returned row, no optimistic
   guess); swap the picker into the transaction, budget, and recurring drawers.
7. `manage-categories.tsx` + `confirm-delete-dialog.tsx` (three-relation impact copy); render the
   Categories section on `/settings`.
8. `npm run test:run` + `npm run build`; full manual pass (§12): inline create → auto-select → manage
   edit → delete with the transactions/templates/budgets impact warning.

---

## 14. Decisions

### Resolved (baked into this spec)

- **Only user categories are mutable** — `isSystem: false` + `userId === session.user.id`; every
  mutation scoped, system/foreign rows collapse to `"Category not found."`.
- **Dedup is three-layered (feedback #1)** — an app pre-check (case-insensitive, spans system + own;
  the only enforcement of the system-collision rule), a **functional unique index `(lower(name),
  userId)`** that makes own-name dedup atomic/race-proof at the DB, and a `P2002` catch mapping the
  rare race to the same friendly error. The index ships as a `--create-only` raw-SQL migration (the
  one schema-adjacent change); the Prisma `@@unique` stays.
- **`createCategory` returns the persisted `CategoryOption` (feedback #6)** — the picker selects the
  real row, dropping the optimistic-insert-then-refresh reconcile window.
- **Delete impact counts all three relations (feedback #2)** — `getManageableCategories` also returns
  `recurringCount`; the confirm dialog reports transactions + templates *uncategorized* and budgets
  *deleted*, not just the first draft's transactions + budgets.
- **All three impact counts scope to user-visible rows (feedback #4)** — non-deleted transactions,
  active (`isArchived: false`) budgets, active (`isActive: true`) templates. One consistent
  "count what the user will notice" rule, not three ad-hoc filters; documented in §8.
- **`name` stores original casing; uniqueness is case-insensitive (feedback #2 + #5)** — no write-time
  normalization; recasing your own category is allowed, renaming onto another row's name modulo case is
  rejected. Spelled out in §6 so no future dev lower-cases the column.
- **Shared write-path helpers, not a repository (feedback #1)** — `assertNameAvailable` +
  `mapCategoryWriteError` are module-private to `actions/categories.ts`, reused by create and update;
  ownership scoping stays inline in each action (§6).
- **Index correctness is verified manually at migration time, not via a live-DB unit test (feedback
  #3)** — the testing standard forbids real DBs in the suite; the `lower(name)` index is proved once
  by hand on the `development` branch (§12/§13).
- **Delete is a hard delete with a usage-impact confirm dialog** — no `deletedAt`, no snackbar undo
  (mirrors Goals). The dialog states transactions-uncategorized + **budgets-deleted**.
- **Budget cascade is surfaced, not migrated** — `Budget.onDelete: Cascade` stays; the user is warned
  rather than blocked or auto-reassigned (the unique budget constraint makes reassignment unsafe). §7.
- **Creation is inline in the pickers; management lives on `/settings`** — no `/categories` route.
- **One shared `<CategoryPickerField>`** drives "+ New category" across the transaction, budget, and
  recurring drawers — implemented once.
- **Inline create auto-selects the new category** in the host drawer.
- **Icon is a whitelisted enum backed by `icon-map.ts`**; color is a hex from a swatch palette — same
  contract as `ACCOUNT_ICONS`/`ACCOUNT_COLORS`. Defaults are named constants, not `[0]` coupling.
- **Not a Pro gate, no count limit** — categories are unlimited on both tiers.
- **NOT added to onboarding (§10)** — seeded categories suffice for first run; just-in-time creation
  in the pickers is the right entry point; at most a one-line copy mention, never a new step.
- **`getUserCategories` is unchanged** — the picker/filter fetcher stays; only a new
  `getManageableCategories` (own + usage counts) is added.

### Considered and deliberately NOT built

- **Block-on-budgets feature flag (feedback #3) — documented seam, not shipped.** A "refuse delete
  while active budgets exist" toggle was weighed and rejected for now: a dormant flag means two delete
  paths + a dual-state dialog with no live caller — speculative surface area that cuts against
  "Decisions over options." The warn-and-proceed dialog is the single decision. §7 records the exact
  one-line enable point (`BLOCK_DELETE_WITH_ACTIVE_BUDGETS` guard at the top of `deleteCategory`) so it
  can be switched on quickly **if** post-launch feedback shows budget loss is surprising — but it is not
  built today.

### Accepted trade-offs (known, deliberate)

- **Deleting a category deletes its budgets.** Surprising but honest and surfaced in the dialog;
  changing the FK is a migration with worse UX. The block-on-budgets seam (above) is the escape hatch
  if this proves wrong in practice.
- **Hidden rows are affected but not counted (§8).** The cascade also deletes any **archived** budget
  for the category, and SetNull also nulls soft-deleted transactions and **paused** templates — none
  of which appear in the dialog's counts (which scope to visible rows). The only one with real teeth is
  the archived-budget deletion; it's accepted because archived budgets are already out of the active
  view, and the fix (count all budgets) is a one-line `where` change if QA disagrees.
- **The system-collision dedup remains app-level only.** No index can express "unique across `userId =
  null` OR `userId = me`," so a *system*-name collision is caught by the pre-check alone (the functional
  index only guards own-name). The pre-check + `P2002` catch make this robust in practice; a true
  system-collision race (vanishingly unlikely — system rows are seed-fixed and never created at
  runtime) would at worst produce one cosmetic duplicate picker row, not corruption.
- **No reassignment-on-delete UI.** Transactions/templates become Uncategorized via `SetNull`; a user
  who wants to re-home them does it manually. A bulk-reassign tool is post-MVP.
- **Soft palette caps, not enforced (feedback #4).** The ~24-icon / ~12-color ceilings (§9) are design
  guidance backed by the icon↔map drift test, not a hard code limit. If a future need blows past them,
  that's the trigger to add icon-picker search/grouping — not pre-built now.

### Still open

None blocking. If a future favourites/visibility model for *system* categories is wanted (hide
unused ones from the picker), that is a separate post-MVP slice — explicitly out of scope here.
