# Spendly MVP Roadmap

> Track the remaining work to reach a shippable MVP. Section numbers are **stable feature IDs**;
> the build order is the value-first **Delivery Sequence** near the end of this doc.

---

## Spec Alignment Notes

How this roadmap reconciles the three governing docs where they disagree:

- **API Routes table in [project-overview.md](../docs/project-overview.md) is largely superseded.** That table lists ~25 REST endpoints (`/api/goals`, `/api/reports/*`, `/api/categories`, etc.). The actual architecture — [entity-crud-architecture.md](./entity-crud-architecture.md) — reserves API routes for "webhooks, file uploads, or spec-listed endpoints callable outside the render cycle" and routes **all** entity CRUD through server-only DB fetchers (`src/lib/db/`) + Server Actions (`src/actions/`). Every shipped slice (transactions, budgets, recurring, accounts) followed that pattern, **not** the REST table. This roadmap does the same: Goals, Reports, and Categories are **Server Actions + fetchers, not the `/api/*` endpoints listed in the overview**. The only new API routes are the Stripe webhook and the **data-export streaming routes** (`/api/export/*`, a genuine "callable outside the render cycle" case — not in the overview's table, but architecturally required). When a project-overview API endpoint and the architecture doc conflict, **the architecture doc wins** (project-overview.md now carries this same clarification above its API Routes table and in its architecture diagram).
- **`isCompleted` auto-set ambiguity — resolved.** [entity-types.md](./entity-types.md) previously said `isCompleted` was set "manually or when `currentAmount >= targetAmount`", which contradicted [entity-crud-architecture.md](./entity-crud-architecture.md)'s **strictly manual** (no auto-complete) rule. Both docs are now reconciled to **manual-only**: `completeGoal` is the only thing that sets the flag, and the app never auto-flips the goal at 100%. See `docs/features/goals-crud-spec.md` §14.
- **Currency / `preferredCurrency`** — see feature #0. The EUR-only resolution and the dormant-`preferredCurrency` rule come from the financial-account spec §10 and override the schema's `"USD"` defaults.

---

## Completed

| Area | What was built |
|---|---|
| Infrastructure | Next.js 16, Tailwind v4, Prisma + Neon, React Compiler |
| Auth (full stack) | Email/password, Google OAuth, email verification, forgot/reset password, rate limiting, profile page with change-password and delete-account |
| Homepage | Hero cube animation, full landing page (Features, Pricing, CTA, Footer, Nav) |
| Dashboard | Live data (hero balance, metric strip, sparkline, recent transactions, budgets panel, goals widget) |
| Transactions | Full read/write stack — list with filters + search, create/edit/delete drawer, transfer pair handling, soft delete + undo |
| Budgets | Full read/write stack — period stepper, create/edit/archive, preset seeding, live spend aggregation |
| Recurring Templates | Full read/write stack — templates + drafts inbox, confirm/dismiss, draft generation on load, merchant stamp on confirm |
| Financial Accounts | Full read/write stack — `/accounts` page, create/edit/archive/unarchive, derived balance, `isArchived` guard on transactions and recurring confirm |
| Goals | Full read/write stack — `/goals` page, create/edit/complete/delete, signed contributions (withdrawals), atomic `currentAmount`, single-source fetcher shared with the dashboard widget |
| Onboarding + Currency (1 + 0) | First-run gate (`requireOnboarded`/`redirectIfOnboarded` server guards, derived from `activeAccountCount > 0`) + `/onboarding` 3-step flow (account → starter budgets → done); budget currency resolves from `DEFAULT_CURRENCY` (EUR); schema currency defaults reconciled to EUR + USD→EUR backfill migration; `formatCurrency` switched to `€` app-wide |
| Dashboard Insights Strip (4) | Actionable pill row on `/dashboard` (budgets at risk, pending recurring drafts, overdue goals) below the metric strip; derived in-process from the page's existing budget/goal arrays + one `count` query for drafts; pure helpers in `src/lib/insights.ts`; renders nothing when all counts are zero |
| Reports Page (5) | `/reports` analytics module — four hand-rolled SVG charts (spending-by-category donut, income-vs-expenses grouped bars, cashflow line, account-balance bars); URL-driven period selector (1m/3m/12m) with Free 3-month clamp + upgrade banner (real `isPro` read from DB); per-chart data-sufficiency gating; account scoping via the global selector; pure helpers in `src/lib/report-period.ts` + `src/lib/reports.ts`, fetchers in `src/lib/db/reports.ts`; read-only (no mutations); `UNCATEGORIZED` extracted to `constants.ts` |
| Data Export (6) | `GET /api/export/{csv,json}` — the first non-auth API routes. CSV flat ledger (UTF-8 BOM + Excel `sep=,` hint, RFC-4180 + formula-injection-safe, transfers as two rows) and a versioned JSON dump (`{ schemaVersion: 1, exportedAt, data }`, derived balances, user-owned categories, nested goal contributions); pure helpers `src/lib/export/*`, fetchers `src/lib/db/export.ts` (`exportTxWhere` mirrors `reportTxWhere`, `EXPORT_ENTITY_CLASS` ownership map); per-`userId` rate limit, unified `{ error, code }` 401/429/413 contract, 10K size cap; tier-agnostic (no `isPro`); entry on `/accounts`; ESLint boundary forbids Prisma in the routes |

---

## Remaining MVP Items

---

### 0. Known Inconsistencies to Resolve First ✅ Shipped

**Effort: S · Value: low (correctness) — these are latent bugs, not new features.**

> **✅ Shipped (`feature/onboarding-currency`, bundled with §1).** Both items resolved:
> - **Currency drift fixed.** `createBudget` / `seedPresetBudgets` now stamp `DEFAULT_CURRENCY` (EUR)
>   instead of reading `User.preferredCurrency` (which also dropped a DB round-trip). Migration
>   `reconcile_currency_eur_default` flips the `User.preferredCurrency` + `FinancialAccount.currency`
>   schema defaults to `"EUR"` and one-shot-backfills `'USD'`→`'EUR'` across all six currency columns
>   (applied to the `development` Neon branch after a read-only pre-flight inventory; production
>   deferred to launch). `preferredCurrency` is now dormant everywhere.
> - **Bonus — `formatCurrency` was hard-coded to `$`.** The spec wrongly assumed it already rendered
>   EUR; it didn't. Fixed `src/lib/format.ts` to `€` and swapped the `$`→`€` amount-input prefix in
>   the account/budget/transaction/recurring drawers (the contribution drawer was already `€`).
> - **Empty states verified.** `BudgetEmptyState`, `RecurringEmptyState`, `AccountEmptyState` confirmed
>   rendering on zero-data accounts during QA.

- **`preferredCurrency` is `"USD"` but the app is EUR-only.** `User.preferredCurrency` defaults to `"USD"` in the schema, and `seedPresetBudgets` ([src/actions/budgets.ts](../src/actions/budgets.ts)) writes preset budgets with `currency: preferredCurrency`. Result: preset budgets are created in USD while every account and transaction is EUR. Fix: have budget/goal currency resolve from `DEFAULT_CURRENCY` (per the financial-account spec §10) until multi-currency lands, and reconcile the schema default to `"EUR"` in a migration. Treat `preferredCurrency` as dormant everywhere else.
- **Verify, don't assume, the existing empty states.** Step 1 marks several pages' empty states with ✓ from the history changelog, not from inspection. Confirm `BudgetEmptyState`, `RecurringEmptyState`, and `AccountEmptyState` actually render on a zero-data account before relying on them.

---

### 1. Onboarding / First-Run Gate ✅ Shipped

**Effort: M · Value: high (every new signup) — smooths first-run; not a hard blocker (a determined user can reach `/accounts` directly).**

> **✅ Shipped (`feature/onboarding-currency`).** Built per `docs/features/onboarding-currency-spec.md`,
> bundled with the §0 currency fixes. Realized slice:
> - **Per-page server guards, not middleware.** `requireOnboarded()` / `redirectIfOnboarded()` in
>   `src/lib/auth/guards.ts` over a lean `getActiveAccountCount` fetcher. "Onboarded" is **derived**
>   from `activeAccountCount > 0` (no stored flag), so archiving the last account re-enters the flow.
> - **`/onboarding` 3-step flow** (`src/app/onboarding/page.tsx` + `src/components/onboarding/*`):
>   inline first-account form → optional `seedPresetBudgets` → done. Its own centered surface (no app
>   chrome), reusing `AuthCard`/`InputFormField`/`SubmitButton` and the existing
>   `createFinancialAccount` / `seedPresetBudgets` actions.
> - **Data surfaces** (`/dashboard`, `/transactions`, `/budgets`, `/recurring`, `/goals`) call
>   `requireOnboarded()`; **`/accounts` + `/profile` stay open** as escape hatches; `/onboarding` added
>   to `auth.config.ts` `isProtected`. Dashboard gained a defensive `accounts.length === 0` zero-state.
> - **Resolved during QA:** a Server Action's implicit current-route refresh re-ran the reverse guard
>   and ejected the user the instant Step 1 created the account, skipping Steps 2–3. Fixed by marking
>   the flow in-progress in the URL (`?step=budgets|done`) so the reverse guard only bounces *fresh*
>   visits; the page derives `initialStep` so reloads resume. (This deviates from the spec's
>   "local state, no URL param" decision, which was the exact thing that broke.)
> - **Note:** the per-page guard is added to `/reports` when that page is built (§5), not stubbed here.
> The build plan below is retained for reference.

A freshly registered user lands on the dashboard with zero accounts, zero categories, and nothing to interact with. The transaction drawer already guards against creating a transaction without an account, but there is no proactive guide to help the user set up.

**What to build:**

- **Post-registration redirect.** After email/password registration or first Google OAuth sign-in, detect `financialAccounts.count === 0` and redirect to `/onboarding` instead of `/dashboard`.
- **`/onboarding` page.** A simple, focused multi-step flow (not a wizard modal — a dedicated route):
  1. **Step 1 — Create your first account.** Renders `AccountFormDrawer` in-place (or an inline form). Cannot skip. On submit, proceeds to step 2.
  2. **Step 2 — Seed starter budgets (optional).** Reuse the existing `seedPresetBudgets` action to create the `BUDGET_PRESETS` budgets for the current month. Has a "Skip for now" link.
     > **Open design question — the spec's "category preset (Personal / Freelancer / Family)" is undesigned.** All 20 categories are already system-seeded (`userId = null`), so a "preset" cannot *create* categories. There is also only one `BUDGET_PRESETS` list today, not three named variants. Decide before building: (a) drop the named presets and ship the single "starter budgets" action above, or (b) introduce three `BUDGET_PRESETS` variants and a category-visibility/favourites concept. Recommend (a) for MVP — it's the smallest path that satisfies "select a preset" without inventing a favourites model.
  3. **Step 3 — Done.** A congratulatory confirmation with CTA → `/dashboard`.
- **Soft redirect guard, not a hard lock.** Detect authenticated users with no active accounts and redirect the *data* surfaces (`/dashboard`, `/transactions`, `/budgets`, `/recurring`, `/goals`, `/reports`) to `/onboarding`. **Keep `/accounts` and `/profile` reachable** — a user who just archived their last account needs to get back in to create or unarchive one, and locking them out of those pages would be a trap. The onboarding nudge should guide, not imprison: show the prompt, but leave the escape hatches open.
- **Empty-state CTAs on existing pages.** Each page already has or needs a contextual empty state when there is no data. Audit and complete:
  - `/dashboard` — hero balance shows `€0.00`, metric strip shows zeroes, a "Create your first account →" CTA card is shown where the transactions panel would be.
  - `/transactions` — "No transactions yet. Add your first one." with Add button.
  - `/budgets` — "No budgets yet" with Create button (existing `BudgetEmptyState`). ✓
  - `/recurring` — "No templates yet" (existing `RecurringEmptyState`). ✓
  - `/goals` — "Set your first savings goal" (existing `GoalEmptyState`). ✓
  - `/accounts` — "Create your first account" (existing `AccountEmptyState`... verify it works). ✓

**Files to create/modify:**
- `src/app/onboarding/page.tsx` (new) + `src/components/onboarding/*`
- `src/lib/auth/guards.ts` — add `requiresOnboarding(userId)` check
- `src/proxy.ts` / middleware — add `/onboarding` to the allowed routes

---

### 2. Goals CRUD ✅ Shipped

**Effort: L · Value: high (headline feature) — full entity slice; zero unbuilt dependencies.**

> **✅ Shipped (`feature/goals-crud`).** Built per `docs/features/goals-crud-spec.md`. Notes on the
> realized slice: progress is a **bar, not a ring** (spec §14); overfunded goals (`saved > target`)
> clamp the bar to 100% and surface an explicit **"Over 100%"** pill plus the true percentage.
> `GOAL_AMOUNT_MAX` lives in `src/lib/system-constants.ts`, `GOAL_COLORS` in `src/lib/constants.ts`.
> The dashboard now imports a dedicated **`getGoalsSummary`** from `src/lib/db/goals.ts` (the old
> `getGoals` / `GOAL_COLORS` / inline overdue math were deleted from `dashboard.ts`); overdue/progress
> logic is centralized in `src/lib/goals.ts` (`isGoalOverdue` floors both sides to UTC midnight with a
> strict `<`, so a goal due *today* is not overdue). `revalidateGoalViews()` added to
> `src/lib/revalidation.ts`. 37 new Vitest tests (325 total); `npm run test:run` + `npm run build` pass.
> The build plan below is retained for reference.

Goals are virtual savings targets updated via manually recorded contributions. No goals page exists yet; only a read-only Goals widget appears on the dashboard (using `getGoals` from `src/lib/db/dashboard.ts`).

**What to build:**

**DB fetcher** — `src/lib/db/goals.ts`
- `getGoals(userId)` — `findMany` with `include: { contributions: { orderBy: { date: "desc" } } }`, ordered by `createdAt asc`.
- `getGoalForEdit(userId, id)` — single goal for drawer pre-fill, returns `null` if not found/not owned.

> **Make Goals the single source of truth — don't fork the query.** `getGoals` already exists in [src/lib/db/dashboard.ts](../src/lib/db/dashboard.ts) (returns the trimmed `GoalRow[]` for the dashboard widget). Rather than maintain two parallel fetchers, move the canonical query into `src/lib/db/goals.ts` and have the dashboard import a narrowed selector from it (e.g. `getGoalsSummary` deriving from the same base query, or a shared `mapGoalRow` helper). The overdue/progress logic (`targetDate < today && !isCompleted && currentAmount < targetAmount`) must live in exactly one place — `src/lib/goals.ts` — and be consumed by both the dashboard widget and the Goals page, so the two surfaces can never disagree.

**Server actions** — `src/actions/goals.ts`

| Action | Behavior |
|---|---|
| `createGoal` | name, targetAmount, currency (→ `DEFAULT_CURRENCY`), optional targetDate |
| `updateGoal` | Patch name, targetAmount, targetDate |
| `completeGoal` | Set `isCompleted = true` |
| `deleteGoal` | Hard delete — cascades to contributions |
| `addContribution` | Atomic `$transaction`: insert `GoalContribution` + `Goal.currentAmount { increment }` |
| `deleteContribution` | Atomic `$transaction`: delete contribution + `Goal.currentAmount { decrement }` |

All auth-guarded, Zod-validated, ownership-checked. Return `{ success, data?, error? }` and call `revalidatePath("/goals")` + `revalidatePath("/dashboard")`.

**Validation** — `src/lib/validations/goal.ts`
- `createGoalSchema`: name (≤80 chars), targetAmount (positive Decimal, max = `GOAL_AMOUNT_MAX`), optional targetDate (ISO date string)
- `updateGoalSchema`: same fields, all optional
- `addContributionSchema`: amount (nonzero Decimal), date (ISO date string), optional note

**Page** — `src/app/goals/page.tsx`
- `force-dynamic`, `getSessionOrRedirect`, `Promise.all([getGoals(userId)])`.
- Renders `<GoalsView goals={...} />` or `<GoalEmptyState />`.

**Components** — `src/components/goals/`
- `GoalsView` — coordinator: own drawer open state, delete with confirm dialog.
- `GoalCard` — progress ring (or bar), name, amounts, overdue badge when `targetDate < today && !isCompleted && currentAmount < targetAmount`.
- `GoalFormDrawer` — shadcn Sheet; create fields: name, target amount, optional target date. Edit mode: same fields editable; "Mark complete" secondary action.
- `ContributionDrawer` — separate Sheet for adding/viewing contributions; amount, date, optional note; list of existing contributions with delete.
- `GoalEmptyState` — "Set your first savings goal" CTA.

**Tests** — `test/actions/goals.test.ts`, `test/lib/goals.test.ts`
- Covers: auth guard, ownership, atomic contribution side-effects, negative contribution (withdrawal), `currentAmount` invariant.

---

### 3. User Category Management

**Effort: M · Value: medium (power users) — nice-to-have, not a launch blocker. Safe to defer if timelines tighten.**

> **Re-scoped: this is a power-user enhancement, not a hard MVP requirement.** The app is fully functional today with the 20 seeded system categories — a user can capture, budget, and report without ever creating a custom one. The MVP definition lists "user extensions" but the core loop (`capture → organize → control → understand`) closes without it. **If schedule pressure appears, this is the first feature to defer to post-launch** — it has no downstream dependencies (nothing else in this roadmap needs it). Kept in the MVP list for completeness, but slotted late in the delivery sequence accordingly.

System categories exist (seeded). Users can read them. But `src/actions/categories.ts` does not exist yet — users cannot create, edit, or delete their own categories.

**What to build:**

**Server actions** — `src/actions/categories.ts`

| Action | Behavior |
|---|---|
| `createCategory` | name, icon (whitelist), color (hex). `isSystem = false`, `userId` from session |
| `updateCategory` | Patch name, icon, color. Rejects if `isSystem = true` or wrong owner |
| `deleteCategory` | Hard delete user category. Rejects system categories. FK sets `Transaction.categoryId = null` (`onDelete: SetNull`) |

Ownership check: `category.userId === session.user.id AND category.isSystem === false`. Returning `{ success: false, error: "Forbidden" }` for any violation.

**Validation** — `src/lib/validations/category.ts`
- `createCategorySchema` / `updateCategorySchema`: name (≤50 chars), icon (whitelisted Lucide names), color (hex).

**UI surface** — Inline in existing category pickers (transaction drawer, budget form, recurring form):
- Add a small "+" or "New category" row at the bottom of the category selector list.
- Clicking it opens a `CategoryFormDrawer` (Sheet) for name + icon + color.
- On success, the new category appears at the top of the list and is auto-selected.
- A separate "Manage categories" section can live on `/settings` (feature #7) to edit/delete existing user categories.

**Tests** — `test/actions/categories.test.ts`
- Covers: auth guard, system category mutation rejection, ownership enforcement, name uniqueness constraint handling.

---

### 4. Dashboard Insights Strip ✅ Shipped

**Effort: S · Value: medium (cheap visible win) — drives the Dashboard's "actionable" promise; needs Goals (2) for the overdue-goals pill.**

> **✅ Shipped (`feature/dashboard-insights-strip`).** Built per `docs/features/dashboard-insights-strip-spec.md`
> (confirmed for build on 2026-06-20; the strip had been removed once in the Dashboard UI Mockup phase).
> Realized slice — **deviates from the sketch below**, which proposed a monolithic `getInsights` fetcher:
> - **Derive in-process, don't re-query.** The dashboard page already fetches budgets (`getBudgetsData`)
>   and goals (`getGoalsSummary`) in its `Promise.all`, so at-risk and overdue counts are computed from
>   those arrays via pure helpers — **zero extra queries**. Only the draft count needed new data: one
>   lean `getPendingDraftCount(userId)` `count` in `src/lib/db/recurring.ts` (mirrors `getPendingDrafts`'
>   ownership scoping; the dashboard does **not** run `generatePendingDrafts` — it only reports).
> - **Single source of truth for each rule.** `countAtRiskBudgets` (`src/lib/insights.ts`) reuses
>   `budgetFraction` with `BUDGET_AT_RISK_THRESHOLD = 0.8` (≥, consistent with `budgetState`; includes
>   over-budget; zero-limit immune; NaN-safe). Overdue count reuses the already-materialized
>   `GoalRow.overdue` flag (`isGoalOverdue`) — never re-derived.
> - **Pure copy/label builder.** `buildInsightItems` emits an ordered `InsightItem[]` (fixed order
>   budgets → drafts → goals; zero-count signals omitted; pluralization), so the component is a dumb
>   renderer and the wording is unit-tested. `DashboardInsights` + `InsightItem` types in
>   `src/types/dashboard.ts`.
> - **Server component** `src/components/dashboard/insights-strip.tsx` — link pills only (no client JS),
>   `TONE_CLASS` lookup (warning amber = the goals overdue badge; info blue = the "View all →" link),
>   returns `null` when empty (calm = nothing rendered, no placeholder). `lg:my-1 lg:gap-3` adds
>   large-monitor breathing room. Rendered between `<MetricStrip />` and the content grid, inside the
>   `accounts.length > 0` branch only.
> - **No KPI-card treatment.** Kept lightweight bare pills (rejected per-pill metric-style cards and a
>   "needs attention" wrapper — the latter being exactly the generic card removed earlier).
> - **Freshness already provisioned** — every recurring mutation revalidates `/dashboard`
>   (`revalidateRecurringViews` / `revalidateTransactionViews`), so the draft count stays current with
>   no new wiring. 13 new Vitest tests in `test/lib/insights.test.ts` (345 total);
>   `npm run test:run` + `npm run build` pass. The build sketch below is retained for reference.

The spec describes "an actionable insights strip (budgets at risk, recurring drafts pending, overdue goals)" as part of the Dashboard ([project-overview.md](../docs/project-overview.md) → Dashboard). This is currently missing.

**What to build:**

**DB fetcher additions** — extend `src/lib/db/dashboard.ts`
- Add `getInsights(userId, month, year)` that returns:
  - `atRiskBudgets`: budgets where `spent / amount > 0.80` for the current month (already computed in `getBudgetsData`, filter there or reuse).
  - `pendingDraftsCount`: count of `RecurringDraft` with `status = PENDING` for the user's templates.
  - `overdueGoals`: goals where `targetDate < today && !isCompleted && currentAmount < targetAmount`.

**Component** — `src/components/dashboard/insights-strip.tsx`
- A horizontal strip of pill/card alerts below the metric strip.
- Shows up to 3 items: e.g. "3 budgets at risk", "2 recurring drafts pending → /recurring", "1 overdue goal → /goals".
- Hidden when all counts are zero (no empty strip).
- Each pill is a link to the relevant page.

---

### 5. Reports Page ✅ Shipped

**Effort: L · Value: high (major module) — required by MVP definition. Always accessible; empty state when insufficient data.**

> **✅ Shipped (`feature/reports-page`).** Built per `docs/features/reports-page-spec.md`. Realized slice:
> - **Read-only — no actions, no revalidation.** All data flows through six server-only fetchers in
>   `src/lib/db/reports.ts` (`getCategoryBreakdown`, `getMonthlyComparison`, `getAccountBalanceHistory`,
>   `getReportTxCount`, `getReportProfile`, + the exported pure `reportTxWhere` scoping builder).
>   Cashflow derives in-process from the monthly-comparison buckets (no extra query).
> - **Period logic** `src/lib/report-period.ts` (`parsePeriod`/`periodBounds`/`monthsInRange`/
>   `isPeriodAllowed`/`resolveEffectivePeriod`) + **pure aggregation** `src/lib/reports.ts`
>   (`bucketByMonth`, `reconstructBalanceHistory`, the four sufficiency gates, `trendNudgeCopy`) — both
>   unit-tested (35 new Vitest tests, 380 total).
> - **`isPro` read from the DB** via `getReportProfile` (the session only carries `user.id`). The gate is
>   **real now** — a Free 12m request clamps the *query* to 3 months (`resolveEffectivePeriod`), keeps the
>   3-month charts rendered, and shows an upgrade **banner above** the grid; the 12-month query never runs
>   for Free. No `isPro = true` hardcode — §8's launch flip does not need to touch Reports.
> - **Four hand-rolled SVG charts** (`src/components/reports/`), consistent with `Sparkline` — Recharts
>   not needed (the `IncomeVsExpenses` canary rendered fine). Each `<svg>` is `role="img"` with a
>   data-summarizing `aria-label` (capped at `ARIA_SUMMARY_MAX` then "and N more") + a real-DOM legend.
> - **Per-chart gating, not one global gate:** category + balance render on data *presence*; only the two
>   trend charts hold out for `REPORTS_MIN_TRANSACTIONS = 15` with the spec's exact nudge copy.
> - **Account scoping** mirrors `/transactions` (`?account=`); archived honored only when explicitly
>   selected (suffixed "(archived)" in the balance legend). Months with no activity still render as zero
>   columns. **Account-balance chart shipped as the full time-series** (no §7.1 fallback taken).
> - **`UNCATEGORIZED` extracted** to `src/lib/constants.ts`, retiring the inline copies in
>   `getRecentTransactions` (`db/dashboard.ts`) and `transaction-row.tsx`. New constants:
>   `REPORTS_MIN_TRANSACTIONS` / `REPORTS_FREE_MAX_MONTHS` / `ARIA_SUMMARY_MAX` (system),
>   `REPORT_PERIOD_OPTIONS` (UI). The per-page `requireOnboarded()` guard was added here (per §1's note).
>   No schema change. `npm run test:run` (380) + `npm run build` pass; Playwright QA covered Pro 12m,
>   the Free clamp, account scoping, and the sparse-account nudge. The build plan below is retained for
>   reference.

No `/reports` page exists. Four charts are required.

**What to build:**

**DB fetchers** — `src/lib/db/reports.ts`
- `getCategoryBreakdown(userId, { from, to, accountId? })` — sum of EXPENSE transactions grouped by category. Returns `{ categoryId, name, icon, color, total }[]`.
- `getMonthlyComparison(userId, { months, accountId? })` — income vs expense totals per calendar month. Returns `{ month, year, income, expenses }[]`.
- `getCashflowTrend(userId, { months, accountId? })` — net cashflow (income - |expenses|) per month.
- `getAccountBalanceHistory(userId, { months, accountId? })` — per-account derived balance at end of each month (computed from cumulative transactions up to that point — no snapshot table needed; cost is acceptable at MVP transaction volumes).
  > **Most complex chart — the designated simplification candidate.** Unlike the other three (which aggregate transactions *within* a period), this one reconstructs a *running* balance: each month's value is `startingBalance + SUM(amount)` for every transaction up to and including that month, per account. That cumulative reconstruction is the heaviest query in Reports. **If Step 5 runs over schedule, simplify or cut this chart first** — e.g. ship only the current end-of-month balance per account as a simple bar, or defer the time-series entirely. The other three charts deliver most of the analytical value at a fraction of the effort.

**Period logic** — `src/lib/report-period.ts`
- `parsePeriod(searchParam)` → `{ months: 1 | 3 | 12, label: string }`.
- `periodBounds(months)` → `{ from: Date, to: Date }`.
- `isPeriodAllowed(months, isPro)` → Free tier locked to ≤ 3 months; Pro unlocks 12 months.

**Page** — `src/app/reports/page.tsx`
- `force-dynamic`, `getSessionOrRedirect`.
- Period selector pills: "This month" / "Last 3 months" / "Last 12 months" (last option disabled + upgrade prompt for Free users).
- `Promise.all` for all four data fetchers in parallel, filtered by `?account=` and `?period=` URL params.
- Each chart section has a `MIN_TRANSACTIONS` threshold below which it shows an empty-state nudge instead of a chart. The spec's example copy is "Add 15 more transactions to see spending trends" ([project-overview.md](../docs/project-overview.md) → Reports) — match that wording/threshold rather than inventing a different number.

**Charts** — `src/components/reports/`
- Use a lightweight chart library or hand-roll SVG charts (consistent with the existing `Sparkline` approach). Recharts is a common choice; or build simple bar/line/pie SVG components.
- `SpendingByCategory` — pie or donut chart with legend.
- `IncomeVsExpenses` — grouped bar chart per month.
- `CashflowTrend` — line chart per month.
- `AccountBalanceHistory` — stacked or grouped bar per month per account.

**Pro gate** — When `!isPro` and period = 12 months, show an upgrade prompt card instead of the 12-month charts. During development `isPro = true` for all users so this never triggers.

> **Reports history = 12-month cap (now consistent across docs).** Free = last 3 months, Pro = last 12 months. The earlier project-overview contradiction (Monetization said Pro "All time" while the period selector capped at 12 months) is reconciled — [project-overview.md](../docs/project-overview.md) now reads "Last 12 months" for Pro. True unbounded all-time history is post-MVP.

**Tests** — `test/lib/report-period.test.ts` — period parsing, bounds, Pro gate logic.

---

### 6. Data Export ✅ Shipped

**Effort: M · Value: medium (trust feature) — in MVP definition; available to all tiers (not a Pro gate).**

> **✅ Shipped (`feature/data-export`).** Built per `docs/features/data-export-spec.md`. Realized slice:
> - **Two GET routes — the first non-auth API routes** (`src/app/api/export/{csv,json}/route.ts`),
>   `runtime="nodejs"` + `dynamic="force-dynamic"`, streamed via `ReadableStream`. Read-only — no
>   actions, no `revalidate*` (like Reports).
> - **Pure ↔ model ↔ HTTP split.** Pure helpers `src/lib/export/{csv,json,filename}.ts` (RFC-4180
>   `escapeCsvField` + formula-injection-safe `escapeCsvTextField`, `buildExportEnvelope`,
>   `exportFilename` — all unit-tested); model `src/lib/db/export.ts` (`exportTxWhere` mirroring
>   `reportTxWhere`, `getTransactionsForExport`, `getFullExport`, the `EXPORT_ENTITY_CLASS` ownership
>   map); routes are HTTP/stream glue only. An ESLint `no-restricted-imports` override forbids Prisma in
>   `src/app/api/export/**`, so route handlers reach the DB only through `db/export.ts`.
> - **CSV** = flat ledger, one row per non-deleted tx (transfers = two rows), signed bare-number
>   amounts, 7 `EXPORT_CSV_COLUMNS`, UTF-8 BOM. **Added beyond the spec:** a leading `sep=,` line so
>   Excel splits columns on double-click (European-locale Excel otherwise defaults to `;` and dumps each
>   row into one cell) — emitted as a transport-level line in the route, leaving the pure
>   `transactionsToCsv` a clean header+rows transform; strict RFC-4180 consumers must skip it.
> - **JSON** = versioned envelope `{ schemaVersion: 1, exportedAt, data }`, pretty-printed; derived
>   account balances, **user-owned categories only**, budgets, goals + nested contributions, recurring
>   templates, non-deleted transactions. Decimal→number, `@db.Date`→`YYYY-MM-DD`.
> - **Security/scoping:** `auth()`-guarded (401 JSON, no redirect), every query `userId`-scoped,
>   **tier-agnostic — `isPro` is never read** (S6). `?account=` scopes account-bound entities; budgets/
>   goals/categories stay full (the deliberate C2 asymmetry — do not "normalize"). Per-`userId` rate
>   limit (`RATE_LIMITS.export`, 10/min, fail-open) + a unified `{ error, code }` shape for 401/429/413
>   (the shared `tooManyRequestsResponse` gained `code: "rate_limited"`); 10K-tx size cap (CSV `#` marker
>   row / JSON 413). Empty export is valid (header-only CSV / empty-arrays JSON) — never 500/redirect.
> - **Entry point:** `<ExportLinks>` on `/accounts` carrying the current `?account=`. New constants:
>   `EXPORT_JSON_SCHEMA_VERSION` / `EXPORT_FILENAME_PREFIX` / `EXPORT_MAX_TRANSACTIONS` + `RATE_LIMITS.export`
>   (system); `EXPORT_CSV_COLUMNS` / `EXPORT_CSV_EXCEL_HINT` (UI). 37 new Vitest tests (417 total);
>   `npm run test:run` + `npm run build` pass; **no schema change**. Playwright QA confirmed CSV
>   BOM/`sep=,`/columns, the JSON envelope + C2 asymmetry, account scoping, and the 401 path. The build
>   plan below is retained for reference.

**What to build:**

**API routes** — `src/app/api/export/`
- `GET /api/export/csv` — streams a CSV file: date, amount, type, category name, account name, merchant, note. Scoped to `?account=` filter if present. Charset: UTF-8 BOM so Excel opens it correctly.
- `GET /api/export/json` — streams a JSON file: complete structured dump including accounts (with derived balances), categories (user-owned only), budgets, goals + contributions, recurring templates, transactions (excluding soft-deleted). Scoped to account filter.
  > **Version the JSON envelope from day one.** Wrap the dump in `{ "schemaVersion": 1, "exportedAt": "<ISO>", "data": { ... } }` rather than emitting the bare object. A single version field now makes future schema evolution (and any re-import tooling) cheap — an importer can branch on `schemaVersion` instead of guessing the shape. Bump it whenever the export structure changes. Cheap to add now, painful to retrofit later.

Both routes:
- Auth-guarded via `auth()`.
- Set `Content-Disposition: attachment; filename="spendly-export-YYYY-MM-DD.csv"`.
- Stream via `Response` with a `ReadableStream` to avoid loading the full dataset into memory.

**UI entry point** — Export buttons on the `/accounts` page or a new `/settings` page (Step 7). A simple "Export CSV" / "Export JSON" link is sufficient — no UI beyond that.

---

### 7. Settings Page

**Effort: S · Value: low (surface for Stripe) — the route is listed in the spec; currently `/profile` covers identity but not app configuration.**

The `/settings` page is meant for user preferences and billing. With EUR-only MVP, preference settings are minimal, but Stripe integration lives here.

**What to build:**

**`/settings` page** — `src/app/settings/page.tsx`
- Section: **Preferences** — display name edit. **No `updateUser` action exists yet** — [src/actions/profile.ts](../src/actions/profile.ts) only has `changePassword` and `deleteAccount`; add a new `updateProfile` action (auth-guarded, Zod-validated, ownership-scoped) for the name field.
- Section: **Billing** — current plan badge (Free / Pro), "Upgrade to Pro" CTA (Stripe Checkout link), active subscription details if Pro. This section is the Stripe integration surface.
- Link from sidebar bottom utility group (below Accounts, above Help).

---

### 8. Stripe Billing Integration

**Effort: M · Value: low in dev / required for launch — invisible while `isPro = true` for all users in dev; enforces the Free vs Pro gate at launch.**

**What to build:**

**Stripe webhook** — `src/app/api/stripe/webhook/route.ts`
- Handle `checkout.session.completed` → set `User.isPro = true`, `stripeCustomerId`, `stripeSubscriptionId`.
- Handle `customer.subscription.deleted` → set `User.isPro = false`, clear subscription ID.
- Validate `stripe-signature` header on every request.

**Checkout session** — `src/actions/billing.ts`
- `createCheckoutSession(priceId)` — creates a Stripe Checkout session for the authenticated user and returns the URL. Client redirects to it.
- `createPortalSession()` — creates a Stripe Customer Portal session for subscription management.

**UI wiring** — Add "Upgrade" and "Manage subscription" buttons to the `/settings` billing section.

**isPro enforcement** — Once Stripe is live, remove the dev-mode `isPro = true` override and enforce the gate on:
- Reports period selector (lock "Last 12 months" for Free users).
- Any future Pro-only features.

**Environment variables** — Already in `.env.example`: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_MONTHLY_PRICE_ID`, `STRIPE_PRO_YEARLY_PRICE_ID`.

---

### 9. Pre-Launch Polish

**Effort: M · Value: required before ship.**

- **Security review** — Run `/security-review` against the full branch. Verify row-level ownership on every new action and API route from Steps 1–8. Confirm no financial data leaks through URL params.
- **isPro gate enforcement** — Flip all dev `isPro` overrides to real enforcement. Verify Reports gating in a test Free account.
- **Responsive QA** — Walk through every new page (Goals, Reports, Onboarding, Settings) on mobile (< 768px) and tablet (768–1024px). Ensure drawers behave as bottom sheets on mobile.
- **Empty state audit** — Every page must have an active guidance empty state, not a blank screen. Verify against the onboarding spec.
- **Build + test pass** — `npm run test:run` and `npm run build` must be clean.
- **Prisma migrate deploy** — Verify no pending migrations exist on the production branch before launch.

---

## Delivery Sequence

> Section numbers above are **stable feature IDs**, not delivery order. Build in the sequence
> below — ordered by **user-visible value first**, with hard dependencies respected.

| # | Item (ID) | Effort | Visible to user? | Why this slot |
|---|---|---|---|---|
| 1 | Goals CRUD (2) | L | Yes — new page | ✅ **Done.** Biggest missing headline feature; zero unbuilt deps. Insights Strip (#3) overdue-goals pill and Data Export (#5) JSON Goals dump dependencies now satisfied. |
| 2 | Onboarding + currency fixes (1 + 0) | M | Yes — new signups | ✅ **Done.** Affects *every* new user's first run; bundled the Step 0 currency/empty-state fixes (same surfaces). Completes the core capture loop for a brand-new account. Also switched `formatCurrency` to `€` app-wide. |
| 3 | Dashboard Insights Strip (4) | S | Yes — dashboard | ✅ **Done.** Cheap visible win; Goals (1st) is done so the overdue-goals pill is real. Derived in-process from existing dashboard fetchers + one `count` query. |
| 4 | Reports Page (5) | L | Yes — new page | ✅ **Done.** Major analytics module — four hand-rolled SVG charts, URL-driven period selector with the real Free 3-month / Pro 12-month gate, per-chart sufficiency gating, account scoping. Read-only slice; balance-history shipped as the full time-series (no fallback taken). |
| 5 | Data Export (6) | M | Yes — download | ✅ **Done.** Trust feature, all tiers (no `isPro` read). Two streaming GET routes — RFC-4180 CSV (BOM + Excel `sep=,` hint) and a versioned JSON dump (incl. Goals + contributions); `?account=` scoping with the C2 asymmetry; per-user rate limit + unified error contract; ESLint-enforced no-Prisma-in-routes boundary. |
| 6 | Settings Page (7) | S | Yes — new page | Config surface; also the host for Stripe billing. |
| 7 | Stripe Billing (8) | M | No (dev) / launch | Invisible while `isPro = true`; wire after Settings exists. |
| 8 | User Category Management (3) | M | Yes — pickers | **Deferrable power-user feature** — no downstream deps. Pushed near the end; first candidate to cut to post-launch if the schedule tightens. |
| 9 | Pre-Launch Polish (9) | M | — | Security review, isPro enforcement, responsive + empty-state QA. Last. |

**Rationale — fastest path to a usable MVP:** front-load first-user experience (Onboarding up to 2nd) and complete the core budgeting/savings workflow early (Goals 1st, Insights 3rd), while pushing the least critical power-user feature (custom categories) to just before launch where it's safe to defer entirely.

**Hard dependencies that constrain the order:** Insights Strip → Goals; Data Export (full JSON) → Goals; Stripe → Settings. Everything else depends only on already-shipped slices, so the rest of the ordering is a value judgment, not a hard constraint.

> **Note on Step 0:** the currency/empty-state fixes carry low standalone value but trivial effort. They're bundled into Onboarding (2nd) because that slice already audits empty states and touches budget currency — but pull them forward anytime if a Goals/Reports task surfaces the same `preferredCurrency` issue.

> **Workflow reminder:** each item is one `/feature` slice — document it in `docs/current-feature.md`, branch (`feature/<name>`), implement, add Vitest coverage for new `src/actions/**` and `src/lib/**`, run `npm run test:run` + `npm run build`, then commit/merge per `docs/ai-interaction.md`.

---

## What "MVP Complete" Looks Like

A real user (not seeded) can:

1. **Register** and be guided to create their first financial account before reaching the dashboard.
2. **Add transactions** (income, expense, transfer) and see balances update live.
3. **Set budgets** per category and see progress bars update as transactions are added.
4. **Set up recurring templates** and confirm drafts each period.
5. **Track savings goals** with contributions and see progress.
6. **Read the dashboard** for a clear current-state summary: balance, this month's cashflow, budget health, overdue goals, pending drafts.
7. **Analyze spending** on the Reports page with at least 3 months of history (Free) or all time (Pro).
8. **Export their data** as CSV or JSON at any time.
9. **Upgrade to Pro** via Stripe and have the gate enforced immediately.
