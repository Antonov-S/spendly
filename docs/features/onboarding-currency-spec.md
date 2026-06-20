# Onboarding + Currency Fixes — Implementation Spec

> **Goal:** Guide a freshly registered user from an empty account to a usable dashboard, and fix the
> latent USD/EUR currency drift that makes preset budgets disagree with every account and
> transaction. Bundles [ROADMAP.md](../ROADMAP.md) **§1 (Onboarding / First-Run Gate)** and
> **§0 (Known Inconsistencies)** — Delivery Sequence slot **#2**.

This spec follows the patterns in [entity-crud-architecture.md](../entity-crud-architecture.md) and
the field-level rules in [entity-types.md](../entity-types.md). It mirrors the already-shipped
**Financial Account**, **Budgets**, and **Goals** slices, and reuses their actions wholesale —
this slice adds almost no new data layer, it wires existing actions into a first-run flow and
corrects a currency default.

---

## 1. Why this slice (and why these two together)

A real (non-seeded) signup lands on `/dashboard` with **zero accounts, zero transactions**. The
core loop already works end-to-end for seeded users, but a brand-new user has no proactive guide:
the dashboard shows seed-shaped chrome with nothing in it, and the only way to create an account is
to discover `/accounts` directly. The Financial Account, Budgets, and Goals slices all shipped their
*actions* — this slice supplies the **first-run flow that calls them in order**.

The currency fix rides along because it touches the **same surfaces** (budget currency, onboarding's
starter-budget step, `preferredCurrency`). It is a latent correctness bug, not a feature:
`User.preferredCurrency` defaults to `"USD"`, and `createBudget` / `seedPresetBudgets`
([src/actions/budgets.ts](../../src/actions/budgets.ts)) stamp that value onto budgets — so a new
user's preset budgets are created in **USD** while every account, transaction, and goal is **EUR**.
Onboarding's Step 2 *is* `seedPresetBudgets`, so fixing the currency here means the very first
budgets a user creates are correct. Bundling avoids touching the budget actions twice.

---

## 2. Scope

### In scope — Part A: Currency fixes (§0)

- **Resolve budget currency from `DEFAULT_CURRENCY`, not `preferredCurrency`.** `createBudget` and
  `seedPresetBudgets` stop reading `User.preferredCurrency` and stamp `DEFAULT_CURRENCY` (EUR), per
  the financial-account spec §10 invariant (currency resolved server-side, never user-derived).
- **Reconcile the schema defaults to EUR** via a Prisma migration: `User.preferredCurrency` and the
  other `@default("USD")` currency columns → `"EUR"`, plus a one-time backfill of existing `"USD"`
  rows (the app is EUR-only; any stored USD is wrong).
- **Treat `preferredCurrency` as dormant everywhere else** — it is displayed read-only on `/profile`
  but never drives currency selection until multi-currency lands (account spec §10).
- **Fix the account drawer's hardcoded `$` prefix** → `€` (EUR-only display correctness).
- **Verify the existing empty states actually render** on a zero-data account: `BudgetEmptyState`,
  `RecurringEmptyState`, `AccountEmptyState` (§0 second bullet — confirm by inspection, not changelog).

### In scope — Part B: Onboarding (§1)

- **Soft first-run redirect guard.** A reusable server guard that redirects authenticated users with
  **no active financial account** from the *data surfaces* (`/dashboard`, `/transactions`,
  `/budgets`, `/recurring`, `/goals`, and `/reports` once it exists) to `/onboarding`.
- **`/onboarding` page** — a dedicated route (not a modal wizard) with a 3-step flow:
  Step 1 create first account (cannot skip) → Step 2 seed starter budgets (optional) → Step 3 done.
- **Reachability carve-out.** `/accounts` and `/profile` stay reachable for zero-account users (an
  escape hatch — a user who just archived their last account must be able to create/unarchive one).
- **`/onboarding` reverse guard.** A user who already has an active account is redirected off
  `/onboarding` → `/dashboard` (no re-running a completed flow).
- **Auth-protect `/onboarding`** in `auth.config.ts` (it requires a session).
- **Dashboard zero-state fallback** — a defensive empty card if a zero-account user reaches the
  dashboard despite the guard (e.g. guard bypassed / race). Minimal, links to onboarding.

### Out of scope (explicit)

- **Currency *picker* / multi-currency.** No UI to choose currency anywhere. EUR-only stays;
  widening is the post-MVP slice documented in account spec §10. We only fix the *default* and the
  *resolution source*.
- **Named category presets (Personal / Freelancer / Family).** Resolved below (§6) to **one**
  "starter budgets" action — the existing `seedPresetBudgets`. No `BUDGET_PRESETS` variants, no
  category-visibility/favourites model (post-MVP, per ROADMAP §1 open question, recommendation (a)).
