# Entity Types Reference

This document is the authoritative field-level reference for every Prisma model in Spendly. It is derived from `prisma/schema.prisma` (field definitions, constraints, indexes, relations), `prisma/seed.ts` (concrete usage patterns), and `docs/project-overview.md` (architectural rules). Use this as the single source of truth when writing queries, server actions, or API routes.

---

## User

The root identity record for every person using the app; all financial data cascades from it.

### Fields

| Field | Type | Constraint | Notes |
|---|---|---|---|
| `id` | `String` | `@id @default(cuid())` | Primary key |
| `name` | `String?` | optional | Display name; may be null for early OAuth sign-ups |
| `email` | `String` | `@unique` | Lowercased on registration |
| `emailVerified` | `DateTime?` | optional | Set by email-verification flow or OAuth sign-in; null blocks credentials sign-in when email verification is enabled |
| `image` | `String?` | optional | OAuth avatar URL |
| `password` | `String?` | optional | Bcrypt hash; `null` for OAuth-only users. Never expose raw value |
| `isPro` | `Boolean` | `@default(false)` | Feature gate; during development all users are effectively Pro |
| `stripeCustomerId` | `String?` | `@unique` | Set on first Stripe interaction |
| `stripeSubscriptionId` | `String?` | `@unique` | Active subscription ID; null on Free plan |
| `preferredCurrency` | `String` | `@default("EUR")` | ISO 4217 code. **Dormant in EUR-only MVP** — reconciled from `"USD"` (migration `reconcile_currency_eur_default`); drives nothing (display resolves `DEFAULT_CURRENCY`) until multi-currency lands |
| `deletedAt` | `DateTime?` | optional | Soft delete — set on account deletion request; sign-in blocked immediately; data purged after 30-day grace period |
| `createdAt` | `DateTime` | `@default(now())` | |
| `updatedAt` | `DateTime` | `@updatedAt` | |

### Relationships (owned)

- `accounts` → `Account[]` — NextAuth OAuth provider links
- `sessions` → `Session[]` — active NextAuth sessions
- `financialAccounts` → `FinancialAccount[]`
- `transactions` → `Transaction[]`
- `categories` → `Category[]` — user-created categories only; system categories have `userId = null`
- `budgets` → `Budget[]`
- `goals` → `Goal[]`
- `recurringTemplates` → `RecurringTemplate[]`

### Index strategy

| Index | Reason |
|---|---|
| `@@index([deletedAt])` | Efficiently filters active users (soft-delete check at sign-in) and enables future batch purge jobs |

### Special rules

- All child records cascade-delete when `User` is hard-deleted (after the 30-day grace period).
- `preferredCurrency` is **dormant in the EUR-only MVP** — it drives nothing. Budget/goal/account currency all resolve from `DEFAULT_CURRENCY` (EUR) server-side, and `formatCurrency` renders `€` directly. The field is retained, read-only on `/profile`, to be revived when multi-currency lands. Actual per-account currencies are stored on `FinancialAccount`; no exchange-rate conversion in MVP.
- `password` is `null` for Google OAuth users. Never attempt a credentials sign-in check on an account where `password` is null.

---

## FinancialAccount

A named container (checking account, credit card, cash envelope, etc.) that holds a transaction history; its live balance is always computed at query time, never stored.

### Fields

| Field | Type | Constraint | Notes |
|---|---|---|---|
| `id` | `String` | `@id @default(cuid())` | |
| `name` | `String` | required | User-defined label, e.g. "Chase Checking" |
| `type` | `AccountType` | required | See enum below |
| `currency` | `String` | `@default("EUR")` | ISO 4217; stored for record-keeping. **MVP writes `DEFAULT_CURRENCY` (EUR) server-side** via `src/lib/currency.ts` — not user-selectable. Schema default reconciled from `"USD"` (migration `reconcile_currency_eur_default`); see § Special rules and the §10 multi-currency upgrade path |
| `startingBalance` | `Decimal` | `@default(0) @db.Decimal(12, 2)` | The balance at the moment tracking began; not updated thereafter. **Signed** — liability accounts (e.g. credit cards) may open negative; bounded by `±STARTING_BALANCE_MAX` |
| `color` | `String?` | optional | Hex colour, e.g. `"#1D9E75"` |
| `icon` | `String?` | optional | Lucide icon name, e.g. `"Wallet"` |
| `isArchived` | `Boolean` | `@default(false)` | Archived accounts are hidden from selectors, excluded from Dashboard totals, and cannot receive new transactions; transactions remain intact and queryable |
| `userId` | `String` | FK → `User.id` | |
| `createdAt` | `DateTime` | `@default(now())` | |
| `updatedAt` | `DateTime` | `@updatedAt` | |

