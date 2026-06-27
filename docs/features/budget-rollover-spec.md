# Budget Rollover Spec

> Let a budget **carry its remainder** — unspent **or** overspent — into the next
> month instead of resetting clean. Opt-in per budget. The carried amount is
> **derived on read** by chaining back through prior months — no stored snapshot,
> no scheduled job. Mostly a calc + a per-budget toggle + a progress-bar label
> tweak, exactly as the roadmap scoped it.

_Status: not started • Feature: Budget Rollover • POST-MVP §7 • Delivery slot 5 • Last updated: 2026-06-27_

Authoritative sources: `docs/POST-MVP-ROADMAP.md` §7 + Delivery Sequence row 5;
`docs/project-overview.md` (Budgets feature, Architecture "no rollover in MVP");
`docs/features/budgets-crud-spec.md` (the shipped read/write stack this extends).

This is a **superset** of Budgets CRUD: every existing rule (period immutability,
revive-or-create, archive+undo, EUR-only, derived spend, `force-dynamic` page)
still holds. Rollover adds one column, one pure math module, a read-time carry
resolution shared by `/budgets` + the dashboard, and a toggle in the drawer.

---

## 1. Goal

A budget owner can mark any budget **"Roll over remainder"**. When enabled, that
budget's **effective limit** for the month = `base limit + carried remainder from
the previous month`, where the carried remainder is the previous month's
(`effective limit − spent`). The remainder can be:

- **Positive** (underspent last month) → more room this month.
- **Negative** (overspent last month) → less room this month.

Everything visible — the progress bar state (green / amber / red), the remaining
summary, the dashboard panel, and the "at-risk" insight count — uses the
**effective** limit. The base limit is still shown so the carry is legible
(`€400 + €100 rolled over`).

### Non-goals (explicit)

- **No stored carry, no cron.** Carry is derived at query time by walking back
  through prior months (see §4). At MVP volumes (≤ 10K tx/user) and a bounded
  look-back this is cheap and removes a whole class of snapshot-drift bugs. The
  store-at-month-rollover alternative is rejected in §12.
- **No user-level default toggle in v1.** Rollover is a **per-budget** boolean
  (decision §12). A `User`-level "default new budgets to rollover" is a possible
  follow-up, not this slice.
- **No cross-currency conversion.** Carry sums magnitudes in the budget's stamped
  `currency` (EUR-only today) — same stance as the rest of Budgets.
- **No rollover for archived budgets.** Archived rows are out of every query, so
  they neither receive nor emit carry.
- **Not a Pro gate.** Rollover is core budgeting, free for everyone (matches the
  roadmap's "Pro earns through depth, not gates on the basics").

---

## 2. What already exists (reuse, don't rebuild)

| Asset | Location | Use |
|---|---|---|
| Budget read + spend derivation | `getBudgets`, `getBudgetFormData`, `getBudgetForEdit` in `src/lib/db/budgets.ts` | Extend `getBudgets` to attach carry; the others are unchanged |
| Dashboard budget read | `getBudgetsData` in `src/lib/db/dashboard.ts` | Must reuse the same carry resolution so the panel agrees with `/budgets` |
| Period helpers | `monthBounds`, `currentPeriod`, `parseMonth/Year` in `src/lib/budget-period.ts` | Reuse; add a `previousPeriod` helper |
| Progress helpers | `budgetState/Percent/Color/Fraction` in `src/lib/budget.ts` | Reuse via new `budgetProgressWithCarry` wrapper (§4.4) that owns the effective limit + the limit ≤ 0 edge |
| Row mapper + summary | `mapBudgetRow`, `summarizeBudgets` in `src/lib/budget.ts` | Extend to carry `rollover` + `carriedAmount` through; summary totals use effective |
| Mutations | `createBudget`, `updateBudget`, `seedPresetBudgets` in `src/actions/budgets.ts` | Thread `rollover` through create/update; preset stays `rollover: false` |
| Validation | `createBudgetSchema`, `updateBudgetSchema` in `src/lib/validations/budget.ts` | Add `rollover: z.boolean()` to both |
| Form drawer | `src/components/budgets/budget-form-drawer.tsx` | Add the toggle + helper copy; load `rollover` on edit pre-fill |
| List row | `src/components/budgets/budget-list.tsx` | Show effective limit + a "rolled over" carry line/chip |
| Help content | `budgets` section in `src/lib/help/content.ts` | **Flip the "No rollover" item** to describe the opt-in carry (maintenance contract, §13) |

---

## 3. Data model change (the only schema touch)

Add **one nullable-defaulted boolean** to `Budget` — `prisma migrate dev`, never
`db push` (coding-standards). Run on the **development** Neon branch only;
production is a launch-day deploy step (`prisma migrate deploy`).

```prisma
model Budget {
  id         String   @id @default(cuid())
  amount     Decimal  @db.Decimal(12, 2)   // the BASE ceiling (unchanged)
  currency   String
  month      Int      // 1–12
  year       Int
  rollover   Boolean  @default(false)      // NEW — opt-in carry of the remainder
  isArchived Boolean  @default(false)
  // … unchanged …
  @@unique([userId, categoryId, month, year])
  @@index([userId])
  @@index([userId, year, month])
}
```

- Migration name: `add_budget_rollover`. Pure additive column with a safe
  default — existing rows backfill to `false` (today's behavior preserved).
- `amount` keeps meaning the **base** limit. The effective limit is **never**
  stored — it is `amount + carriedAmount`, computed on read.
- No new index needed: carry resolution queries by `(userId, categoryId, year,
  month)` runs of budgets, already covered by `@@index([userId, year, month])`
  plus the unique key.

> **Update the schema mirror in `docs/project-overview.md`** (the `Budget` block)
> and any `entity-types` reference in the same PR so the doc schema doesn't drift.

---

## 4. The rollover math (the core — pure + testable)

A new pure module `src/lib/rollover.ts` (no Prisma, no I/O — the unit-test
workhorse). The DB layer's only job is to assemble the inputs; the math lives
here.

### 4.1 Definitions

For a category's budget in month *m*:

- `baseLimit(m)` = `Budget.amount`.
- `spent(m)` = abs(Σ EXPENSE, non-deleted, in `[monthStart(m), nextMonthStart(m))`).
  *(Identical to today's spend derivation.)*
- `carryIn(m)` = remainder rolled in from *m−1* (signed; 0 if none).
- `effectiveLimit(m)` = `baseLimit(m) + carryIn(m)`.
- `remainder(m)` = `effectiveLimit(m) − spent(m)` (signed; what *m* rolls forward).

### 4.2 The chain rule (decision — stated once, predictable)

> **Carry accumulates across a maximal run of consecutive calendar months that
> each have a rollover-enabled budget for the category.** The first month of a
> run has `carryIn = 0`. A month with **no budget** for the category, or a budget
> with `rollover = false`, **ends the run** — the next rollover-enabled month
> starts fresh from its base limit.

Equivalently: carry flows from *m−1* to *m* **only when both** months have a
rollover-enabled budget for that category and they are calendar-adjacent.

This makes each month locally predictable: a budget's effective limit depends
only on the unbroken rollover run immediately before it — not on the entire
history, not on archived rows, not on months the user never budgeted.

### 4.3 The pure functions

```ts
// src/lib/rollover.ts

