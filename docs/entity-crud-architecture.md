# Entity CRUD Architecture

Spendly uses a three-layer data access pattern: **async server components** call **server-only Prisma fetchers** (`src/lib/db/`) for reads, and **`"use server"` Server Actions** (`src/actions/`) for mutations. API routes (`src/app/api/`) are reserved for Stripe webhooks, third-party integrations, and the endpoints listed in the project spec that need to be callable outside the Next.js render cycle. Every layer enforces row-level ownership by scoping all Prisma queries to `session.user.id`.

> **✅ Realized non-auth API route (`feature/data-export`).** The **data-export** routes
> (`GET /api/export/csv`, `GET /api/export/json`) are the first non-auth API routes in the codebase and
> the canonical example of this "callable outside the render cycle" exception — a file download needs
> `Content-Disposition` + streaming, which a Server Action cannot do. They keep the three-layer split
> intact: reads go through a server-only fetcher (`src/lib/db/export.ts` — `exportTxWhere`,
> `getTransactionsForExport`, `getFullExport`), pure transforms live in `src/lib/export/*`, and the
> route handler is HTTP/stream glue only (`auth()` → rate-limit → fetch → stream). The boundary is
> enforced by an ESLint `no-restricted-imports` override forbidding `@/lib/prisma` in
> `src/app/api/export/**`. Read-only — no Server Actions, no `revalidate*`. See `docs/ROADMAP.md` §6
> and `docs/features/data-export-spec.md`.

---

## Transaction

**Route:** `/transactions`

### Read path

Fetcher file: `src/lib/db/transactions.ts`

The server component calls the fetcher directly with `userId` from `auth()`. Core filters:

| Filter | Value |
|---|---|
| `userId` | from session — always required |
| `deletedAt` | `null` (soft-delete) |
| `type` | optional — `INCOME`, `EXPENSE`, or `TRANSFER` |
| `financialAccountId` | optional — from the global account selector |
| `date` range | optional — user-selected period |
| text search | optional — `OR: [{ merchant: { contains } }, { note: { contains } }]` |

Results are ordered `date: "desc"`. The feed groups rows by date label (Today / Yesterday / earlier dates).

For transfers: both legs share a `transferPairId`. When no account filter is active, deduplicate in the fetcher by grouping on `transferPairId` and exposing both account names. When an account filter is active, return only the leg whose `financialAccountId` matches and render a transfer indicator.

### Mutation path

Action file: `src/actions/transactions.ts`

All actions follow the `{ success, data?, error? }` convention (see Cross-Cutting Concerns).

| Action | Description |
|---|---|
| `createTransaction` | Create a single INCOME or EXPENSE record |
| `createTransfer` | Create two linked records in a `$transaction` (see snippet below) |
| `updateTransaction` | Patch amount, date, category, merchant, note — never change `type` on a transfer leg |
| `deleteTransaction` | Soft delete — set `deletedAt = new Date()` (both legs for a transfer) |
| `restoreTransaction` | Set `deletedAt = null` — called by the 8-second snackbar undo **and** the Trash UI restore |
| `hardDeleteTransaction` | Permanent delete of an **already-soft-deleted** row (both legs for a transfer) — Trash UI "Delete forever" only |
| `emptyTrash` | Permanent delete of every soft-deleted row for the user — Trash UI "Empty trash" |

Zod schema validates: `type` enum, `amount` (positive Decimal), `date` (local calendar date string), `financialAccountId`, optional `categoryId`, `merchant`, `note`.

### Transfer create pattern

```typescript
// src/actions/transactions.ts
import { randomUUID } from "crypto";

const pairId = randomUUID();
await prisma.$transaction([
  prisma.transaction.create({
    data: {
      ...sharedFields,
      type: "TRANSFER",
      amount: positiveAmount,          // positive on the source debit
      financialAccountId: fromAccountId,
      isTransferLeg: true,
      transferPairId: pairId,
      userId,
    },
  }),
  prisma.transaction.create({
    data: {
      ...sharedFields,
      type: "TRANSFER",
      amount: negativeAmount,          // negative on the destination credit
      financialAccountId: toAccountId,
      isTransferLeg: true,
      transferPairId: pairId,
      userId,
    },
  }),
]);
```

