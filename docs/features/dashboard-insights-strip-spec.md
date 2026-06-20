# Dashboard Insights Strip — Implementation Spec

> **✅ Shipped (`feature/dashboard-insights-strip`).** Confirmed for build on 2026-06-20 (§0 gate) and
> implemented per this spec. Notable realized details: counts are **derived in-process** from the
> dashboard's existing `getBudgetsData` / `getGoalsSummary` arrays (only the draft count is a new
> `getPendingDraftCount` query — §4); `BUDGET_AT_RISK_THRESHOLD = 0.8` lives in `system-constants.ts`;
> pure helpers (`countAtRiskBudgets`, `buildInsightItems`) in `src/lib/insights.ts`; the strip is a
> lightweight bare-pill **server component** (`lg:my-1 lg:gap-3` for large-monitor breathing room) that
> renders `null` when calm — per-pill KPI cards and a "needs attention" wrapper were considered and
> rejected. 13 new Vitest tests (345 total); `npm run test:run` + `npm run build` pass. See
> `docs/ROADMAP.md` §4 for the full realized-slice note.

> **Goal:** Add the "actionable insights strip" the spec promises on the Dashboard — a compact,
> link-only row surfacing **budgets at risk**, **recurring drafts pending**, and **overdue goals** —
> so the Dashboard delivers on its "actionable" promise without becoming an analytics screen.