/** One month in a category's consecutive rollover run, oldest → newest. */
export interface RolloverPoint {
  baseLimit: number;
  spent: number;
}

/**
 * Carry-in for a target month, given the consecutive rollover-enabled run
 * IMMEDIATELY preceding it (oldest → newest; already trimmed by the caller at
 * the first gap / rollover-off month). Returns 0 for an empty run.
 * Folds the effective remainder forward: each month rolls (base + carry − spent).
 */
export function rolloverCarryIn(priorRun: ReadonlyArray<RolloverPoint>): number {
  let carry = 0;
  for (const p of priorRun) carry = p.baseLimit + carry - p.spent;
  return carry;
}

/** Effective ceiling = base + carried remainder (signed). */
export function effectiveLimit(baseLimit: number, carriedAmount: number): number {
  return baseLimit + carriedAmount;
}
```

The caller only invokes `rolloverCarryIn` for a target whose own budget has
`rollover = true`; a rollover-off target always has `carriedAmount = 0`.

**Determinism & precision (must hold):**
- **Order-independent inputs.** `rolloverCarryIn` folds `priorRun` in array order,
  so the caller **must** hand it the run sorted **chronologically (oldest →
  newest)** — never raw DB-return order, which Prisma does not guarantee without an
  explicit `orderBy`. The fold is associative for the running sum, but sorting is
  still required so the run is *trimmed* at the correct gap boundary (§7.2) and so
  results are reproducible. Assemble the run sorted; a test feeds it shuffled and
  asserts the same result after the caller's sort step.
- **Round at the boundary, not mid-fold.** Each `RolloverPoint.{baseLimit, spent}`
  is already a 2-dp money magnitude (`Decimal(12,2)` → `Number`). The fold stays in
  plain JS numbers; round the **final** `carriedAmount` to 2 dp (reuse the actions'
  `round2`, or a shared `roundMoney` in `src/lib/budget.ts`) **once**, where the DB
  layer attaches it to the row — so a long chain can't accrue float drift like
  `99.99999999`. Do not round each intermediate step (needless and can bias a long
  chain); round only the emitted carry.

### 4.4 The limit ≤ 0 guard (overspent carry) — one shared helper

A large negative carry can drive `effectiveLimit ≤ 0`. `budgetFraction` returns
`0` when `limit <= 0`, which would mis-render a definitionally-over budget as 0% /
green. **Decision:** treat `effectiveLimit <= 0` (carried overspend) as **fully
over** — `state = "danger"`, `percent = 100`.

**Centralize the edge in one helper, not in UI guards.** Add a single
`budgetProgressWithCarry(spent, baseLimit, carriedAmount)` to `src/lib/budget.ts`
that computes the effective limit and returns the canonical
`{ effectiveLimit, state, percent }` triple — applying the ≤ 0 rule internally.
**Every** consumer (the `/budgets` row, the dashboard `BudgetsPanel` row, and the
at-risk insight count via the effective limit) calls this one function, so the
edge-case logic can never drift between surfaces. The thin existing
`budgetState/Percent` helpers stay for non-carry callers, but rollover-aware
surfaces go through `budgetProgressWithCarry`.

```ts
export interface BudgetProgress {
  effectiveLimit: number;
  state: BudgetState;   // "success" | "warning" | "danger"
  percent: number;      // 0–100, clamped
}

