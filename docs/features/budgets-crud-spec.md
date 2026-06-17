# Budgets CRUD Spec

> Implement the full **read + write** stack for monthly category budgets at
> `/budgets`, mirroring the patterns already established by the Transactions
> feature (server-component reads via `src/lib/db/*`, `"use server"` mutations via
> `src/actions/*`, Zod validation, row-level ownership, toast + snackbar undo).

_Status: proposal • Feature: Budgets CRUD • Last updated: 2026-06-16_

Authoritative sources: `context/project-overview.md` (Budgets feature, Design
System, Onboarding), `docs/entity-types.md` (Budget fields/rules), and
`docs/entity-crud-architecture.md` (Budget read/mutation contract).

---

## 1. Goal

A user can manage a calendar month's budgets end-to-end on `/budgets`:

- **Create** a budget: pick a category + amount for the selected month/year.
- **Read**: see every budget for the selected period with live spend, progress
  bar (green / amber / red), and a remaining-summary block — reusing the exact
  visual language of the dashboard `BudgetsPanel`.
- **Update**: change a budget's `amount`.
- **Delete**: archive a budget (`isArchived = true`) with an 8-second snackbar
  undo — never a hard delete from the UI.

This completes the **control layer** half of the MVP loop (`capture → organize →
control → understand`): add a transaction → see it consume a budget here.

### Non-goals (explicit, per spec)

- **No rollover** between months — each `(category, month, year)` is independent.
- **No cross-currency conversion** — budget currency = the user's
  `preferredCurrency` at write time. Budgets in a period are expected to share one
  currency; if they don't, the summary total is **flagged approximate** (mixed-
  currency note), never silently converted. Full conversion is post-MVP.
- **No spend recomputation cache** — `spent` is always derived at query time.
- **No Reports/analytics** here — `/budgets` is a control screen, not insight.

---

## 2. What already exists (reuse, don't rebuild)

| Asset | Location | Use |
|---|---|---|
| Budget read logic | `getBudgetsData()` in `src/lib/db/dashboard.ts` | Spend-derivation pattern to lift into the new fetcher |
| Progress helpers | `src/lib/budget.ts` (`budgetState`, `budgetPercent`, `budgetColor`, `budgetFraction`) | Use as-is — no new threshold logic |
| Thresholds / colors | `BUDGET_THRESHOLDS`, `SEMANTIC_COLORS` in `src/lib/system-constants.ts` | Already correct (green <60%, amber 60–<100%, red ≥100%) |
| Types | `BudgetRow`, `BudgetSummary`, `CategoryRef` in `src/types/dashboard.ts` | Reuse for the page; add `BudgetEditable` for edit pre-fill |
| Category picker data | `getUserCategories()` in `src/lib/db/categories.ts` | Category options for the create/edit form |
| Visual row + summary | `src/components/dashboard/budgets-panel.tsx` | Reference layout; extract a shared row if convenient |
| Icon resolution | `resolveIcon()` in `src/lib/icon-map.ts` | DB icon-name string → Lucide component |
| Drawer / toast infra | `src/components/ui/sheet.tsx`, `src/components/ui/sonner.tsx` | Reuse Sheet for the budget form drawer; Sonner for undo |
| Action conventions | `src/actions/transactions.ts` | Copy the auth guard, `safeParse`, `{ success, error }`, `revalidatePath` shape verbatim |

> **`BudgetsPanel` "Manage →" is currently a dead button.** Wiring it to
> `/budgets` is part of this feature (principle: *never UI without backing
> function*). Same for the per-page nav entry already in the sidebar.

---

## 3. Data model recap (`Budget`)

From `prisma/schema.prisma` / `docs/entity-types.md` — **no schema change**:

| Field | Type | Notes |
|---|---|---|
| `id` | `String` | cuid |
| `amount` | `Decimal(12,2)` | The ceiling — always **positive** |
| `currency` | `String` | = user `preferredCurrency`; never client-supplied |
| `month` | `Int` | 1–12 |
| `year` | `Int` | e.g. 2026 |
| `isArchived` | `Boolean` | `false` = active; archive = delete-from-UI |
| `userId` | FK | from session |
| `categoryId` | FK | system or user category |

