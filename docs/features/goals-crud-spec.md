# Goals CRUD — Implementation Spec

> **Goal:** Give users a real read/write stack for `Goal` + `GoalContribution` so they can
> create savings targets, record contributions (and withdrawals), and watch progress — turning
> the read-only dashboard Goals widget into a full `/goals` management surface.

This spec follows the patterns in [entity-crud-architecture.md](../entity-crud-architecture.md)
and the field-level rules in [entity-types.md](../entity-types.md). It mirrors the
already-shipped **Budgets**, **Recurring**, and **Financial Account** slices, and implements
[ROADMAP.md](../ROADMAP.md) §2 (Delivery Sequence slot #1).

---

## 1. Why this slice

`Goal` is **read-only** today: [src/lib/db/dashboard.ts](../../src/lib/db/dashboard.ts) exposes
`getGoals(userId)` returning the trimmed `GoalRow[]` for the dashboard widget, and
[goals-widget.tsx](../../src/components/dashboard/goals-widget.tsx) renders it with a dead
"View all →" button (no `/goals` route exists). There is no create/edit/complete/delete action,
no contribution flow, and no management page. Goals only exist because `prisma/seed.ts` made them.

This slice ships the highest-value missing headline feature with **zero unbuilt dependencies** —
it completes the savings half of the core loop (`capture → organize → control → understand`).

---

## 2. Scope

### In scope

- Zod validation schemas: create/update goal, add contribution.
- Server actions: `createGoal`, `updateGoal`, `completeGoal`, `deleteGoal`, `addContribution`, `deleteContribution`.
- DB fetchers in a new `src/lib/db/goals.ts`: list-with-contributions, single-for-edit. **The
  dashboard's `getGoals` moves here** so the two surfaces share one query (see §7).
- Pure helpers in `src/lib/goals.ts`: the **single** definition of overdue / progress / row mapping.
- Management UI at **`/goals`** — list of goal cards, create/edit drawer, contribution drawer, complete + delete.
- Wire the dashboard `GoalsWidget` "View all →" to `/goals`.
- A centralized `revalidateGoalViews()` helper in `src/lib/revalidation.ts`.
- Vitest unit tests for actions + pure helpers.

### Out of scope (explicit)

- **Any currency selection.** EUR-only MVP: goal `currency` is stamped `DEFAULT_CURRENCY` (EUR)
  server-side, never from the client (mirrors accounts/budgets — see §10 of the account spec).
- **Auto-completion at 100%.** `isCompleted` is **strictly manual** via `completeGoal`. The app
  never auto-flips a goal when `currentAmount >= targetAmount` — this resolves the
  [entity-types.md](../entity-types.md) vs architecture-doc ambiguity per
  [ROADMAP.md](../ROADMAP.md) "Spec Alignment Notes" (architecture doc wins).
- **Soft delete / undo for goals.** Per [ROADMAP.md](../ROADMAP.md) §2, `deleteGoal` is a
  **hard delete** that cascades to contributions (`onDelete: Cascade`). There is no `deletedAt`
  on `Goal`, so no 8-second snackbar-undo path as transactions have — a `confirm` dialog guards it
  instead. (Contribution delete is likewise hard, reversed only by re-adding.)
- Linked real-money savings accounts, goal→budget/account interaction (post-MVP, see overview
  "Out of Scope"). Goals are **virtual progress only**.
- Reordering goals, goal categories/icons, target-date reminders/notifications.

---

## 3. Data model recap

From [project-overview.md](../../docs/project-overview.md) Prisma schema. **No schema change required.**

### `Goal`

| Field | Type | Notes |
|---|---|---|
| `name` | `String` | required, user label (≤80 chars) |
| `targetAmount` | `Decimal(12,2)` | positive; the savings target |
| `currentAmount` | `Decimal(12,2)` | **denormalized** sum of contributions; default 0. Kept in sync, always derivable |
| `currency` | `String` | **MVP: always `DEFAULT_CURRENCY` (EUR)**, server-stamped |
| `targetDate` | `DateTime? @db.Date` | optional calendar date (no time/zone) |
| `isCompleted` | `Boolean` | **manual only** (`completeGoal`); never auto-set |

### `GoalContribution`

| Field | Type | Notes |
|---|---|---|
| `amount` | `Decimal(12,2)` | **signed**: negative = withdrawal |
| `date` | `DateTime @db.Date` | calendar date |
| `note` | `String?` | optional |
| `goalId` | `String` | FK, `onDelete: Cascade` |

### The `currentAmount` invariant

```
goal.currentAmount === SUM(contribution.amount) for all contributions of that goal
```

This is the one rule the whole slice protects. It is maintained transactionally:
`addContribution` inserts a row **and** `increment`s `currentAmount` in the same
`prisma.$transaction`; `deleteContribution` deletes a row **and** `decrement`s by that row's
amount in the same transaction (mirrors the schema comment on `GoalContribution`). `currentAmount`
may go **negative** if withdrawals exceed contributions — that is allowed (no clamp at the data
layer); the UI clamps the *progress bar* to `[0, 100]` for display only.

---

## 4. File plan

| Layer | File | Action |
|---|---|---|
| Validation | `src/lib/validations/goal.ts` | **create** — `createGoalSchema`, `updateGoalSchema`, `addContributionSchema` |
| Actions | `src/actions/goals.ts` | **create** — 6 actions + `getGoalForEdit` proxy |
| DB reads | `src/lib/db/goals.ts` | **create** — `getGoals`, `getGoalsSummary`, `getGoalForEdit` |
| DB reads | `src/lib/db/dashboard.ts` | **modify** — delete local `getGoals`/`GOAL_COLORS`; re-export from `src/lib/db/goals.ts` |
| Pure helpers | `src/lib/goals.ts` | **create** — `isGoalOverdue`, `goalProgressPercent`, `mapGoalRow`, `mapGoalCard` |
| Types | `src/types/goals.ts` | **create** — `GoalCard`, `EditableGoal`, `ContributionRow` |
| Constants (UI) | `src/lib/constants.ts` | **modify** — `GOAL_COLORS` (moved from dashboard.ts), `GOAL_AMOUNT_MAX` if treated as UI cap |
| Constants (system) | `src/lib/system-constants.ts` | **modify** — `GOAL_AMOUNT_MAX = 1_000_000` (mirrors `BUDGET_AMOUNT_MAX`) |
| Revalidation | `src/lib/revalidation.ts` | **modify** — add `revalidateGoalViews()` |
| Page | `src/app/goals/page.tsx` | **create** — `force-dynamic`, `Promise.all`, Suspense |
| Components | `src/components/goals/goals-view.tsx` | **create** — coordinator (drawer state, delete confirm) |
| Components | `src/components/goals/goal-card.tsx` | **create** — progress, amounts, overdue badge, menu |
| Components | `src/components/goals/goal-form-drawer.tsx` | **create** — shadcn Sheet, `useTransition` |
| Components | `src/components/goals/contribution-drawer.tsx` | **create** — add/list/delete contributions |
| Components | `src/components/goals/goal-empty-state.tsx` | **create** — "Set your first savings goal" CTA |
| Components | `src/components/goals/confirm-delete-dialog.tsx` | **create** — native `<dialog>` (mirror recurring) |
| Cross-cut | `src/components/dashboard/goals-widget.tsx` | **modify** — wire "View all →" to `/goals` |
| Tests | `test/actions/goals.test.ts` | **create** |
| Tests | `test/lib/goals.test.ts` | **create** |

> **Route:** `/goals` is in the spec's Pages table and the sidebar's primary daily-use group
> (Dashboard, Transactions, Budgets, Recurring, **Goals**, Reports). No nav change needed beyond
> the sidebar item already being present; verify it links to `/goals`.

---

## 5. Validation (`src/lib/validations/goal.ts`)

Mirror [validations/budget.ts](../../src/lib/validations/budget.ts): the user enters a positive
magnitude for `targetAmount`; `currency`, `userId`, `currentAmount`, and `isCompleted` are
server-resolved and never accepted from the client.

```ts
import { z } from "zod";
import { GOAL_AMOUNT_MAX } from "@/lib/system-constants";

/** Positive target magnitude, capped at the same limit the UI advertises. */
const targetAmount = z.coerce
  .number()
  .refine((n) => Number.isFinite(n), "Enter a valid amount")
  .refine((n) => n > 0, "Enter an amount greater than 0")
  .refine((n) => n <= GOAL_AMOUNT_MAX, "That target is too large");

/** Optional calendar date as "YYYY-MM-DD" (matches `dateInputToUtc` consumers). */
const targetDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date")
  .nullish();

const note = z.string().trim().max(200).nullish();

/** Create: name + target. Currency + currentAmount are server-resolved. */
export const createGoalSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  targetAmount,
  targetDate,
});

/** Update: name / target / targetDate — all optional (patch). currentAmount is not editable here. */
export const updateGoalSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  targetAmount: targetAmount.optional(),
  targetDate, // already nullish — allows clearing the date
});

/** Contribution: signed nonzero amount (negative = withdrawal), date, optional note. */
export const addContributionSchema = z.object({
  goalId: z.string().min(1),
  amount: z.coerce
    .number()
    .refine((n) => Number.isFinite(n), "Enter a valid amount")
    .refine((n) => n !== 0, "Enter a nonzero amount")
    .refine((n) => Math.abs(n) <= GOAL_AMOUNT_MAX, "That amount is too large"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date"),
  note,
});

export type CreateGoalInput = z.infer<typeof createGoalSchema>;
export type UpdateGoalInput = z.infer<typeof updateGoalSchema>;
export type AddContributionInput = z.infer<typeof addContributionSchema>;
```

> **Why `amount` is signed and nonzero, not positive.** Goals support withdrawals
> (overview "Goals"): a negative contribution legitimately reduces progress. Zero is rejected
> because it's a no-op that still creates a row. The sign is taken **verbatim** from the input —
> unlike transactions/budgets, there is no server-side sign derivation here.

---

## 6. Server actions (`src/actions/goals.ts`)

`"use server"`. Reuse the established shape exactly: `MutationResult`, `NOT_AUTHED`
(`"You must be signed in."`), `round2`, `auth()` guard → Zod `safeParse` → ownership scope by
`session.user.id` → `{ success, error? }` → `revalidateGoalViews()`.

| Action | Behavior |
|---|---|
| `createGoal(input)` | Validate. Insert with `userId` from session, `currency: DEFAULT_CURRENCY`, `currentAmount: 0`, `isCompleted: false`. `targetDate` via `dateInputToUtc` or null. |
| `updateGoal(id, input)` | Patch `name` / `targetAmount` / `targetDate` only. Ownership check `where: { id, userId }`. Never touches `currentAmount` or `isCompleted`. |
| `completeGoal(id)` | Set `isCompleted: true`. **Manual only** — independent of progress. Ownership-scoped. |
| `deleteGoal(id)` | **Hard delete** (`prisma.goal.delete`), ownership-scoped; cascades to contributions. |
| `addContribution(input)` | **Atomic `$transaction`**: `goalContribution.create` + `goal.update({ currentAmount: { increment } })`. Validates goal ownership *inside* the transaction. |
| `deleteContribution(id)` | **Atomic `$transaction`**: load the contribution (join goal for ownership), `goalContribution.delete` + `goal.update({ currentAmount: { decrement: <stored amount> } })`. Decrement by the **value read from the DB row**, never a client-supplied or recomputed amount (see invariant note below). |

### Ownership pattern (every action)

```ts
const session = await auth();
if (!session?.user?.id) return NOT_AUTHED;
const userId = session.user.id;
// all prisma calls scoped: where: { id, userId } (or goal: { userId } for contributions)
```

### `addContribution` — atomic side-effect

```ts
await prisma.$transaction(async (tx) => {
  // Ownership gate INSIDE the tx — a foreign/missing goal must not create a row.
  const goal = await tx.goal.findFirst({
    where: { id: goalId, userId },
    select: { id: true },
  });
  if (!goal) throw new NotFoundError();

  await tx.goalContribution.create({
    data: { goalId, amount: round2(amount), date: dateInputToUtc(date), note: note ?? null },
  });
  await tx.goal.update({
    where: { id: goalId },
    data: { currentAmount: { increment: round2(amount) } },
  });
});
```

> **Both writes share one transaction** so the `currentAmount` invariant can never half-apply.
> `increment`/`decrement` use Prisma's atomic numeric ops (not read-modify-write) so concurrent
> contributions don't lose updates.
>
> **`deleteContribution` decrements by the value it read from the DB row** (the persisted
> `Decimal(12,2)`), inside the same `$transaction` that loads it — never a client-supplied id+amount
> pair and never a recomputed figure. The action takes only the contribution `id`; the amount comes
> from the row. Because the stored value was already `round2`-normalized on insert and
> `Decimal(12,2)` round-trips exactly, decrement-by-stored-value restores `currentAmount` to its
> pre-insert figure with no floating drift. The invariant
> (`currentAmount === SUM(contribution.amount)`) is preserved by construction across any
> add/delete sequence.

### Failure semantics (standardized — match the account slice)

- No session → `{ success: false, error: "You must be signed in." }`.
- Goal/contribution missing **or** owned by another user → a single
  `{ success: false, error: "Goal not found." }` / `"Contribution not found."`. Both collapse to
  *not found* so ownership stays non-enumerable. Scope every query `where: { id, userId }`.

### Revalidation

Add to [src/lib/revalidation.ts](../../src/lib/revalidation.ts):

```ts
/** Revalidate every surface that renders goals or goal progress. */
export function revalidateGoalViews() {
  revalidatePath("/goals");
  revalidatePath("/dashboard"); // GoalsWidget reads the same data
}
```

Every goal/contribution mutation calls this one helper (mirrors `revalidateBudgetViews` /
`revalidateAccountViews`). Goals do **not** touch `/transactions` or `/budgets` — they have no
interaction with accounts or budgets.

---

## 7. DB fetchers (`src/lib/db/goals.ts`) — single source of truth

Per [ROADMAP.md](../ROADMAP.md) §2: **do not fork the query.** Move the canonical goal
read here and have the dashboard import from it, so the widget and the page can never disagree on
progress/overdue.

### `getGoals(userId)` — page list

`findMany` with `include: { contributions: { orderBy: { date: "desc" } } }`, ordered by
`createdAt: "asc"`. Returns `GoalCard[]` (serializable — Decimals → numbers, contributions
mapped to `ContributionRow[]`). Includes both active and completed goals; the page splits them
into sections.

### `getGoalsSummary(userId)` — dashboard widget

The narrowed selector the dashboard needs: active (`isCompleted: false`) goals only, **no**
contributions included, mapped to the existing `GoalRow` shape via the shared `mapGoalRow` helper.
This **replaces** the current `getGoals` in `dashboard.ts`.

**Update the dashboard page to import `getGoalsSummary` directly** — do not re-export it from
`dashboard.ts` under the old `getGoals` name:

```ts
// src/app/dashboard/page.tsx
import { getGoalsSummary } from "@/lib/db/goals";
// ...used where getGoals(userId) was previously called.
```

> **Why a direct import, not `export { getGoalsSummary as getGoals }`.** An aliased re-export
> would keep the name `getGoals` pointing at the *narrowed* dashboard dataset, while the new
> `src/lib/db/goals.ts` `getGoals` returns the *full* page dataset (with contributions). Two
> functions named `getGoals` meaning different things is exactly the drift this consolidation is
> meant to remove. The two fetchers carry distinct, self-describing names — `getGoals` (full,
> page) and `getGoalsSummary` (narrowed, dashboard) — and every call site imports the one it means.

Delete the local `GOAL_COLORS` array and the inline overdue/progress math from `dashboard.ts`;
both now come from `src/lib/goals.ts` + `src/lib/constants.ts`.

### `getGoalForEdit(userId, id)`

Single goal scoped by `userId`, mapped to `EditableGoal` for the drawer pre-fill. Returns `null`
if not found / not owned. Exposed to the client via a thin auth-guarded proxy in `actions/goals.ts`
(mirrors `getBudgetForEdit`).

---

## 8. Pure helpers (`src/lib/goals.ts`) — overdue logic lives here, once

The overdue rule appears in **three** places today (dashboard fetcher inline, the spec, the
widget badge). Collapse it to one definition consumed everywhere:

```ts
import { startOfUtcDay } from "@/lib/date";
import type { GoalRow } from "@/types/dashboard";
import type { GoalCard, ContributionRow } from "@/types/goals";

/**
 * A goal is overdue when its target date is strictly **before today** and it
 * isn't yet complete AND progress is still short of target. `now` is injectable
 * for testing.
 *
 * Date comparison rule (read carefully): `targetDate` is a `@db.Date` stored at
 * UTC midnight. We floor `now` to UTC midnight too (`startOfUtcDay`) and use a
 * **strict `<`**, so a goal whose target date is *today* is NOT overdue — it
 * only flips overdue on the following calendar day. Comparing against an
 * un-floored `now` would (wrongly) mark a goal overdue from 00:00:01 UTC on its
 * own due date. This floor-both-sides rule matches the recurring slice's
 * day-boundary handling.
 */
export function isGoalOverdue(
  goal: { targetDate: Date | null; isCompleted: boolean; currentAmount: number; targetAmount: number },
  now: Date = new Date()
): boolean {
  if (goal.targetDate == null || goal.isCompleted) return false;
  if (goal.currentAmount >= goal.targetAmount) return false;
  return goal.targetDate < startOfUtcDay(now);
}

/** Progress clamped to [0, 100] for display (currentAmount may exceed target or go negative). */
export function goalProgressPercent(saved: number, target: number): number {
  if (target <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((saved / target) * 100)));
}

export function mapGoalRow(goal: GoalRecord, index: number, now?: Date): GoalRow { /* ... */ }
export function mapGoalCard(goal: GoalWithContributions, index: number, now?: Date): GoalCard { /* ... */ }
```

> The dashboard's inline `overdue` calculation and the widget's `percent = Math.min(100, ...)`
> are both replaced by these. The earlier inline check did **not** include `!isCompleted` in the
> fetcher (it filters `isCompleted: false` at the query instead); centralizing makes the rule
> explicit and reusable for the `/goals` page, which shows completed goals too.

`GOAL_COLORS` moves to `src/lib/constants.ts` (UI data per the constants-split rule) and is read
by `mapGoalRow`/`mapGoalCard` via `GOAL_COLORS[index % GOAL_COLORS.length]` (no `color` column on
`Goal`, same as today).

---

## 9. UI

### Page — `src/app/goals/page.tsx`

- `export const dynamic = "force-dynamic";`
- `getSessionOrRedirect()` (existing guard).
- `const goals = await getGoals(userId);` (single fetcher; `Promise.all` for symmetry/extensibility).
- `<Suspense>` skeleton keyed so it re-triggers on revalidate.
- Renders `<GoalsView goals={...} />`, or `<GoalEmptyState />` when none exist.

### `goals-view.tsx` (client coordinator)

- Owns drawer open state (`useState`) for both the **goal form drawer** and the **contribution
  drawer** (mirrors `BudgetsView`'s `DrawerState`).
- Page header: title + "Add goal" CTA (green button, `Plus` icon — match `BudgetsView`).
- Active goals grid + a collapsed/de-emphasized "Completed" section.
- Delete → `ConfirmDeleteDialog` (native `<dialog>`, mirror recurring's pattern) since there is no
  undo for a hard delete; on confirm call `deleteGoal`, `toast`, `router.refresh()`.
- Complete → `completeGoal` with a success toast; the goal moves to the Completed section.

### `goal-card.tsx`

- **Progress bar** (reuse the widget's track styling — not a ring, see §14); name;
  `formatCurrency(saved) / formatCurrency(target)`; `goalProgressPercent` label; **overdue badge**
  when `isGoalOverdue(...)` (amber pill, same as widget). Overfunded goals (`saved > target`) clamp
  the bar to 100% **and** show an "Overfunded" / "Over 100%" affordance with the true percentage
  (formal UI rule, §11) so the clamp never hides the overshoot.
- Overflow menu: Edit, Add contribution (opens contribution drawer), **Mark complete**, Delete.
  Mark complete lives **here only** (§14) — it's an action on the goal, not a data edit.
- A completed goal shows a "Completed" state and hides the Mark-complete menu item (no
  un-complete action in MVP — §14).
- Receives the goal's `contributions` (from `GoalCard`) so Delete can pass
  `contributions.length` into the confirm dialog with no extra query.

### `goal-form-drawer.tsx`

- shadcn **Sheet** — right panel ≥768px / bottom sheet <768px (`useMediaQuery` + `BREAKPOINTS.mobile`).
- Create fields: name, target amount (`€` informational prefix — EUR-only), optional target date.
- Edit mode: same fields editable; **no** currency field, **no** completion control (Mark complete
  is on the card menu — keep this drawer a pure data edit).
- Submit via `useTransition`; surface `{ error }` inline / as toast.

### `contribution-drawer.tsx`

- Separate Sheet, opened per-goal. Add form: amount (signed — allow negative for withdrawal,
  with a clear "withdrawal" affordance), date (defaults to `todayDateInputValue()`), optional note.
- Below the form: the goal's existing contributions (`ContributionRow[]`, date-desc) each with a
  delete control → `deleteContribution` + `router.refresh()`. Withdrawals render in the danger
  color, contributions in the success color.

### `goal-empty-state.tsx`

- Active-guidance empty state (onboarding principle): headline "Set your first savings goal" +
  button → opens the create drawer.

### Dashboard widget wiring

- [goals-widget.tsx](../../src/components/dashboard/goals-widget.tsx) "View all →" button →
  `<Link href="/goals">`. (Currently a bare `<button>` with no handler.)

---

## 10. Constants

### `src/lib/system-constants.ts`

```ts
/** Max goal target / contribution magnitude (UI + Zod). Mirrors BUDGET_AMOUNT_MAX. */
export const GOAL_AMOUNT_MAX = 1_000_000;
```

### `src/lib/constants.ts`

```ts
/** Accent palette cycled across goal cards/rows (Goal has no color column). */
export const GOAL_COLORS = ["#378ADD", "#1D9E75", "#7F77DD", "#EF9F27", "#D4537E"];
```

> Moved verbatim from `dashboard.ts`. Per coding standards: no magic values in
> components/actions — pull from these files.

---

## 11. Edge cases & rules

- **`currentAmount` may go negative or exceed target.** Withdrawals can drive it below zero;
  contributions can overshoot the target. The **data layer never clamps** — only the *display*
  progress bar clamps to `[0, 100]` (`goalProgressPercent`). Do not "fix up" `currentAmount`.
- **Editing `targetAmount` below `currentAmount` is allowed (overfunded, not auto-completed).**
  `updateGoal` never reads or touches `currentAmount`, so lowering the target below what's already
  saved is valid: the goal becomes *overfunded*, `goalProgressPercent` clamps to 100%, and
  `isGoalOverdue` returns false (the `currentAmount >= targetAmount` short-circuit). It is **not**
  auto-completed — completion stays manual (§14). No validation rejects this; do not add a
  "target must exceed saved" rule.
- **Overfunded goals must be visually distinct (formal UI rule).** When `currentAmount > targetAmount`
  (including the target-edited-below-saved case above), the progress bar clamps to 100% width but
  the card **must** surface an explicit "Overfunded" / "Over 100%" affordance (e.g. a small neutral
  or success pill, and the real percentage in the amount label) so the clamp doesn't hide the
  overshoot. Display-only — it changes no data and does not auto-complete the goal. Without this,
  a goal at 100% and a goal at 180% look identical, which is misleading.
- **Completed goals stay editable and contributable.** `isCompleted` is a manual flag, not a lock.
  A completed goal still appears (in the Completed section) and can receive contributions or be
  edited; there is no re-open action in MVP beyond `updateGoal` (which doesn't touch `isCompleted`).
  > **Known tradeoff — `isCompleted` is a soft tag, not a lifecycle state.** Because completed goals
  > remain fully mutable, `isCompleted` currently means "the user labelled this done," not "this goal
  > is closed and immutable." Accepted for MVP (it keeps the model simple and matches "manual only").
  > Flag for later: if analytics ("active vs finished savings"), strict UI filtering, or automation
  > (auto-complete, notifications) are added, `isCompleted` will likely need to harden into a real
  > lifecycle state (e.g. lock contributions on complete, add an explicit re-open transition). Don't
  > build that now — just don't assume `isCompleted` implies immutability anywhere downstream.
- **Hard delete, no undo.** Unlike transactions/budgets/accounts, `Goal` has no `deletedAt`.
  Deletion is irreversible and cascades to all contributions — hence the confirm dialog, not a
  snackbar. The dialog copy states the contribution count ("This also deletes N contributions").
  **The count comes from the already-loaded `GoalCard.contributions.length`** — `getGoals` includes
  the contributions, so `GoalsView` passes the count straight into the dialog. Do **not** add a
  separate count query or a server round-trip for it.
- **The overdue rule lives only in `isGoalOverdue` (§8).** Both the dashboard widget badge and the
  card badge call it; the date comparison floors both sides to UTC midnight and uses strict `<`,
  so a goal due *today* is not overdue. Never re-derive overdue inline (the dashboard fetcher's old
  inline check is deleted in step 3).
- **No goal count limit.** Budgets & goals are "Unlimited" on both Free and Pro (Monetization →
  Plans). Do not add a cap.
- **Goals never touch accounts or budgets.** No balance changes, no budget consumption — purely
  virtual progress. Do not revalidate `/transactions` or `/budgets`.
- **Currency dormant.** Goal `currency` is always EUR (`DEFAULT_CURRENCY`); `User.preferredCurrency`
  must not influence goals (it's `"USD"` by default and treated as dormant until multi-currency —
  see account spec §10). `formatCurrency` is called without a currency arg (EUR default), matching
  the existing widget.
- **Decimal → number serialization.** Never pass a Prisma `Decimal` to a client component;
  `mapGoalCard`/`mapGoalRow` convert (`Number(...)`). Safe because every figure is
  `Decimal(12,2)`, far inside `Number.MAX_SAFE_INTEGER` at 2 fractional digits (same reasoning as
  the account slice).
- **`targetDate` is a calendar date.** Store via `dateInputToUtc` (UTC midnight, no zone); read
  back via `toDateInputValue`. Overdue compares against `startOfUtcDay(new Date())` for a clean
  day boundary (reuse [src/lib/date.ts](../../src/lib/date.ts)).
- **Empty contributions list.** A goal with zero contributions has `currentAmount === 0` and an
  empty contribution drawer list — show a small "No contributions yet" line, not a blank panel.

---

## 12. Testing (`test/`, Vitest, mock `@/lib/prisma` + `@/auth`)

**`test/lib/goals.test.ts`**
- `isGoalOverdue`: true only when `targetDate < now && !isCompleted && currentAmount < targetAmount`;
  false when no target date, when completed, when fully funded, when target date is future.
  Inject a fixed `now`.
- `goalProgressPercent`: 0 at zero/negative target; clamps a >100% case to 100; clamps a negative
  `saved` to 0; rounds.
- `mapGoalRow` / `mapGoalCard`: Decimal → number, color cycling by index, overdue passthrough.

**`test/actions/goals.test.ts`**
- Unauthorized (no session) → `NOT_AUTHED` for all six actions.
- `createGoal`: valid input inserts with session `userId`, `currency === "EUR"`, `currentAmount === 0`,
  `isCompleted === false`; invalid (empty name, zero/negative target, target over `GOAL_AMOUNT_MAX`)
  → validation error, no prisma write.
- `createGoal`: a client-supplied `currency`/`currentAmount`/`isCompleted` is ignored, not trusted.
- `updateGoal`: ownership scoping (`where` includes `userId`); foreign/unknown id → `"Goal not found."`;
  never writes `currentAmount`/`isCompleted`.
- `completeGoal`: sets `isCompleted: true`, scoped by `userId`; independent of progress (works at <100%).
- `deleteGoal`: hard `delete` scoped by `userId`; foreign id → not found, no delete.
- `addContribution`: **both** writes occur in one `$transaction` — assert `goalContribution.create`
  **and** `goal.update({ currentAmount: { increment } })` are issued; foreign goal id → throws/rolls
  back, no contribution created. Negative amount (withdrawal) is accepted and increments by the
  negative value (i.e. decreases `currentAmount`). Zero amount rejected.
- `deleteContribution`: atomic delete + `decrement` by the deleted row's amount; **the decrement
  uses the stored row amount, not an input value** — assert the action takes only `id`, reads the
  row, and the `goal.update` decrement equals the mocked stored amount (not anything the caller
  passed). Ownership enforced via the contribution's parent goal `userId`; foreign id → not found.

Run `npm run test:run` and `npm run build` before commit (per [ai-interaction.md](../../docs/ai-interaction.md) workflow).

---

## 13. Implementation order

1. Constants (`GOAL_AMOUNT_MAX`, move `GOAL_COLORS`) + types (`src/types/goals.ts`) + Zod schemas (no deps).
2. `src/lib/goals.ts` pure helpers + `test/lib/goals.test.ts` (TDD-friendly).
3. `src/lib/db/goals.ts` fetchers; migrate `dashboard.ts` to import `getGoalsSummary` and delete its
   local `getGoals`/`GOAL_COLORS`/inline overdue math. Verify the dashboard widget still renders.
4. `revalidateGoalViews()` in `revalidation.ts`.
5. Server actions + `test/actions/goals.test.ts` (focus on the atomic contribution side-effects).
6. `/goals` page + components (view, card, both drawers, empty state, confirm dialog).
7. Wire dashboard `GoalsWidget` "View all →" to `/goals`.
8. `npm run test:run` + `npm run build`; manual browser pass: create goal → appears on `/goals`
   and dashboard widget → add contribution → progress updates on both → add withdrawal → progress
   drops → mark complete → moves to Completed → delete → confirm dialog → gone.

---

## 14. Decisions

### Resolved (baked into this spec)

- **`isCompleted` is manual only** — no auto-complete at 100% (architecture doc wins over
  entity-types.md; [ROADMAP.md](../ROADMAP.md) Spec Alignment Notes).
- **`deleteGoal` is a hard delete** cascading to contributions — no soft delete / snackbar undo;
  guarded by a confirm dialog instead.
- **Contribution `amount` is signed + nonzero**, taken verbatim (negative = withdrawal). No
  server-side sign derivation (unlike transactions).
- **`currentAmount` maintained transactionally** via atomic `increment`/`decrement`; never clamped
  at the data layer.
- **Single fetcher** — the dashboard and `/goals` share `src/lib/db/goals.ts`; overdue/progress
  logic lives only in `src/lib/goals.ts`.
- **EUR-only** — goal `currency` server-stamped `DEFAULT_CURRENCY`; `preferredCurrency` dormant.
- **`get*` fetcher naming** kept for repo consistency (`getGoals`, `getGoalsSummary`, `getGoalForEdit`).
- **No `uncompleteGoal` in MVP.** Completion is a lightweight manual status, not a strict business
  state; defer an un-complete action until there's a demonstrated need (delete + recreate covers
  the rare case). Do not build it now.
- **"Mark complete" lives in the goal-card overflow menu**, not the edit drawer. Completion is an
  *action on* the goal, not an edit of its data — keeping it on the card avoids duplicate
  affordances and keeps `goal-form-drawer.tsx` single-purpose (pure data edit).
- **Progress is a bar, not a ring.** Reuses the dashboard widget's track styling (lowest effort,
  visual consistency) and degrades cleanly for overfunded goals (clamp to 100% width). The
  roadmap's "ring or bar" is resolved to **bar**.
- **Overdue comparison floors both sides to UTC midnight with strict `<`** (§8) — a goal due today
  is not overdue.
- **Editing the target below the saved amount is allowed** (overfunded, clamps to 100%, not
  auto-completed) — §11. No "target must exceed saved" validation.
- **Delete-dialog contribution count** comes from the already-loaded `GoalCard.contributions` —
  no extra query (§11).

### Still open

None — all decisions resolved. The notes above are the authoritative choices for implementation.