This spec implements [ROADMAP.md](../ROADMAP.md) §4 (Delivery Sequence slot #3) and the Dashboard
description in [project-overview.md](../project-overview.md) → Features → Dashboard:
*"…an actionable insights strip (budgets at risk, recurring drafts pending, overdue goals)."*
It follows the patterns in [entity-crud-architecture.md](../entity-crud-architecture.md) and mirrors
the shipped Dashboard data slice.

---

## 0. ⚠ Confirm before building — this was deliberately removed once

[current-feature.md](../current-feature.md) (Dashboard UI Mockup history entry) records:
*"An interim 'needs attention' insights strip was added then removed at user request."*

The strip is still in the spec ([project-overview.md](../project-overview.md) Dashboard section), so it
stays in MVP scope here, and [ROADMAP.md](../ROADMAP.md) §4 flags it explicitly. **But the earlier
removal may reflect a product preference the written spec hasn't caught up to.** Get a yes from the
user before implementing — the rest of this spec assumes that confirmation. If the answer is "leave it
out", close the slice and note the decision in the roadmap rather than shipping it.

> **Record the decision either way (avoid a third round-trip).** Because this is the *second* time the
> strip's existence is in question, do not let the outcome live only in a chat message. After the user
> answers, write the decision into [ROADMAP.md](../ROADMAP.md) §4 — *"confirmed for build on
> &lt;date&gt;"* or *"dropped again, do not reintroduce without product sign-off"*. A future
> contributor reading the spec + roadmap should never have to re-litigate this. The earlier removal
> was lost to a one-line changelog entry; a one-line roadmap note closes that gap.

---

## 1. Why this slice

The Dashboard is the app's "state screen" — *"where am I now"*. Today it shows hero balance, the
metric strip, sparkline, recent transactions, the budgets panel, and the goals widget. What it does
**not** do is proactively flag the three things a user should act on this period. Each of those signals
already exists in the data layer but is scattered:

- **Budgets at risk** — `getBudgetsData` already computes `spent`/`limit` per budget row, but nothing
  aggregates "how many are ≥80% spent."
- **Recurring drafts pending** — `RecurringDraft(status = PENDING)` rows exist and drive `/recurring`,
  but the Dashboard never counts them.
- **Overdue goals** — `getGoalsSummary` already stamps each `GoalRow.overdue` via `isGoalOverdue`, but
  the Dashboard widget only badges individual goals; it never summarizes the count.

This slice is **small** (one fetcher count, a pure helper, one server component) and **visible** — it
turns three existing-but-buried signals into one actionable row. Its only hard dependency (Goals, for
the overdue pill) is already shipped.

---

## 2. Scope

### In scope

- A pure helper module `src/lib/insights.ts`: derive the three counts from already-fetched data +
  build the display items. **Single source of truth** for the at-risk rule and the pill copy.
- One new lean DB fetcher `getPendingDraftCount(userId)` in `src/lib/db/recurring.ts`.
- A `DashboardInsights` type + `InsightItem` display type.
- One new constant `BUDGET_AT_RISK_THRESHOLD = 0.8` in `src/lib/system-constants.ts`.
- A server component `src/components/dashboard/insights-strip.tsx` rendering the pill row.
- Wiring in `src/app/dashboard/page.tsx`: fetch the draft count, build insights, render the strip
  **below the metric strip, above the content columns**.
- Vitest unit tests for the pure helpers.

### Out of scope (explicit)

- **No new entity, no schema change, no mutation.** This is a read/display slice only.
- **No per-account scoping beyond what the Dashboard already does.** The Dashboard fetchers currently
  aggregate all active accounts (the page does not read `?account=`); the strip follows suit. If/when
  the Dashboard honors the global account filter, the strip inherits it for free because it derives
  from the same arrays. Do **not** add independent account filtering here.
- **No dismiss / snooze / "mark as seen" state.** The strip is purely derived; it disappears when the
  underlying counts hit zero, and reappears when they don't. No persistence.
- **No notifications of any kind** (email/push are post-MVP — overview "Out of Scope").
- **No new analytics.** The strip shows counts and links; trends/breakdowns belong to Reports (§5).
- **No re-introduction of the removed generic "needs attention" card** beyond these three defined
  signals. Three pills, fixed set.

---

## 3. The three signals — exact definitions

> **Terminology (used consistently throughout):** a **signal** is the domain concept (a budget at
> risk, a pending draft, an overdue goal); an **`InsightItem`** is its *rendered representation*
> (resolved copy + link + tone). Counts are computed over signals; `buildInsightItems` turns counts
> into `InsightItem`s.

| Signal | Definition | Source of truth |
|---|---|---|
| **Budgets at risk** | Count of current-month, non-archived budgets where `budgetFraction(spent, limit) >= BUDGET_AT_RISK_THRESHOLD` (0.8). Includes over-budget (≥100%) rows. | Derived from the `BudgetRow[]` the page already fetches via `getBudgetsData`. |
| **Recurring drafts pending** | Count of `RecurringDraft` with `status = PENDING` belonging to the user's templates. | New `getPendingDraftCount(userId)` (count query). |
| **Overdue goals** | Count of active goals where `isGoalOverdue(...)` is true (`targetDate` strictly before today, `!isCompleted`, `currentAmount < targetAmount`). | Derived from the `GoalRow[]` the page already fetches via `getGoalsSummary` — each row already carries `overdue`. |

> **At-risk boundary — resolved to `>= 0.8`.** [project-overview.md](../project-overview.md) says
> *"exceeds 80% mid-period"*; [ROADMAP.md](../ROADMAP.md) §4 writes `spent / amount > 0.80`. This spec
> uses **`>=`** (≥ 80%) for consistency with the existing `budgetState` thresholds in
> [src/lib/budget.ts](../../src/lib/budget.ts), which are all `>=` comparisons (`warning` at `>= 0.6`,
> `danger` at `>= 1.0`). A budget sitting exactly at 80% spent is "at risk." This is a deliberate,
> documented choice, not an oversight.
>
> **The 80% threshold is a proxy for risk, not a temporal correctness model.** The product's
> *"mid-period"* wording is **not** implemented — there is no elapsed-days awareness; a budget at 80%
> on day 1 and on day 28 read identically. Time-weighting is explicitly deferred (§15, §15.1). Do not
> read "mid-period" as already satisfied.

---

## 4. Architectural decision — derive from already-fetched data, don't re-query

[ROADMAP.md](../ROADMAP.md) §4 sketches a single `getInsights(userId, month, year)` fetcher that
recomputes at-risk budgets, pending drafts, and overdue goals. **This spec deviates** for efficiency
and single-source-of-truth reasons:

The Dashboard page **already fetches** the budget rows (`getBudgetsData`) and the goal rows
(`getGoalsSummary`) in its `Promise.all`. A standalone `getInsights` would re-run those same budget
and goal queries — duplicating work and, worse, risking a second, drifting copy of the at-risk/overdue
logic. The repo's established ethos is the opposite (see the Goals slice: *"don't fork the query"*, one
overdue definition in `src/lib/goals.ts`).

**Therefore:**
- At-risk budgets and overdue goals are **derived in-process** from the arrays the page already has,
  via pure helpers — **zero extra queries**.
