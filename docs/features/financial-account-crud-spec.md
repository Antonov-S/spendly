# Financial Account CRUD — Implementation Spec

> **Goal:** Give users a real read/write stack for `FinancialAccount` so a freshly
> registered user can create, edit, and archive accounts — closing the foundational
> gap that currently blocks the entire capture loop for any non-seeded user.

This spec follows the patterns in [entity-crud-architecture.md](../entity-crud-architecture.md)
and the field-level rules in [entity-types.md](../entity-types.md). It mirrors the existing
Budgets and Transactions slices.

---

## 1. Why this first

Today `FinancialAccount` is **read-only**: [src/lib/db/accounts.ts](../src/lib/db/accounts.ts)
exposes only `getUserAccounts` (id + name for the topbar pill). There is no create/edit/archive
action and no management surface. Accounts exist only because `prisma/seed.ts` made them, so:

- A real signup cannot create an account → cannot add a transaction → budgets/dashboard are empty.
- The topbar account selector and dashboard hero balance point at seed-only data.

This slice makes the core loop (`capture → organize → control → understand`) real end-to-end.

---

## 2. Scope

### In scope

- Zod validation schemas for create/update.
- Server actions: `createFinancialAccount`, `updateFinancialAccount`, `archiveFinancialAccount`, `unarchiveFinancialAccount`.
- DB fetchers: list-with-derived-balance, single-for-edit.
- Management UI at **`/settings`** (Accounts section) — list, create/edit drawer, archive + undo.
- Topbar account-selector entry point ("Manage accounts" → `/settings`).
- Archived-account guard on transaction creation **and recurring-draft confirmation** (see §9).
- Pausing the archived account's recurring templates as a side-effect of archiving (§9).
- A centralized `revalidateAccountViews()` helper (see §6).
- A dedicated `src/lib/currency.ts` product-level currency policy, **single-currency (EUR) for
  this slice** but structured so widening is a one-constant change (see §10).
- Vitest unit tests for actions + any pure helper.

### Out of scope (explicit)

- Hard delete of accounts (MVP uses archive only; never `prisma.financialAccount.delete`).
- **Any currency selection in the UI.** MVP is **EUR-only**: there is no currency field in the
  account drawer; every account is created in `DEFAULT_CURRENCY` resolved server-side (§10).