Key constraints:

- `@@unique([userId, categoryId, month, year])` — one budget per category per
  period. **The key does _not_ include `isArchived`.** Consequence: an archived
  budget row still occupies its slot, so "archive then create the same
  category/period again" would throw `P2002`. The create action therefore
  **revives** an existing (archived or active) row instead of blindly inserting —
  see §7. Any genuine duplicate still returns a friendly message, never a raw
  Prisma error.
- `@@index([userId, year, month])` — backs the primary period query.
- Cascade: deleting a `Category` hard-deletes its `Budget` rows. (Not triggered
  here, but relevant — never surface a budget whose category was removed.)

---

## 4. Files to create / touch

| Layer | File | Action |
|---|---|---|
| Validation | `src/lib/validations/budget.ts` | **new** — Zod schemas (amount cap via `BUDGET_AMOUNT_MAX`) |
| Read fetcher | `src/lib/db/budgets.ts` | **new** — `getBudgets` + `getBudgetForEdit` + `getBudgetFormData` |
| Pure helpers | `src/lib/budget.ts` | **extend** — add `mapBudgetRow`, `summarizeBudgets` next to existing progress helpers |
| Shared type | `src/types/dashboard.ts` | **touch** — add `hasMixedCurrencies: boolean` to `BudgetSummary` (populate in `getBudgetsData` too) |
| Mutations | `src/actions/budgets.ts` | **new** — create(revive) / update / archive / unarchive / `seedPresetBudgets` + form data |
| Page | `src/app/budgets/page.tsx` | **new** — `force-dynamic`, reads searchParams `month`/`year` |
| Components | `src/components/budgets/*` | **new** — header, list, row, form drawer, empty state |
| Date/period helpers | `src/lib/budget-period.ts` | **new** — `parseMonth`, `parseYear`, `monthBounds` (→ `{ monthStart, nextMonthStart }`), `currentPeriod` |
| Constants | `src/lib/constants.ts` | add `BUDGET_AMOUNT_MAX`, `BUDGET_PRESETS` |
| Spend revalidation | `src/actions/transactions.ts` | **touch** — add `revalidatePath("/budgets")` to `revalidateTransactionViews()` |
| Nav wiring | `src/components/dashboard/budgets-panel.tsx` | link "Manage →" + summary to `/budgets` |
| Tests | `test/lib/budget-period.test.ts`, `test/lib/budget.test.ts` (extend), `test/actions/budgets.test.ts` | **new/extend** |

---

## 5. Validation — `src/lib/validations/budget.ts`

Mirror `validations/transaction.ts` (coerced positive amount, friendly messages):

```ts
import { z } from "zod";
import { BUDGET_AMOUNT_MAX } from "@/lib/constants";

const amount = z.coerce
  .number()
  .refine((n) => Number.isFinite(n), "Enter a valid amount")
  .refine((n) => n > 0, "Enter an amount greater than 0")
  // Enforce the same cap the UI advertises — constant and schema must agree.
  .refine((n) => n <= BUDGET_AMOUNT_MAX, "That budget is too large");

const month = z.coerce.number().int().min(1).max(12);
const year = z.coerce.number().int().min(2020).max(2100);

/** Create: category + amount for a given period. Currency is server-resolved. */
export const createBudgetSchema = z.object({
  categoryId: z.string().min(1, "Select a category"),
  amount,
  month,
  year,
});
export type CreateBudgetInput = z.infer<typeof createBudgetSchema>;

/** Update: only the ceiling is editable (period + category are the identity). */
export const updateBudgetSchema = z.object({ amount });
export type UpdateBudgetInput = z.infer<typeof updateBudgetSchema>;
```

Rules:
- `amount` is a **positive magnitude** — no sign games (budgets are ceilings).
- `currency`, `userId`, `isArchived` are **never** accepted from the client.
- Category and period are immutable after create — to "move" a budget the user
  archives and recreates (keeps the unique key clean, matches transaction-leg
  immutability philosophy).

---

## 6. Read path — `src/lib/db/budgets.ts`