### Relationships

- belongs to: `User`
- owns: `Transaction[]`, `RecurringTemplate[]`

### Index strategy

| Index | Reason |
|---|---|
| `@@index([userId])` | Every account query is scoped to the authenticated user |

### Special rules

- **Balance is derived, never stored.** The formula is `startingBalance + SUM(amount WHERE deletedAt IS NULL)`. This prevents reconciliation bugs that arise when a stored balance drifts out of sync. Caching in a read model is a post-MVP optimisation. Display uses `formatCurrency`, which renders `€` (switched from `$` in `feature/onboarding-currency`); per-row currency-aware formatting arrives with the multi-currency slice.
- **Currency is EUR-only in MVP.** Accounts are created in `DEFAULT_CURRENCY` (EUR) resolved server-side; there is no currency picker and no cross-currency conversion. The `currency` column is retained so multi-currency needs no migration later.
- **Archive-only — no hard delete in MVP.** `prisma.financialAccount.delete` is never called; `isArchived` is the only removal path. (The schema relations would cascade on a hard delete, but the app never triggers one.)
- Archived accounts appear in Reports only when explicitly selected. They must not appear in account selector dropdowns, topbar filter pills, or Dashboard metrics.
- Seed examples: Pro demo user has Checking (`startingBalance: 1800`), Savings (`1200`), Cash (`150`), Credit Card (`0`).

---

## Category

A label applied to transactions, budgets, and recurring templates; system categories are shared across all users while user-created categories are private.

### Fields

| Field | Type | Constraint | Notes |
|---|---|---|---|
| `id` | `String` | `@id @default(cuid())` | |
| `name` | `String` | required | Human-readable, e.g. `"Groceries"` |
| `icon` | `String` | required | Lucide icon name, e.g. `"ShoppingCart"` |
| `color` | `String` | required | Hex colour, e.g. `"#EF9F27"` |
| `isSystem` | `Boolean` | `@default(false)` | `true` for the 20 seeded system categories |
| `userId` | `String?` | FK → `User.id`, nullable | `null` for system categories; set for user-created ones |
| `createdAt` | `DateTime` | `@default(now())` | |

### Relationships

- optionally belongs to: `User` (null for system categories)
- owns: `Transaction[]`, `Budget[]`, `RecurringTemplate[]`

### Index strategy

| Index | Reason |
|---|---|
| `@@unique([name, userId])` | Prevents duplicate names within the same user's namespace; allows the same name to exist in system and user namespaces independently |
| `@@index([userId])` | Category list queries filter by `userId IS NULL OR userId = ?` |

### Special rules

- **Ownership model:** `isSystem = true, userId = null` — shared, no owner. `isSystem = false, userId = <id>` — private to that user.
- When a `Category` is deleted, all `Transaction.categoryId` references are set to `null` (`onDelete: SetNull`) — transactions are preserved but become uncategorized. `Budget` records referencing the deleted category are hard-deleted (`onDelete: Cascade`).
- `"Uncategorized"` is the fallback system category (`icon: "HelpCircle"`, `color: "#D1D5DB"`). It cannot be deleted by anyone.
- The seed populates 20 system categories. The first 10 (Groceries through Freelance) are the default onboarding preset; the remaining 10 (Subscriptions through Investment) are available in the category picker but not highlighted during onboarding.

### Seeded system categories

| Name | Icon | Hex | Notes |
|---|---|---|---|
| Groceries | ShoppingCart | `#EF9F27` | Core preset |
| Dining | UtensilsCrossed | `#D85A30` | Core preset |
| Transport | Bus | `#7F77DD` | Core preset |
| Housing | Home | `#1D9E75` | Core preset |
| Utilities | Zap | `#F59E0B` | Core preset |
| Health | Heart | `#D4537E` | Core preset |
| Entertainment | Gamepad2 | `#F97316` | Core preset |
| Miscellaneous | MoreHorizontal | `#9CA3AF` | Core preset |
| Salary | Briefcase | `#1D9E75` | Core preset |
| Freelance | Laptop | `#10B981` | Core preset |
| Subscriptions | Tv | `#378ADD` | Extended |
| Clothing | Shirt | `#888780` | Extended |
| Education | BookOpen | `#6366F1` | Extended |
| Insurance | Shield | `#64748B` | Extended |
| Gifts | Gift | `#EC4899` | Extended |
| Travel | Plane | `#0EA5E9` | Extended |
| Taxes | Landmark | `#6B7280` | Extended |
| Pets | PawPrint | `#92400E` | Extended |
| Investment | TrendingUp | `#F59E0B` | Extended |
| Uncategorized | HelpCircle | `#D1D5DB` | Fallback, indestructible |