/** Carry-aware progress; effectiveLimit <= 0 => fully over (danger / 100). */
export function budgetProgressWithCarry(
  spent: number,
  baseLimit: number,
  carriedAmount: number
): BudgetProgress {
  const eff = effectiveLimit(baseLimit, carriedAmount);
  if (eff <= 0) return { effectiveLimit: eff, state: "danger", percent: 100 };
  return { effectiveLimit: eff, state: budgetState(spent, eff), percent: budgetPercent(spent, eff) };
}
```

---

## 5. Files to create / touch

| Layer | File | Action |
|---|---|---|
| Schema | `prisma/schema.prisma` | **touch** — add `rollover Boolean @default(false)` to `Budget` |
| Migration | `prisma/migrations/<ts>_add_budget_rollover/` | **new** — `prisma migrate dev --name add_budget_rollover` (dev branch) |
| Pure math | `src/lib/rollover.ts` | **new** — `rolloverCarryIn`, `effectiveLimit`, `RolloverPoint` |
| Period helper | `src/lib/budget-period.ts` | **touch** — add `previousPeriod(month, year)` |
| Read fetcher | `src/lib/db/budgets.ts` | **touch** — `getBudgets` attaches carry; new internal `resolveRolloverCarry`; `getBudgetForEdit` returns `rollover` |
| Dashboard read | `src/lib/db/dashboard.ts` | **touch** — `getBudgetsData` reuses `resolveRolloverCarry` so the panel agrees |
| Row mapper / summary | `src/lib/budget.ts` | **touch** — `mapBudgetRow` carries `rollover`/`carriedAmount`; `summarizeBudgets` totals use effective limits; new `formatCarry` display helper (§9.3) |
| Types | `src/types/dashboard.ts` | **touch** — add `rollover: boolean` + `carriedAmount: number` to `BudgetRow`, `BudgetListRow`, `BudgetEditable` |
| Validation | `src/lib/validations/budget.ts` | **touch** — add `rollover: z.boolean()` to create + update schemas |
| Mutations | `src/actions/budgets.ts` | **touch** — thread `rollover` through `createBudget` (upsert update + create) and `updateBudget`; preset unchanged (`rollover: false`) |
| Form drawer | `src/components/budgets/budget-form-drawer.tsx` | **touch** — rollover toggle + helper copy; pre-fill `rollover` on edit |
| List row | `src/components/budgets/budget-list.tsx` | **touch** — effective limit + carry line/chip; limit ≤ 0 guard |
| Help | `src/lib/help/content.ts` | **touch** — rewrite the budgets "No rollover" item |
| Docs | `docs/project-overview.md`, `docs/POST-MVP-ROADMAP.md` | **touch** — schema mirror, Budgets feature note, Out-of-Scope reframe, mark §7 shipped |
| Constants | `src/lib/system-constants.ts` | **touch** — `ROLLOVER_MAX_LOOKBACK_MONTHS` |
| Tests | `test/lib/rollover.test.ts` (new), `test/lib/budget.test.ts`, `test/lib/budget-period.test.ts`, `test/actions/budgets.test.ts` (extend) | **new/extend** |

---

## 6. Validation — `src/lib/validations/budget.ts`

Add `rollover` to both schemas (period/category stay immutable; **rollover is
editable in place** — the user can toggle it on an existing budget without
recreate):

```ts
const rollover = z.boolean();