`import "server-only"`. One fetcher returns the same `{ rows, summary }` shape
the dashboard already uses, so the page can render `BudgetsPanel`-style rows
directly. Lift the spend derivation from `getBudgetsData`:

```ts
export async function getBudgets(
  userId: string,
  month: number,
  year: number
): Promise<{ rows: BudgetRow[]; summary: BudgetSummary }> {
  // Half-open interval [monthStart, nextMonthStart). `Transaction.date` is
  // @db.Date — stored at UTC midnight — so an inclusive `lte: lastDay` bound
  // would *also* be correct here (there is no intra-day time to exclude). The
  // half-open form is used anyway because it is unambiguous and needs no
  // reasoning about column type if `date` ever gains a time component.
  const { monthStart, nextMonthStart } = monthBounds(month, year);

  const budgets = await prisma.budget.findMany({
    where: { userId, month, year, isArchived: false },
    include: {
      category: {
        include: {
          transactions: {
            where: {
              userId,
              deletedAt: null,
              type: "EXPENSE",
              date: { gte: monthStart, lt: nextMonthStart },
            },
            select: { amount: true },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const rows = budgets.map(mapBudgetRow);     // pure: row → BudgetRow
  const currencies = budgets.map((b) => b.currency);
  return { rows, summary: summarizeBudgets(rows, currencies, month, year) };
}
```

- **Spend** = `abs(SUM(EXPENSE tx in that category, that period, deletedAt null))`.
- **Pure, testable summary.** Extract two pure helpers (no Prisma) so the math is
  unit-testable without a DB mock (addresses the missing read-layer coverage):
  - `mapBudgetRow(budget)` → `BudgetRow` (`spent = abs(Σ amount)`, `limit`,
    `CategoryRef` via `resolveIcon`).
  - `summarizeBudgets(rows, currencies, month, year, now = new Date())` →
    `BudgetSummary`: `total = Σ limit`, `remaining = max(0, total − Σ spent)`,
    `categoryCount = rows.length`, `daysLeft` derived from `now` **only** when
    `(month, year)` is the current period (else `0`), and
    **`hasMixedCurrencies = new Set(currencies).size > 1`** — the defined data
    path for the mixed-currency warning. The injectable `now` (default
    `new Date()`) keeps the helper fully deterministic for tests. Put these in
    `src/lib/budget.ts` next to the existing progress helpers.

> **Type change:** add `hasMixedCurrencies: boolean` to `BudgetSummary` in
> `src/types/dashboard.ts`. It is a new required field; the dashboard
> `getBudgetsData` must also populate it (its budgets are effectively single-
> currency, so it can pass `[user.preferredCurrency]` or the budgets' own
> currencies → `false` in practice). Keeps one shared type honest.
- Add `getBudgetForEdit(userId, id)` → `{ id, categoryId, amount, month, year }`
  for drawer pre-fill (scoped `findFirst` by `userId`, `isArchived: false`).
- Add `getBudgetFormData(userId, month, year)` → categories with **no active
  budget** for the period (the create picker). Note this only excludes
  `isArchived: false` rows; a category whose budget was archived reappears as
  selectable and `createBudget` **revives** it (see §7) rather than inserting a
  duplicate — required because the unique key ignores `isArchived`.