---

## Transaction

The canonical ledger entry; every movement of money, whether income, expense, or transfer, is a `Transaction`. It is the single source of truth for account balances, budget consumption, and cashflow reporting.

### Fields

| Field | Type | Constraint | Notes |
|---|---|---|---|
| `id` | `String` | `@id @default(cuid())` | |
| `type` | `TransactionType` | required | `INCOME`, `EXPENSE`, or `TRANSFER` |
| `amount` | `Decimal` | `@db.Decimal(12, 2)` | Signed: positive for income, negative for expenses and transfer outflows. See rules below |
| `currency` | `String` | required | ISO 4217; inherited from the account at creation time |
| `date` | `DateTime` | `@db.Date` | Calendar date in the user's local timezone — **no UTC conversion applied** |
| `note` | `String?` | optional | Free-text user memo |
| `merchant` | `String?` | optional | Merchant name; future-proofs subscription detection. Also the primary source of a transaction's **displayed label** (there is no separate description column) — the UI derives the row label from `merchant` first. When a `RecurringDraft` is confirmed, `merchant` is set to the parent template's `name` so the entry reads e.g. "Netflix". |
| `isTransferLeg` | `Boolean` | `@default(false)` | `true` on both records of a transfer pair; prevents accidental recategorization |
| `deletedAt` | `DateTime?` | optional | Soft delete timestamp; `null` means active |
| `transferPairId` | `String?` | optional | Shared UUID linking both legs of a transfer |
| `userId` | `String` | FK → `User.id` | |
| `financialAccountId` | `String` | FK → `FinancialAccount.id` | The account this leg debits or credits |
| `categoryId` | `String?` | FK → `Category.id`, nullable | Null if uncategorized or a transfer leg |
| `recurringTemplateId` | `String?` | FK → `RecurringTemplate.id`, nullable | Set when a draft is confirmed |
| `createdAt` | `DateTime` | `@default(now())` | |
| `updatedAt` | `DateTime` | `@updatedAt` | |

### Relationships

- belongs to: `User`, `FinancialAccount`, optionally `Category`, optionally `RecurringTemplate`

### Index strategy

| Index | Reason |
|---|---|
| `@@index([userId, date])` | Primary query pattern: user's transactions sorted/filtered by date |
| `@@index([userId, financialAccountId])` | Account-scoped views and balance derivation |
| `@@index([userId, categoryId])` | Category breakdown in Reports and budget consumption |
| `@@index([transferPairId])` | Fetching both legs of a transfer in a single query |
| `@@index([deletedAt])` | Efficiently filters out soft-deleted records in all active queries |

### Special rules

- **Signed amounts.** Positive values add to the account balance (income, transfer inflow); negative values subtract (expenses, transfer outflow). This matches the balance formula: `startingBalance + SUM(amount WHERE deletedAt IS NULL)`.
- **Transfers create two records.** A transfer from Checking → Savings produces one `Transaction` with `amount = -500` on Checking and one with `amount = +500` on Savings, both sharing the same `transferPairId` and both having `isTransferLeg = true`. Neither leg should be recategorized.
- **Calendar date storage.** `date` uses `@db.Date`, which stores only the calendar date with no time or timezone component. The client sends the user's local date string (e.g. `"2026-05-31"`) directly. No UTC conversion is applied server-side. This prevents a "May 31 at 23:30 local time becoming June 1 UTC" bug that would corrupt monthly budget calculations.
- **Soft delete.** Deleted transactions receive a `deletedAt` timestamp and are excluded from all active queries and the balance formula. Users have 8 seconds to undo via snackbar; beyond that, soft-deleted transactions are recoverable from the `/trash` "Recently deleted" surface (restore or permanently delete) — shipped post-MVP (`feature/trash-ui`, §8). Hard deletion happens **only** through that Trash UI (`hardDeleteTransaction` / `emptyTrash`), and only on rows that are already soft-deleted.
- `categoryId` is set to `null` via `onDelete: SetNull` if the referenced category is deleted.
- `recurringTemplateId` is set to `null` via `onDelete: SetNull` if the template is deleted; the transaction record itself is retained.
- **Bulk import is an ordinary creation path.** `/import` (`commitImport`, `feature/data-import`, POST-MVP §15) bulk-creates rows from a CSV or Spendly JSON export into one chosen account — the same signed-amount / `@db.Date` / account-currency rules as a single create, written via `createMany`. INCOME/EXPENSE only (transfers skipped), count-based dedup makes re-import idempotent, and imported rows are **indistinguishable from manually-entered ones** (no provenance column — no schema change).