- Editing `type` after creation (post-MVP per architecture doc).
- Cross-currency conversion / mixed-currency math, and the multi-currency upgrade itself
  (post-MVP — the upgrade path is documented in §10 so it's cheap when it lands).
- The onboarding "create your first account" step — separate feature, but this slice
  provides the action it will call. Noted as a follow-up dependency.
- Billing / Stripe sections of `/settings`.

---

## 3. Data model recap

From [entity-types.md](../entity-types.md) (FinancialAccount section). No schema change required.

| Field | Type | Notes |
|---|---|---|
| `name` | `String` | required, user label |
| `type` | `AccountType` | `CHECKING \| SAVINGS \| CREDIT_CARD \| CASH \| INVESTMENT \| OTHER` |
| `currency` | `String` | ISO 4217. **MVP: always written as `DEFAULT_CURRENCY` (EUR), resolved server-side — not user-selectable.** Column kept so multi-currency needs no migration later (§10). |
| `startingBalance` | `Decimal(12,2)` | balance when tracking began; not updated after |
| `color` | `String?` | hex, e.g. `#1D9E75` |
| `icon` | `String?` | Lucide icon name, e.g. `Wallet` |
| `isArchived` | `Boolean` | hidden from selectors/dashboard; cannot receive new transactions |

**Canonical derived balance (never stored):**

```
balance(account) = account.startingBalance
                 + SUM(t.amount) for every Transaction t WHERE
                     t.financialAccountId = account.id
                     AND t.deletedAt IS NULL
```

This formula is **transfer-complete by construction.** Spendly models a transfer as two
ordinary `Transaction` rows sharing a `transferPairId` (there is no separate transfer
table): the outflow leg carries a **negative** `amount` on the source account, the inflow
leg a **positive** `amount` on the destination account (per
[entity-types.md](../entity-types.md), Transaction special rules). Because each leg is a normal signed
`Transaction` scoped to its own `financialAccountId`, summing `amount` per account already
nets transfers correctly — the balance query needs **no special handling** of `isTransferLeg`
or `transferPairId`. An archived account's legs still count toward *that* account's balance;
archiving never deletes rows (§9, §11).

---

## 4. File plan

| Layer | File | Action |
|---|---|---|
| Validation | `src/lib/validations/financial-account.ts` | **create** — `createAccountSchema`, `updateAccountSchema` |
| Actions | `src/actions/financial-accounts.ts` | **create** — 4 actions |
| DB reads | `src/lib/db/accounts.ts` | **modify** — add `getAccountsWithBalances`, `getAccountForEdit` (keep `getUserAccounts`) |
| Pure helpers | `src/lib/account.ts` | **create** — `mapAccountRow` (serializable row), `deriveBalance`, `getDefaultActiveAccount` (single source for the drawer fallback rule) |
| Types | `src/types/accounts.ts` | **create** — `AccountListRow`, `EditableAccount`, `AccountFormData` |
| Constants (UI) | `src/lib/constants.ts` | **modify** — `ACCOUNT_TYPE_OPTIONS`, `ACCOUNT_COLORS`, `ACCOUNT_ICONS` |
| Constants (system) | `src/lib/system-constants.ts` | **modify** — `STARTING_BALANCE_MAX` |
| Currency policy | `src/lib/currency.ts` | **create** — `SUPPORTED_CURRENCIES`, `DEFAULT_CURRENCY`, `isSupportedCurrency` (shared product-level source) |
| Page | `src/app/settings/page.tsx` | **create** — `force-dynamic`, `Promise.all`, Suspense |
| Components | `src/components/settings/accounts-view.tsx` | **create** — coordinator (archive + Sonner undo) |
| Components | `src/components/settings/account-list.tsx` | **create** — rows w/ balance, type, archive menu |
| Components | `src/components/settings/account-form-drawer.tsx` | **create** — shadcn Sheet, `useTransition` |
| Components | `src/components/settings/account-empty-state.tsx` | **create** — "Add your first account" CTA |
| Cross-cut | `src/actions/transactions.ts` | **modify** — reject creates/moves against archived accounts (§9) |
| Cross-cut | `src/actions/recurring.ts` | **modify** — block `confirmDraft` against an archived account (§9) |
| Cross-cut | `src/lib/revalidation.ts` | **modify** — add `revalidateAccountViews()` |
| Cross-cut | topbar account selector component | **modify** — add "Manage accounts" link to `/settings` |
| Tests | `test/actions/financial-accounts.test.ts` | **create** |
| Tests | `test/lib/account.test.ts` | **create** |

> **Route decision:** account management lives at **`/settings`** (matches the spec route
> table). `/profile` stays the user-identity page (password, delete, stats); `/settings`
> hosts app configuration, starting with Accounts. Link `/settings` from both the topbar
> account pill and the `UserMenu` drop-up (alongside Profile).

---

## 5. Validation (`src/lib/validations/financial-account.ts`)

```ts
import { z } from "zod";
import { AccountType } from "@/generated/prisma"; // or wherever the enum is re-exported
import { STARTING_BALANCE_MAX } from "@/lib/system-constants";
import { ACCOUNT_ICONS } from "@/lib/constants";

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
// Whitelist, not an arbitrary string: an icon outside this set has no Lucide mapping
// in icon-map.ts and would render blank. Reject it at the boundary.
const accountIcon = z.enum(ACCOUNT_ICONS);

// EUR-only MVP: there is NO `currency` field on the schema. The action writes
// DEFAULT_CURRENCY (EUR) server-side. When multi-currency lands, add a
// `currency: z.enum(SUPPORTED_CURRENCIES)` field here and a drawer select (§10).
export const createAccountSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  type: z.nativeEnum(AccountType),
  // Signed. Liability accounts (e.g. CREDIT_CARD) legitimately open with a negative
  // balance — the opening figure is whatever was owed when tracking began.
  startingBalance: z.coerce
    .number()
    .min(-STARTING_BALANCE_MAX, "Out of range")
    .max(STARTING_BALANCE_MAX),
  color: hexColor.nullish(),
  icon: accountIcon.nullish(),
});

// MVP: only name, color, icon are editable. type is immutable; currency isn't even input.
export const updateAccountSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(60),
  color: hexColor.nullish(),
  icon: accountIcon.nullish(),
});

export type CreateAccountInput = z.infer<typeof createAccountSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
```

> **Resolved — liability accounts:** `startingBalance` accepts **negative** values (bounded by
> `±STARTING_BALANCE_MAX`). A `CREDIT_CARD` or other liability with existing debt opens below
> zero; the derived-balance formula already sums signed amounts, so nothing downstream needs to
> change. This intentionally overrides the `≥ 0` line in the architecture doc — note the
> divergence when implementing.

---

## 6. Server actions (`src/actions/financial-accounts.ts`)

`"use server"`. Every action: `auth()` guard → Zod `safeParse` → ownership scope by
`session.user.id` → return `{ success, data?, error? }` → `revalidatePath`.

| Action | Behavior |
|---|---|
| `createFinancialAccount(input)` | Validate, insert with `userId` from session. **`currency` is set server-side to `DEFAULT_CURRENCY` (EUR) — never from client input.** `startingBalance` written as `Decimal`. Returns the created row (serialized). |
| `updateFinancialAccount(input)` | Patch `name/color/icon` only. Ownership check (`where: { id, userId }`); never trust client `userId`. |
| `archiveFinancialAccount(id)` | **Idempotent.** Sets `isArchived: true` and, in the *same* `$transaction`, pauses the account's active recurring templates (§9). Never hard-delete. Re-archiving an already-archived account succeeds as a no-op. |
| `unarchiveFinancialAccount(id)` | **Idempotent.** Sets `isArchived: false` — drives the Sonner undo. Does **not** auto-resume the templates archiving paused. |

**Failure semantics (standardized):** there are only two failure shapes — never branch
"forbidden" vs "missing":

- No session → `{ success: false, error: "Unauthorized" }`.
- Account missing **or** owned by another user → a single `{ success: false, error: "Account not found" }`.
  Both collapse to *not found* so ownership is non-enumerable. Implement by scoping every write
  `where: { id, userId }` and treating a 0-row result as not-found.

**Idempotency:** `archive`/`unarchive` are no-ops when the account is already in the target
state and still return `{ success: true }`. Prefer `updateMany` (count-based, won't throw on a
missing row) over `update` so "already in that state" and "not found" are distinguishable by
the affected-row count rather than an exception.

**Concurrency — last-write-wins.** `isArchived` is a single boolean flag with no optimistic
locking or version column. Two racing archive/unarchive calls simply resolve to whichever
commits last; there is no conflict error. Acceptable for a single-user-owned record. One caveat:
the template-pause side-effect of `archive` is *not* reversed by a later `unarchive`, so an
`archive` → `unarchive` race can leave the account active with its templates paused — benign,
and the user re-activates templates deliberately anyway (§9).

**Revalidation:** add a single centralized helper `revalidateAccountViews()` to
[src/lib/revalidation.ts](../src/lib/revalidation.ts) that revalidates `/settings`,
`/dashboard`, and `/transactions` together (account filter + derived balances all change).
Every account mutation calls this **one** helper — do not scatter individual `revalidatePath()`
calls across actions (mirrors the existing `revalidateTransactionViews()` pattern).

> One helper is deliberate for MVP (YAGNI) — but it's an *internal* coupling, not a contract.
> If settings and dashboard later need to revalidate independently, split the body into
> `revalidateAccountCore()` (settings + selectors) and `revalidateAccountDerived()` (dashboard +
> analytics) and keep `revalidateAccountViews()` as the wrapper. Call sites don't change, so this
> stays a cheap future move — no reason to pre-split now.

**Ownership pattern (every action):**

```ts
const session = await auth();
if (!session?.user?.id) return { success: false, error: "Unauthorized" };
const userId = session.user.id;
// all prisma calls scoped: where: { id, userId }
```

---

## 7. DB fetchers (`src/lib/db/accounts.ts`)

### `getUserAccounts(userId)` — formal contract (keep, but pin the guarantees)

The existing selector fetcher. Formalize its two invariants so every selector surface (topbar
pill, transaction drawer, transfer, recurring, budgets) can rely on them without re-filtering:

1. **Active-only.** Always `where: { userId, isArchived: false }` — archived accounts are never
   returned. This is the single mechanism that keeps archived accounts out of every selector.
2. **Canonical order.** `orderBy: { name: "asc" }` — matches the §11 ordering rule (active group,
   alphabetical). Callers may rely on the order; the "first active account" the drawer
   pre-selects (§11) is defined as element `[0]` of this result.

It returns the minimal `{ id, name }` shape — do **not** widen it with balances; that's
`getAccountsWithBalances`'s job. Then add:

### `getAccountsWithBalances(userId, { includeArchived })`

Avoid N+1 — one `groupBy` aggregate, then map:

```ts
const accounts = await prisma.financialAccount.findMany({
  where: { userId, ...(includeArchived ? {} : { isArchived: false }) },
  orderBy: [{ isArchived: "asc" }, { name: "asc" }],
});

const sums = await prisma.transaction.groupBy({
  by: ["financialAccountId"],
  where: { userId, deletedAt: null },
  _sum: { amount: true },
});

// map → AccountListRow with derived balance via deriveBalance()
```

Returns `AccountListRow[]` (serializable — `balance` and `startingBalance` as `number`,
`color`/`icon` as resolved strings). The management page shows archived accounts in a
separate de-emphasized section, so pass `includeArchived: true` there.

> **Performance — correct now, cacheable later.** Two queries (`findMany` + a single `groupBy`)
> regardless of account count, so no N+1. But the `groupBy` still scans the user's transactions,
> so cost grows with transaction volume. This is the right MVP tradeoff (correctness over a
> denormalized balance that can drift — see entity-types.md "derived, never stored"). If it
> becomes hot, the post-MVP fix is a cached per-account rollup / read model, **not** a `balance`
> column on `FinancialAccount`. Aligned with the spec's ">10K transactions" out-of-scope note.

### `getAccountForEdit(userId, id)`

Single account scoped by `userId`, mapped to `EditableAccount` for drawer pre-fill.
Returns `null` if not found / not owned.

---

## 8. UI

### Page — `src/app/settings/page.tsx`

- `export const dynamic = "force-dynamic";`
- `getSessionOrRedirect()` (existing guard helper).
- `Promise.all([ getAccountsWithBalances(userId, { includeArchived: true }) ])`.
- `<Suspense>` with a skeleton, keyed so it re-triggers on revalidate.
- Renders `<AccountsView accounts={...} />`, or `<AccountEmptyState />` when none exist.

### `accounts-view.tsx` (client coordinator)

- Owns the create/edit drawer open state via `useState` (mirrors `BudgetsView`).
- Archive → optimistic removal + Sonner toast with **Undo** (8s) calling `unarchiveFinancialAccount`.
- "Add account" CTA opens the drawer in create mode.

### `account-list.tsx`

- Active accounts section + collapsed "Archived" section.
- Each row: icon square (resolved via [src/lib/icon-map.ts](../src/lib/icon-map.ts)) + name +
  type label + currency + **derived balance** (right-aligned). Overflow menu: Edit, Archive (or
  Unarchive).
- **Currency formatting rule (formal):** a balance is **always** formatted with *its own
  account's* `currency` field — `formatCurrency(row.balance, row.currency)` — never a global
  constant. In EUR-only MVP every `row.currency` is `"EUR"`, so this renders uniformly; but
  reading the field per-row (rather than hardcoding `€`) is what makes the account list
  multi-currency-ready for free. **Do not hardcode the symbol.** A cross-account total is fine
  while single-currency, but the helper that computes it must bail to "no total" the moment more
  than one distinct currency is present (the future multi-currency guard — see §10).

### `account-form-drawer.tsx`

- shadcn **Sheet** — right panel ≥768px / bottom sheet <768px (`useMediaQuery` + `BREAKPOINTS.mobile`).
- Create fields: name, type select (`ACCOUNT_TYPE_OPTIONS`), starting balance, color picker
  (`ACCOUNT_COLORS`), icon picker (`ACCOUNT_ICONS`). **No currency field** — EUR-only MVP; the
  `€` symbol on the starting-balance input is informational only.
- Edit mode: **disable** type and starting balance (immutable in MVP); only name/color/icon editable.
- Submit via `useTransition`; surface `{ error }` inline / as toast.

### `account-empty-state.tsx`

- Active guidance per onboarding principle: headline + "Add your first account" button → opens drawer.

---

## 9. Cross-cutting: archived guard

Archived accounts **cannot receive new transactions** ([entity-crud-architecture.md](../entity-crud-architecture.md), FinancialAccount special cases).

- In `createTransaction`, `createTransfer`, and `updateTransaction` (when moving a tx to a
  different account): after resolving the account, reject if `account.isArchived === true`
  with `{ success: false, error: "This account is archived" }`. **Verify whether the current
  transaction actions already do this; add the check if missing.**
- In `recurring.ts` `confirmDraft`: confirming creates a `Transaction` on the template's
  account, so it must also reject when that account `isArchived === true`. `createTemplate`
  already performs an `isArchived` check (per changelog) — confirm parity and add the guard to
  `confirmDraft`.
- Account selectors (drawer, transfer, recurring, budgets) already source from
  `getUserAccounts`, which excludes archived — no change needed there.

### Recurring templates when an account is archived

- Archiving an account sets `isActive = false` on that account's active templates **inside the
  same `$transaction`** as the archive write, so the scheduler stops emitting drafts that could
  never be confirmed. This is the documented behavior — do not leave templates live against an
  archived account.
- Existing `PENDING` drafts are **not** deleted; they simply can't be confirmed (the guard
  above blocks it). The user dismisses them.
