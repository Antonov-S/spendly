# Fix Spec: Budget Spend via `groupBy` Instead of Row-Loading

`/budgets` renders noticeably slower than the other app-shell pages. The cause is the spend
calculation: for each active budget the query **loads every matching transaction row** into
memory through a nested Prisma `include`, then sums the amounts in JavaScript. At any real
transaction volume this transfers far more rows than needed and does aggregation work the
database should do. The same anti-pattern is duplicated on the dashboard budget bars.

This fix replaces the row-load-and-sum with a single database-side
`transaction.groupBy({ _sum: { amount } })` per period, so the DB returns **one number per
category** instead of every row. Behaviour is identical — only the mechanism changes.

Branch: `fix/budgets-groupby-spend`

> **Note — performance follow-up to `fix/profile-name-refresh`.** Identified while
> investigating `/budgets` render latency during that fix. It is a **separate, self-contained
> optimization** with no behavioural change and its own tests. Land it after the name-refresh
> fix is merged.

---

## Root cause

[`getBudgets`](../../src/lib/db/budgets.ts#L17-L47) loads budgets with a nested relation
include — `budget → category → transactions` (filtered to EXPENSE, non-deleted, in the
half-open month window) — selecting `{ amount }` for **every** such transaction.
[`mapBudgetRow`](../../src/lib/budget.ts#L54-L67) then reduces `category.transactions` to a
sum in JS (`Math.abs(Σ amount)`).

So a category with N expenses in the month ships N rows over the wire purely to produce one
sum. The work scales with transaction count, not budget count — and `/budgets` is the only
page paying it, which is why it lags the others.

The **identical pattern is duplicated** in
[`getBudgetsData`](../../src/lib/db/dashboard.ts#L234-L270) (dashboard budget bars), which
inlines its own copy of the nested include + JS reduce rather than calling `mapBudgetRow`.

> Note: the per-month window is the same logical range in both places, expressed two ways —
> `getBudgets` uses `monthBounds()` (half-open `[monthStart, nextMonthStart)`), `getBudgetsData`
> uses `Date.UTC(year, month, 0)` with an inclusive `lte`. Keep each call site's existing
> window construction; this fix does not unify them.

---

## Fix

### 1. `src/lib/db/budgets.ts` — `getBudgets`

Replace the nested-transactions include with a flat budgets query plus one `groupBy`:

```ts
const { monthStart, nextMonthStart } = monthBounds(month, year);

const budgets = await prisma.budget.findMany({
  where: { userId, month, year, isArchived: false },
  include: { category: { select: { name: true, color: true, icon: true } } },
  orderBy: { createdAt: "asc" },
});

// One DB-side aggregation: signed sum of in-window EXPENSE spend per category,
// scoped to the categories that actually have a budget this period.
const spendByCategory = await prisma.transaction.groupBy({
  by: ["categoryId"],
  where: {
    userId,
    deletedAt: null,
    type: "EXPENSE",
    date: { gte: monthStart, lt: nextMonthStart },
    categoryId: { in: budgets.map((b) => b.categoryId) },
  },
  _sum: { amount: true },
});

const spentMap = new Map<string, number>(
  spendByCategory.map((g) => [g.categoryId!, Math.abs(Number(g._sum.amount ?? 0))])
);

const rows = budgets.map((b) => mapBudgetRow(b, spentMap.get(b.categoryId) ?? 0));
const currencies = budgets.map((b) => b.currency);
return { rows, summary: summarizeBudgets(rows, currencies, month, year) };
```

- `categoryId: { in: [...] }` keeps the aggregation from summing categories that have no
  budget this period. When there are no budgets, the `in: []` makes `groupBy` return an
  empty array (no wasted scan); `rows` is then `[]` and the summary is the empty-state value.
- The two queries are sequential (the `in` filter needs the budgets' category IDs first).
  That is fine — both are index-backed and each returns a tiny result set. The win is
  eliminating the per-row transfer, not the round-trip count. (Dropping the `in` filter to
  run them in parallel is **not** worth summing every category; keep the filter.)

### 2. `src/lib/budget.ts` — `mapBudgetRow` takes a precomputed `spent`

The mapper no longer owns the summation. Change `MappableBudget` to drop
`category.transactions`, and take `spent` as a second argument:

```ts
export interface MappableBudget {
  id: string;
  amount: Numeric;
  category: { name: string; color: string; icon: string };
}

/**
 * Map a budget + its precomputed period spend to a serializable display row.
 * `spent` is the absolute in-period EXPENSE total for the budget's category,
 * aggregated by the caller (DB-side `groupBy`). `icon` stays a raw name string.
 */
export function mapBudgetRow(budget: MappableBudget, spent: number): BudgetListRow {
  return {
    id: budget.id,
    category: {
      name: budget.category.name,
      color: budget.category.color,
      icon: budget.category.icon,
    },
    spent,
    limit: Number(budget.amount),
  };
}
```

`budgetFraction` / `budgetState` / `budgetPercent` / `budgetColor` / `summarizeBudgets` are
unchanged — they already operate on the mapped `{ spent, limit }` rows.

### 3. `src/lib/db/dashboard.ts` — `getBudgetsData` (same treatment)

Apply the identical pattern to the dashboard fetcher so both budget surfaces aggregate
DB-side. It currently inlines its own nested include + reduce + `resolveIcon` row build.
Rework it to: flat budgets query (`category: { select: { name, color, icon } }`) → one
`transaction.groupBy` over its window (`gte: monthStart, lt`/`lte: monthEnd` — keep its
existing window) filtered by `categoryId: { in: ... }` → `spentMap` → build each row from the
map (still calling `resolveIcon(budget.category.icon)` for its `BudgetRow.icon`, which is a
resolved component, not a string — so it does **not** use `mapBudgetRow`, it keeps its own
row build, just sourced from the map instead of a JS reduce). The `total` / `totalSpent` /
`remaining` summary math below it is unchanged.

> If you prefer to keep this fix tightly scoped to `getBudgets`, step 3 may be deferred — but
> the dashboard renders budget bars too, so leaving it on the old path is an inconsistent
> half-fix. **Recommended: do both in this branch.**

---

## Correctness invariants (must hold)

- **Same filters:** `userId`, `deletedAt: null`, `type: "EXPENSE"`, in-period `date`. The
  `groupBy` `where` must match the old nested-include `where` exactly so spend is unchanged.
- **Sign:** EXPENSE amounts are stored signed-negative; `_sum.amount` returns the negative
  total, so `Math.abs(Number(...))` reproduces the old positive `spent`.
- **Null sum:** a category present in `by` with no matching rows cannot occur (the `in` set is
  derived from budgets and `groupBy` only returns categories with ≥1 row), but guard anyway —
  a budget whose category has zero spend is simply **absent** from `spendByCategory`, so
  `spentMap.get(categoryId) ?? 0` yields `0`. Also coalesce `_sum.amount ?? 0` for the
  Decimal-null edge.
- **Decimal:** `_sum.amount` is a Prisma `Decimal | null` → `Number(... ?? 0)`.

---

## What we are not doing

- **Not** changing budget thresholds, colors, the progress bar, or the summary block math.
- **Not** touching `getBudgetForEdit` or `getBudgetFormData` (the latter's two-query shape is
  already lean — system+user categories and the taken-set; no row-loading problem).
- **Not** unifying the two month-window helpers (`monthBounds` vs `Date.UTC(...,0)`); each
  call site keeps its own.
- **Not** adding caching or read models — this is a query-shape fix only.
- **Not** a behavioural change: the numbers a user sees on `/budgets` and the dashboard are
  identical before and after.

## Testing

### Unit (Vitest)

- **`test/lib/budget.test.ts`** — update `mapBudgetRow` cases to the new
  `(budget, spent)` signature: assert it returns `{ spent, limit }` from the passed `spent`
  (no longer a `category.transactions` reduce) and still maps `id` / name / color / raw icon.
  The `budgetFraction` / `budgetState` / `budgetPercent` / `budgetColor` / `summarizeBudgets`
  suites are unaffected and must stay green.
- **`test/lib/db/budgets.test.ts`** (add if absent, mocking `@/lib/prisma`) — assert
  `getBudgets` calls `transaction.groupBy` with the EXPENSE / non-deleted / in-window /
  `categoryId in [...]` where, and that a budget whose category is missing from the groupBy
  result maps to `spent: 0`. Assert the absolute-value sign handling (negative `_sum.amount`
  → positive `spent`).
- If step 3 lands, add a matching assertion for `getBudgetsData` (groupBy called; row spend
  sourced from the aggregate; `remaining` math unchanged).

### Build / lint

`npm run test:run` and `npm run build` must pass; `npm run lint` confirms no leftover unused
imports from the removed nested-include shape.

### Manual

1. Seed a category with several expense transactions in the current month plus a budget for
   it. `/budgets` shows the **same** spent figure, progress %, and color as before the change.
2. The dashboard budget bars show the same spent/remaining as `/budgets`.
3. A budget whose category has no transactions this month shows `spent = 0` (green, empty bar).
4. Switch budget period (prev/next month) — spend recomputes correctly for the new window.
5. Subjectively, first warm (non-compile) `/budgets` render is no slower than `/goals`.