---

## Budget

A monthly spending ceiling for a specific category; one budget row per category per calendar month. Opt-in `rollover` flag carries the unspent (or overspent) remainder into the next consecutive month — derived on read, no stored carry (`feature/budget-rollover`, POST-MVP §7).

### Fields

| Field | Type | Constraint | Notes |
|---|---|---|---|
| `id` | `String` | `@id @default(cuid())` | |
| `amount` | `Decimal` | `@db.Decimal(12, 2)` | The ceiling (always positive) |
| `currency` | `String` | required | Stamped `DEFAULT_CURRENCY` (EUR) server-side by `createBudget` / `seedPresetBudgets`. **No longer reads `preferredCurrency`** (changed in `feature/onboarding-currency`) |
| `month` | `Int` | required | Calendar month 1–12 |
| `year` | `Int` | required | Four-digit year, e.g. `2026` |
| `rollover` | `Boolean` | `@default(false)` | Opt-in carry of the unspent/overspent remainder into the next month; effective limit derived on read |
| `isArchived` | `Boolean` | `@default(false)` | Hides the budget from the active list without deleting history |
| `userId` | `String` | FK → `User.id` | |
| `categoryId` | `String` | FK → `Category.id` | |
| `createdAt` | `DateTime` | `@default(now())` | |
| `updatedAt` | `DateTime` | `@updatedAt` | |

### Relationships

- belongs to: `User`, `Category`

### Index strategy

| Index | Reason |
|---|---|
| `@@unique([userId, categoryId, month, year])` | Enforces one budget per category per period; used as an upsert key |
| `@@index([userId])` | Broad user-scoped list queries |
| `@@index([userId, year, month])` | Primary query pattern: all budgets for the current period |

### Special rules

- **Rollover (opt-in).** `rollover = false` (default) — each month resets clean. When `true`, the effective limit = `amount + carriedAmount`, where `carriedAmount` is the folded remainder of the consecutive rollover-on run immediately preceding this month (derived on read by `resolveRolloverCarry`; a gap or rollover-off month breaks the run and resets carry to 0). Effective limit ≤ 0 renders as danger/100%.
- Budget consumption is computed at query time by summing `Transaction.amount` where `type = EXPENSE`, `categoryId = ?`, `month/year` matches, and `deletedAt IS NULL`. It is never stored.
- Progress thresholds used in the UI: green below 60 %, amber 60–90 %, red above 100 %. The Dashboard surfaces an "at risk" alert when any category exceeds 80 % of the **effective** limit mid-period.
- When a `Category` is hard-deleted, its `Budget` records are also hard-deleted (`onDelete: Cascade`).

---

## RecurringTemplate

A standing instruction that generates draft transaction proposals on a configurable cadence; drafts must be confirmed by the user before they become real transactions.

### Fields

| Field | Type | Constraint | Notes |
|---|---|---|---|
| `id` | `String` | `@id @default(cuid())` | |
| `name` | `String` | required | Display name, e.g. `"Netflix"` |
| `type` | `TransactionType` | required | The type of transaction the draft will create |
| `amount` | `Decimal` | `@db.Decimal(12, 2)` | Expected amount; editable when confirming the draft |
| `currency` | `String` | required | |
| `cadence` | `RecurringCadence` | required | `DAILY`, `WEEKLY`, `MONTHLY`, or `YEARLY` |
| `nextOccurrence` | `DateTime` | `@db.Date` | Calendar date of the next scheduled draft; advanced on each draft generation |
| `isActive` | `Boolean` | `@default(true)` | `false` = paused; no drafts are generated while paused |
| `userId` | `String` | FK → `User.id` | |
| `financialAccountId` | `String` | FK → `FinancialAccount.id` | |
| `categoryId` | `String?` | FK → `Category.id`, nullable | |
| `createdAt` | `DateTime` | `@default(now())` | |
| `updatedAt` | `DateTime` | `@updatedAt` | |