- Unarchiving does **not** auto-resume those templates — the user re-activates each one
  deliberately (conscious-capture principle).
- **No pause-reason tracking.** `isActive = false` is a single flag with no provenance: a template
  paused by archiving is **indistinguishable** from one the user paused manually. This is a
  deliberate MVP simplification — we add no `pausedReason`/`pausedByArchive` column. Consequence:
  on unarchive we *cannot* know which paused templates to auto-resume (another reason resume stays
  manual), and the `/recurring` UI shows both kinds identically under "Paused." If a future slice
  needs to auto-resume only archival-paused templates, it must first introduce that provenance
  field — call it out then, don't infer it. The archive→pause / unarchive→(no resume) asymmetry
  is **intentional** (conscious-capture); if product ever wants it configurable, that's an
  `archiveBehavior: "pause-only" | "pause-and-tag"` policy flag in a later slice, not now.

### Archiving never modifies history

Archive/unarchive touch only `FinancialAccount.isArchived` (plus the template-pause above).
They never alter, soft-delete, or reassign any `Transaction`, transfer leg, or
`GoalContribution`. Historical balances and transfer pairs are preserved verbatim, and an
archived account's transactions remain queryable (e.g. when explicitly selected in Reports).

---

## 10. Constants

### `src/lib/constants.ts` (UI data)