### Special cases

- **Soft delete first.** The normal delete path never calls `prisma.transaction.delete` — it sets `deletedAt`, and the 8-second snackbar calls `restoreTransaction` to reverse it. The **only** hard-delete path is the post-MVP Trash UI (`hardDeleteTransaction` / `emptyTrash`), which removes rows that are **already** soft-deleted (`feature/trash-ui`, POST-MVP §8). Restore from Trash reuses `restoreTransaction` unchanged.
- **Transfer legs are immutable for type/category.** `isTransferLeg = true` signals that recategorization is blocked.
- **Date is a calendar date.** Store the user's local date string directly (e.g. `"2026-06-15"`) as a `@db.Date`; do not convert to UTC.

### Row-level ownership

```typescript
// All reads and mutations must include userId from session
const session = await auth();
if (!session?.user?.id) return { success: false, error: "Unauthorized" };

await prisma.transaction.findMany({
  where: { userId: session.user.id, deletedAt: null, ... },
});
```

---

## FinancialAccount

**Route:** `/accounts` (dedicated account-management page), account selector pill (global filter across all pages). A "Manage accounts" entry point links here from the topbar account pill, the sidebar bottom utility group, and the UserMenu drop-up.

### Read path

Fetcher file: `src/lib/db/accounts.ts` (the existing file — not `financial-accounts.ts`). Keeps `getUserAccounts` (active-only `{ id, name }` for selectors) and adds `getAccountsWithBalances(userId, { includeArchived })` (derived balances via a 2-query `findMany` + `groupBy`, no N+1) and `getAccountForEdit(userId, id)`.

Standard list query scoped by `userId`. Archived accounts (`isArchived: true`) are excluded from all account selectors, the dashboard hero balance, and the monthly metric strip. Archived accounts remain visible in Reports only when explicitly selected by the user.

Balance is never stored on the record. Always compute at query time:

```typescript
// Derived balance formula
const balance = account.startingBalance
  + transactions
      .filter(tx => tx.deletedAt === null)
      .reduce((sum, tx) => sum + tx.amount, 0);
```

For the dashboard hero total: sum derived balances across all non-archived accounts. When the user holds accounts in multiple currencies, display a `⚠ Mixed currencies — approximate total` indicator alongside the hero balance.

### Mutation path

Action file: `src/actions/financial-accounts.ts`

| Action | Description |
|---|---|
| `createFinancialAccount` | Create with name, type, startingBalance, optional color/icon. **`currency` is set server-side to `DEFAULT_CURRENCY` (EUR) — never client-supplied** (§ currency note below). |
| `updateFinancialAccount` | Patch name, color, icon **only** — `type` and `startingBalance` are immutable in MVP (changing `startingBalance` would silently rewrite every derived balance) |
| `archiveFinancialAccount` | Idempotent. Set `isArchived = true` and, in the **same `$transaction`**, pause (`isActive = false`) the account's active recurring templates so the scheduler stops emitting unconfirmable drafts. Never hard-delete |
| `unarchiveFinancialAccount` | Idempotent. Set `isArchived = false` — drives the 8-second Sonner undo. Does **not** auto-resume the templates archiving paused (the user re-activates each one deliberately) |

Zod schema validates: `name` (non-empty string, ≤ 60), `type` (`AccountType` enum), `startingBalance` (**signed** Decimal — negative allowed for liability accounts such as credit cards — bounded by `±STARTING_BALANCE_MAX`), optional `color` (hex) / `icon` (whitelisted `ACCOUNT_ICONS`). There is **no** `currency` field on the schema in MVP (EUR-only; the action stamps `DEFAULT_CURRENCY`).

### Special cases