### Relationships

- belongs to: `User`, `FinancialAccount`, optionally `Category`
- owns: `RecurringDraft[]`, `Transaction[]`

### Index strategy

| Index | Reason |
|---|---|
| `@@index([userId])` | User-scoped template list |
| `@@index([isActive, nextOccurrence])` | The scheduler queries only active templates where `nextOccurrence <= today`; this composite index avoids full table scans |

### Special rules

- `categoryId` is set to `null` via `onDelete: SetNull` if the referenced category is deleted; the template is preserved.
- `financialAccountId` hard-deletes cascade: if the account is removed, the template is also removed (`onDelete: Cascade`).
- Templates can be paused (`isActive = false`) and resumed. While paused, no new `RecurringDraft` records are created.
- Each confirmed draft sets `recurringTemplateId` on the resulting `Transaction`, linking the ledger entry back to its template.

---

## RecurringDraft

A proposed transaction generated by a `RecurringTemplate`; it exists only until the user confirms or dismisses it — the UI enforces the conscious-capture principle even for recurring expenses.

### Fields

| Field | Type | Constraint | Notes |
|---|---|---|---|
| `id` | `String` | `@id @default(cuid())` | |
| `suggestedDate` | `DateTime` | `@db.Date` | Calendar date the scheduler proposed |
| `suggestedAmount` | `Decimal` | `@db.Decimal(12, 2)` | Amount copied from the template at generation time; user can adjust before confirming |
| `status` | `DraftStatus` | `@default(PENDING)` | `PENDING`, `CONFIRMED`, or `DISMISSED` |
| `recurringTemplateId` | `String` | FK → `RecurringTemplate.id` | |
| `createdAt` | `DateTime` | `@default(now())` | |

### Relationships

- belongs to: `RecurringTemplate` (cascade-deletes when template is deleted)

### Index strategy

| Index | Reason |
|---|---|
| `@@index([recurringTemplateId, status])` | The pending-drafts list for a user is fetched by joining templates then filtering `status = PENDING` |

### Special rules