```ts
export const ACCOUNT_TYPE_OPTIONS = [
  { value: "CHECKING", label: "Checking" },
  { value: "SAVINGS", label: "Savings" },
  { value: "CREDIT_CARD", label: "Credit card" },
  { value: "CASH", label: "Cash" },
  { value: "INVESTMENT", label: "Investment" },
  { value: "OTHER", label: "Other" },
] as const;

export const ACCOUNT_COLORS = ["#1D9E75", "#EF9F27", "#378ADD", "#D4537E", "#7F77DD", "#888780"];
export const ACCOUNT_ICONS = ["Wallet", "Landmark", "PiggyBank", "CreditCard", "Banknote", "TrendingUp"];
```

### `src/lib/system-constants.ts` (system config)

```ts
export const STARTING_BALANCE_MAX = 100_000_000;
```

### `src/lib/currency.ts` (dedicated product-level currency policy)

Currency is a **product-level concern shared across accounts, budgets, goals, onboarding, and
`User.preferredCurrency`** — not an account-only constant. Give it one owner so the supported
set, the default, and formatting can't drift between features:

```ts
// src/lib/currency.ts — single source of truth for currency policy.
// EUR-only for MVP. The set is a tuple so widening is a one-line change.
export const SUPPORTED_CURRENCIES = ["EUR"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export const DEFAULT_CURRENCY: SupportedCurrency = "EUR";

export function isSupportedCurrency(c: string): c is SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(c);
}
```