- Only the pending-draft count needs new data (the Dashboard doesn't fetch drafts today), so add a
  single lightweight `count` query.

This keeps the at-risk rule defined exactly once (`countAtRiskBudgets` reusing `budgetFraction`) and
the overdue rule defined exactly once (`isGoalOverdue`, already consumed by `getGoalsSummary`).

---

## 5. File plan

| Layer | File | Action |
|---|---|---|
| Constants (system) | `src/lib/system-constants.ts` | **modify** — add `BUDGET_AT_RISK_THRESHOLD = 0.8` |
| Types | `src/types/dashboard.ts` | **modify** — add `DashboardInsights`, `InsightItem` |
| Pure helpers | `src/lib/insights.ts` | **create** — `countAtRiskBudgets`, `buildInsightItems` |
| DB reads | `src/lib/db/recurring.ts` | **modify** — add `getPendingDraftCount(userId)` |
| Component | `src/components/dashboard/insights-strip.tsx` | **create** — server component, pill row |
| Page | `src/app/dashboard/page.tsx` | **modify** — fetch count, build insights, render strip |
| Tests | `test/lib/insights.test.ts` | **create** |

No new route, no nav change, no migration, no action.

---

## 6. Constant (`src/lib/system-constants.ts`)

```ts
/**
 * Fraction of a budget's limit spent at or above which it is flagged "at risk"
 * on the Dashboard insights strip. Distinct from BUDGET_THRESHOLDS (the
 * green/amber/red progress-bar states): a budget can be "at risk" (>= 80%)
 * while still in the amber band (60–<100%). Includes over-budget rows.
 */
export const BUDGET_AT_RISK_THRESHOLD = 0.8;
```

> Lives in `system-constants.ts` (a system-level threshold, alongside `BUDGET_THRESHOLDS`), per the
> constants-split rule — not in `constants.ts`.

---

## 7. Types (`src/types/dashboard.ts`)

```ts
/** The three actionable counts surfaced on the Dashboard insights strip. */
export interface DashboardInsights {
  /** Current-month budgets at or over BUDGET_AT_RISK_THRESHOLD of their limit. */
  atRiskBudgetCount: number;
  /** PENDING recurring drafts awaiting confirmation. */
  pendingDraftCount: number;
  /** Active goals past their target date and still short of target. */
  overdueGoalCount: number;
}

/** A single rendered pill in the strip (already resolved to copy + link). */
export interface InsightItem {
  /** Stable key / signal id. */
  key: "budgets" | "drafts" | "goals";
  /** Display copy, e.g. "3 budgets at risk". */
  label: string;
  /** Destination page for the signal. */
  href: string;
  /** Semantic tone driving the pill color. */
  tone: "warning" | "info";
}
```

---

## 8. Pure helpers (`src/lib/insights.ts`)

```ts
import { budgetFraction } from "@/lib/budget";
import { BUDGET_AT_RISK_THRESHOLD } from "@/lib/system-constants";
import type { DashboardInsights, InsightItem } from "@/types/dashboard";

/** Count budgets at or above the at-risk threshold (includes over-budget). */
export function countAtRiskBudgets(
  rows: ReadonlyArray<{ spent: number; limit: number }>
): number {
  return rows.filter(
    (r) => budgetFraction(r.spent, r.limit) >= BUDGET_AT_RISK_THRESHOLD
  ).length;
}

/**
 * Build the ordered, non-empty pill list from the three counts. A count of 0
 * produces no pill — so the strip renders nothing when everything is calm
 * (the component returns null on an empty array). Order is fixed:
 * budgets → drafts → goals.
 */
export function buildInsightItems(insights: DashboardInsights): InsightItem[] {
  const items: InsightItem[] = [];

  if (insights.atRiskBudgetCount > 0) {
    items.push({
      key: "budgets",
      label: `${insights.atRiskBudgetCount} ${plural(insights.atRiskBudgetCount, "budget")} at risk`,
      href: "/budgets",
      tone: "warning",
    });
  }
  if (insights.pendingDraftCount > 0) {
    items.push({
      key: "drafts",
      label: `${insights.pendingDraftCount} recurring ${plural(insights.pendingDraftCount, "draft")} pending`,
      href: "/recurring",
      tone: "info",
    });
  }
  if (insights.overdueGoalCount > 0) {
    items.push({
      key: "goals",
      label: `${insights.overdueGoalCount} overdue ${plural(insights.overdueGoalCount, "goal")}`,
      href: "/goals",
      tone: "warning",
    });
  }

  return items;
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}
```

> **Why the copy lives in a pure helper, not the component.** Pluralization and label formatting are
> easy to get subtly wrong ("1 budgets at risk") and trivial to unit-test in isolation. Keeping it out
> of JSX means the component is a dumb renderer and the wording is covered by `test/lib/insights.test.ts`.

Overdue-goal counting does **not** need a helper — the page counts the already-materialized boolean:
`goals.filter((g) => g.overdue).length`, inline.

> **Standardized philosophy (so this isn't read as inconsistency):** the UI **may** count directly
> from already-materialized boolean fields without a helper abstraction; it **may not** re-derive the
> underlying *rule*. `GoalRow.overdue` is already computed by `isGoalOverdue`
> ([src/lib/goals.ts](../../src/lib/goals.ts)) at fetch time, so filtering it is not a second
> definition — it's reading a settled flag. `countAtRiskBudgets` *is* a helper precisely because the
> at-risk **rule** (the threshold comparison) is not pre-materialized on the row. Boolean already on
> the row → inline filter is fine; rule still needs applying → helper.

---

## 9. DB fetcher (`src/lib/db/recurring.ts`)

```ts
/** Count of the user's PENDING recurring drafts (for the dashboard insights strip). */
export async function getPendingDraftCount(userId: string): Promise<number> {
  return prisma.recurringDraft.count({
    where: { status: "PENDING", recurringTemplate: { userId } },
  });
}
```

> A `count`, not a `findMany` — the strip needs only the number. This mirrors the `where` clause of the
> existing `getPendingDrafts` (same ownership scoping through `recurringTemplate: { userId }`) but skips
> the joins. The Dashboard does **not** call `generatePendingDrafts` before counting — generating
> drafts is a `/recurring` concern; the Dashboard only reports. See **§12.1 Data freshness &
> revalidation contract** for the (accepted) staleness this implies. Do not add draft generation to the
> Dashboard render path.

---

## 10. Component (`src/components/dashboard/insights-strip.tsx`)

A **server component** (no interactivity — just `next/link`s; no `"use client"`).

```tsx
import Link from "next/link";
import type { InsightItem } from "@/types/dashboard";

export function InsightsStrip({ items }: { items: InsightItem[] }) {
  if (items.length === 0) return null; // calm state: render nothing

  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          className={/* pill styling keyed on item.tone */}
        >
          {item.label} →
        </Link>
      ))}
    </div>
  );
}
```

**Visual rules (Design System):**
- Pills sit **below the metric strip, above the content columns**. Horizontal, wrap on narrow widths.
- `tone: "warning"` → amber (`text-warning` on `bg-warning/15`), matching the existing overdue badge in
  [goals-widget.tsx](../../src/components/dashboard/goals-widget.tsx). `tone: "info"` → blue
  (`text-info` on `bg-info/15`), matching the "View all →" link tone.
- Each pill is a link with the trailing `→` affordance, hover opacity transition (match existing links).
- Sentence case, no decoration beyond the subtle tinted background (Design System: no gradients/shadows).
- **Renders nothing when `items` is empty** — no empty container, no "all clear" message
  (Never UI without backing function; an empty strip is visual noise).

> Keep the pill class logic out of inline `style`; use Tailwind tone classes selected from a small
> `const TONE_CLASS: Record<InsightItem["tone"], string>` lookup inside the component
> (no magic class strings scattered in JSX).

> **Guardrail — interactivity flips the component, never the data model.** The server-component choice
> assumes the strip stays display-only (links, no client state). Given the feature's history (the strip
> was removed once), a future pivot to interactivity — dismiss, snooze, animation — is a realistic
> risk. If that happens, `InsightsStrip` becomes a `"use client"` component, but its prop contract
> (`items: InsightItem[]`) and the pure builders in `src/lib/insights.ts` are **unchanged**. Do not let
> added interactivity leak data-shaping into the component.

> **UX note — an absent strip is a *positive* state, not a missing feature.** When all counts are zero
> the strip renders nothing (§12). That is intentional: silence means "nothing needs action," not a
> bug or an unfinished panel. Flagged here because if a future reader misreads the empty calm-state as
> a defect, this is where the confusion originates — it is by design.

---

## 11. Page wiring (`src/app/dashboard/page.tsx`)

Add the draft-count fetcher to the existing `Promise.all`, then build the insights from data already in
hand and render the strip inside the `accounts.length > 0` branch.

```ts
import { getPendingDraftCount } from "@/lib/db/recurring";
import { countAtRiskBudgets, buildInsightItems } from "@/lib/insights";
import { InsightsStrip } from "@/components/dashboard/insights-strip";

// inside DashboardPage, extend the Promise.all:
const [
  summary,
  balanceTrend,
  { rows: transactions, count },
  { rows: budgets, summary: budgetSummary },
  goals,
  accounts,
  pendingDraftCount,
] = await Promise.all([
  getDashboardSummary(userId, month, year),
  getBalanceTrend(userId, month, year),
  getRecentTransactions(userId, 20),
  getBudgetsData(userId, month, year),
  getGoalsSummary(userId),
  getUserAccounts(userId),
  getPendingDraftCount(userId),
]);

const insightItems = buildInsightItems({
  atRiskBudgetCount: countAtRiskBudgets(budgets),
  pendingDraftCount,
  overdueGoalCount: goals.filter((g) => g.overdue).length,
});
```

Render between `<MetricStrip />` and the content-columns grid:

```tsx
<MetricStrip summary={summary} />
<InsightsStrip items={insightItems} />
<div className="grid grid-cols-1 gap-2 lg:grid-cols-[1.4fr_1fr]">
  …
</div>
```

> The strip lives only inside the `accounts.length === 0 ? <DashboardZeroState /> : (…)` non-zero
> branch — a user with no accounts has nothing to be at risk on, and the zero-state card owns that
> screen.
>
> **Principle — gate the render, never the fetch: all Dashboard fetchers stay parallel in `Promise.all`
> regardless of render gating.** `getPendingDraftCount` stays in the batch even though a zero-account
> user can't see the strip; short-circuiting it would mean awaiting `getUserAccounts` first and
> serializing the rest — trading latency on every load to skip one `COUNT(*)` on a rare fallback path.

---

## 12. Edge cases & rules

- **All counts zero → strip renders nothing.** `buildInsightItems` returns `[]`; the component returns
  `null`. No empty container, no margin gap left behind (the strip is a sibling that simply isn't there).
- **At-risk includes over-budget.** A budget at 120% is "at risk" (it's `>= 0.8`). It is **not** broken
  out as a separate "over budget" pill in MVP — one "at risk" bucket. (Splitting over-budget into its
  own danger pill is a possible later refinement, not now.)
- **Zero-limit budgets are never at risk.** `budgetFraction` returns `0` when `limit <= 0`, so they
  can't trip the threshold — correct (a €0 budget has no ceiling to breach).
- **Overdue uses the shared rule.** The count comes from `GoalRow.overdue`, which `getGoalsSummary`
  stamps via `isGoalOverdue` (floors both sides to UTC midnight, strict `<`, excludes completed and
  fully-funded). Never re-implement overdue in the insights layer.
- **Account scope.** Counts are all-active-accounts, matching the rest of the Dashboard today. Archived
  accounts are already excluded by the upstream fetchers (`isArchived: false`).
- **Currency.** EUR-only; the strip shows counts, no currency formatting — `formatCurrency` is not used
  here, so no currency concern.
- **No `Decimal` crosses the boundary.** The strip consumes only numbers (counts) and pre-built
  `InsightItem`s; nothing Prisma-`Decimal` reaches the client component.

### 12.1 Data freshness & revalidation contract (normative)

This is the **single, normative definition** of the strip's freshness behavior. §9 and §15 reference
it and must not restate the reasoning. Each item is tagged by who owns it.

- **[Pre-existing guarantee]** Every recurring mutation already revalidates `/dashboard`:
  `revalidateRecurringViews()` in [src/actions/recurring.ts](../../src/actions/recurring.ts) calls
  `revalidatePath("/dashboard")` (its comment already reads *"dashboard shows the pending-draft
  count"*), and `confirmDraft` revalidates `/dashboard` via `revalidateTransactionViews()`. So
  confirming/dismissing/pausing/deleting drafts or templates refreshes the strip count immediately.
- **[Required by this feature] — none.** This slice adds **no** revalidation wiring; the path above
  was provisioned ahead of the feature. Budget-at-risk and overdue counts are derived in-process from
  the same `getBudgetsData` / `getGoalsSummary` arrays the page already renders on a `force-dynamic`
  page — no separate cache to drift, nothing to revalidate.
- **[Future contract — must not break]** **All recurring domain write actions MUST include
  `/dashboard` in their revalidation targets.** This is currently true by convention
  (`revalidateRecurringViews` / `revalidateTransactionViews` both list it); stating it as a rule turns
  a convention into a contract so a new action can't silently drop it and leave the count stale. When a
  recurring action is added, this rule is a review checklist item.
- **[System invariant]** The strip is only as fresh as the **slowest upstream fetch** in the
  Dashboard's `Promise.all`. The three counts are independent snapshots (budgets, goals, drafts) read
  in one parallel batch on a `force-dynamic` render, so they are mutually consistent *per render* but
  each is only as current as its own fetch. Acceptable at MVP — a single page render is one coherent
  point in time; there is no partial-refresh path that could desync them mid-view.
- **[Accepted limitation]** The draft count can briefly **under-report**: the Dashboard never runs
  `generatePendingDrafts` (§9), so a template that *becomes* due since the last `/recurring` visit (or
  cron run) isn't counted until its draft is materialized elsewhere. The strip is a *nudge*, not the
  authority — the canonical list is `/recurring`. The real fix is the post-MVP recurring-draft
  generation **cron endpoint** noted in [project-overview.md](../project-overview.md)'s API Routes
  note; once it runs on a schedule the count is fresh app-wide. Tracked there, not here.

---

## 13. Testing (`test/lib/insights.test.ts`, Vitest)

Pure helpers only — no DB, no auth (the component is out of test scope per coding standards; the
fetcher is a thin `count` pass-through). Cover:

- **`countAtRiskBudgets`**:
  - empty array → 0;
  - a row exactly at 80% (`spent/limit === 0.8`) **counts** (boundary, `>=`);
  - a row at 79% does not count;
  - an over-budget row (e.g. 120%) counts;
  - a zero-limit row never counts;
  - a mixed array returns the correct total;
  - **non-finite / malformed inputs are ignored, not counted** (e.g. `spent: NaN` or a missing
    `limit`): `budgetFraction` yields `NaN`/`0`, and `NaN >= 0.8` is `false`, so the row is skipped
    rather than throwing or false-positiving. Guards the helper against bad seeds / partial migrations.
- **`buildInsightItems`**:
  - all-zero input → `[]`;
  - singular vs plural copy (`1 budget at risk` vs `2 budgets at risk`, `1 recurring draft pending`
    vs `3 recurring drafts pending`, `1 overdue goal` vs `2 overdue goals`);
  - order is always budgets → drafts → goals;
  - only non-zero signals produce pills (e.g. drafts=0 omits the drafts pill);
  - each pill has the correct `href` (`/budgets`, `/recurring`, `/goals`) and `tone`.

Run `npm run test:run` and `npm run build` before commit (per
[ai-interaction.md](../ai-interaction.md) workflow).

---

## 14. Implementation order

1. Constant (`BUDGET_AT_RISK_THRESHOLD`) + types (`DashboardInsights`, `InsightItem`).
2. `src/lib/insights.ts` pure helpers + `test/lib/insights.test.ts` (TDD-friendly; no deps beyond
   `budgetFraction`).
3. `getPendingDraftCount` in `src/lib/db/recurring.ts`.
4. `InsightsStrip` server component.
5. Wire `src/app/dashboard/page.tsx` (extend `Promise.all`, build items, render below the metric strip).
6. `npm run test:run` + `npm run build`; manual browser pass:
   - seed/create a budget pushed ≥80% spent → "budgets at risk" pill appears, links to `/budgets`;
   - leave a recurring template due so a PENDING draft exists → "recurring drafts pending" pill;
   - create a goal with a past target date below target → "overdue goals" pill, links to `/goals`;
   - resolve all three (raise budget, confirm/dismiss draft, fund/complete goal) → strip disappears.

---

## 15. Decisions

### Resolved (baked into this spec)

- **Confirm-before-build gate (§0).** The strip was removed once at user request; ship only after the
  user re-confirms they want it.
- **Derive from already-fetched data, not a monolithic `getInsights`** (§4) — reuses the page's
  existing budget/goal arrays, adds only a single `count` query for drafts. Avoids re-querying and
  keeps the at-risk/overdue rules defined once.
- **At-risk threshold = `>= 0.8`** (§3) — `>=` for consistency with `budgetState`; includes
  over-budget rows in the single "at risk" bucket.
- **Three fixed signals, fixed order** (budgets → drafts → goals) for MVP. No generic "needs
  attention" card. This is a current-state invariant, not a ceiling — see §15.1 for how signals extend.
- **Strip renders nothing when calm** — empty `items` → `null`, no placeholder.
- **Server component** — links only, no client JS.
- **No dismiss/snooze/persistence, no notifications, no per-account scoping** beyond the Dashboard's
  current all-accounts behavior (§2).
- **Dashboard does not generate drafts** — the count is point-in-time (§9, §12.1).
- **Draft-count revalidation is already provisioned** — every recurring mutation revalidates
  `/dashboard` today (§12.1); this slice adds no new revalidation wiring.
- **Overdue count reuses `GoalRow.overdue`** — never re-derived (§8, §12.1).

### Still open (deferred — not built in this slice)

These are intentionally out of MVP scope; listed so a future contributor sees them as known tradeoffs,
not oversights.

- **Over-budget severity split.** Folding 120%-spent and 80%-spent into one "at risk" bucket keeps MVP
  simple but flattens urgency — a blown budget reads the same as an approaching one. A later version
  could promote `>= 100%` budgets to their own danger-tone pill ("N budgets over"). Revisit only if
  users ask to distinguish "approaching" from "blown." (Shape rules: §15.1.)
- **Time-of-month–aware risk.** The current rule treats 80% spent on day 1 and 80% on day 29
  identically, whereas the product wording is *"exceeds 80% **mid-period**"*. A more meaningful signal
  would weight spend against elapsed days (e.g. flag when `spent/limit` outpaces `daysElapsed/daysInMonth`).
  Deferred: it needs a calibrated heuristic and risks false positives early in the month; the flat 80%
  threshold is the defensible MVP. (Rule-stability requirement: §15.1.)
- **Draft-count staleness.** Governed by §12.1 (the only normative freshness definition) — not restated.
- **Localization.** Label copy is centralized and testable (`buildInsightItems`) but English-only with
  embedded strings and ad-hoc pluralization. If i18n is ever on the table, restructure the helper to
  return translation **keys + counts** (e.g. `{ key: "insights.budgetsAtRisk", count }`) and let the
  view layer resolve plural forms via the i18n library's plural rules, rather than baking English
  singular/plural into `src/lib/insights.ts`. Not now — there is no i18n layer yet, and introducing one
  for three pills would be premature.

### 15.1 Extensibility contract (one rule, applies to all future signals)

> **Insight signals may evolve, but the base counting functions stay stable and composable.**

Three corollaries, so future work extends without rewriting:

1. **Signals are additive, not a fixed ceiling.** The "three pills, fixed set" line in §2 is a
   *current-state* invariant, not a hard limit. The model — an ordered `InsightItem[]` built from
   independent `if (count > 0)` pushes — accepts a new signal by: (a) a new `key` literal, (b) one more
   conditional push in `buildInsightItems` (stable order, zero-count omitted), (c) a `tone`. Existing
   pills are not touched.
2. **Base counters never mutate in place.** `countAtRiskBudgets`'s contract is "count rows at/over a
   flat fraction"; tests and callers depend on that. A richer rule (e.g. time-of-month weighting)
   arrives as a *new* composable layer (`budgetRiskScore(row, now)`, or `countTimeWeightedAtRisk`) that
   the counter may call — not by redefining the existing function. Logic stays in `src/lib/insights.ts`.
3. **Adding a `tone` is a UI-only change, not a logic change.** `tone` is the designed extension point.
   The union is deliberately `"warning" | "info"` today (no speculative `"danger"` — YAGNI / "decisions
   over options"). When the over-budget split lands, widen the union to `"danger"` and add the matching
   `TONE_CLASS` entry **in the same change**; no counting/build logic changes.
4. **Order is defined by the `buildInsightItems` push sequence — and that is the *only* source of UI
   priority.** Pills render in array order (budgets → drafts → goals). The component must not re-sort
   (by severity, count, tone, or anything else). To change priority, reorder the pushes in
   `buildInsightItems` — one place, covered by the order test (§13). This keeps "what's most important"
   a single, testable decision rather than an emergent property of render-time sorting.