- **A hard onboarding lock.** The guard *nudges*, it does not imprison: `/accounts` + `/profile`
  stay open, and a determined user reaching `/accounts` directly is fine.
- **Onboarding for OAuth provider account linking, currency step, avatar upload, etc.** The spec's
  onboarding "Step 2 — pick preferred currency" is deferred while EUR-only (overview Onboarding MVP
  note); onboarding never asks for currency.
- **Persisted "onboarding completed" flag.** Completion is *derived* from `activeAccountCount > 0`,
  not stored — no `User.onboardedAt` column (see §10 decision).

---

## 3. Data model

**No new tables. One migration: column-default changes + backfill.**

| Column | Current | After |
|---|---|---|
| `User.preferredCurrency` | `@default("USD")` | `@default("EUR")` |
| `FinancialAccount.currency` | `@default("USD")` | `@default("EUR")` |

> The non-defaulted `currency` columns (`Transaction`, `Budget`, `Goal`, `RecurringTemplate`) have
> no schema default — they are always written explicitly by their create actions, which already
> resolve EUR (accounts/goals) or, after Part A, `DEFAULT_CURRENCY` (budgets). They need no schema
> change; the backfill (below) corrects any historical `"USD"` rows.

### Migration

Generate with `prisma migrate dev --name reconcile_currency_eur_default` (per coding standards —
never `db push`), then **edit the generated SQL** to add a backfill *before* committing (the
`--create-only` / hand-edit pattern already used by the recurring partial-index migration):

```sql
-- Reconcile schema defaults to EUR (app is single-currency EUR; "USD" defaults were latent bugs).
ALTER TABLE "User" ALTER COLUMN "preferredCurrency" SET DEFAULT 'EUR';
ALTER TABLE "FinancialAccount" ALTER COLUMN "currency" SET DEFAULT 'EUR';

-- One-time backfill: any row stamped USD predates the EUR-only resolution and is wrong.
UPDATE "User"             SET "preferredCurrency" = 'EUR' WHERE "preferredCurrency" = 'USD';
UPDATE "FinancialAccount" SET "currency"          = 'EUR' WHERE "currency"          = 'USD';
UPDATE "Budget"           SET "currency"          = 'EUR' WHERE "currency"          = 'USD';
UPDATE "Goal"             SET "currency"          = 'EUR' WHERE "currency"          = 'USD';
UPDATE "Transaction"      SET "currency"          = 'EUR' WHERE "currency"          = 'USD';
UPDATE "RecurringTemplate" SET "currency"         = 'EUR' WHERE "currency"          = 'USD';
```

Apply to `development` first (Neon `br-hidden-bonus-aqksw1pa`), then `prisma migrate deploy` to
production at launch. Schema change is limited to the two `@default(...)` literals.

#### Pre-flight verification (run before applying — the backfill is hard to reverse)