- **Currency is EUR-only and resolved server-side.** No currency picker exists in MVP. `createFinancialAccount` writes `DEFAULT_CURRENCY` (EUR) from `src/lib/currency.ts`; client-supplied currency is ignored. The schema column stays for the post-MVP multi-currency upgrade. Display uses the existing `$`-styled `formatCurrency` for now (per-row `€` formatting lands with multi-currency).
- **Negative starting balance allowed.** Liability accounts (e.g. `CREDIT_CARD`) legitimately open below zero; the derived-balance formula already sums signed amounts. This overrides the earlier `≥ 0` rule.
- **Archived accounts cannot receive new transactions.** The transaction create/update actions verify `financialAccount.isArchived === false` (already enforced), and `confirmDraft` must do the same (see RecurringTemplate special cases).
- **Balance is derived, not stored.** Never add a `balance` column. If query performance becomes an issue, add a read-model cache table — but do not denormalize onto the model itself.
- **Archive-only — no hard delete in MVP.** `prisma.financialAccount.delete` is never called; archiving is the only removal path.

---

## Budget

**Route:** `/budgets`

### Read path

Fetcher file: `src/lib/db/budgets.ts`

Budgets are scoped to a calendar month. The page receives `month` and `year` from searchParams (defaulting to the current month).

Filters always applied:

| Filter | Value |
|---|---|
| `userId` | from session |
| `month` | 1–12 |
| `year` | e.g. 2026 |
| `isArchived` | `false` |

For each budget row, the fetcher also aggregates the category's EXPENSE transactions within the same month range to compute `spent`. This can be done with an `include` + inline filter (as in `dashboard.ts`) or with a `groupBy` aggregate — prefer the `include` approach for small result sets.

Progress states derive from `spent / budget.amount`:

| Fraction | State |
|---|---|
| < 0.60 | green (in budget) |
| 0.60–0.90 | amber (warning threshold) |
| > 1.00 | red (over budget) |

Dashboard surfaces budgets at risk (> 80%) as actionable insights.

### Mutation path

Action file: `src/actions/budgets.ts`

| Action | Description |
|---|---|
| `createBudget` | Create for a given `categoryId`, `month`, `year`, `amount` |
| `updateBudget` | Patch `amount` or `currency` |
| `archiveBudget` | Set `isArchived = true` |

Zod schema validates: `categoryId`, `month` (1–12), `year` (integer ≥ 2020), `amount` (positive Decimal), `currency`.

The schema enforces `@@unique([userId, categoryId, month, year])` — the action should handle the unique constraint violation and return a user-friendly error rather than surfacing a Prisma exception.

### Special cases

- **Opt-in rollover (`feature/budget-rollover`, POST-MVP §7).** By default each month is independent. When `rollover = true`, the budget's **effective limit** = base `amount` + the prior month's remainder (`effective − spent`), derived on read by `resolveRolloverCarry` — no stored carry, no cron. A gap month or a rollover-off month resets the run. See `docs/features/budget-rollover-spec.md`.
- **Currency.** Budget currency is recorded but cross-currency comparison is post-MVP. In MVP, budgets and transactions should share the same currency.
- **Archived-account expenses still count toward budget spend (deliberate).** Budget consumption is **category-scoped historical analysis**, so it sums a category's EXPENSE transactions regardless of whether the owning account is archived — `getBudgetsData`/`getBudgets` intentionally do **not** add an `isArchived: false` account filter. This is asymmetric with the dashboard hero balance and metric strip (current-account aggregates that *do* exclude archived accounts) and with the recent-transactions feed (which excludes archived-account rows so it agrees with `/transactions`). The rule: archiving changes **visibility and future capture, not historical category spending**. Do not "fix" the budget query to match the balance query — the divergence is the intended behavior.

---

## RecurringTemplate + RecurringDraft

**Route:** `/recurring`

### Read path

Fetcher file: `src/lib/db/recurring.ts`

Two separate queries, fanned out in parallel:

1. **Templates:** `findMany({ where: { userId } })` — include all active and inactive templates so the user can see paused ones.
2. **Pending drafts:** join through `recurringTemplateId` to filter `status: "PENDING"` drafts belonging to the authenticated user's templates.

```typescript
// Efficient pending-drafts query scoped to the user's templates
const drafts = await prisma.recurringDraft.findMany({
  where: {
    status: "PENDING",
    recurringTemplate: { userId },
  },
  include: { recurringTemplate: true },
  orderBy: { suggestedDate: "asc" },
});
```

### Mutation path

Action file: `src/actions/recurring.ts`