export const createBudgetSchema = z.object({
  categoryId: z.string().min(1, "Select a category"),
  amount,
  month,
  year,
  rollover,
});

export const updateBudgetSchema = z.object({ amount, rollover });
```

`rollover` is the only field added; `userId` / `currency` / `isArchived` are
still server-resolved and never client-supplied.

---

## 7. Read path — `src/lib/db/budgets.ts`

### 7.1 New helper `previousPeriod` (`budget-period.ts`)

```ts
/** The calendar month immediately before `(month, year)`; Jan wraps to prev Dec. */
export function previousPeriod(month: number, year: number): BudgetPeriod {
  return month === 1 ? { month: 12, year: year - 1 } : { month: month - 1, year };
}
```

### 7.2 `resolveRolloverCarry` (internal, shared)

A single carry-resolution function used by **both** `getBudgets` and
`getBudgetsData` (export it from `db/budgets.ts`; `dashboard.ts` imports it — keep
one implementation, no copy-paste). Contract:

```ts
/**
 * Given the period's budgets, return a Map<categoryId, carriedAmount> for the
 * rollover-enabled ones. Carry is the folded remainder of the consecutive
 * rollover-enabled run immediately preceding the period (§4.2). Non-rollover
 * categories are absent from the map (carry = 0).
 *
 * CONTRACT: every value in the returned map is already rounded to 2 decimals
 * (currency precision). Callers consume it as-is — they never re-round and never
 * see a raw float. Rounding is part of the public contract, not an internal detail.
 */
async function resolveRolloverCarry(
  userId: string,
  month: number,
  year: number,
  rolloverCategoryIds: string[]
): Promise<Map<string, number>>
```

Implementation strategy (bounded, no raw SQL — matches the existing `groupBy`
pattern):

1. If `rolloverCategoryIds` is empty → return empty map (zero extra queries; the
   common case for users who never enable rollover stays free).
2. Walk back month-by-month from `previousPeriod`, up to
   `ROLLOVER_MAX_LOOKBACK_MONTHS`. At each step:
   - Fetch the budgets for the still-active categories in that month
     (`rollover: true, isArchived: false`) → drop any category whose run just
     broke (no budget, or `rollover: false`).
   - One `transaction.groupBy({ by: ["categoryId"], _sum })` for that month's
     EXPENSE spend (the same shape `getBudgets` already uses), scoped to the
     categories still in a run.
   - Record `{ baseLimit, spent }` per surviving category for that month.
   - Stop early when no categories remain in a run.
3. For each rollover category, **sort its collected run chronologically (oldest →
   newest)**, then fold with `rolloverCarryIn` and **round the result to 2 dp**
   before putting it in the returned map. The walk in step 2 happens
   newest → oldest, so the per-category run is reversed (or built front-to-back)
   into chronological order before folding — never rely on DB return order.

> **Query budget.** Worst case = `ROLLOVER_MAX_LOOKBACK_MONTHS` × 2 queries, only
> when a user has long unbroken rollover chains — rare. Typical chains are 1–3
> months. The empty-set short-circuit keeps non-rollover users at today's cost.
> A single `date_trunc('month')` raw query is a valid future optimization but is
> **not** taken now (stays consistent with the codebase's Prisma-only `groupBy`
> idiom; revisit only if §0 telemetry shows deep chains at scale).

> **Memoization seam (don't build yet, but keep the shape).** `/budgets` calls
> `resolveRolloverCarry` once per render today, so per-request caching buys
> nothing now. But the dashboard already fans out several fetchers in one
> `Promise.all`, and a future surface could call it again within the same request.
> Keep `resolveRolloverCarry` a **pure-ish, side-effect-free function of
> `(userId, month, year, rolloverCategoryIds)`** so wrapping it in React's
> `cache()` (request-scoped memoization, the same primitive used elsewhere for
> per-request dedupe) is a **one-line, zero-call-site-change** drop-in if a second
> caller ever appears. Do **not** add the wrapper speculatively (YAGNI) — just
> don't close the door: no hidden internal state, no reliance on call order.

### 7.3 `getBudgets` wiring

After loading the period's budgets and the in-month spend map (unchanged):

```ts
const rolloverIds = budgets.filter((b) => b.rollover).map((b) => b.categoryId);
const carryMap = await resolveRolloverCarry(userId, month, year, rolloverIds);

