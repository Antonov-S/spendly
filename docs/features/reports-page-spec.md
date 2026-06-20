# Reports Page — Implementation Spec

> **✅ Shipped (`feature/reports-page`).** Implemented per this spec. Notable realized details: the slice
> is **read-only** (six server-only fetchers in `src/lib/db/reports.ts`, no actions/revalidation); pure
> logic lives in `src/lib/report-period.ts` + `src/lib/reports.ts` (35 new Vitest tests, 380 total); the
> Free 3-month / Pro 12-month gate is **real** (`isPro` read from the DB via `getReportProfile`, clamp
> via `resolveEffectivePeriod` — the 12-month query never runs for Free, the 3-month charts stay rendered
> under an upgrade banner); all four charts are **hand-rolled SVG** (Recharts not needed — the
> `IncomeVsExpenses` canary rendered fine), each `role="img"` + data-summarizing `aria-label` capped at
> `ARIA_SUMMARY_MAX` with a real-DOM legend; per-chart gating (category + balance on presence, the two
> trend charts on `REPORTS_MIN_TRANSACTIONS = 15`); the **account-balance chart shipped as the full
> time-series — no §7.1 fallback taken**; `UNCATEGORIZED` extracted to `constants.ts` (retiring the
> inline copies in `db/dashboard.ts` + `transaction-row.tsx`). No schema change. `npm run test:run` +
> `npm run build` pass; Playwright QA covered Pro 12m, the Free clamp, account scoping, and the
> sparse-account nudge. See `docs/ROADMAP.md` §5 for the realized-slice note.

> **Goal:** Build the `/reports` analytics module — the **insight layer** half of the MVP loop
> (`capture → organize → control → **understand**`). A read-only page with four charts
> (spending by category, income vs expenses, cashflow trend, account balance over time), a
> period selector (this month / last 3 months / last 12 months), account scoping via the global
> selector, a Free-vs-Pro 12-month gate, and per-chart empty-state nudges when there isn't enough
> data yet.