- **Confirming** a draft creates a new `Transaction` (with `recurringTemplateId` set, and `merchant` set to the parent template's `name` so the ledger entry is identifiable) and transitions the draft to `CONFIRMED`.
- **Dismissing** transitions the draft to `DISMISSED`; no transaction is created. The draft record remains for audit purposes.
- `RecurringDraft` does not have its own `userId` — access is controlled via the parent `RecurringTemplate` which is always user-scoped.
- Hard-delete cascades from `RecurringTemplate`; there is no soft delete on `RecurringDraft`.

---

## Goal

A virtual savings target tracked through manually recorded contributions; goals are completely isolated from account balances and budget calculations.

### Fields

| Field | Type | Constraint | Notes |
|---|---|---|---|
| `id` | `String` | `@id @default(cuid())` | |
| `name` | `String` | required | e.g. `"Japan Trip"` |
| `targetAmount` | `Decimal` | `@db.Decimal(12, 2)` | The amount the user wants to reach |
| `currentAmount` | `Decimal` | `@default(0) @db.Decimal(12, 2)` | Denormalized running total; always equals `SUM(GoalContribution.amount)`. See rules below |
| `currency` | `String` | required | |
| `targetDate` | `DateTime?` | `@db.Date`, optional | If set and `currentAmount < targetAmount` and `targetDate` is **strictly before today**, the goal surfaces as overdue on the Dashboard. "Today" floors both sides to UTC midnight with a strict `<`, so a goal due *today* is not overdue (see `docs/features/goals-crud-spec.md` §8) |
| `isCompleted` | `Boolean` | `@default(false)` | **Manual only** — set exclusively by the `completeGoal` action. The app never auto-completes a goal when `currentAmount >= targetAmount` (resolved in favour of the architecture doc; see `docs/features/goals-crud-spec.md` §14) |
| `userId` | `String` | FK → `User.id` | |
| `createdAt` | `DateTime` | `@default(now())` | |
| `updatedAt` | `DateTime` | `@updatedAt` | |

### Relationships

- belongs to: `User`
- owns: `GoalContribution[]`

### Index strategy

| Index | Reason |
|---|---|
| `@@index([userId])` | All goal list queries are user-scoped |

### Special rules

- `currentAmount` is a **denormalized sum** of `GoalContribution.amount`. It is always derivable from the contributions table by running `SUM(amount) WHERE goalId = ?`. The denormalized value is kept for fast reads and must be updated in the same database transaction as any contribution insert or delete. `deleteContribution` decrements by the **stored row value** (never a recomputed or client-supplied figure), so the invariant `currentAmount === SUM(contributions.amount)` holds across any add/delete sequence.
- Goals do not affect `FinancialAccount` balances or `Budget` consumption. They are a virtual tracking layer only.
- Negative `GoalContribution.amount` values represent withdrawals; `currentAmount` may legitimately go **negative** (withdrawals exceed deposits) or **exceed `targetAmount`** (overfunded). The **data layer never clamps** — only the *display* progress bar clamps to `[0, 100]`. An overfunded goal (`currentAmount > targetAmount`) must be visually distinct (an "Overfunded / Over 100%" affordance), not silently shown as a flat 100% (see `docs/features/goals-crud-spec.md` §11).
- **Completion is a soft tag, not a lifecycle state.** A completed goal (`isCompleted = true`) remains fully editable and can still receive contributions; there is no re-open (`uncompleteGoal`) action in MVP. Nothing downstream may assume `isCompleted` implies immutability. If analytics/automation later need a hard "closed" state, `isCompleted` must be promoted to a real lifecycle transition then (see `docs/features/goals-crud-spec.md` §11, §14).
- Goals with `targetDate` strictly before today and `isCompleted = false` (and `currentAmount < targetAmount`) are shown as overdue in the Dashboard. The overdue rule lives in exactly one place — `isGoalOverdue` in `src/lib/goals.ts` — consumed by both the dashboard widget and the `/goals` page.
- Seed examples: Pro user has Japan Trip (`target: 5000`, `current: 2400`, `targetDate: 2026-12-01`), Emergency Fund (`target: 10000`, `current: 3800`, no target date), New Laptop (`target: 1500`, `current: 900`, `targetDate: 2026-09-01`).

---

## GoalContribution

A single deposit or withdrawal recorded against a goal; the audit log that backs the denormalized `Goal.currentAmount`.

### Fields

| Field | Type | Constraint | Notes |
|---|---|---|---|
| `id` | `String` | `@id @default(cuid())` | |
| `amount` | `Decimal` | `@db.Decimal(12, 2)` | Positive = contribution, negative = withdrawal |
| `date` | `DateTime` | `@db.Date` | Calendar date; same no-UTC-conversion rule as `Transaction.date` |
| `note` | `String?` | optional | User memo |
| `goalId` | `String` | FK → `Goal.id` | |
| `createdAt` | `DateTime` | `@default(now())` | |

### Relationships

- belongs to: `Goal` (cascade-deletes when goal is deleted)

### Index strategy

| Index | Reason |
|---|---|
| `@@index([goalId])` | Fetching the contribution history for a single goal |

### Special rules

- **Atomic update required.** Inserting or deleting a `GoalContribution` must be wrapped in a `prisma.$transaction` that also updates `Goal.currentAmount` by the same delta. This is the `addContribution` / `deleteContribution` **Server Action** pair (`src/actions/goals.ts`), not a REST endpoint — the `/api/goals/contributions/[id]` row in the project-overview API table is superseded by the Server Actions architecture (see `docs/entity-crud-architecture.md` and `docs/features/goals-crud-spec.md` §6). `deleteContribution` decrements `Goal.currentAmount` by the deleted row's **stored** amount inside the same transaction.
- Negative `amount` is supported to model withdrawals. The UI should present withdrawals clearly (distinct colour); there is no separate model for them.
- `GoalContribution` does not have its own `userId` — access is controlled via the parent `Goal` (ownership checked inside the transaction).

---

## Summaries

### Enums

#### `AccountType`

| Value | Description |
|---|---|
| `CHECKING` | Standard current / checking account |
| `SAVINGS` | Savings account |
| `CREDIT_CARD` | Credit card liability account |
| `CASH` | Physical cash envelope |
| `INVESTMENT` | Brokerage or investment account |
| `OTHER` | Catch-all for unlisted account types |

#### `TransactionType`

| Value | Description |
|---|---|
| `INCOME` | Money flowing in; positive `amount` |
| `EXPENSE` | Money flowing out; negative `amount` |
| `TRANSFER` | Internal move between accounts; creates two linked records via `transferPairId`; both legs have `isTransferLeg = true` |

#### `RecurringCadence`

| Value | Description |
|---|---|
| `DAILY` | Draft generated every day |
| `WEEKLY` | Draft generated every week |
| `MONTHLY` | Draft generated every month (most common) |
| `YEARLY` | Draft generated every year |

#### `DraftStatus`

| Value | Description |
|---|---|
| `PENDING` | Awaiting user action; shown in the Recurring inbox |
| `CONFIRMED` | User accepted; a `Transaction` was created |
| `DISMISSED` | User rejected; no transaction was created; record retained for audit |

---

### Soft Delete vs Hard Delete

| Entity | Delete strategy | Notes |
|---|---|---|
| `User` | Soft delete (`deletedAt`) | 30-day grace period; sign-in blocked immediately; hard purge after grace period; all children cascade on hard delete |
| `Transaction` | Soft delete (`deletedAt`) | 8-second snackbar undo, then recoverable from `/trash` (restore or permanent delete — `feature/trash-ui`, §8); excluded from balance formula and all active queries while soft-deleted |
| `FinancialAccount` | Archived (`isArchived`) — **archive-only in MVP** | Archiving hides from UI and pauses the account's active recurring templates. No hard delete in MVP (`prisma.financialAccount.delete` is never called); the schema *could* cascade to `Transaction` and `RecurringTemplate`, but the app never triggers it |
| `Budget` | Archived (`isArchived`) + hard delete | Cascade-deleted when its `Category` is deleted |
| `Category` | Hard delete | Cascades to `Budget`; sets `Transaction.categoryId` and `RecurringTemplate.categoryId` to null |
| `RecurringTemplate` | Hard delete | Cascades to `RecurringDraft`; sets `Transaction.recurringTemplateId` to null |
| `RecurringDraft` | Status transition | Records are retained after `CONFIRMED` or `DISMISSED`; cascade-deleted only if the parent template is hard-deleted |
| `Goal` | Hard delete | Cascades to `GoalContribution` |
| `GoalContribution` | Hard delete | Must decrement `Goal.currentAmount` in the same transaction |

---

### System-owned vs User-owned

| Entity | Ownership rule |
|---|---|
| `Category` (system) | `isSystem = true`, `userId = null`. Shared across all users. Cannot be modified or deleted by end users. |
| `Category` (user) | `isSystem = false`, `userId = <id>`. Private to the owner. Cascade-deleted with the user. |
| All other entities | Always owned by a `User` via `userId`. Cascade-deleted when the user is purged. |

---

### Derived vs Stored Values

| Value | Location | Strategy | Rule |
|---|---|---|---|
| `FinancialAccount` balance | not stored | Always derived | `startingBalance + SUM(Transaction.amount WHERE deletedAt IS NULL)`. Caching in a read model is a post-MVP optimisation. |
| Budget consumption | not stored | Always derived | `SUM(Transaction.amount WHERE type = EXPENSE AND categoryId = ? AND month/year match AND deletedAt IS NULL)`. |
| `Goal.currentAmount` | stored (denormalized) | Derivable but cached | Equals `SUM(GoalContribution.amount WHERE goalId = ?)`. The stored value exists for fast reads and **must** be updated atomically with every contribution insert or delete. |
| `isCompleted` on `Goal` | stored | Manual flag | Set **only** by the `completeGoal` action. Never auto-set at 100 % progress — a soft tag, not a lifecycle state (completed goals stay editable). |

---

### `@db.Date` Calendar-Date Rule

The following fields use `@db.Date` and store a calendar date with **no time or timezone component**:

- `Transaction.date`
- `RecurringTemplate.nextOccurrence`
- `RecurringDraft.suggestedDate`
- `Goal.targetDate`
- `GoalContribution.date`

The client sends the user's local date string (e.g. `"2026-05-31"`) directly. No UTC conversion is applied on the server. This is intentional: converting to UTC would cause a "May 31 at 23:30 local = June 1 UTC" bug that would misattribute transactions to the wrong budget month.