> **Decision — EUR-only MVP.** The app does no currency conversion (post-MVP), so offering a
> currency *picker* would imply multi-currency support it can't honor. MVP ships **a single
> currency, EUR.** There is no currency field in any drawer; the create action stamps
> `DEFAULT_CURRENCY` server-side. This sidesteps the mixed-currency dashboard problem entirely —
> with one currency the hero total is always exact and the "⚠ Mixed currencies" path is dead
> code that never triggers.

> **Why a module and not a literal `"EUR"`.** The indirection costs nothing now and means the
> multi-currency upgrade is a *constant change, not a refactor*. Keep all four invariants below.

> **This is a future-boundary module, not a runtime multi-currency system.** Despite the
> `SUPPORTED_CURRENCIES` tuple, type narrowing, and `isSupportedCurrency` guard, the app **cannot**
> handle more than one currency today — there is no conversion, no per-currency presentation, no
> base currency. The shape exists so the *seam* is already cut, not because logic flexes at
> runtime. Implementers: treat anything here beyond "everything is EUR" as scaffolding for a later
> slice, not behavior to wire up now.

#### Multi-currency upgrade path (when we build conversion)

Everything here is deliberately structured so a future slice can widen currency support without
a migration or a data backfill:

1. **Schema columns stay.** `FinancialAccount.currency`, `Transaction.currency`,
   `Budget.currency`, `Goal.currency`, `User.preferredCurrency` all remain and are **written
   explicitly as `"EUR"`** now (never null) — so existing rows are already valid when the set
   widens.