| Action | Description |
|---|---|
| `createRecurringTemplate` | Create with name, type, amount, currency, cadence, nextOccurrence, financialAccountId, optional categoryId |
| `updateRecurringTemplate` | Patch name, amount, cadence |
| `pauseTemplate` | Set `isActive = false` |
| `resumeTemplate` | Set `isActive = true` |
| `deleteTemplate` | Hard delete — cascades to drafts (no user data is lost) |
| `confirmDraft` | See snippet below — creates a Transaction and advances nextOccurrence |
| `dismissDraft` | Set `status = "DISMISSED"` |

### Draft confirm pattern

Confirming a draft has two side effects that must be atomic:

```typescript
// src/actions/recurring.ts
async function confirmDraft(draftId: string, userId: string) {
  const draft = await prisma.recurringDraft.findUnique({
    where: { id: draftId },
    include: { recurringTemplate: true },
  });

  // Row-level ownership: verify the template belongs to this user
  if (!draft || draft.recurringTemplate.userId !== userId) {
    return { success: false, error: "Not found" };
  }
  if (draft.status !== "PENDING") {
    return { success: false, error: "Draft is no longer pending" };
  }

  const template = draft.recurringTemplate;
  const nextOccurrence = advanceByCADENCE(template.nextOccurrence, template.cadence);
  // advanceByCADENCE: DAILY +1d, WEEKLY +7d, MONTHLY +1mo, YEARLY +1yr

  await prisma.$transaction([
    // 1. Create the confirmed transaction from template fields
    prisma.transaction.create({
      data: {
        type: template.type,
        amount: draft.suggestedAmount,
        currency: template.currency,
        date: draft.suggestedDate,
        // Stamp the template name as the merchant — a Transaction has no
        // description column, so the displayed label is derived from `merchant`.
        // Without this the row shows the category name (feed) or "Transaction"
        // (dashboard) instead of "Netflix". See "Confirmed-draft description" below.
        merchant: template.name,
        financialAccountId: template.financialAccountId,
        categoryId: template.categoryId,
        recurringTemplateId: template.id,
        userId,
      },
    }),
    // 2. Mark the draft confirmed
    prisma.recurringDraft.update({
      where: { id: draftId },
      data: { status: "CONFIRMED" },
    }),
    // 3. Advance the template's next occurrence
    prisma.recurringTemplate.update({
      where: { id: template.id },
      data: { nextOccurrence },
    }),
  ]);

  return { success: true };
}
```

### Special cases