const rows = budgets.map((b) =>
  mapBudgetRow(
    b,
    spentMap.get(b.categoryId) ?? 0,
    b.rollover,
    b.rollover ? (carryMap.get(b.categoryId) ?? 0) : 0
  )
);
```

`getBudgetForEdit` adds `rollover: budget.rollover` to its `select` + return so
the drawer pre-fills the toggle.

### 7.4 `mapBudgetRow` / `summarizeBudgets` (`src/lib/budget.ts`)

- `mapBudgetRow(budget, spent, rollover, carriedAmount)` → adds `rollover` and
  `carriedAmount` to the returned row; `limit` stays the **base** amount.
- `summarizeBudgets(rows, …)` → `total` and `remaining` use the **effective**
  limit per row (`limit + carriedAmount`), so the remaining block reflects carry.
  Update the `{ spent, limit }` row shape it consumes to `{ spent, limit,
  carriedAmount }` (default `0`).

---

## 8. Mutation path — `src/actions/budgets.ts`

Thread `rollover` through; no new action, no new auth/ownership logic.

- **`createBudget`** — `rollover` from validated input goes into **both** the
  `upsert` `update` branch (revive sets the new `rollover`) and the `create`
  branch. Revive-or-create semantics are otherwise unchanged.
- **`updateBudget`** — now writes `{ amount, rollover }`. Toggling rollover on an
  existing budget is a normal in-place edit (no recreate); because carry is
  derived, the flip recalculates this month and every downstream month on the next
  read (no backfill) — `revalidateBudgetViews()` already triggers that re-render.
- **`seedPresetBudgets`** — preset rows stay `rollover: false` (carried-amount of
  a brand-new starter budget would be meaningless; the user opts in deliberately).
- `revalidateBudgetViews()` already covers `/budgets` + `/dashboard` — no change.
  Spend freshness on transaction writes already revalidates `/budgets`.

---

## 9. Page + components

The `/budgets` page (`force-dynamic`, period via `?month=&year=`) and `BudgetsView`
are structurally unchanged — they just receive richer rows.

### 9.1 `budget-form-drawer.tsx`

Add a **rollover toggle** below the amount field:

- A labeled switch/checkbox: **"Roll over remainder"** + helper line *"Carry this
  budget's unspent (or overspent) balance into next month."*
- **First-run explainer.** Next to the label, a small `info`-glyph tooltip (or an
  always-visible example line under the helper copy) with a concrete worked
  example so the mechanic is obvious on first encounter: *"e.g. a €400 budget with
  €320 spent starts next month at €480; spend €450 and next month starts at
  €350."* Reuse an existing tooltip/popover primitive (or the native `title=` as a
  minimum) — don't build new tooltip infra for this. Keep it to one example;
  details live on the Help page (§13).
- `useState<boolean>` `rollover`, defaulting to `false` on create and to the
  loaded value on edit (`getBudgetForEdit` now returns it).
- Available in **both** create and edit (unlike category, which is edit-locked).
- Pass `rollover` into the `createBudget` / `updateBudget` calls.
- Styling: **neutral**, not the AI light-blue accent — rollover is a normal
  budgeting control, and the AI accent is reserved for AI affordances only
  (Design System rule).

### 9.2 `budget-list.tsx` (row)

- `const { effectiveLimit, state, percent } = budgetProgressWithCarry(spent,
  budget.limit, budget.carriedAmount)` — the §4.4 ≤ 0 edge is handled inside the
  helper; the row never re-implements it.
- The amount label shows `formatCurrency(spent) / formatCurrency(effectiveLimit)`.
- When `rollover && carriedAmount !== 0`, render the carry line per the single
  presentation rule below (§9.3). Plain budgets (rollover off, or zero carry)
  render exactly as today.
- The remaining-summary block needs no change beyond consuming the
  effective-based `summary` from §7.4.

### 9.3 Carry presentation — one rule, applied everywhere

To avoid the same number being formatted three different ways across the row, the
drawer, and the summary, define the carry copy **once** as a pure helper and reuse
it (e.g. `formatCarry(carriedAmount)` in `src/lib/budget.ts`, beside the other
display helpers). The rule:

| Carry | Sign-direction copy (preferred) | Glyph |
|---|---|---|
| `carriedAmount > 0` | `↻ +€100 rolled over` | `RefreshCw` / ↻ |
| `carriedAmount < 0` | `↻ €70 overspent last month` | `RefreshCw` / ↻ |
| `carriedAmount === 0` | *(nothing — no carry line)* | — |

**Why direction-worded, not a bare `−€70`.** A signed minus is ambiguous next to a
spent/limit row that already has its own colors; "overspent last month" tells the
user *why* their room shrank. Positive carry keeps the explicit `+` so it reads as
*added* room. Tone stays neutral (`ink-3`) — carry is information, not a
warning/positive semantic (the progress bar already owns green/amber/red).

**Consistency rule (must hold):** every surface that shows an **effective** limit
(`/budgets` row, dashboard `BudgetsPanel` row, the drawer's read-back) presents it
the same way — base ceiling as the primary number, the carry line as the secondary
explainer (`€400 base · ↻ +€100 rolled over`). Never show a naked effective number
with no way to see the base + carry that produced it; the carry must always be
legible, never silently folded into the ceiling.

**`formatCarry` is presentation-only.** It takes the already-computed,
already-rounded numeric `carriedAmount` and returns a display string (sign word +
glyph + `formatCurrency`). It performs **no arithmetic** — no rounding, no
sign-deriving math, no effective-limit calc. Every calculation (carry resolution,
`effectiveLimit`, progress state, summary totals, the at-risk count) operates on
the **raw numeric** `carriedAmount`/effective limit; `formatCarry` is the last
step and feeds nothing back into logic. This keeps the number the math sees and the
number the user sees provably the same value.

---

## 10. Constants — `src/lib/system-constants.ts`

```ts
/**
 * Max months `resolveRolloverCarry` walks back when deriving a budget's carried
 * remainder. Carry only flows through a consecutive run of rollover-enabled
 * budgets, so this is a defensive ceiling on a pathological chain, not the
 * expected depth (typical runs are 1–3 months). Derive-on-read bound — keep
 * small; raising it only adds queries for users with very long chains.
 */