The `UPDATE`s are **forward-only**: once `"USD"` → `"EUR"`, the original values are gone (there is
no column recording the prior currency). So **before** applying on any branch, run this read-only
inventory and eyeball the result — confirm every USD row is an expected default artifact (demo
users' `preferredCurrency`, pre-Part-A budgets), not a surprise:

```sql
-- Read-only: how many USD rows exist, per table? Expect only default-artifact rows.
SELECT 'User'              AS tbl, count(*) FROM "User"              WHERE "preferredCurrency" = 'USD'
UNION ALL SELECT 'FinancialAccount',  count(*) FROM "FinancialAccount"  WHERE "currency" = 'USD'
UNION ALL SELECT 'Budget',            count(*) FROM "Budget"            WHERE "currency" = 'USD'
UNION ALL SELECT 'Goal',              count(*) FROM "Goal"              WHERE "currency" = 'USD'
UNION ALL SELECT 'Transaction',       count(*) FROM "Transaction"       WHERE "currency" = 'USD'
UNION ALL SELECT 'RecurringTemplate', count(*) FROM "RecurringTemplate" WHERE "currency" = 'USD';
```

If any count is unexpectedly high (e.g. real imported data), **stop and reassess** — do not run the
backfill blind. On `production`, per CLAUDE.md this is an explicitly-authorized, confirm-first step;
run the inventory there only when the user has approved touching the production branch. The demo
seed sets no explicit currency, so demo users will legitimately show `User.preferredCurrency = 'USD'`
— that is exactly the artifact the backfill is meant to correct, and an expected non-zero count.

> **Why backfill the non-defaulted columns too.** Pre-Part-A `createBudget`/`seedPresetBudgets`
> already wrote `preferredCurrency` (`"USD"`) onto real budgets. Those rows are stale data, not just
> a default. The backfill is idempotent and scoped to `= 'USD'`, so it is safe to run once.

> **Migration assumption — every stored `"USD"` is a default artifact, not a real USD record.**
> This backfill is only safe because **the app has never been multi-currency**: there is no currency
> picker, no FX, and every write path resolves EUR server-side. The only way a `"USD"` value exists
> is the schema default leaking through (`User.preferredCurrency`, the pre-Part-A budget currency
> bug). **There are no legitimate USD users, accounts, transactions, budgets, goals, or templates** —
> so rewriting `= 'USD'` → `'EUR'` cannot corrupt a real monetary record. Before running this on a
> branch that might hold genuine non-EUR data, **stop and confirm**: if real USD data ever exists,
> this `UPDATE` is destructive and must be reconsidered. For the current EUR-only MVP on `development`
> and `production`, the assumption holds.

---

## 4. File plan

| Part | Layer | File | Action |
|---|---|---|---|
| A | Schema/migration | `prisma/schema.prisma` + new migration | **modify** — two `@default("EUR")`; SQL backfill |
| A | Actions | `src/actions/budgets.ts` | **modify** — `createBudget` + `seedPresetBudgets` stamp `DEFAULT_CURRENCY`; drop `preferredCurrency` lookups |
| A | Components | `src/components/accounts/account-form-drawer.tsx` | **modify** — `$` → `€` prefix (2 spots); use `DEFAULT_ACCOUNT_COLOR`/`DEFAULT_ACCOUNT_ICON` instead of `ACCOUNT_COLORS[0]`/`ACCOUNT_ICONS[0]` |
| B | Constants (UI) | `src/lib/constants.ts` | **modify** — add `DEFAULT_ACCOUNT_COLOR`, `DEFAULT_ACCOUNT_ICON` (shared by drawer + onboarding) |
| B | Guard | `src/lib/auth/guards.ts` | **modify** — add `requireOnboarded()` (session + active-account check → `/onboarding`) and `redirectIfOnboarded()` (reverse guard for `/onboarding`) |
| B | DB read | `src/lib/db/accounts.ts` | **modify** — add `getActiveAccountCount(userId)` (lean `count`) |
| B | Auth | `src/auth.config.ts` | **modify** — add `/onboarding` to `isProtected` |
| B | Page | `src/app/onboarding/page.tsx` | **create** — server component; reverse-guard, render flow |
| B | Components | `src/components/onboarding/onboarding-flow.tsx` | **create** — client coordinator (step state) |
| B | Components | `src/components/onboarding/onboarding-account-step.tsx` | **create** — inline first-account form → `createFinancialAccount` |
| B | Components | `src/components/onboarding/onboarding-budgets-step.tsx` | **create** — starter-budgets + skip → `seedPresetBudgets` |
| B | Components | `src/components/onboarding/onboarding-done-step.tsx` | **create** — confirmation + CTA → `/dashboard` |
| B | Pages | `src/app/{dashboard,transactions,budgets,recurring,goals}/page.tsx` | **modify** — swap `getSessionOrRedirect()` → `requireOnboarded()` |
| B | Components | `src/components/dashboard/*` | **modify** — defensive zero-account fallback card (minimal) |
| A/B | Tests | `test/actions/budgets.test.ts` | **modify** — assert EUR currency, no `preferredCurrency` read |
| B | Tests | `test/lib/auth/guards.test.ts` | **create** — `requireOnboarded` / `redirectIfOnboarded` branching |

> Reuses existing `DEFAULT_CURRENCY` (`src/lib/currency.ts`) and `BUDGET_PRESETS`
> (`src/lib/constants.ts`). Adds two small UI constants — `DEFAULT_ACCOUNT_COLOR`,
> `DEFAULT_ACCOUNT_ICON` (see §6.4). If onboarding copy needs centralized strings, add an
> `ONBOARDING_STEPS` UI constant to `src/lib/constants.ts` (per the constants-split rule — no magic
> strings in components).

---

## 5. Part A — Currency fixes (detail)

### 5.1 Budget actions stop reading `preferredCurrency`

In [src/actions/budgets.ts](../../src/actions/budgets.ts), `createBudget` and `seedPresetBudgets`
currently do:

```ts
const { preferredCurrency } = await prisma.user.findUniqueOrThrow({
  where: { id: userId },
  select: { preferredCurrency: true },
});
// ...currency: preferredCurrency
```

Replace with the imported constant — this also **removes a DB round-trip** per call:

```ts
import { DEFAULT_CURRENCY } from "@/lib/currency";
// ...currency: DEFAULT_CURRENCY   // EUR; never user-derived (account spec §10)
```

Both the `upsert` (`create` + `update` branches) in `createBudget` and the `createMany` rows in
`seedPresetBudgets` use `DEFAULT_CURRENCY`. Delete the now-unused `user.findUniqueOrThrow` lookups.

> **Why not keep reading `preferredCurrency`?** Because it is dormant and defaults to a wrong value.
> Currency must resolve from the product-level policy module (account spec §10 invariant #2), the
> same way accounts and goals already do. `preferredCurrency` is presentation-only until
> multi-currency exists.

### 5.2 Account drawer currency symbol

[account-form-drawer.tsx](../../src/components/accounts/account-form-drawer.tsx) hardcodes `$` in
two places (the large starting-balance input prefix and the read-only edit display). The app is
EUR-only; change both to `€`. (`formatCurrency` already defaults to EUR everywhere else — this is the
one literal that slipped through.)

### 5.3 Empty-state verification (no code unless broken)

§0's second bullet: confirm by inspection/runtime that `BudgetEmptyState`, `RecurringEmptyState`,
and `AccountEmptyState` actually render on a zero-data account before relying on them in onboarding.
`AccountEmptyState` is confirmed (renders via `AccountsView` when `accounts.length === 0`). Verify the
budgets and recurring equivalents fire on their pages with no rows; fix only if a page fails to render
its empty component. This is a QA checklist item, not a build task.

---

## 6. Part B — Onboarding (detail)

### 6.1 The guard model (the core mechanism)

The redirect is **not** middleware. `src/proxy.ts` runs on the edge via `auth.config.ts`, which
cannot touch Prisma — it can't count accounts. So the first-run gate is a **per-page server guard**,
counting accounts in the Node runtime.

Add to [src/lib/db/accounts.ts](../../src/lib/db/accounts.ts):

```ts
/** Count of the user's *active* (non-archived) accounts — the onboarding gate signal. */
export async function getActiveAccountCount(userId: string): Promise<number> {
  return prisma.financialAccount.count({
    where: { userId, isArchived: false },
  });
}
```

Add to [src/lib/auth/guards.ts](../../src/lib/auth/guards.ts):

```ts
/**
 * Guard for data surfaces: require a session AND at least one active account.
 * A signed-in user with zero active accounts is redirected to /onboarding so the
 * first-run flow can guide them. Returns the session (with guaranteed user.id)
 * for the page to use.
 */
export async function requireOnboarded(): Promise<Session> {
  const session = await getSessionOrRedirect();
  const count = await getActiveAccountCount(session.user.id);
  if (count === 0) redirect("/onboarding");
  return session;
}

/**
 * Reverse guard for /onboarding itself: a user who already has an active account
 * has finished onboarding — send them to the dashboard so the flow can't re-run.
 */
export async function redirectIfOnboarded(): Promise<Session> {
  const session = await getSessionOrRedirect();
  const count = await getActiveAccountCount(session.user.id);
  if (count > 0) redirect("/dashboard");
  return session;
}
```

**Wiring** — on every data surface, replace the opening `getSessionOrRedirect()` with
`requireOnboarded()`:

| Page | Guard |
|---|---|
| `/dashboard`, `/transactions`, `/budgets`, `/recurring`, `/goals`, `/reports`† | `requireOnboarded()` |
| `/onboarding` | `redirectIfOnboarded()` |
| `/accounts`, `/profile` | unchanged `getSessionOrRedirect()` — **escape hatches, stay reachable** |

† `/reports` doesn't exist yet (ROADMAP §5); apply `requireOnboarded()` when it's built. Note it in
that spec rather than stubbing a page here.

> **Why "active" (non-archived) and not total accounts.** The gate signal is "can this user
> actually capture a transaction right now?" Archived accounts can't receive transactions, so a user
> whose only account is archived is functionally at zero and *should* be guided to create/unarchive
> one. `isArchived: false` matches the same predicate `getUserAccounts` uses for every selector — one
> consistent definition of "usable account."

> **Why completion isn't stored.** Onboarding is "done" exactly when an active account exists. A
> derived check needs no `User.onboardedAt` column, no migration, and can never drift from reality
> (e.g. a user who archives their last account correctly re-enters the flow). The cost is one cheap
> indexed `count` per data-surface render — acceptable, and these pages are already `force-dynamic`.

> **Known cost — one `count` query per protected render (accepted for MVP).** Because the gate is
> derived rather than stored, *every* render of a guarded page issues a `financialAccount.count`
> (indexed on `userId`, sub-millisecond). At MVP traffic this is negligible and not worth caching.
> **If traffic grows, optimize without re-introducing a drift-prone stored flag:** the cleanest path
> is to surface a lightweight `hasActiveAccount` boolean on the **session/JWT** (set in the NextAuth
> `session`/`jwt` callback, invalidated when an account is created or archived), so the guard reads it
> from the already-loaded session instead of hitting the DB. That keeps "onboarded" derived from real
> state while removing the per-render query. **Do not build this now** — it is a documented future
> optimization, not MVP scope; the `getActiveAccountCount` fetcher is the seam it would slot behind.

### 6.2 Registration / OAuth landing — no special branch needed

Both entry paths converge on the guard:

- **Email/password:** `register-form` → `/verify-email` or `/sign-in` (unchanged). After sign-in,
  the user lands on `/dashboard` (auth.config redirects authed users off `/sign-in`), where
  `requireOnboarded()` bounces them to `/onboarding`.
- **Google OAuth:** lands on `/dashboard` → `requireOnboarded()` → `/onboarding`.

No change to `register-form.tsx` or the OAuth callback — the guard is the single chokepoint. This is
simpler and has no second code path to keep in sync.

### 6.3 Auth-protect `/onboarding`

In [src/auth.config.ts](../../src/auth.config.ts), extend `isProtected` so an unauthenticated user
hitting `/onboarding` is redirected to sign-in (consistent with `/dashboard`):

```ts
const isProtected =
  pathname.startsWith("/dashboard") ||
  pathname.startsWith("/profile") ||
  pathname.startsWith("/onboarding");
```

(Data routes like `/budgets`, `/goals` rely on their server-component guard rather than the edge
`authorized` callback today; `/onboarding` joins `/dashboard`/`/profile` in the edge list for an
early bounce, and still has its own `redirectIfOnboarded()` server guard.)

### 6.4 `/onboarding` page + flow

**Page — `src/app/onboarding/page.tsx`** (server component):

- `export const dynamic = "force-dynamic";`
- `const session = await redirectIfOnboarded();` (reverse guard — completed users leave).
- Renders `<OnboardingFlow userName={session.user.name ?? null} />` inside a centered, focused
  layout (no app sidebar/topbar chrome — onboarding is its own surface). Reuse the auth pages'
  centered-card shell pattern (`AuthCard`-style container) rather than `AppShell`.

**`onboarding-flow.tsx`** (client coordinator):

- Local `useState<1 | 2 | 3>` step state (no URL param — the flow is short and linear; a refresh
  restarting at step 1 is acceptable, and a completed step-1 user is caught by the reverse guard on
  reload anyway).
- A 3-dot / "Step N of 3" progress indicator.
- Step 1 → on success advance to 2; Step 2 (seed or skip) → advance to 3; Step 3 → `Link`/router
  push to `/dashboard`.

**`onboarding-account-step.tsx`** (Step 1 — cannot skip):

- Inline form (not the slide-in `AccountFormDrawer` — onboarding *is* the focus surface, a drawer
  is the wrong affordance here). Fields: **name**, **type** (`ACCOUNT_TYPE_OPTIONS`), **starting
  balance** (`€` prefix). Color/icon default to `DEFAULT_ACCOUNT_COLOR` / `DEFAULT_ACCOUNT_ICON`
  (new constants — see below) — keep Step 1 to the minimum required fields; users refine color/icon
  later on `/accounts`.

> **Centralize the account defaults — don't couple to array order.** Today
> [account-form-drawer.tsx](../../src/components/accounts/account-form-drawer.tsx) seeds its
> defaults as `ACCOUNT_COLORS[0]` / `ACCOUNT_ICONS[0]`, hardwiring "the default is whatever happens to
> be first in the array." Onboarding would inherit the same fragile coupling. Add named constants to
> `src/lib/constants.ts` and have **both** the drawer and onboarding read them, so reordering the
> palette can never silently change the default:
>
> ```ts
> // src/lib/constants.ts
> export const DEFAULT_ACCOUNT_COLOR = ACCOUNT_COLORS[0]; // "#1D9E75"
> export const DEFAULT_ACCOUNT_ICON = ACCOUNT_ICONS[0];   // "Wallet"
> ```
>
> Then refactor the drawer's `useState(ACCOUNT_COLORS[0])` / `useState(ACCOUNT_ICONS[0])` and its
> reset branch to use these constants. Small, in-scope cleanup since this slice already touches the
> drawer (§5.2) and introduces a second default consumer.
- Submits via `useTransition` to the **existing** `createFinancialAccount` action (no new action).
- On success: `router.refresh()` is **not** needed; just advance the local step. The account now
  exists, so if the user later reloads `/onboarding` the reverse guard moves them on.
- On error: inline message (same pattern as the drawer).

**`onboarding-budgets-step.tsx`** (Step 2 — optional):

- Explains starter budgets for the current month; primary button **"Add starter budgets"** calls the
  **existing** `seedPresetBudgets(month, year)` (current `new Date()` month/year, computed in the
  step). Secondary **"Skip for now"** link advances without seeding.
- After Part A, the seeded budgets are EUR — correct from the first budget.
- On success (`{ created }`): toast "Added N starter budgets", advance to Step 3.

> **Skipping loses nothing.** A user who skips (or abandons) this step can seed the identical starter
> budgets later from the **Budgets page** — `BudgetEmptyState` already exposes the same
> `seedPresetBudgets` action via its "Use starter budgets" CTA (shipped with the Budgets slice). The
> onboarding step is a convenience shortcut, not the only entry point; nothing is permanently missed.
> The step copy may optionally reassure the user of this ("You can add these anytime from Budgets").

**`onboarding-done-step.tsx`** (Step 3):

- Congratulatory confirmation; single CTA **"Go to dashboard"** → `/dashboard`. The guard now passes
  (an active account exists).

> **Resolved — single "starter budgets", no named presets.** Per ROADMAP §1's open question, we ship
> recommendation **(a)**: the one existing `BUDGET_PRESETS` set via `seedPresetBudgets`. No
> Personal/Freelancer/Family variants and no category-visibility model — those would require
> inventing a favourites concept for no MVP benefit (all 20 categories are already system-seeded).

> **Onboarding is "complete" the instant Step 1 succeeds — Steps 2 & 3 are abandonable.** Because
> completion is derived from `activeAccountCount > 0` (§6.1), the user is considered onboarded the
> moment `createFinancialAccount` returns success — *before* they see Steps 2 or 3. This is the
> intended design: a user who creates an account and then closes the tab, hits Back, or navigates
> away mid-flow is **done** — Step 2 (budgets) is explicitly optional and Step 3 is pure
> confirmation. On their next visit, `requireOnboarded` passes and `redirectIfOnboarded` sends them
> off `/onboarding` to the dashboard. **No partial-onboarding state is tracked or recoverable**, and
> none is needed: the only mandatory artifact (an account) already exists. Do not add
> "resume where you left off" logic.

### 6.5 Dashboard defensive zero-state

With the guard in place, a zero-account user normally never reaches `/dashboard`. As a defensive
fallback (guard bypass, client nav race), the dashboard should not render a broken seed-shaped shell
with `€0.00` and empty panels as if it were real. Minimal treatment: when
`accounts.length === 0`, render a single centered card — "Create your first account to get started"
with a button/link to `/onboarding` — in place of the metric strip + content columns. This is a thin
guard branch in the dashboard page/shell, **not** a full empty-state redesign of every panel.

> Other pages' empty states (`/transactions`, `/budgets`, `/recurring`, `/goals`) already exist
> (§5.3) and handle the has-account-but-no-data case — those users *do* reach the pages. Only the
> dashboard needs this extra zero-account fallback because it has no single "list" to show empty.

> **Keep the fallback independent of the guard — it is a standalone safety net.** The zero-account
> branch must key purely off the dashboard's own fetched data (`accounts.length === 0`), **not** off
> `requireOnboarded`'s decision or any shared "is onboarded" helper. The two are deliberately
> redundant: the guard normally prevents a zero-account user from ever reaching the dashboard, and
> this branch is the defense for when it doesn't (guard bypass, client nav race, a future guard
> change). It must continue to render correctly even if the dashboard's data-fetching is later
> refactored — so the check belongs in the dashboard page/shell against locally-fetched accounts, and
> any refactor of the fetch logic must preserve the `accounts.length === 0` guard branch. Do not
> collapse it into the guard or assume the guard makes it unreachable.

---

## 7. Edge cases & rules

- **Guard runs in Node, not edge.** `requireOnboarded` / `redirectIfOnboarded` import the Prisma
  fetcher and must live in server components / `server-only` modules — never in `auth.config.ts` or
  `proxy.ts` (edge runtime, no Prisma).
- **No redirect loop.** `/onboarding` uses `redirectIfOnboarded` (sends *completed* users out);
  data pages use `requireOnboarded` (sends *incomplete* users in). The predicates are exact
  complements on the same `getActiveAccountCount` signal, so a user is in exactly one bucket.
- **Escape hatches stay open.** `/accounts` and `/profile` must keep plain `getSessionOrRedirect`.
  A user who archived their last account lands back at zero accounts; the data pages push them to
  `/onboarding`, but they can still reach `/accounts` to unarchive — never trapped.
- **Currency resolution is server-side only.** No client input sets currency anywhere; Part A keeps
  every write stamping `DEFAULT_CURRENCY`/EUR (account spec §10 invariant #2).
- **Backfill is one-shot and scoped.** The migration's `UPDATE ... WHERE = 'USD'` is idempotent and
  only touches stale USD rows; running it once on dev then prod is safe.
- **`preferredCurrency` stays in the schema and on `/profile`** (read-only display). It is dormant,
  not removed — the multi-currency upgrade (account spec §10) will revive it. Do not delete the
  column or the profile row.
- **Onboarding step state is ephemeral.** A page reload restarts at Step 1 visually, but a user who
  already created an account in Step 1 is caught by `redirectIfOnboarded` on reload and sent to the
  dashboard — so they never redo Step 1 against a now-non-empty account.
- **Seeding is idempotent.** `seedPresetBudgets` already skips any category with an existing row for
  the period, so a user who runs Step 2, navigates back, and runs it again creates no duplicates.

---

## 8. Testing (`test/`, Vitest, mock `@/lib/prisma` + `@/auth`)

**`test/actions/budgets.test.ts`** (modify):
- `createBudget` stamps `currency: "EUR"` (`DEFAULT_CURRENCY`) on both the `create` and `update`
  branches of the upsert; assert no `user.findUnique*` call for `preferredCurrency`.
- `seedPresetBudgets` writes `currency: "EUR"` on every `createMany` row; no `preferredCurrency` read.
- A user whose `preferredCurrency` is `"USD"` still gets EUR budgets (the value is ignored).

**`test/lib/auth/guards.test.ts`** (create):
- `requireOnboarded`: no session → redirects to `/sign-in` (via `getSessionOrRedirect`); session +
  `getActiveAccountCount === 0` → `redirect("/onboarding")`; session + count > 0 → returns the
  session, no redirect.
- `redirectIfOnboarded`: count > 0 → `redirect("/dashboard")`; count === 0 → returns session.
- Mock `redirect` (assert called with the right path) and `getActiveAccountCount`.

> Server components and the onboarding React components are **not** unit-tested (components are out of
> scope per coding standards). Coverage targets the guard logic and the budget-currency contract.

Run `npm run test:run` and `npm run build` before commit (per
[ai-interaction.md](../ai-interaction.md) workflow).

### Manual QA — happy path (new user)

1. Register a brand-new user → sign in → lands on `/onboarding` (not `/dashboard`).
2. Step 1: create an account → advances to Step 2.
3. Step 2: "Add starter budgets" → toast with count → advances to Step 3.
4. Step 3: "Go to dashboard" → `/dashboard` renders real data (no redirect back).
5. `/budgets` shows the seeded budgets formatted in **€**, not `$`.

### Manual QA — abandonment

6. New user, Step 1 only: create account, then immediately hit Back / close-and-reopen the tab →
   revisiting `/onboarding` redirects to `/dashboard` (account exists ⇒ onboarded; §6.4 abandonment).
7. Confirm no starter budgets were created (Step 2 was skipped) and the dashboard still works.

### Manual QA — archived-account recovery (critical — completion is derived from active accounts)

This flow exercises the exact reason the gate uses *active* accounts and keeps escape hatches open;
validate it explicitly, not just as a side note of the happy path:

8. As an onboarded user with exactly **one** active account, go to `/accounts` and **archive** it.
9. Navigate to `/dashboard` → bounces to `/onboarding` (zero active accounts ⇒ re-enters the flow).
10. Repeat for `/transactions`, `/budgets`, `/recurring`, `/goals` → each bounces to `/onboarding`.
11. From the bounced state, navigate to `/accounts` → **reachable** (not redirected) — the escape
    hatch. Confirm `/profile` is likewise reachable.
12. **Unarchive** the account on `/accounts` → `/dashboard` now loads normally (no bounce); the user
    is back in without ever being trapped.
13. Alternative recovery: instead of unarchiving, **create a new account** from `/accounts` → same
    result (any active account satisfies the gate).

---

## 9. Implementation order

1. **Part A first (isolated, low-risk).** Edit `budgets.ts` to stamp `DEFAULT_CURRENCY`; fix the
   account-drawer `$`→`€`. Update `test/actions/budgets.test.ts`. Run tests.
2. **Migration.** Run the §3 pre-flight inventory on `development` first; confirm USD counts are
   expected artifacts. Then `prisma migrate dev --name reconcile_currency_eur_default`, hand-edit to
   add the backfill SQL, apply to `development`. Verify `prisma migrate status` clean. (Production
   backfill is a separate, explicitly-authorized launch-time step.)
3. **Guard layer.** `getActiveAccountCount` in `db/accounts.ts`; `requireOnboarded` /
   `redirectIfOnboarded` in `guards.ts`; `test/lib/auth/guards.test.ts`.
4. **Auth-protect** `/onboarding` in `auth.config.ts`.
5. **Onboarding page + components** (flow, account step, budgets step, done step).
6. **Wire data-surface pages** to `requireOnboarded`; wire `/onboarding` to `redirectIfOnboarded`.
7. **Dashboard defensive zero-state** fallback card.
8. **Empty-state verification** (§5.3) — manual check of budgets/recurring/accounts empties.
9. `npm run test:run` + `npm run build`; full manual pass (§8).

---

## 10. Decisions

### Resolved (baked into this spec)

- **First-run gate is a per-page server guard, not middleware** — the edge `authorized` callback
  can't query Prisma to count accounts. `requireOnboarded()` runs in the Node render cycle.
- **"Onboarded" is derived from `activeAccountCount > 0`, not a stored flag** — no `User.onboardedAt`
  column, no migration, can't drift; re-archiving the last account correctly re-enters the flow.
- **The gate uses *active* (non-archived) accounts** — matches the "can capture a transaction"
  question and the predicate every selector already uses.
- **`/accounts` and `/profile` are escape hatches** — never gated, so a zero-account user is guided,
  not trapped.
- **No special post-registration redirect branch** — both email/password and Google OAuth converge
  on the dashboard guard; one chokepoint, no duplicated logic.
- **Single "starter budgets" action, no named presets** — ROADMAP §1 recommendation (a): reuse the
  one `BUDGET_PRESETS` set; no Personal/Freelancer/Family variants, no category-visibility model.
- **Onboarding Step 1 is an inline form, not the slide-in drawer** — onboarding is the focus surface;
  it calls the existing `createFinancialAccount` action (no new action), with color/icon defaulted.
- **Budget currency resolves from `DEFAULT_CURRENCY` (EUR), not `preferredCurrency`** — fixes the
  USD/EUR drift and removes a DB round-trip; matches accounts/goals (account spec §10).
- **Schema currency defaults reconciled to EUR + one-shot USD→EUR backfill** — corrects both the
  default and the stale rows pre-Part-A budgets created.
- **`preferredCurrency` stays as dormant, read-only display** on `/profile` — revived by the
  post-MVP multi-currency slice; not removed.
- **No currency picker** — EUR-only; the spec's onboarding "pick currency" step is deferred.
- **The USD→EUR backfill assumes no legitimate USD data exists** — safe only because the app has
  never been multi-currency; flagged as a confirm-before-running step on any branch that might hold
  real non-EUR records (§3).
- **Onboarding completes the instant Step 1 succeeds** — Steps 2 & 3 are abandonable; no
  partial-onboarding state is tracked or resumable (§6.4).
- **Account color/icon defaults are named constants** (`DEFAULT_ACCOUNT_COLOR`/
  `DEFAULT_ACCOUNT_ICON`), shared by the drawer and onboarding — not `ACCOUNT_*[0]` index coupling.
- **Archived-account recovery is a first-class QA flow** (§8) — the derived-gate design makes it a
  critical path, validated explicitly alongside the happy path.

### Accepted trade-offs (known, deliberate — not gaps)

These are conscious MVP choices; listed so a future reader doesn't mistake them for oversights.

- **Archiving your last account re-enters onboarding.** A returning user who archives their only
  account is treated like a new user and pushed back to `/onboarding`. Intended — it's the same
  "no usable account" state — but the flow is generic, not a tailored "welcome back." Acceptable;
  the escape hatches (§7) keep it from being a trap. Revisit if the re-entry feels wrong in QA.
- **Onboarding is really 1 mandatory step + 2 optional screens.** Because completion derives from
  account existence, Step 1 is the only gate; Steps 2–3 are convenience. This is the design, not a
  bug — but don't describe it externally as a "3-step setup you must finish."
- **Guard coverage requires discipline on every new data route.** Adding a future data surface means
  remembering to use `requireOnboarded()` — a forgotten route silently bypasses the gate. Mitigation:
  the wiring table (§6.1) is the canonical list; keep it updated, and any new page spec must state
  its guard. (A lint rule or a shared layout-level guard is a possible future hardening, not MVP.)
- **The dashboard fallback and the guard are intentionally redundant** (§6.5) — two mechanisms that
  must stay aligned as onboarding logic evolves. The redundancy is the safety margin; the cost is
  remembering they're related.
- **`preferredCurrency` is visible but inert.** A read-only profile field that drives nothing until
  multi-currency lands can mislead a future dev into thinking it's wired. Mitigation: it's documented
  as dormant here and in the account spec §10; consider a code comment at its read site.
- **No onboarding "resume" state.** Abandonment restarts the (short) flow visually; fine at 3 steps.
  If onboarding ever grows heavier, a persisted progress model may be needed — out of scope now.

### Deferred optimization (documented, not built)

- **Per-render `count` may move to a session/JWT `hasActiveAccount` flag** if traffic grows — keeps
  "onboarded" derived from real state while removing the per-page query (§6.1). Out of MVP scope.
  Until then, the onboarding gate has a hard runtime dependency on DB availability on every guarded
  render (a guarded page can't decide where to send the user if the `count` query fails) — acceptable
  since those pages already query the DB to render at all.

### Still open

- **Reports gating timing.** `/reports` doesn't exist yet; this spec notes it should adopt
  `requireOnboarded()` when ROADMAP §5 builds it, rather than touching a non-existent page now.
  No action required in this slice.
</content>
</invoke>