- **Archived-account guard on confirm.** Confirming a draft creates a `Transaction` on the template's `financialAccountId`, so `confirmDraft` must reject when that account `isArchived === true`, returning `{ success: false, error: "This account is archived" }`. (Archiving an account already pauses its active templates, but a `PENDING` draft generated before archiving can still exist — this guard blocks confirming it.)
- **Confirmed-draft description.** The created `Transaction` sets `merchant = template.name`. A `Transaction` has no dedicated description/name column; its displayed label is derived from `merchant` first. Without the stamp a draft-born row is unlabeled and the views diverge — the transactions feed falls back `merchant → category.name → type`, while the dashboard recent list falls back `merchant ?? note ?? "Transaction"`. Stamping the template name (the field's intended use — "future-proofs subscription detection") makes both views show the recognizable name. Any new surface that creates a `Transaction` from a template should follow the same rule.
- **Draft generation.** A background job (or a cron-triggered API route at `/api/recurring/generate`) checks templates where `isActive = true` and `nextOccurrence <= today`, creates PENDING drafts, and does NOT advance `nextOccurrence` — that happens only on confirmation. In MVP this can be triggered on page load server-side.
- **Dismissed drafts.** Setting `status = "DISMISSED"` skips the occurrence. `nextOccurrence` is still advanced so the template continues generating future drafts.
- **Paused templates.** `isActive = false` templates do not generate new drafts. Existing PENDING drafts remain until explicitly dismissed.

---

## Goal + GoalContribution

**Route:** `/goals`

### Read path

Fetcher file: `src/lib/db/goals.ts`

```typescript
// Goals list — include contributions for progress display
const goals = await prisma.goal.findMany({
  where: { userId },
  include: {
    contributions: { orderBy: { date: "desc" } },
  },
  orderBy: { createdAt: "asc" },
});
```

`currentAmount` is a denormalized field kept in sync with `SUM(contributions.amount)`. Read it directly for fast renders; treat the contributions list as the audit trail.

Overdue goals: `targetDate < today AND currentAmount < targetAmount AND isCompleted = false`, where `today` floors both sides to UTC midnight with a strict `<` (a goal due *today* is not overdue). This rule lives in exactly one helper — `isGoalOverdue` in `src/lib/goals.ts` — shared by the dashboard widget and the `/goals` page (see `docs/features/goals-crud-spec.md` §8).

### Mutation path

Action file: `src/actions/goals.ts`

| Action | Description |
|---|---|
| `createGoal` | Create with name, targetAmount, currency, optional targetDate |
| `updateGoal` | Patch name, targetAmount, targetDate |
| `completeGoal` | Set `isCompleted = true` |
| `deleteGoal` | Hard delete — cascades to contributions |
| `addContribution` | See snippet below — creates GoalContribution and updates Goal.currentAmount atomically |
| `deleteContribution` | See snippet below — removes contribution and decrements Goal.currentAmount atomically |

### GoalContribution side-effect pattern

```typescript
// src/actions/goals.ts

// Adding a contribution
async function addContribution(goalId: string, amount: number, date: string, note: string | undefined, userId: string) {
  // Verify ownership
  const goal = await prisma.goal.findUnique({ where: { id: goalId } });
  if (!goal || goal.userId !== userId) return { success: false, error: "Not found" };

  await prisma.$transaction([
    prisma.goalContribution.create({
      data: { goalId, amount, date: new Date(date), note },
    }),
    prisma.goal.update({
      where: { id: goalId },
      data: { currentAmount: { increment: amount } },
    }),
  ]);

  return { success: true };
}

// Deleting a contribution
async function deleteContribution(contributionId: string, userId: string) {
  const contribution = await prisma.goalContribution.findUnique({
    where: { id: contributionId },
    include: { goal: true },
  });
  if (!contribution || contribution.goal.userId !== userId) {
    return { success: false, error: "Not found" };
  }

  await prisma.$transaction([
    prisma.goalContribution.delete({ where: { id: contributionId } }),
    prisma.goal.update({
      where: { id: contribution.goalId },
      data: { currentAmount: { decrement: contribution.amount } },
    }),
  ]);

  return { success: true };
}
```

### Special cases

- **Negative contributions.** Passing a negative `amount` represents a withdrawal. The same `addContribution` action handles this; the `decrement` equivalent is `increment` with a negative value.
- **`currentAmount` is denormalized.** It can always be recomputed from `SUM(contributions.amount)` — useful for a future reconciliation utility. Never let it drift by updating the goal without also writing a contribution record.
- **`isCompleted` is manual.** The app does not auto-complete goals when `currentAmount >= targetAmount`; the user explicitly marks completion.

---

## Category

**Route:** Account-wide (used in transaction drawer, budget creation, recurring template creation)

### Read path

Categories are fetched as a combined list of system categories and the authenticated user's own categories:

```typescript
// src/lib/db/categories.ts
const categories = await prisma.category.findMany({
  where: {
    OR: [
      { isSystem: true },
      { userId },
    ],
  },
  orderBy: { name: "asc" },
});
```

System categories have `userId = null` and `isSystem = true`. They are returned alongside user categories from the same query. No separate endpoint needed.

### Mutation path

Action file: `src/actions/categories.ts`

| Action | Applies to | Description |
|---|---|---|
| `createCategory` | User categories only | Create with name, icon, color — `isSystem` is always `false`, `userId` is always from session |
| `updateCategory` | User categories only | Patch name, icon, color |
| `deleteCategory` | User categories only | Hard delete — foreign key on Transaction is `onDelete: SetNull`, so transactions move to `categoryId = null` (displayed as "Uncategorized") |

System categories (`isSystem = true`) are never mutated through the app. Any attempt to update or delete a record where `isSystem = true` must return an error.

### Special cases

- **Ownership check.** Before any mutation, verify `category.userId === session.user.id` AND `category.isSystem === false`. Failing either check returns `{ success: false, error: "Forbidden" }`.
- **Name uniqueness.** The schema enforces `@@unique([name, userId])`. A user cannot create two categories with the same name, but system names are allowed to overlap with user names (different `userId`).
- **"Uncategorized" is a system category.** It acts as the fallback when a category is deleted. It cannot be deleted.

---

## Cross-Cutting Concerns

### File layout

| Layer | Location | Notes |
|---|---|---|
| DB fetchers (reads) | `src/lib/db/<entity>.ts` | `import "server-only"` at top; Prisma queries only; returns typed domain objects |
| Server Actions (mutations) | `src/actions/<entity>.ts` | `"use server"` directive; Zod validation; `auth()` session check; `{ success, data?, error? }` return |
| Server components (pages) | `src/app/(app)/<route>/page.tsx` | `async` function; calls DB fetchers directly via `Promise.all`; passes typed props to client components |
| API routes | `src/app/api/<route>/route.ts` | Only for webhooks, file uploads, or spec-listed endpoints callable outside the render cycle. ✅ Realized: the data-export streaming routes `src/app/api/export/{csv,json}/route.ts` (DB only via `src/lib/db/export.ts`; ESLint-enforced) |

### Soft-delete pattern

Only `Transaction` uses soft delete in the current schema. `FinancialAccount` and `Budget` use `isArchived`. User accounts use `deletedAt` for a 30-day grace period.

```
Transaction.deletedAt = null   → visible everywhere
Transaction.deletedAt = <date> → hidden from active queries; snackbar undo for 8 seconds, then recoverable from /trash

// All active transaction list queries must include:
where: { deletedAt: null }

// deleteTransaction action:
await prisma.transaction.update({
  where: { id, userId },   // userId scoping prevents cross-user mutation
  data: { deletedAt: new Date() },
});

// restoreTransaction action (snackbar within 8 seconds, or Trash UI restore):
await prisma.transaction.update({
  where: { id, userId },
  data: { deletedAt: null },
});
```

**✅ Trash UI shipped (`feature/trash-ui`, POST-MVP §8).** Beyond the 8-second snackbar, soft-deleted
transactions are recoverable from `/trash` — `getDeletedTransactions` reads `deletedAt != null`, restore
reuses `restoreTransaction`, and `hardDeleteTransaction` / `emptyTrash` permanently remove
already-soft-deleted rows. Only transactions soft-delete; other entities are hard-deleted, so Trash is
transactions-only.

### Auth guard pattern

Every Server Action and API route handler must call `auth()` at the top and exit early if no session exists. Never trust a client-supplied user ID.

```typescript
// Pattern for Server Actions (src/actions/<entity>.ts)
import { auth } from "@/auth";

export async function createEntity(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Unauthorized" };
  }
  const userId = session.user.id;
  // All Prisma calls below use `userId` — never a client-supplied value
}

// Pattern for API route handlers (src/app/api/.../route.ts)
import { auth } from "@/auth";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // ...
}
```

The middleware (`src/proxy.ts`) redirects unauthenticated users away from `/dashboard/*` before the request reaches the page or action, but this is a UX safeguard only — every action must still verify the session independently.

### Mutation return convention

All Server Actions return a discriminated union. Never throw from a Server Action — re-throw only `NEXT_REDIRECT` (thrown by `signIn`, `signOut`, and `redirect()`).

```typescript
// Success
return { success: true, data: createdRecord };

// Failure
return { success: false, error: "Human-readable message for toast display" };

// Re-throw control-flow errors only
try {
  await signIn("credentials", { redirectTo: "/dashboard" });
} catch (error) {
  if (error instanceof AuthError) return { success: false, error: "Invalid credentials" };
  throw error; // re-throw NEXT_REDIRECT
}
```

Client components consume the result via `useActionState` and surface errors as toasts or inline messages. The `error` string should be user-facing and safe to display without sanitization.

### Prisma `$transaction` usage

Use `prisma.$transaction` whenever a mutation has more than one write that must succeed or fail together:

| Scenario | Operations wrapped |
|---|---|
| Transfer create | Insert both transaction legs |
| Confirm recurring draft | Create transaction + mark draft CONFIRMED + advance `nextOccurrence` |
| Add goal contribution | Insert GoalContribution + increment `Goal.currentAmount` |
| Delete goal contribution | Delete GoalContribution + decrement `Goal.currentAmount` |