export const ROLLOVER_MAX_LOOKBACK_MONTHS = 24;
```

No magic numbers in the fetcher.

---

## 11. Tests (Vitest, `test/` mirrors `src/`)

Per coding-standards: cover `src/lib/**` + `src/actions/**`; no component tests.

`test/lib/rollover.test.ts` (**new** — the core; pure, no mocks):
- `rolloverCarryIn`: empty run → 0; single month underspent → positive carry;
  single month overspent → **negative** carry; multi-month accumulation folds
  forward (e.g. +50 then +30 → +80); a negative then positive month nets
  correctly; carry can exceed the next base limit.
- **Determinism:** a run passed in shuffled order yields the **same** result once
  the caller sorts chronologically (guards the order-independence contract §4.3).
- **Precision:** a chain of non-round amounts yields a clean 2-dp carry after the
  single boundary round — no float drift like `99.99999999`.
- `effectiveLimit`: `base + carry` incl. negative carry pushing it ≤ 0.
- `budgetProgressWithCarry`: positive carry widens the bar; `effectiveLimit <= 0`
  → `{ state: "danger", percent: 100 }` (the single source for the §4.4 edge).

`test/lib/budget-period.test.ts` (extend):
- `previousPeriod`: mid-year decrement; **January wraps to previous December**
  (`previousPeriod(1, 2026) === { month: 12, year: 2025 }`).

`test/lib/budget.test.ts` (extend):
- `mapBudgetRow`: passes `rollover`/`carriedAmount` through; `limit` stays base.
- `summarizeBudgets`: `total`/`remaining` use **effective** limits (a row with
  `carriedAmount` shifts the totals); non-rollover rows unaffected.
- `formatCarry`: positive → `+€…rolled over`; negative → `€…overspent last month`;
  `0` → empty/nullish (the row renders no carry line).

`test/actions/budgets.test.ts` (extend — mock `@/lib/prisma` + `@/auth`):
- `createBudget` persists `rollover` in both the `upsert` `update` (revive) and
  `create` branches; revive preserves the row `id` and applies the new
  `rollover`.
- `updateBudget` writes `{ amount, rollover }`; toggling rollover on an existing
  budget is accepted.
- `seedPresetBudgets` rows are created with `rollover: false`.
- Schema rejects a non-boolean `rollover`.

`test/lib/db/budgets.test.ts` (extend, if present — light DB-shape assertions):
- `resolveRolloverCarry` short-circuits to an empty map when no category has
  rollover (asserts **zero** extra `groupBy` calls — the cost guarantee for
  non-rollover users).
- A run that breaks at a rollover-off / missing month stops folding there.
- **Integration-style chain (the full read path, not just the pure fold).** With a
  mocked Prisma returning a realistic **Jan → Feb → Mar** series for one category
  (e.g. each €400 base; spent 300 / 500 / 350; all `rollover: true`), assert
  `getBudgets(Mar)` returns the correctly **accumulated** March carry
  (Jan leaves +100 → Feb effective 500, overspent 500 → 0 → Mar carry 0 …
  pick concrete numbers that exercise a sign flip) and the expected effective
  limit on the row. This verifies the walk-back assembly + chronological sort +
  fold + rounding wire together end-to-end, catching mistakes the pure-math test
  can't (wrong month order, off-by-one window, dropped run member).

Run `npm run test:run` **and** `npm run build` green before commit.

---

## 12. Special cases & decisions

| Case | Decision |
|---|---|
| Derive vs store the carry | **Derive on read** (§4). Cron-free, snapshot-drift-free, clean at MVP volumes. Store-at-rollover needs a scheduled job + a reconciliation story for late/edited transactions — rejected. |
| Per-budget flag vs user-level default | **Per-budget `Budget.rollover`** is the source of truth. A `User`-level default is marginal value for a second column + settings UI — deferred (non-goal §1). Rollover is set in the budget drawer, on per budget. |
| Chain across a gap month | A month with **no budget** for the category **ends the run** — carry resets to 0 for the next rollover-on month. Predictable; no "phantom carry" across untracked months. |
| Chain across a rollover-off month | A `rollover: false` month **ends the run** (both source and receiver must be on). |
| Overspent carry (negative) | Carried forward as a **negative** amount, reducing next month's effective limit — the roadmap's "(or overspent) remainder." |
| Effective limit ≤ 0 | §4.4 guard: `state = danger`, `percent = 100` (not the misleading 0%/green that `budgetFraction(limit ≤ 0)` would give). |
| Archived budgets | Out of every query → never receive or emit carry. Un-archiving (snackbar undo) restores the row with its stored `rollover` flag; its carry re-derives on the next read. |
| Editing `amount` mid-run | Changing a month's base limit changes that month's effective remainder, which re-derives downstream carry on the next read automatically (nothing stored). |
| Toggling `rollover` on an existing budget | Takes effect **immediately on the current read** — because carry is derived, flipping the flag instantly re-includes/excludes that month from its run and **recalculates every downstream month** on the next render. No backfill, no migration of past rows, no recompute job. Turning it off mid-run breaks the chain at that month going forward. |
| Dashboard vs `/budgets` agreement | Both call the shared `resolveRolloverCarry` and effective-limit math — they cannot diverge. |
| Insights "at risk" count | `countAtRiskBudgets` already uses `budgetFraction(spent, limit)`; it now receives the **effective** limit, so an over-carry budget can correctly trip the 80% rail. |
| Preset budgets | Seeded with `rollover: false` — opt-in only. |
| Lookback bound | `ROLLOVER_MAX_LOOKBACK_MONTHS = 24` is an **implementation safeguard** (query/recursion ceiling), **not a business rule**. It does not define or alter rollover semantics — raising or lowering it only changes how far an already-unbroken chain is walked; the chain rule (§4.2) is unchanged. Typical runs are 1–3 months, far inside it. |
| Pro gate | **None.** Core budgeting, free for all. |
| Currency | Carry sums magnitudes in the budget's stamped currency (EUR-only); no conversion. |

---

## 13. Doc updates / maintenance contract

This feature changes a behaviour the docs assert as a hard rule, so the same PR
**must** reconcile:

1. `src/lib/help/content.ts` — rewrite the budgets **"No rollover"** item to
   describe the opt-in carry (per the Help maintenance contract; the help spec
   even flags this item as "until §7 ships"). Keep the green/amber/red item.
2. `docs/project-overview.md` — (a) `Budget` schema mirror gets the `rollover`
   column; (b) Budgets feature paragraph notes opt-in rollover; (c) the
   Architecture "no rollover in MVP" line and the **Out of Scope → "Budget
   rollover between periods"** bullet are reframed ("graduated in" per the
   roadmap's Out-of-Scope reconciliation note — it's a "not in MVP" list, not
   "never").
3. `docs/POST-MVP-ROADMAP.md` — mark §7 + Delivery row 5 shipped with the realized
   decisions (derive-on-read, per-budget flag, chain rule).

---

## 14. Workflow (per `docs/ai-interaction.md`)

1. **Document** in `docs/current-feature.md` (Goals / Notes).
2. **Branch** `feature/budget-rollover`.
3. **Implement** in order: schema + migration (dev branch) → `rollover.ts` +
   `previousPeriod` → types → validation → fetchers (`resolveRolloverCarry`,
   `getBudgets`, `getBudgetsData`, `getBudgetForEdit`) → `budget.ts` mappers →
   actions → drawer toggle → list row → help/docs.
4. **Test** — Vitest (§11); `npm run test:run` + `npm run build`; verify in the
   browser: toggle on, underspend a month, advance to next month and see the
   effective limit grow; overspend and see it shrink; break the chain with an off
   month; confirm the dashboard panel matches.
5. **Iterate**, then **commit** (only on green; conventional `feat:`; **no agent
   attribution**), **merge** to `main`, **delete** branch, mark done in
   `current-feature.md` history.

> Neon: schema change goes through **Prisma migrate on the `development` branch**
> (`br-hidden-bonus-aqksw1pa`), never `db push`, never production from this slice.

---

## 15. Acceptance criteria

- [ ] `Budget.rollover Boolean @default(false)` added via the `add_budget_rollover`
      migration (dev branch); existing rows behave exactly as before.
- [ ] A rollover-enabled budget's **effective limit** = base + previous month's
      `(effective limit − spent)`, derived on read — no stored carry, no cron.
- [ ] Carry accumulates across a consecutive run of rollover-on budgets and
      **resets at the first gap or rollover-off month** (§4.2).
- [ ] **Negative** carry (overspend) reduces next month's effective limit; an
      effective limit ≤ 0 renders danger/100%, not green/0%.
- [ ] Progress bar, remaining summary, dashboard panel, and the at-risk insight
      all use the **effective** limit and **agree** with each other.
- [ ] The drawer toggle creates/updates `rollover` in place (no recreate);
      `getBudgetForEdit` pre-fills it. Flipping it recalculates the current and all
      downstream months on the next read (no backfill).
- [ ] The `effectiveLimit ≤ 0` edge lives in one shared `budgetProgressWithCarry`
      helper; the `/budgets` row, dashboard panel, and at-risk count all route
      through it (no per-surface guard).
- [ ] An integration-style Jan→Feb→Mar test verifies the full read-path carry
      accumulation (assembly + sort + fold + round), not just the pure math.
- [ ] Carry copy is direction-worded via one shared `formatCarry` helper
      (`+€100 rolled over` / `€70 overspent last month`), applied identically on
      the `/budgets` row, the dashboard panel, and the drawer read-back; the base
      ceiling is always legible beside the effective limit. Plain budgets are
      visually unchanged.
- [ ] The drawer's rollover toggle carries a one-line worked example (tooltip or
      inline) so the mechanic is clear on first use.
- [ ] `seedPresetBudgets` rows are `rollover: false`.
- [ ] Non-rollover users incur **zero** extra queries (`resolveRolloverCarry`
      short-circuits on an empty rollover set).
- [ ] `rollover.ts`, `previousPeriod`, the extended mappers, and the actions are
      unit-tested; chain accumulation, run-break, and negative carry are covered.
- [ ] Help "No rollover" item and the `project-overview` schema/feature/Out-of-Scope
      notes are reconciled in the same PR.
- [ ] `npm run test:run` and `npm run build` pass; `prisma migrate status` clean;
      no `db push`, no production touch.
```