2. **Currency is resolved server-side, never from the client.** `createFinancialAccount` writes
   `DEFAULT_CURRENCY`; transaction/budget/goal currency inherits from the account/user. No
   client input to retrofit-validate.
3. **To widen later:** add codes to `SUPPORTED_CURRENCIES`, add `currency: z.enum(SUPPORTED_CURRENCIES)`
   to `createAccountSchema`, add a currency `<select>` to the account drawer (rendered from the
   same constant), and build the mixed-currency dashboard presentation (per-currency subtotals,
   **not** a naïve summed "approximate total"). The account-list formatter already reads
   `row.currency` per row, so it needs no change.
4. **The real work is conversion**, which is its own slice: FX rates, a reporting/base currency,
   and rate history. That is explicitly *not* unlocked by widening the picker — keep them separate.

> **`User.preferredCurrency` is dormant in the EUR-only MVP.** It must **not** influence account
> creation, balance formatting, or any reporting/aggregation while the app is single-currency —
> treat it as effectively deprecated. Everything currency-related resolves from `DEFAULT_CURRENCY`,
> not from this field. Its schema default (`"USD"`) contradicts EUR-only but is harmless precisely
> *because* nothing reads it; **do not migrate it here.** It returns to use only when the onboarding
> currency picker / multi-currency support lands — at which point reconcile the default to EUR and
> wire it as the user's display/base currency.

> Per coding standards: no magic values in components/actions — pull from these files.

---

## 11. Edge cases & rules