This spec follows the patterns in [entity-crud-architecture.md](../entity-crud-architecture.md) and
mirrors the already-shipped **Budgets**, **Goals**, and **Transactions** slices. It implements
[ROADMAP.md](../ROADMAP.md) §5 (Delivery Sequence slot #4) and the **Reports** section of
[project-overview.md](../../docs/project-overview.md).

---

## 1. Why this slice

`/reports` does not exist. It is the last unbuilt headline surface and is **required by the MVP
definition** ("Reports — always accessible, empty state when data is insufficient"). The Dashboard
is deliberately a *state* screen ("where am I now"); Reports is the separated *analysis* screen
("what happened over time"). The two are kept apart on purpose to prevent scope creep
([project-overview.md](../../docs/project-overview.md) → Product Philosophy #2, Three-layer model).

Reports is **read-only** — it has **no mutations**, so there is no `src/actions/reports.ts`. All
data flows through server-only fetchers (`src/lib/db/reports.ts`) consumed directly by the server
component. This is the simplest slice architecturally; the effort is in the four chart fetchers and
their rendering.

---

## 2. Scope

### In scope

- Period logic (`src/lib/report-period.ts`): parse `?period=`, derive month-range bounds, Pro gate.
- Pure aggregation helpers (`src/lib/reports.ts`): month bucketing, balance reconstruction, the
  "enough data" check, the nudge copy builder — all DB-free and unit-tested.
- Four server-only DB fetchers (`src/lib/db/reports.ts`): category breakdown, income-vs-expenses,
  cashflow trend, account balance history.
- A small `getReportProfile(userId)` fetcher returning `{ isPro }` (the session does **not** carry
  it — see §9).
- `/reports` page (`src/app/reports/page.tsx`): `force-dynamic`, `requireOnboarded`, period +
  account scoping from URL params, `Promise.all` over the fetchers, rendered inside `AppShell`.
- Four chart components + a period selector + per-chart empty states (`src/components/reports/`).
- A Pro-gate upgrade prompt on the "Last 12 months" option for Free users.
- Vitest unit tests for `report-period.ts` and the pure helpers in `reports.ts`.

### Out of scope (explicit)

- **Any mutation.** Reports never writes. No server actions, no `revalidate*` helper.
- **Unbounded "all-time" history.** The period selector tops out at **12 months** (the Pro ceiling).
  True all-time history and the unbounded queries it implies are **post-MVP**
  ([project-overview.md](../../docs/project-overview.md) → Reports MVP note;
  [ROADMAP.md](../ROADMAP.md) §5 reconciliation).
- **Monthly balance snapshot tables / read-model caching.** Balance history is reconstructed at
  query time from cumulative transactions. Snapshots are a documented future optimization, not built
  here (architecture: "May be cached in read models later if query performance requires it").
- **Cross-currency conversion.** EUR-only MVP — every figure is EUR, no FX. No mixed-currency
  handling is needed in Reports (unlike budgets, where the warning machinery is dormant): all
  accounts are EUR, so sums are exact. Do **not** add an FX path.
- **CSV/PDF export of charts.** Data export is its own slice ([ROADMAP.md](../ROADMAP.md) §6).
- **Drill-down / click-through from a chart segment to filtered transactions.** Post-MVP — but
  flagged the **highest-priority Reports follow-up**: a click on a category slice / month bar should
  deep-link to `/transactions` with the matching `?category=`/`?from=`/`?to=`/`?account=` filters
  pre-applied (the feed already reads all of those params, so the wiring is cheap once Reports
  exists). Reports become far more actionable with this; build it first in the next Reports pass.
- **Diversity-based data-sufficiency.** This spec gates on transaction *count/presence* (§6). A
  richer future signal — category coverage, months-with-activity, account spread — would better
  capture "is this chart actually insightful" (15 tiny same-category transactions still make a thin
  pie). Deferred: count/presence is the pragmatic MVP proxy; revisit if charts feel hollow in use.
- **Report-level date-range picker** beyond the three fixed period options.

---

## 3. Data model recap

**No schema change.** Reports reads existing tables only:

| Source | Used for |
|---|---|
| `Transaction` (`type`, `amount`, `date`, `financialAccountId`, `categoryId`, `deletedAt`) | every chart — the canonical ledger |
| `Category` (`name`, `icon`, `color`) | category-breakdown labels/colors |
| `FinancialAccount` (`startingBalance`, `isArchived`, `name`, `color`) | balance-history baseline + per-account series |
| `User` (`isPro`) | the 12-month Pro gate (§9) |

Rules carried from the architecture that Reports must honor:

- **`deletedAt: null`** on every transaction query — soft-deleted rows never count.
- **`amount` is signed**: `INCOME` positive, `EXPENSE` negative; transfers are two signed legs.
  Spend = `abs(sum of EXPENSE amounts)`. Cashflow / balance use the raw signed sum.
- **Dates are `@db.Date`** (UTC midnight, no zone). Bucket with the same UTC math the budget period
  helpers use (`Date.UTC(...)`, half-open `[from, to)` windows).
- **Archived accounts**: excluded from the default (all-accounts) view, but **included when a single
  archived account is explicitly selected** via `?account=` (architecture: "included in Reports only
  when explicitly selected"). See §8.

---

## 4. File plan

| Layer | File | Action |
|---|---|---|
| Period logic | `src/lib/report-period.ts` | **create** — `parsePeriod`, `periodBounds`, `monthsInRange`, `isPeriodAllowed`, `resolveEffectivePeriod` |
| Pure helpers | `src/lib/reports.ts` | **create** — `bucketByMonth`, `reconstructBalanceHistory`, `hasCategoryData`, `hasBalanceData`, `hasEnoughForTrends`, `trendNudgeCopy` |
| DB reads | `src/lib/db/reports.ts` | **create** — 4 chart fetchers + `getReportProfile` + a shared `reportTxWhere` builder |
| Types | `src/types/reports.ts` | **create** — chart row shapes + `ReportPeriod` + `ReportData` |
| Constants (system) | `src/lib/system-constants.ts` | **modify** — `REPORTS_MIN_TRANSACTIONS`, `REPORTS_FREE_MAX_MONTHS` |
| Constants (UI) | `src/lib/constants.ts` | **modify** — `REPORT_PERIOD_OPTIONS` |
| Page | `src/app/reports/page.tsx` | **create** — `force-dynamic`, `requireOnboarded`, `Promise.all`, `Suspense` |
| Components | `src/components/reports/reports-view.tsx` | **create** — header + period selector + chart grid coordinator |
| Components | `src/components/reports/period-selector.tsx` | **create** — URL-driven pills + Pro lock on 12-month |
| Components | `src/components/reports/spending-by-category.tsx` | **create** — donut/pie + legend |
| Components | `src/components/reports/income-vs-expenses.tsx` | **create** — grouped bar per month |
| Components | `src/components/reports/cashflow-trend.tsx` | **create** — line chart per month |
| Components | `src/components/reports/account-balance-history.tsx` | **create** — bar per month per account |
| Components | `src/components/reports/chart-card.tsx` | **create** — shared section frame (title + empty-state slot) |
| Components | `src/components/reports/chart-empty-state.tsx` | **create** — the "Add N more transactions" nudge |
| Components | `src/components/reports/upgrade-prompt.tsx` | **create** — Free-user 12-month gate card |
| Tests | `test/lib/report-period.test.ts` | **create** |
| Tests | `test/lib/reports.test.ts` | **create** |

> **Route + nav:** `/reports` is already in `NAV_ITEMS` (`src/lib/constants.ts`) and the spec's Pages
> table — the sidebar item exists and currently dead-links. No nav change needed beyond the page
> coming into existence. Add the per-page `requireOnboarded()` guard ([ROADMAP.md](../ROADMAP.md) §1
> note: "the per-page guard is added to `/reports` when that page is built").

---

## 5. Period logic — `src/lib/report-period.ts`

Pure and deterministic (`now` injectable), mirroring `budget-period.ts`. A "period" is one of three
fixed month-spans.

```ts
import { REPORTS_FREE_MAX_MONTHS } from "@/lib/system-constants";

/** The three report windows. `months` is the count of calendar months including the current one. */
export type PeriodMonths = 1 | 3 | 12;

export interface ReportPeriod {
  months: PeriodMonths;
  /** URL param value, e.g. "3m". */
  param: string;
  /** Display label, e.g. "Last 3 months". */
  label: string;
}

/** Parse `?period=` → a ReportPeriod. Defaults to the 1-month ("This month") window. */
export function parsePeriod(value: string | undefined): ReportPeriod { /* "1m" | "3m" | "12m" */ }

/**
 * Half-open UTC bounds for the window: `[from, to)`.
 *  - `from` = start of the month `(months - 1)` before the current month.
 *  - `to`   = start of the *next* month (so the current month is fully included).
 * December→January wraps the year (reuse the `Date.UTC` pattern from `monthBounds`).
 */
export function periodBounds(
  months: PeriodMonths,
  now: Date = new Date()
): { from: Date; to: Date } { /* ... */ }

/**
 * Ordered list of `{ month, year }` buckets spanning the window, oldest→newest.
 * Length === `months`. Drives the per-month charts' x-axis (so months with zero
 * activity still render an empty column, not a gap).
 */
export function monthsInRange(
  months: PeriodMonths,
  now: Date = new Date()
): { month: number; year: number }[] { /* ... */ }

/** Free tier is capped at REPORTS_FREE_MAX_MONTHS (3); Pro unlocks 12. */
export function isPeriodAllowed(months: PeriodMonths, isPro: boolean): boolean {
  return months <= REPORTS_FREE_MAX_MONTHS || isPro;
}

/**
 * Resolve the *effective* period to actually query from the *requested* one and
 * the user's plan — the business-critical Free 12m→3m clamp, extracted from the
 * page so it is a pure, unit-tested unit (not inline branch logic). Returns the
 * window to fetch AND a `clamped` flag that drives the upgrade banner / the
 * "highlight the effective pill" rule (§9). Keeping this here means the page
 * never re-derives the gate by hand.
 */
export function resolveEffectivePeriod(
  requested: ReportPeriod,
  isPro: boolean
): { effective: ReportPeriod; clamped: boolean } {
  if (isPeriodAllowed(requested.months, isPro)) {
    return { effective: requested, clamped: false };
  }
  return { effective: parsePeriod("3m"), clamped: true };
}
```

> **Why the x-axis comes from `monthsInRange`, not from the data.** A month with no transactions
> must still appear as a labelled zero column on the bar/line charts (otherwise "Last 12 months"
> silently collapses to however many months had activity, which misreads as a data gap). The
> fetchers bucket their rows into this canonical month list so every month is present.

---

## 6. Pure aggregation helpers — `src/lib/reports.ts`

Extract the non-Prisma math here so it's unit-testable without a DB mock (same discipline as
`summarizeBudgets` / `mapBudgetRow`). The fetchers do the `findMany`/`groupBy`; these helpers shape
the result.

```ts
import type { MonthBucket, BalancePoint } from "@/types/reports";

/**
 * Bucket signed transaction rows into the canonical month list, summing income
 * (amount > 0) and expenses (abs of amount < 0) per month. Months with no rows
 * yield `{ income: 0, expenses: 0 }`. Used by income-vs-expenses AND cashflow
 * (cashflow.net = income - expenses).
 */
export function bucketByMonth(
  rows: { amount: number; date: Date }[],
  months: { month: number; year: number }[]
): MonthBucket[] { /* ... */ }

/**
 * Reconstruct each account's end-of-month balance across the window.
 * `balanceAtWindowStart[accountId]` = startingBalance + SUM(amount) for every
 * non-deleted tx strictly before `from`. Then walk months, adding that month's
 * net to get the running end-of-month figure. Pure — the fetcher supplies the
 * pre-window baseline and the in-window rows.
 */
export function reconstructBalanceHistory(
  accounts: { id: string; name: string; color: string | null; baseline: number }[],
  inWindowRows: { financialAccountId: string; amount: number; date: Date }[],
  months: { month: number; year: number }[]
): BalancePoint[] { /* ... */ }

/**
 * Per-chart data-sufficiency — NOT one global gate. A single 15-transaction
 * threshold across every chart wrongly hides a category breakdown that is
 * already meaningful with a handful of expenses. So gating is two-tier:
 *
 *  • PRESENCE gate (render as soon as there's relevant data):
 *      - Spending by category → any expense exists (some slice `total > 0`).
 *      - Account balance history → renders whenever there is at least one
 *        in-scope account *series*; even with zero transactions it shows flat
 *        starting balances, which is itself informative. The one empty case it
 *        must still catch is a foreign/unknown `?account=` (no owned account
 *        matches) → every month's `balances` array is empty → show the empty
 *        state, not an axis with no bars. See the helper note below.
 *  • TREND gate (needs volume to be a *trend*, not a lonely point):
 *      - Income vs Expenses AND Cashflow trend → gated on REPORTS_MIN_TRANSACTIONS.
 *        Below it, these two show the "Add N more transactions to see spending
 *        trends" nudge; the other two charts still render.
 */
export function hasCategoryData(categories: { total: number }[]): boolean {
  return categories.some((c) => c.total > 0);
}

/**
 * True when at least one month carries a non-empty account series. NOTE: this
 * deliberately checks `balances`, not `history.length` — `monthsInRange` always
 * yields ≥ 1 month, so a length check would be trivially always-true (the
 * redundancy this avoids). The real "nothing to show" case is an empty
 * `?account=` scope, where the months exist but every series is empty.
 */
export function hasBalanceData(history: BalancePoint[]): boolean {
  return history.some((p) => p.balances.length > 0);
}

/** Trend charts (income/expense, cashflow) need volume to be meaningful. */
export function hasEnoughForTrends(txCount: number): boolean {
  return txCount >= REPORTS_MIN_TRANSACTIONS;
}

/** "Add 15 more transactions to see spending trends" — count clamped at ≥ 0. */
export function trendNudgeCopy(txCount: number): string {
  const remaining = Math.max(0, REPORTS_MIN_TRANSACTIONS - txCount);
  return `Add ${remaining} more transactions to see spending trends`;
}
```

> **Match the spec's exact nudge wording and threshold for the trend charts.**
> [project-overview.md](../../docs/project-overview.md) → Reports gives the canonical copy "Add 15
> more transactions to see spending trends," which is specifically about *trends* — so it gates the
> two time-series charts, with `REPORTS_MIN_TRANSACTIONS = 15` and copy `Add ${15 - count} more …`.
> Do **not** invent a different number for that nudge ([ROADMAP.md](../ROADMAP.md) §5 is explicit).
> The category/balance charts use their own short presence-copy (§12), not this trend nudge.

---

## 7. DB fetchers — `src/lib/db/reports.ts`

`import "server-only"`. Every fetcher takes `(userId, { months, accountId })`, scopes by `userId`,
honors `deletedAt: null`, and applies the **shared account predicate** (§8). All `Decimal`s are
converted to `number` before leaving the module (charts are client components — never hand a Prisma
`Decimal` across the boundary; safe because every figure is `Decimal(12,2)`, far inside
`Number.MAX_SAFE_INTEGER`).

```ts
/**
 * Shared WHERE fragment: user scope + soft-delete + account scoping (see §8).
 * EXPORTED and pure (no Prisma call) so the scoping rule — the security-relevant
 * part of every fetcher — is unit-testable directly without a DB mock (§16).
 */
export function reportTxWhere(userId: string, accountId: string | undefined) {
  return {
    userId,
    deletedAt: null,
    financialAccount: accountId
      ? { id: accountId }                 // explicit single account (archived OK)
      : { isArchived: false },            // all accounts → active only
  };
}
```

> **Why export the WHERE builder.** The two rules that matter most for correctness *and* security —
> row-level ownership scoping (`userId` always present) and the active-vs-explicit account rule — live
> entirely in this pure function. Exporting it turns those rules into a directly unit-testable unit
> (§16), so a regression that drops `userId` or leaks archived accounts in the all-accounts view
> fails a fast test rather than needing a DB-backed integration test. The transfer-exclusion rule
> (`type` filter) lives per-fetcher, not here — see the testing note in §16 for covering it.

| Fetcher | Returns | Notes |
|---|---|---|
| `getCategoryBreakdown(userId, opts)` | `CategorySlice[]` = `{ categoryId, name, icon, color, total }` | `groupBy` `categoryId` over `type: "EXPENSE"` rows in `[from, to)`; resolve name/icon/color from `Category`; `total = abs(sum)`. Null-category expenses bucket under "Uncategorized" (`#D1D5DB`/`HelpCircle`). Sorted desc by `total`. |
| `getMonthlyComparison(userId, opts)` | `MonthBucket[]` = `{ month, year, income, expenses }` | `findMany` `{ amount, date }` (INCOME+EXPENSE, exclude TRANSFER) in `[from, to)`; pipe through `bucketByMonth(rows, monthsInRange(...))`. **Canonical bucketing — every monthly chart routes through this one `bucketByMonth` + `monthsInRange` path; no fetcher buckets independently**, so income/expense, cashflow, and the x-axis can never drift out of month alignment. |
| `getCashflowTrend(userId, opts)` | `MonthBucket[]` (consumer reads `income - expenses`) | **Reuses `getMonthlyComparison`'s buckets** — cashflow is a derived view, not a second query. The page computes `net` per bucket; no separate fetcher round-trip. |
| `getAccountBalanceHistory(userId, opts)` | `BalancePoint[]` = `{ month, year, balances: { accountId, name, color, balance }[] }` | The heavy one (§7.1). Two queries: pre-window `groupBy` for baselines + in-window `findMany`; shaped by `reconstructBalanceHistory`. |
| `getReportTxCount(userId, opts)` | `number` | One `count` over `[from, to)` with `reportTxWhere` — feeds `hasEnoughForTrends` / `trendNudgeCopy`. |
| `getReportProfile(userId)` | `{ isPro: boolean }` | `findUnique` selecting `isPro` only (§9). |

> **Transfers in Reports.** Income-vs-expenses, cashflow, and category breakdown **exclude
> `TRANSFER`** legs (a transfer moves money between the user's own accounts — it is neither income
> nor spend, and counting it would double-distort cashflow). **Account balance history includes
> transfers**, because a transfer genuinely changes a single account's balance (one leg out, one leg
> in). This split matches how the dashboard metric strip treats transfers (income/expense only) vs
> how derived account balances treat them (all signed rows).

> **Category resolution — one batched lookup, no N+1.** `getCategoryBreakdown` does a single
> `groupBy(categoryId)` for the sums, then **one** `category.findMany({ where: { id: { in: ids } } })`
> to resolve name/icon/color, joined in memory by id — never a per-group query. Notes:
> - **Deleted categories never dangle.** `Category.onDelete: SetNull` (schema) means a deleted
>   category's transactions carry `categoryId = null`, so they fall into the **Uncategorized** bucket
>   (the shared `UNCATEGORIZED` constant, §13) rather than referencing a missing row. There is no
>   "orphaned id" case to defend against — but still tolerate a resolved-id miss by falling back to
>   `UNCATEGORIZED` labelling, so a race (category deleted between the two queries) degrades
>   gracefully. Use the constant, never an inline literal.
> - **Renamed/recolored categories** resolve to their **current** name/color (the lookup reads live
>   `Category` rows), which is the correct, least-surprising behavior — the chart reflects how the
>   user labels things now.
> - Resolve the raw `icon` name to a component **client-side** (`resolveIcon`) like every other
>   surface; the fetcher returns the raw string (`CategorySlice.icon`), keeping it serializable.

> **Why `getReportTxCount` is a separate `count`, not derived from `getMonthlyComparison`.** The two
> scan the same date window but **different row sets**: the trend gate counts **all** in-scope
> non-deleted transactions (income + expense + **transfer**) — it answers "does this account have
> enough *activity* to be worth charting," so transfers count — whereas `getMonthlyComparison`
> deliberately **excludes** transfers. They can't share a result without conflating the two
> definitions. A `count` over an indexed window (`@@index([userId, date])`) is among the cheapest DB
> ops (index-only, no row materialization), so the extra round-trip is negligible and keeps each
> definition honest. If profiling ever shows it matters, derive both from one `findMany` that selects
> `{ amount, date, type }` — but that's a premature optimization today.

### 7.1 Account balance history — the designated simplification candidate

This is the only chart that reconstructs a **running** balance rather than aggregating within a
window, making it the heaviest query in Reports
([ROADMAP.md](../ROADMAP.md) §5 flags it as the first thing to cut if effort runs over).

**MVP approach (two queries, no snapshot table):**

1. **Baseline before the window** — `groupBy` `financialAccountId` summing `amount` for all
   non-deleted, in-scope transactions with `date < from`; add each account's `startingBalance`.
2. **In-window rows** — `findMany` `{ financialAccountId, amount, date }` in `[from, to)`.
3. `reconstructBalanceHistory(accounts, inWindowRows, monthsInRange(...))` walks the months adding
   each month's net per account to its baseline → end-of-month balances.

> **Explicit performance envelope (so "expensive" isn't hand-wavy).** This MVP assumes the
> overview's stated ceiling of **≤ 10K transactions per user** (project-overview "Out of Scope" lists
> ">10K transactions" as a future perf concern). Under that ceiling the cost is bounded and small:
> - **Query cost:** exactly **two** DB round-trips regardless of window size — one `groupBy`
>   (baseline, backed by the existing `@@index([userId, financialAccountId])`) and one ranged
>   `findMany` over `[from, to)` (backed by `@@index([userId, date])`). Not N+1, not per-account,
>   not per-month.
> - **Memory/CPU:** `reconstructBalanceHistory` is `O(rows + months × accounts)` in memory; for a
>   12-month window with a few accounts and a few thousand in-window rows that is single-digit
>   milliseconds. The in-window `findMany` returns at most the user's transactions in that window
>   (≤ their total), held briefly to bucket, then discarded.
> - **When the envelope is exceeded** (a user past ~10K rows, or "all-time" arriving post-MVP), the
>   already-documented monthly **balance-snapshot table** is the upgrade path — not a rewrite of this
>   algorithm, just a cache in front of the baseline query. Out of scope here by the same boundary.
>
> **Pre-approved fallbacks if this overruns delivery (in order):**
> 1. **Current end-of-month balance only** — drop the time series, render a single bar per account of
>    its present derived balance (reuse `getAccountsWithBalances`-style math). Still answers "how much
>    is in each account."
> 2. **Defer the chart entirely** — ship the other three (which carry most of the analytical value)
>    and add a fourth `ChartCard` placeholder empty state. The other three must not be blocked on
>    this one.
>
> **What a fallback does to the acceptance bar (no hidden flag).** The slice ships in its real,
> chosen state — there is **no temporary feature flag** hiding a half-built chart. If a fallback is
> taken:
> - **Fallback #1** → the §20 criterion "account-balance bars render" is **met** by the
>   current-balance bars (it is the account-balance chart, just without the time axis). Reword that
>   line in `current-feature.md` to "current balance per account" and note the time-series is a
>   tracked follow-up. The chart is real and shipped, not stubbed.
> - **Fallback #2** → the "all four charts" criterion is **explicitly relaxed to three** for this
>   slice; the fourth `ChartCard` ships as an honest active-guidance empty state ("Balance history is
>   coming soon" is **not** acceptable — *never UI without backing function*; instead show e.g. "View
>   per-account balances on the Accounts page →" linking to `/accounts`, which already exists). The
>   deferred chart becomes the top item of the next Reports pass.
> - Either way, **record the choice and the adjusted criteria in `current-feature.md` the moment the
>   fallback is decided — not as a post-build cleanup.** Update the §20 acceptance bar in the same
>   commit/PR that takes the fallback, so the implemented behavior and the stated MVP definition never
>   sit in conflict (even briefly). A spec/reality mismatch that lingers until "later" is exactly how
>   an MVP definition silently rots; close it at the point of decision.

---

## 8. Account scoping (the global selector)

Reports respects the topbar `?account=<id>` selector exactly like `/transactions` does — read
`sp.account || undefined` and thread it into every fetcher via `reportTxWhere`.

- **No `?account=`** → aggregate **all active accounts** (`financialAccount: { isArchived: false }`).
  This is the architecture default ("excluded from Reports unless explicitly selected").
- **`?account=<id>` set** → scope to that one account by id, **even if it is archived**. The topbar
  only lists active accounts, so an archived account is reachable only by a hand-built URL — but the
  architecture explicitly allows archived accounts in Reports *when explicitly selected*, so we honor
  the id without an `isArchived` filter. Ownership is still enforced (`userId` scope), so a foreign
  or unknown id simply yields an empty (zero-row) report, never another user's data.

> **Why no separate account-ownership pre-check.** `reportTxWhere` scopes by `userId` on the
> transaction *and* joins `financialAccount` — a foreign `accountId` matches **zero** rows (the
> account isn't the user's, so none of its transactions are either). The result is already secure and
> non-enumerable without a `financialAccount.findFirst({ id, userId })` guard. A pre-check was
> considered and **deliberately omitted**: it would add a round-trip to defend against a hand-built
> URL that already fails safe (empty charts), and it can't even use the page's free `getUserAccounts`
> list to short-circuit, because that list excludes archived accounts — which are *legitimately*
> selectable here (§8). The cost of an invalid id is a handful of indexed zero-row queries on a path
> a normal user never hits; not worth a guard query. If a future surface needs to *distinguish*
> "invalid account" from "valid account, no data" (e.g. to show a "that account doesn't exist"
> message), add the check **there** — Reports treats both as the same empty state by design.

---

## 9. Pro gate — resolving `isPro` (session does NOT carry it)

**Important:** the NextAuth session only exposes `user.id` (see
[src/types/next-auth.d.ts](../../src/types/next-auth.d.ts)) — there is **no `isPro` on the
session**. Reports therefore fetches it from the DB via `getReportProfile(userId)` and passes the
boolean into `isPeriodAllowed` and the period selector.

Gate behavior:

- `isPeriodAllowed(months, isPro)` → Free (`!isPro`) is allowed `months ≤ 3`; the **12-month** option
  is Pro-only.
- **Don't blank the grid — keep what the user is entitled to.** A Free user landing on `?period=12m`
  (typed URL, stale bookmark, or clicking the locked pill) still sees their **real 3-month charts**
  fully rendered. The page clamps the *effective* period to 3 months for the data fetch (the
  12-month query never runs for a Free user) and shows a single **`<UpgradePrompt />` banner above
  the grid** — not in place of it. The 3-month charts answer the user's question now; the banner
  sells the longer window. This is deliberately *not* a blanked grid or a blurred/extrapolated 12-
  month teaser: rendering fake or smeared data to bait an upgrade violates "never UI without backing
  function" and "visual weight serves information, never decoration." The honest 3-month charts +
  one clear banner is both more truthful and a stronger motivator (the user sees the real thing and
  wants more of it).
- The period selector **disables (not hides)** the 12-month pill for Free users with a lock glyph;
  clicking it surfaces the same upgrade banner / links to `/settings` (the billing surface, once it
  exists — [ROADMAP.md](../ROADMAP.md) §7). *Never UI without backing function* holds — the lock
  **is** the function (it routes to upgrade), and the charts beneath stay live.
- **Make the clamp legible (URL vs rendered-data mismatch).** When a Free user is on `?period=12m`,
  the URL says 12m but the data is the 3-month window — an intentional but invisible mismatch. Close
  it in the UI, not by rewriting the URL: (1) the selector highlights the **effective** ("Last 3
  months") pill as active — *not* the requested 12-month pill (which renders locked), so the
  highlighted pill always matches what's drawn; (2) the upgrade banner copy names the clamp
  explicitly, e.g. *"Showing the last 3 months. Upgrade to Pro for the full 12-month view."* We
  deliberately **do not** rewrite `?period=12m`→`3m`: keeping the requested value is what tells the
  page to show the banner (and preserves the user's intent if they later upgrade and refresh). The
  rendered state stays unambiguous because the active pill + banner both describe the 3-month
  reality.

> **Dev reality:** [project-overview.md](../../docs/project-overview.md) says "during development all
> users have `isPro = true`." That is a **convention, not enforced in code** — `User.isPro` defaults
> to `false` in the schema and the seed sets it per-user (`demo-pro` = true, `demo-nonpro` = false).
> So the gate here reads the **real** `isPro` and is genuinely exercised by the two demo users. This
> is intentional: it lets us verify the Free 3-month clamp now rather than discovering it broken at
> the Stripe step. The launch-time "flip enforcement" task ([ROADMAP.md](../ROADMAP.md) §9) does not
> need to touch Reports — the gate is already real. Do **not** hardcode `isPro = true` anywhere in
> Reports.

---

## 10. Page — `src/app/reports/page.tsx`

```ts
export const dynamic = "force-dynamic";
```

Pattern lifted from `transactions/page.tsx` / `budgets/page.tsx`:

1. `const session = await requireOnboarded();` → `userId`.
2. `const sp = await searchParams;` → `period`, `account`.
3. `const { isPro } = await getReportProfile(userId);`
4. `const requested = parsePeriod(sp.period);`
   `const { effective, clamped } = resolveEffectivePeriod(requested, isPro);`
   (Free + `12m` request → `effective` is the 3-month window and `clamped === true`; `clamped` drives
   the upgrade banner and the "highlight the effective pill" rule — the page never re-derives the
   gate inline.)
5. `const accountId = sp.account || undefined;`
6. `const opts = { months: effective.months, accountId };`
7. `Promise.all([ getCategoryBreakdown, getMonthlyComparison, getAccountBalanceHistory,
   getReportTxCount, getUserAccounts ])` — the last is **shell chrome** for the `AppShell` topbar
   selector (same as every app page), not report data. Cashflow derives from the monthly-comparison
   buckets in-process (no extra query — §7).
8. Render inside `<AppShell accounts user>`:
   - `<ReportsView … isPro={isPro} clamped={clamped} effective={effective} … />`
   - `<Suspense key={`${effective.param}-${accountId ?? "all"}`}>` so switching period/account
     re-shows a skeleton (same `key`-to-resuspend trick as the other pages).

The view renders the header (title + `<PeriodSelector>`), an optional `<UpgradePrompt>` **banner**
when `clamped` (a Free user requested `12m`; above the grid — the grid still renders the entitled
3-month charts, §9), then a responsive chart grid. Each chart is wrapped in `<ChartCard>` and gated
**individually** (§6): the two trend charts fall back to `<ChartEmptyState message={trendNudgeCopy(txCount)} />`
when `!hasEnoughForTrends(txCount)`, while the category chart gates on `hasCategoryData(...)` and the
balance chart on `hasBalanceData(...)` — so a sparse account can show a real category breakdown and
balance chart even while the trend cards still nudge. Empty-state cards carry an "Add transaction"
CTA (opens the global drawer via `useAppShell()`).

---

## 11. Charts — `src/components/reports/`

### Charting decision: hand-rolled SVG (resolved)

**Build the four charts as dependency-free SVG components**, consistent with the existing
[`Sparkline`](../../src/components/dashboard/sparkline.tsx). Rationale:

- The repo already hand-rolls SVG charts and has **no chart dependency**; adding Recharts (a heavy
  client lib pulling in D3 modules) contradicts the project's "no decorative deps" / "visual weight
  serves information" ethos and the dependency-light precedent.
- The four MVP charts are geometrically simple (donut, grouped bars, a polyline, grouped bars) — the
  same primitives `Sparkline` already demonstrates. React Compiler is on, so these stay
  memoization-free server-friendly renderers.
- Decision per [project-overview.md](../../docs/project-overview.md) Product Philosophy #5
  ("Decisions over options. Pick one implementation, document why").

> **Concrete fallback trigger (decide early, not after sinking days).** Grouped multi-series bars
> (`IncomeVsExpenses`, `AccountBalanceHistory`) are the realistic time-sinks. Apply this gate while
> building: **if `IncomeVsExpenses` — the first grouped-bar chart in the build order (§17) — is not
> rendering correctly within roughly half a day of hand-rolling** (axis scaling, grouped layout,
> negative values, labels), **stop and switch the bar/line charts to Recharts.** Don't discover the
> cost twice on `AccountBalanceHistory`; the first grouped chart is the canary. The donut and the
> cashflow line are cheap either way — keep those hand-rolled regardless. Whichever way it goes,
> isolate the choice behind these component boundaries so the page/fetchers/types never change, and
> record the decision in `current-feature.md`. Default remains SVG; this is the explicit escape
> hatch with a defined trigger, not an open-ended "if it's hard."

### The four charts

| Component | Type | Input | Notes |
|---|---|---|---|
| `SpendingByCategory` | Donut + legend | `CategorySlice[]` | Arc per category using its `color`; legend lists name + `formatCurrency(total)` + %. Empty (all zero) → handled by the `ChartCard` nudge, not an empty donut. |
| `IncomeVsExpenses` | Grouped bars / month | `MonthBucket[]` | Two bars per month (income green `#1D9E75`, expenses red `#E24B4A`); x-axis = every month from `monthsInRange` (zero months render flat). |
| `CashflowTrend` | Line / month | `MonthBucket[]` (net = income − expenses) | Single polyline of monthly net; zero baseline gridline; positive above / negative below. Reuse `Sparkline`'s point-mapping approach, scaled up with axis labels. |
| `AccountBalanceHistory` | Grouped bars / month / account | `BalancePoint[]` | One bar group per month, one bar per account (account `color`); legend maps color→account name. **Archived account (only reachable via explicit `?account=`, §8): suffix its legend label "(archived)"** so the user understands why an inactive account is showing — the series renders identically otherwise (no greying), since they explicitly asked for it. |

All currency labels use `formatCurrency` (EUR, no decimals). Colors come from `SEMANTIC_COLORS`
(income/expense/cashflow) and per-row `category.color` / `account.color` — **no new color
constants**, no magic hexes in components (uncategorized fallback `#D1D5DB` already used in
`dashboard.ts`; reference it via a shared constant if you introduce one).

`ChartCard` is the shared frame: section title (13px, sentence case), consistent padding, and a
`children`-or-`emptyState` slot. Charts are **client components** (they receive plain serializable
props and render SVG); the page/fetchers stay server-side.

### Accessibility (non-optional for hand-rolled SVG)

Hand-rolled SVG has **no built-in semantics** — a bare `<svg>` of `<rect>`/`<path>` is invisible to
screen readers. This is the real hidden cost of skipping a charting lib, so the spec mandates the
baseline rather than leaving it to chance:

- Each chart's root `<svg>` carries `role="img"` and an `aria-label` that **states the takeaway**,
  not just the title — e.g. `aria-label="Spending by category, last 3 months: Groceries €420, Dining
  €180, Transport €90"` (summarize from the same data the chart renders).
- **Cap the summary length.** Include at most the **top 3** entries by magnitude, then append "and N
  more" (e.g. "…Transport €90, and 5 more") — an unbounded label listing 12 months × 4 accounts would
  be unreadable noise for a screen reader. A small `ARIA_SUMMARY_MAX = 3` constant in
  `system-constants.ts` keeps it consistent across charts. The full detail remains available in the
  real-DOM legend below the chart.
- Decorative inner shapes are `aria-hidden` (mirrors `Sparkline`'s existing `aria-hidden`), so AT
  reads the one summary label, not every `<rect>`.
- The legend is real DOM text (not SVG `<text>`), so category/account names + amounts are selectable
  and readable independent of the SVG.
- Color is never the **only** signal: income/expense (green/red) and per-account series are also
  distinguished by the legend's text labels and order, so the charts remain legible for color-vision
  deficiency. (Aligns with the design system's "visual weight serves information" principle.)
- `ChartEmptyState` is plain text, already accessible.

> If the a11y summary strings become awkward to hand-build per chart, that is itself a signal to
> reach for the Recharts fallback (§11 trigger) — but the *bar* above is the minimum either way.

---

## 12. Empty states & thresholds

- **Per-chart gating, not one global gate (§6).** Each `ChartCard` decides independently:
  - **Spending by category** → renders whenever `hasCategoryData(categories)` (any expense). Empty
    copy: "Add an expense to see your spending breakdown."
  - **Account balance history** → renders whenever `hasBalanceData(history)` (≥ 1 in-scope account
    series — shows flat starting balances even with no transactions). The only empty case is a
    foreign/empty `?account=` scope, which falls through to "No accounts in this view." copy.
  - **Income vs Expenses** & **Cashflow trend** → gated on `hasEnoughForTrends(txCount)`
    (`REPORTS_MIN_TRANSACTIONS = 15`, the in-scope count from `getReportTxCount`); below it they show
    `<ChartEmptyState message={trendNudgeCopy(txCount)} />` ("Add N more transactions to see spending
    trends"). These two share one count so they never show different "add N" numbers.
  - Net effect: a brand-new account with 3 categorized expenses shows a real pie + balance chart,
    while only the two trend cards nudge — instead of the old behavior where 14 transactions blanked
    *everything*.
- **Zero-account safety.** `requireOnboarded()` already redirects users with no active accounts to
  `/onboarding`, so the page assumes ≥ 1 account. No separate zero-account branch is needed (unlike
  the dashboard's defensive fallback); a foreign/empty `?account=` still yields zero-row charts that
  fall through to each chart's own empty state.
- **Pro-gate** shows an `<UpgradePrompt>` **banner above the grid** when a Free user requested `12m`
  — the entitled 3-month charts still render beneath it (§9). It does **not** replace the grid.
- **"Always accessible."** Reports is never a locked screen — even with zero data it renders the
  header, period selector, and active-guidance empty states per the MVP definition.

---

## 13. Constants

### `src/lib/system-constants.ts`

```ts
/** Min in-scope transactions before a Reports chart renders instead of the nudge. */
export const REPORTS_MIN_TRANSACTIONS = 15;

/** Free-tier reporting ceiling (months). Pro unlocks the full 12-month window. */
export const REPORTS_FREE_MAX_MONTHS = 3;

/** Max entries listed in a chart's accessibility summary before "and N more" (§11). */
export const ARIA_SUMMARY_MAX = 3;
```

### `src/lib/constants.ts`

```ts
/** Reports period selector options (UI data). `months` drives the query window. */
export const REPORT_PERIOD_OPTIONS = [
  { param: "1m", label: "This month", months: 1 },
  { param: "3m", label: "Last 3 months", months: 3 },
  { param: "12m", label: "Last 12 months", months: 12 },
] as const;

/**
 * Single source of truth for the null-category fallback. `getRecentTransactions`
 * / `getBudgetsData` in `db/dashboard.ts` currently inline this same triplet
 * ("Uncategorized" / "#D1D5DB" / "HelpCircle") — extract it here and have those
 * call sites import it too, so the fallback can never drift between Reports, the
 * dashboard feed, and the budgets panel. Referenced by `getCategoryBreakdown`,
 * the donut legend, and the §20 acceptance criterion.
 */
export const UNCATEGORIZED = {
  name: "Uncategorized",
  color: "#D1D5DB",
  icon: "HelpCircle",
} as const;
```

No magic numbers/strings in components or fetchers — pull from these (coding standards). The
`UNCATEGORIZED` extraction also retires the two hard-coded copies in `db/dashboard.ts`.

---

## 14. Types — `src/types/reports.ts`

```ts
import type { PeriodMonths, ReportPeriod } from "@/lib/report-period";

/** One category's expense total for the spending-by-category donut. */
export interface CategorySlice {
  categoryId: string | null;   // null = Uncategorized
  name: string;
  icon: string;                // raw Lucide name, resolved client-side
  color: string;
  total: number;               // abs(sum of EXPENSE amounts)
}

/** One month's income/expense totals (also the cashflow source: net = income - expenses). */
export interface MonthBucket {
  month: number;               // 1–12
  year: number;
  income: number;              // sum of positive amounts
  expenses: number;            // abs(sum of negative amounts)
}

/** End-of-month balances across all in-scope accounts for one month. */
export interface BalancePoint {
  month: number;
  year: number;
  balances: { accountId: string; name: string; color: string; balance: number }[];
}

/** Everything the page hands the view (after the Pro clamp). */
export interface ReportData {
  categories: CategorySlice[];
  monthly: MonthBucket[];
  balanceHistory: BalancePoint[];
  txCount: number;
  /** The window actually queried (already clamped for Free). */
  effective: ReportPeriod;
  /** True when a Free user's 12m request was clamped to 3m — drives the banner + pill highlight. */
  clamped: boolean;
  isPro: boolean;
}
```

(`PeriodMonths`/`ReportPeriod` live in `report-period.ts`; re-export or import as convenient — keep
one definition. `clamped` comes straight from `resolveEffectivePeriod` — the view never recomputes
the gate.)

---

## 15. Edge cases & rules

- **Transfers excluded from income/expense/category, included in balance history** (§7). Never count
  a transfer as income or spend.
- **Soft-deleted transactions excluded everywhere** (`deletedAt: null`).
- **Months with no activity still render** as a zero column/point (x-axis from `monthsInRange`, not
  from the data) so "Last 12 months" never visually collapses to fewer months.
- **EUR-only — no mixed-currency path.** All accounts are EUR; sums are exact. Do not port the
  budget mixed-currency warning here.
- **Free user requesting `12m`** → data fetch clamps to 3 months; the entitled 3-month charts stay
  rendered with an upgrade **banner above** the grid (grid not replaced), the **effective** 3-month
  pill is highlighted, and the 12-month query is never executed for Free (§9).
- **`isPro` comes from the DB, not the session** (§9) — a `getReportProfile` round-trip is required.
- **Archived accounts**: default view excludes them; explicit `?account=<archivedId>` includes that
  one (§8). Foreign/unknown account id → empty report (ownership still enforced via `userId`).
- **Decimal → number at the fetcher boundary** — charts are client components; never pass a Prisma
  `Decimal`. Safe at `Decimal(12,2)`.
- **Balance history baseline** uses **all** non-deleted in-scope transactions strictly before `from`
  (`date < from`), plus `startingBalance` — so the first month's bar is the true running balance, not
  a from-zero reset.
- **Negative cashflow / negative balances render** (liability accounts, overspending months). The
  cashflow line crosses a zero baseline; balance bars below zero are allowed (do not clamp).
- **Current month is partial** — "This month" and the latest month of any window include only
  transactions up to today; that's expected (a state-of-now read), not a bug to "fill."
- **Period default** is "This month" (`1m`) when `?period=` is missing/garbage.

---

## 16. Testing (`test/`, Vitest, no DB — pure helpers only)

Per coding standards: cover `src/lib/**`; **no component tests**; Reports has **no actions** to test.
The DB fetchers are thin Prisma wrappers — their *logic* lives in the pure helpers, which are where
the tests concentrate.

**`test/lib/report-period.test.ts`**
- `parsePeriod`: `"1m"`/`"3m"`/`"12m"` map correctly; missing/garbage → `1m` default.
- `periodBounds`: correct half-open UTC `[from, to)` for each window with a fixed `now`; the
  **Dec→Jan year wrap** (e.g. `now` in Jan, `12m` → `from` in the prior February); `to` is the start
  of next month (current month fully included).
- `monthsInRange`: length === `months`; oldest→newest order; spans the year boundary correctly.
- `isPeriodAllowed`: Free allowed `1m`/`3m`, denied `12m`; Pro allowed all.
- `resolveEffectivePeriod` (the business-critical clamp): **Free + `12m`** → `effective.months === 3`
  and `clamped === true`; **Free + `1m`/`3m`** → `effective === requested`, `clamped === false`;
  **Pro + `12m`** → `effective === requested` (12m), `clamped === false`. This is the regression guard
  on the revenue-relevant gate — assert both the returned window **and** the `clamped` flag for each
  plan × request combination.

**`test/lib/reports.test.ts`**
- `bucketByMonth`: income vs expense split by sign; abs on expenses; zero-fills months with no rows;
  rows outside the month list ignored; multiple rows in a month summed.
- `reconstructBalanceHistory`: running end-of-month balance = baseline + cumulative monthly net;
  multiple accounts kept separate; a month with no rows carries the prior balance forward; negative
  balances preserved (no clamp).
- `hasCategoryData`: true when any slice `total > 0`; false for empty array / all-zero totals.
- `hasBalanceData`: true when some month has a non-empty `balances` series; false when every series
  is empty (the foreign/empty-`?account=` case) — explicitly assert it is **not** trivially true on
  a non-empty-but-seriesless history.
- `hasEnoughForTrends`: false below `REPORTS_MIN_TRANSACTIONS`, true at/above.
- `trendNudgeCopy`: exact string at count 0 ("Add 15 more transactions to see spending trends");
  clamps to "Add 0 more …" at/above threshold (never negative).
- `reportTxWhere` (the exported WHERE builder, §7): asserts the security-critical scoping rule
  without a DB — `userId` is always present and `deletedAt: null` is always set; **no `accountId`** →
  `financialAccount: { isArchived: false }` (all-accounts excludes archived); **with `accountId`** →
  `financialAccount: { id }` (explicit single account, **no** `isArchived` filter so an explicitly
  selected archived account is honored, §8). This is the cheapest guard against a regression that
  drops ownership scoping or leaks archived accounts.

> **Optional (post-MVP) — mocked-prisma fetcher tests.** The transfer-exclusion rule (`type` filter)
> and `[from, to)` bounds live *inside* each fetcher, not in a pure helper, so they aren't covered by
> the unit tests above. Per coding standards (mock `@/lib/prisma`, never a real DB), a lightweight
> follow-up could assert the `where` each fetcher passes to Prisma — e.g. `getMonthlyComparison`
> includes `type: { in: ["INCOME", "EXPENSE"] }` (excludes TRANSFER) and `getAccountBalanceHistory`
> does **not**. Not required for the MVP slice (the pure helpers carry the load-bearing logic), but
> worthwhile if the fetcher query shapes churn. Recorded here so it isn't lost.

Run `npm run test:run` **and** `npm run build` green before commit (workflow §4).

---

## 17. Implementation order

1. Constants (`REPORTS_MIN_TRANSACTIONS`, `REPORTS_FREE_MAX_MONTHS`, `REPORT_PERIOD_OPTIONS`) + types
   (`src/types/reports.ts`) — no deps.
2. `src/lib/report-period.ts` + `test/lib/report-period.test.ts` (TDD-friendly, pure).
3. `src/lib/reports.ts` pure helpers + `test/lib/reports.test.ts`.
4. `src/lib/db/reports.ts` fetchers (`reportTxWhere`, the four chart fetchers, `getReportTxCount`,
   `getReportProfile`) — build on the tested helpers.
5. `/reports` page: guard, params, Pro clamp, `Promise.all`, `AppShell`, `Suspense`.
6. Components: `ChartCard` + `ChartEmptyState` + `PeriodSelector` + `UpgradePrompt` first (frame),
   then the four chart SVGs (start with `IncomeVsExpenses` and `CashflowTrend` — they share the
   `MonthBucket` shape — then `SpendingByCategory`, then `AccountBalanceHistory` last as the
   cut-candidate).
7. `npm run test:run` + `npm run build`; manual browser pass (§18).

---

## 18. Decisions

### Resolved (baked into this spec)

- **Read-only slice — no server actions, no revalidation.** Reports never mutates.
- **Charts are hand-rolled SVG** (dependency-free, consistent with `Sparkline`); Recharts is the
  documented fallback behind the same component boundaries (§11).
- **`isPro` is fetched from the DB** via `getReportProfile` — the session doesn't carry it (§9).
- **The Pro gate is real now**, exercised by the two demo users; no Reports change at the launch-time
  enforcement flip (§9). Free `12m` clamps the query to 3 months but **keeps the 3-month charts
  rendered** and shows an upgrade **banner above** them — the grid is never blanked, and no
  blurred/fake 12-month teaser is drawn (§9).
- **Period tops out at 12 months** — no all-time window in MVP (§2).
- **Transfers excluded from income/expense/category, included in balance history** (§7).
- **Per-chart gating, not one global threshold** (§6, §12): category + balance gate on data
  *presence*; only the two time-series "trend" charts hold out for `REPORTS_MIN_TRANSACTIONS = 15`,
  using the spec's exact nudge copy. A sparse account still gets a real pie + balance chart.
- **Balance-history performance envelope is pinned** to the ≤10K-tx/user boundary with two indexed
  queries; the snapshot table is the documented escape above it (§7.1).
- **Recharts has a concrete early trigger** — switch the bar/line charts if `IncomeVsExpenses` isn't
  rendering within ~½ day; the donut + cashflow line stay hand-rolled regardless (§11).
- **Account scoping mirrors `/transactions`**: `?account=` to one account (archived allowed when
  explicit), else all active accounts (§8).
- **x-axis from `monthsInRange`**, so zero-activity months still render (§5).
- **Account balance history is the cut candidate** with two pre-approved fallbacks (§7.1).
- **Balance baseline includes all pre-window transactions + `startingBalance`** (true running
  balance, §15).

### Still open

- **None blocking.** The only deferrable is the balance-history chart's depth (full time series vs
  current-balance bars vs deferred) — resolve at build time against the effort budget per §7.1, and
  record the choice in `current-feature.md`.

---

## 19. Workflow (per [ai-interaction.md](../../docs/ai-interaction.md))

1. **Document** in `docs/current-feature.md` (Goals/Notes).
2. **Branch** `feature/reports-page`.
3. **Implement** §17 order: constants/types → period logic → pure helpers → fetchers → page →
   components.
4. **Test**: Vitest specs (§16); `npm run test:run` + `npm run build`; browser pass — switch periods,
   switch account scope, verify the Free 12-month upgrade prompt (sign in as `demo-nonpro`), verify
   charts populate for `demo-pro`, verify the nudge on a sparse account.
5. **Iterate**, then **commit** on green (conventional `feat:`, **no agent attribution** per CLAUDE.md),
   **merge** to `main`, **delete** branch, mark done in `current-feature.md` history.

---

## 20. Acceptance criteria

- [ ] `/reports` renders inside `AppShell` with the sidebar "Reports" item active; guarded by
      `requireOnboarded()`.
- [ ] Period selector (This month / Last 3 months / Last 12 months) is URL-driven via `?period=`;
      default is "This month".
- [ ] All four charts render for an account with enough data: spending-by-category donut,
      income-vs-expenses grouped bars, cashflow line, account-balance bars. *(If a §7.1 balance-history
      fallback is taken, this relaxes per §7.1 — current-balance bars for #1, or three charts + an
      honest linking empty state for #2, recorded in `current-feature.md`.)*
- [ ] Charts gate **individually**: category + balance render on data presence; only Income vs
      Expenses and Cashflow trend show the "Add N more transactions to see spending trends" nudge
      (N = `15 − count`, clamped ≥ 0) when in-scope transactions < 15. A sparse account still shows a
      real category pie + balance chart — the page is never wholesale-blanked.
- [ ] Global account selector scopes every chart (`?account=`); "All accounts" excludes archived,
      an explicitly selected account is honored by id.
- [ ] A **Free** user selecting "Last 12 months" keeps their 3-month charts rendered with an upgrade
      **banner above** the grid (grid not replaced, no fake teaser), and the 12-month query never
      runs; a **Pro** user gets the full 12-month charts.
- [ ] `isPro` is read from the DB (not assumed from the session).
- [ ] Months with no activity still appear as zero columns/points across the 3- and 12-month windows.
- [ ] Transfers are excluded from income/expense/category and included in balance history; soft-
      deleted transactions are excluded everywhere.
- [ ] No `Decimal` crosses to a client chart; all amounts are `number`.
- [ ] `getCategoryBreakdown` resolves category metadata in **one** batched lookup (no N+1);
      null/SetNull categories render as Uncategorized.
- [ ] Each chart SVG has `role="img"` + a data-summarizing `aria-label`, decorative shapes are
      `aria-hidden`, and the legend is real DOM text (chart a11y baseline, §11).
- [ ] `report-period.ts` and `reports.ts` pure helpers are unit-tested (period bounds incl. year
      wrap, Pro gate, month bucketing, balance reconstruction, threshold + nudge copy).
- [ ] `npm run test:run` and `npm run build` pass; **no schema change**, no `db push`.
```