> **Optional refactor (don't over-reach):** once `mapBudgetRow` /
> `summarizeBudgets` exist, `dashboard.ts:getBudgetsData` can call them too. If
> the diff is trivial, do it; otherwise leave `getBudgetsData` untouched — the
> dashboard panel is read-only and unaffected.

---

## 7. Mutation path — `src/actions/budgets.ts`

`"use server"`. Every action: `auth()` guard → `safeParse` → ownership-scoped
Prisma → `{ success, error? }` → `revalidatePath`. Copy the helpers from
`actions/transactions.ts` (`NOT_AUTHED`, `round2`).

```ts
function revalidateBudgetViews() {
  revalidatePath("/budgets");
  revalidatePath("/dashboard");
}
```

| Action | Signature | Behavior |
|---|---|---|
| `createBudget` | `(input: CreateBudgetInput)` | Validate; verify category is `{ userId }` **or** `{ userId: null }` (system); resolve `currency` from `user.preferredCurrency`; **revive-or-create** (see below). |
| `updateBudget` | `(id, input: UpdateBudgetInput)` | `findFirst({ id, userId, isArchived: false })` → 404 guard; `update` amount only. |
| `archiveBudget` | `(id)` | Ownership guard; set `isArchived = true`. This is the UI "delete". |
| `unarchiveBudget` | `(id)` | Ownership guard; set `isArchived = false`. Backs the snackbar **undo**. Defensive guard: if some other **active** row already holds the slot (only reachable via external mutation — see §11), return a friendly error instead of throwing `P2002`. |
| `seedPresetBudgets` | `(month, year)` | Batch-create the §9 preset for the period (see preset flow below). |
| `getBudgetForEdit` | `(id)` | **Thin auth-guarded proxy** over `db/budgets.ts#getBudgetForEdit`: `auth()` then delegate. Called by the drawer on a **row click** for edit pre-fill (mirrors `getTransactionForEdit`). |

> **Fetch timing — one pattern, no ambiguity.**
> - **`getBudgetFormData` (create picker) is fetched once at page render** by the
>   server component and passed to the drawer as a **prop**. It is *not* a client
>   action: changing the period navigates (`?month=&year=`), which re-renders the
>   page and re-derives the available-category list for free. After a
>   create/archive the page revalidates + `router.refresh()`, so the prop stays
>   current.
> - **`getBudgetForEdit` (edit pre-fill) is a client action**, fetched lazily on a
>   row click by id — the row data alone doesn't carry `categoryId`/raw amount.
>
> **Two-layer, not two implementations.** `db/budgets.ts` (server-only) owns the
> single Prisma implementation of both; the page calls `getBudgetFormData`
> directly, the drawer calls the `getBudgetForEdit` *action*, and that action only
> does `auth()` + delegate. Never copy query logic into an action.

**Revive-or-create (the core of `createBudget`).** The unique key ignores
`isArchived`, so a plain `create` can hit `P2002` against an archived row. Use a
pre-check for the active-duplicate *message* only, then an atomic `upsert` keyed
on the unique tuple — the revive/insert decision is a single statement, with no
check-then-act window between concurrent requests:

```ts
const key = { userId_categoryId_month_year: { userId, categoryId, month, year } };

// UX-only pre-check: an *active* duplicate is a user error, not a revive.
const existing = await prisma.budget.findUnique({ where: key });
if (existing && !existing.isArchived) {
  return { success: false, error: "A budget for this category already exists this month." };
}

// Atomic: revives an archived row (or inserts) without a P2002 window.
// `upsert` keeps the existing row `id` — identity is preserved; only
// amount / currency / isArchived change on revive.
await prisma.budget.upsert({
  where: key,
  update: { amount, currency, isArchived: false },
  create: { userId, categoryId, amount, currency, month, year },
});
```

The pre-check is best-effort (the picker already hides active categories). **Under
a rare concurrent active-duplicate the second request is treated as an idempotent
update** — the `upsert` updates the amount rather than crashing or erroring. This
is an accepted trade-off: the picker prevents the common path, and strict
"always error on an active duplicate" semantics would require a `Serializable`
transaction for no MVP-relevant benefit. Documented here so implementers don't
treat the silent-update-under-race as a bug.

Ownership & safety rules (match the transaction action exactly):
- Never trust a client `userId`/`currency`/`isArchived`.
- Category check: `prisma.category.findFirst({ where: { id, OR: [{ userId }, { userId: null }] } })` — 404 if missing (prevents budgeting another user's private category).
- Currency: `const { preferredCurrency } = await prisma.user.findUniqueOrThrow(...)`. Stamped at write time; existing budgets are **not** retro-updated when the user later changes `preferredCurrency` (see §11).
- Belt-and-suspenders: still wrap writes so a racing `P2002` maps to the friendly duplicate message rather than surfacing.

**Spend freshness (cross-cutting).** Adding a transaction must refresh an open
Budgets page. Extend `revalidateTransactionViews()` in `src/actions/transactions.ts`
to also `revalidatePath("/budgets")`. The drawer's `router.refresh()` re-runs the
(`force-dynamic`) page server component, so in-app edits reflect immediately;
the added `revalidatePath` covers cache correctness on navigation.

**Preset flow (`seedPresetBudgets`).** Resolve `BUDGET_PRESETS` names → system
category ids via `findMany({ where: { isSystem: true, name: { in: names } } })`,
drop any name that doesn't resolve, then drop categories that already have **any**
row (archived or active) for the period, and `createMany({ data, skipDuplicates:
true })` the rest in one call. `skipDuplicates` is a safety net against a race; the
pre-filter is what keeps it idempotent. Return `{ success: true, data: { created:
n } }` so the empty state can toast "Added n budgets". It never overwrites an
existing amount — preset is a *starter*, not a reset.

> **Deliberate divergence from `createBudget`:** the preset flow **skips** any
> category that already has a row for the period — **including archived ones** —
> rather than reviving them. `createBudget` is a single explicit user action where
> reviving the archived row is the expected outcome; `seedPresetBudgets` is a bulk
> convenience, and silently resurrecting budgets the user previously archived
> would be surprising. So: `createBudget` *revives* archived, `seedPresetBudgets`
> *leaves archived alone*. Skipping also keeps `createMany` clear of the archived
> row that still occupies the unique slot (avoids a `P2002`).

> **On resolving by name:** `name` *is* the stable identifier for system
> categories in this schema (`@@unique([name, userId])`, `userId: null`) — there
> is no slug/key column, and adding one is a schema change, out of scope here. So
> `BUDGET_PRESETS.categoryName` values **must** match seeded names exactly; a test
> asserts every preset name resolves against the seed (guards silent drift). A
> dedicated category key is a reasonable post-MVP migration.

---

## 8. Page + components

### `src/app/budgets/page.tsx`
`export const dynamic = "force-dynamic"`. Pattern from `transactions/page.tsx`:

1. `getSessionOrRedirect()` → `userId`.
2. `const sp = await searchParams` → `month`, `year` (default to current period
   via `currentPeriod()`).
3. `Promise.all([ getBudgets(userId, month, year), getBudgetFormData(...), getUserAccounts(userId) ])`.
   `getUserAccounts` is **not** budget data — `AppShell` requires an `accounts`
   prop for the global topbar account selector (same as `transactions/page.tsx`).
   Fetched here only to satisfy the shell chrome.
4. Render inside `<AppShell accounts user>` (same chrome as every app page):
   - `<BudgetsHeader period={…} />` — month/year stepper (← June 2026 →) that
     pushes `?month=&year=` (URL-driven, like the transaction filters); "Add
     budget" CTA opens the form drawer.
   - `<BudgetList rows summary />` — remaining-summary block + progress rows
     (reuse `CategoryIcon`, `budgetState/Percent/Color`, `formatCurrency`). When
     `summary.hasMixedCurrencies`, render the `⚠ Mixed currencies — approximate
     total` note beside the remaining figure (same treatment as the dashboard
     hero). Each row is a clickable button → edit; row overflow menu → archive.
   - The drawer receives the render-time `getBudgetFormData` result as a **prop**
     (available categories for create); it does not fetch it itself.
   - Empty state when no active budgets: guidance + a single **"Use starter
     budgets"** button calling `seedPresetBudgets(month, year)` (per Onboarding:
     "Budget screens offer one-tap creation from preset templates"). It batch-
     creates the §9 preset, skipping any category already budgeted for the
     period, then toasts how many were added.
   - `<Suspense key={month-year}>` so changing period re-shows a skeleton.

### `src/components/budgets/budget-form-drawer.tsx`
Client. Reuse the **Sheet** (right panel ≥768px / bottom sheet <768px via
`useMediaQuery` + `BREAKPOINTS.mobile`) exactly like `transaction-drawer.tsx`.
Fields: category selector (disabled in edit), amount (large input), read-only
period label. `useActionState` → call `createBudget` / `updateBudget`; on
success `toast.success`, `router.refresh()`, close. Keep the drawer **local to
the page** (own `useState`), not in `AppShell` — it's page-specific, unlike the
global transaction drawer.

### Delete + undo
Archive from the row menu → `archiveBudget(id)` → `toast` with an **Undo**
action (Sonner) that calls `unarchiveBudget(id)`, mirroring the 8-second
transaction undo. No Trash UI.

---

## 9. Constants (`src/lib/constants.ts`)

No magic values in components. Add:

```ts
/** Max budget ceiling accepted by the form (UI guard; DB is Decimal(12,2)). */
export const BUDGET_AMOUNT_MAX = 1_000_000;

/** One-tap starter budgets for the empty state (category name → suggested amount). */
export const BUDGET_PRESETS = [
  { categoryName: "Groceries", amount: 400 },
  { categoryName: "Dining", amount: 200 },
  { categoryName: "Transport", amount: 120 },
  { categoryName: "Utilities", amount: 150 },
] as const;
```

(System color/threshold constants already exist — do not duplicate.)

---

## 10. Tests (Vitest, `test/` mirrors `src/`)

Per coding-standards: cover `src/actions/**` and `src/lib/**`; no component tests.

`test/lib/budget-period.test.ts`
- `parseMonth` / `parseYear`: valid, out-of-range, garbage → defaults.
- `monthBounds`: correct UTC `monthStart` / `nextMonthStart` (incl. Feb and the
  Dec→Jan year wrap — `monthBounds(12, 2026)` ends at `2027-01-01`).
- `currentPeriod`: derives `{ month, year }` from a fixed clock.

`test/lib/budget.test.ts` (extend the existing file — pure, no mocks):
- `summarizeBudgets`: `total` / `remaining` (clamped at 0 when overspent) /
  `categoryCount`; `daysLeft` is computed for the current period and `0` for a
  past/future period (inject a fixed `now`); `hasMixedCurrencies` is `true` for a
  >1-currency input and `false` for a uniform one (incl. empty).
- `mapBudgetRow`: `spent = abs(Σ amount)`; uncategorized/edge inputs.

`test/actions/budgets.test.ts` (mock `@/lib/prisma` + `@/auth`, like the
transaction action tests):
- Unauthenticated → `{ success: false }` for every action.
- `createBudget`: rejects category not owned/system; resolves currency from
  user; **revives** an archived row via `upsert` keyed on the unique tuple —
  asserts the `update` branch sets `amount`/`currency`/`isArchived: false` and
  preserves the existing row `id` (no second `create`); returns the friendly
  duplicate error when an **active** row exists; enforces positive amount and the
  `BUDGET_AMOUNT_MAX` cap.
- `updateBudget`: 404 when not owner; updates amount only.
- `archiveBudget` / `unarchiveBudget`: ownership guard; flips `isArchived`;
  `unarchiveBudget` returns the friendly error when the slot is re-occupied.
- `seedPresetBudgets`: skips already-budgeted categories; reports `created`
  count; unresolved preset names are dropped, not errored.
- **Preset/seed drift guard:** assert every `BUDGET_PRESETS.categoryName`
  matches a seeded system-category name (fails loudly if either list drifts).

Run `npm run test:run` **and** `npm run build` green before commit (workflow §4).

---

## 11. Special cases & decisions

| Case | Decision |
|---|---|
| Duplicate budget (same category/period) | Unique key ignores `isArchived`, so `createBudget` is **revive-or-create**: active row → friendly error; archived row → revive with new amount; none → insert. Picker hides only active-budgeted categories. |
| Re-adding an archived category | `createBudget` revives the archived row (no `P2002`), applying the new amount. |
| Undo after the slot was re-taken | Because revive happens **in place** (the archived row itself is reactivated), a normal flow can never produce a *second* active row in the same slot — so the usual "Undo" simply reactivates the same row. The friendly-error branch in `unarchiveBudget` is therefore a **defensive safeguard** for non-app mutations (manual DB edits, migrations, admin tools), not a reachable user-flow state. |
| Month boundary | Query uses half-open `[monthStart, nextMonthStart)`. Safe regardless of whether `date` is a pure `@db.Date` (UTC midnight) now or gains a time component later. |
| Category vs period immutability | Only `amount` is editable in place. Moving to a different category/period = create there (own slot); old one is archived independently. |
| Currency stamped at write time | Always `user.preferredCurrency` at creation. Changing `preferredCurrency` later does **not** rewrite existing budgets. The page sums magnitudes without conversion (consistent with the dashboard's "approximate total" stance); if a period contains budgets in >1 currency, show the same `⚠ Mixed currencies` note the hero uses. Full conversion is post-MVP. |
| `BUDGET_AMOUNT_MAX` | Enforced in **both** the Zod schema and the input UI — single source via the constant. |
| Spent > limit | Bar clamps at 100% (`budgetPercent`), state goes `danger` (red); amount label turns `text-danger`. |
| Spend freshness | Transaction writes `revalidatePath("/budgets")`; the drawer `router.refresh()` re-runs the `force-dynamic` page, so spend updates live. |
| Period with no budgets | Empty state with one-tap `seedPresetBudgets`, not a blank screen. |
| Preset re-run / partial overlap | `seedPresetBudgets` skips categories already budgeted (archived or active); never overwrites an amount; reports the created count. |
| Preset vs `createBudget` on archived | **Intentional divergence:** `createBudget` *revives* an archived slot; `seedPresetBudgets` *skips* it (does not resurrect). Bulk convenience shouldn't silently un-archive. |
| Mixed-currency warning path | `summarizeBudgets` sets `BudgetSummary.hasMixedCurrencies` from the period's budget currencies; `BudgetList` renders the `⚠` note when true. Defined field, not an ad-hoc check. |
| Archived budgets | Excluded from all `/budgets` and dashboard queries (`isArchived: false`). No restore UI beyond the snackbar undo. |
| Transfer/income transactions | Never counted toward spend — only `type: "EXPENSE"`. |
| Soft-deleted transactions | Excluded from spend (`deletedAt: null`). |
| Dashboard "Manage →" | Now links to `/budgets`. |

---

## 12. Workflow (per `context/ai-interaction.md`)

1. **Document** this feature in `context/current-feature.md` (Goals/Notes).
2. **Branch** `feature/budgets-crud`.
3. **Implement** §4 files in order: validation → fetcher → actions → page →
   components → nav wiring.
4. **Test**: add Vitest specs (§10); `npm run test:run` + `npm run build`; verify
   in the browser (create, edit, archive+undo, period switch, empty/preset).
5. **Iterate**, then **commit** (only on green; conventional `feat:`; no agent
   attribution), **merge** to `main`, **delete** branch, mark done in
   `current-feature.md` history.

---

## 13. Acceptance criteria

- [ ] `/budgets` lists the selected period's active budgets with live spend +
      green/amber/red progress, and a remaining-summary block.
- [ ] Month/year stepper drives the period via `?month=&year=` (URL-driven).
- [ ] Create budget works; an **active** duplicate yields a friendly error, an
      **archived** same-slot budget is revived (not a `P2002`), never a raw
      Prisma exception.
- [ ] Revival is atomic (`upsert`), updates `amount`/`currency`, clears
      `isArchived`, and **keeps the same record `id`**.
- [ ] Edit changes only `amount`; category/period are fixed.
- [ ] Archive removes the budget from the UI with an 8-second Sonner **Undo**;
      undo onto a re-occupied slot fails gracefully.
- [ ] Amount over `BUDGET_AMOUNT_MAX` is rejected by the schema, not just the UI.
- [ ] Adding a transaction refreshes spend on an open `/budgets` page.
- [ ] All actions auth-guard, scope by session `userId`, and resolve currency
      server-side from `preferredCurrency` (stamped at write time).
- [ ] Empty period shows guidance + one-tap `seedPresetBudgets` (skips already-
      budgeted categories).
- [ ] Read-layer math (`summarizeBudgets`, `mapBudgetRow`) is unit-tested,
      including `hasMixedCurrencies` (true for >1 currency, false otherwise).
- [ ] A period whose budgets span >1 currency shows the `⚠ Mixed currencies`
      note, driven by `summary.hasMixedCurrencies`.
- [ ] Dashboard `BudgetsPanel` "Manage →" navigates to `/budgets`.
- [ ] `npm run test:run` and `npm run build` pass; no `db push`, no schema drift.
```