- **No active accounts (zero, or all archived) — transaction capture is blocked.** A
  `Transaction` requires a `financialAccountId`, so with no active account there is nothing to
  create against. The transaction drawer must **disable Save and show a guiding empty state**
  ("Create an account first") linking to `/settings`, rather than presenting an empty account
  select. `createTransaction`/`createTransfer` defend the same rule server-side: if the user has
  no active account (or the supplied id isn't an active, owned account), return
  `{ success: false, error: "Create an account first" }`. This is the natural state for a brand-new
  user before onboarding's account step and after archiving the last account.
- **Last account archived:** allowed (we never block archiving to preserve an invariant). It
  simply lands the user in the zero-active-accounts state above; the `/settings` page shows the
  empty state with a re-create CTA.
- **No account-count limits in MVP.** Accounts are unlimited on both Free and Pro (matches
  Monetization → Plans). Do not add a per-user cap, a paywall, or a "max accounts" constant.
- **Dashboard totals use active accounts only.** The hero balance and monthly metric strip sum
  **non-archived** accounts exclusively; archived accounts never contribute to any aggregate or
  overview metric. They surface only in Reports when explicitly selected (see the archived-history
  clarification below). This is the canonical answer — no setting toggles it in MVP.
- **Default account after the first create (defined).** There is **no stored "default account"
  field.** Creating the first account does not set or change the global account filter — the
  topbar selector stays on **"All accounts"** (`?account=` unset), which with a single account
  naturally shows exactly that account everywhere. Separately, the **transaction drawer**
  pre-selects an account: the globally-scoped account if the filter is active, otherwise the
  first active account in canonical order (§ ordering rule). So a brand-new user with one
  account gets it auto-selected in the drawer without any extra concept.
  > Encode this fallback **once** as `getDefaultActiveAccount(accounts)` in `src/lib/account.ts`
  > (returns the scoped account, else `accounts[0]`, else `null`) and call it from every surface
  > that needs a sensible default — never re-derive "first active account" inline. The rule is
  > correct only as long as it's identical everywhere, so it gets exactly one definition.
- **Archived accounts and history (clarification).** Archiving is a *visibility* flag, never a
  data change: an archived account's derived balance is always computed from its complete,
  unmodified transaction history. Archived accounts are hidden only from the *default* aggregate
  surfaces (dashboard hero + metric strip, account selectors); they remain fully present in
  Reports when **explicitly selected** and in any direct balance query. Archiving never freezes,
  zeroes, or recomputes a balance — it just hides the account from the default views.
- **Currency not editable (and not even set in MVP):** there is no currency input at create or
  edit. Every account is EUR. When multi-currency lands, currency stays create-only (editing it
  would invalidate historical transaction currencies) — see §10.
- **Starting balance immutable in edit:** changing it silently rewrites every derived balance;
  out of scope for MVP. Disabled in edit mode.
- **Account name uniqueness — none.** Names are **not** unique. The schema has no unique
  constraint on `(name, userId)`, and a user may legitimately hold two "Cash" accounts. Do not
  add a uniqueness check. The list and pickers disambiguate by type + balance (and currency once
  multi-currency exists), never by name.
- **Account ordering (formal business rule).** Active accounts first, then archived; within
  each group, alphabetical by `name`. This is a product rule, not an incidental query detail —
  `getAccountsWithBalances` encodes it (`orderBy: [{ isArchived: "asc" }, { name: "asc" }]`) and
  every account list surface (settings list, selectors) must honor the same order.
- **Decimal → number serialization (and why it's safe here).** Never pass a Prisma `Decimal`
  to a client component; `mapAccountRow` converts to `number` (mirrors `mapBudgetRow`). This is
  lossless **because account values are bounded**: every stored figure is `@db.Decimal(12, 2)`
  (max ±9,999,999,999.99), and a derived balance sums a user-scale set of 2-dp rows. All such
  magnitudes sit far inside `Number.MAX_SAFE_INTEGER` (≈9.007×10¹⁵) at exactly 2 fractional
  digits, so no precision is lost for any representable account. (Aggregations across the whole
  DB would stay in `Decimal`; it is this per-account bound that makes client serialization
  safe.)
- **Topbar scope reset:** if the user archives the account currently selected in the global
  pill, the selector falls back to "All accounts" (the `?account=` param no longer matches an
  active account — handle gracefully in the selector).

---

## 12. Testing (`test/`, Vitest, mock `@/lib/prisma` + `@/auth`)

**`test/actions/financial-accounts.test.ts`**
- Unauthorized (no session) → `{ success: false, error: "Unauthorized" }` for all four actions.
- `createFinancialAccount`: valid input inserts with session `userId`; invalid (empty name,
  bad hex color, **icon outside `ACCOUNT_ICONS`**) → validation error, no prisma write.
- `createFinancialAccount`: the persisted row's `currency` equals `DEFAULT_CURRENCY` (`"EUR"`)
  even if the client somehow supplies a `currency` field — it must be ignored, not trusted.
- `createFinancialAccount`: a **negative** `startingBalance` (within `±STARTING_BALANCE_MAX`) is
  **accepted** (liability accounts); a value beyond the bound is rejected.
- `updateFinancialAccount`: ownership scoping (`where` includes `userId`); unknown/foreign id →
  the standardized `{ success: false, error: "Account not found" }` (not "Forbidden").
- `archive`/`unarchive`: set `isArchived` correctly, scoped by `userId`; **idempotent** —
  archiving an already-archived account returns `{ success: true }` without error.
- `archiveFinancialAccount` pauses the account's active recurring templates in the same
  transaction (assert the `recurringTemplate.updateMany(... isActive: false)` write is included).

**`test/lib/account.test.ts`**
- `deriveBalance`: `startingBalance + sum`, handles null sum (no transactions), negative sums.
- `mapAccountRow`: Decimal → number, color/icon passthrough, `isArchived` preserved.

Run `npm run test:run` and `npm run build` before commit (per workflow).

---

## 13. Implementation order

1. Constants + types + Zod schemas (no deps).
2. `src/lib/account.ts` pure helpers + their tests (TDD-friendly).
3. DB fetchers (`getAccountsWithBalances`, `getAccountForEdit`).
4. Server actions + tests.
5. Cross-cutting archived guard in `transactions.ts`.
6. `/settings` page + components.
7. Topbar "Manage accounts" link + `UserMenu` Settings entry.
8. `npm run test:run` + `npm run build`; manual browser pass (create → appears in topbar →
   add transaction → balance updates → archive → disappears → undo).

---

## 14. Decisions

### Resolved (baked into this spec)

- **Negative starting balance** — *allowed* (bounded by `±STARTING_BALANCE_MAX`) for liability
  accounts. Overrides the architecture doc's `≥ 0` (§5).
- **Currency policy** — **EUR-only MVP.** No currency picker; `createFinancialAccount` stamps
  `DEFAULT_CURRENCY` server-side. Owned by `src/lib/currency.ts` with a documented one-constant
  upgrade path; conversion stays post-MVP (§10).
- **Icon input** — restricted to the `ACCOUNT_ICONS` whitelist, not arbitrary strings (§5).
- **Currency formatting** — format per-row from `row.currency` (always EUR now), never a hardcoded
  symbol; keeps the list multi-currency-ready (§8).
- **Archive concurrency** — last-write-wins, no locking (§6).
- **Default account** — no stored field; selector stays "All accounts", drawer pre-selects
  first active account via the single `getDefaultActiveAccount` helper (§11).
- **Fetcher naming — keep the `get*` prefix** (`getUserAccounts`, `getAccountsWithBalances`,
  `getAccountForEdit`). Rejected the `list*` rename: the codebase's existing fetchers are all
  `get*` (`getBudgets`, `getTemplates`, `getTransactionForEdit`, and the already-shipped
  `getUserAccounts`), so `list*` would *break* consistency and force renaming a live function with
  existing callers. Consistency with the repo beats the `list`/`get` grammar nicety.
- **Revalidation stays one helper now; balance stays derived now** — both have documented,
  call-site-stable upgrade paths (§6, §7) rather than being pre-optimized.

### Still open — confirm before coding

1. **Route:** `/settings` (chosen) vs a dedicated `/accounts`. Spec route table says `/settings`.
