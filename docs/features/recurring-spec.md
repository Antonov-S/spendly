# Recurring Templates Spec

> Implement the full **read + write** stack for recurring transaction templates and
> their pending-draft inbox at `/recurring`, mirroring the patterns established by
> Transactions and Budgets (server-component reads via `src/lib/db/*`, `"use server"`
> mutations via `src/actions/*`, Zod validation, row-level ownership, Sonner toasts).

_Status: proposal • Feature: Recurring Templates • Last updated: 2026-06-16_

Authoritative sources: `context/project-overview.md` (Recurring Templates feature,
Design System), `docs/entity-types.md` (RecurringTemplate / RecurringDraft fields and
rules), and `docs/entity-crud-architecture.md` (read/mutation contracts, draft-confirm
pattern).

> **Deliberate divergence from the documented API routes.** `project-overview.md` lists
> REST routes (`/api/recurring`, `/api/recurring/[id]`, `/api/recurring/drafts`,
> `/api/recurring/drafts/[id]`). This feature implements the same surface as **server
> actions** instead, consistent with how Transactions and Budgets shipped and with
> `coding-standards.md` (prefer Server Actions; reserve API routes for webhooks, uploads,
> and external clients). The documented routes remain a valid future addition if a
> mobile/CLI client needs them.

---

## 1. Goal

A user can manage recurring transaction rules end-to-end on `/recurring`:

- **Templates** — create standing instructions (name, type, amount, cadence, account,
  optional category, first occurrence date); edit name/amount/cadence; pause/resume;
  hard-delete.
- **Drafts inbox** — every time the page loads the server generates a pending draft for
  each active template whose `nextOccurrence` is today or past (one draft per template,
  not one per missed period). The user **confirms** a draft (creates a real `Transaction`
  and advances `nextOccurrence`) or **dismisses** it (skips the occurrence, also
  advances `nextOccurrence`). This preserves the *conscious capture* principle: even
  recurring expenses require a moment of acknowledgement before hitting the ledger.

This completes the **control layer** of the MVP recurring flow and closes the Drafts
panel on the Dashboard.

### Non-goals (explicit, per spec)

- **No TRANSFER type** for recurring templates — transfers require two accounts and a
  pairing ID; the single-account template form cannot model them cleanly. Out of scope
  for MVP.
- **No automatic draft generation on a background scheduler** — generation runs
  server-side on page load only. A future `/api/recurring/generate` cron route is
  acknowledged in the architecture but not implemented here.
- **No per-draft amount edit at confirm time** — the spec notes the amount is "editable
  when confirming the draft"; this is deferred for now. The confirm action uses
  `draft.suggestedAmount` directly.
  _Future enhancement — editable amount on confirm._ A `RecurringDraft` stays an
  immutable snapshot of the template at generation time; editing a template's amount
  after a draft exists never updates that draft. The enhancement would let the user
  **override `suggestedAmount` during confirmation** — the override flows only into the
  resulting `Transaction` and **does not modify the draft record**. This applies an
  amount change immediately without mutating historical snapshots, preserving the audit
  rule "what you reviewed is what you confirmed." See the §12 "Draft snapshot
  immutability" row for the current (pre-enhancement) reconciliation paths.
- **No Trash UI for templates** — hard delete cascades to drafts. No undo for template
  deletion (the action is destructive by design and gates behind a confirm dialog).
- **No cross-currency recurring templates** — `currency` is resolved from the chosen
  financial account at create time and stamped on the template. Mixed-currency templates
  are displayed as-is; no aggregation is attempted.

---

## 2. What already exists (reuse, don't rebuild)

| Asset | Location | Use |
|---|---|---|
| Sheet drawer | `src/components/ui/sheet.tsx` | Template form drawer (right panel ≥768px / bottom sheet) |
| Sonner toasts | `src/components/ui/sonner.tsx` | Confirm / dismiss / delete / undo feedback |
| `AppShell` | `src/components/layout/app-shell.tsx` | Page chrome (topbar + sidebar + account selector) |
| Transaction actions | `src/actions/transactions.ts` | Copy auth guard, `safeParse`, `{ success, error }`, `revalidatePath` |
| Icon resolution | `src/lib/icon-map.ts` | DB icon-name string → Lucide component (for category icons in draft cards) |
| Format helpers | `src/lib/format.ts` | `formatCurrency`, `formatSigned` for amount display |
| `useMediaQuery` | existing hook | `BREAKPOINTS.mobile` for bottom-sheet vs right-panel |
| `getSessionOrRedirect` | `src/lib/auth/guards.ts` | Auth guard at the top of the page server component |
| `getUserAccounts` | `src/lib/db/accounts.ts` | Account selector in the form |
| `getUserCategories` | `src/lib/db/categories.ts` | Category selector in the form |
| `getDrawerFormData` | `src/actions/transactions.ts` | Reference pattern — already `Promise.all([getUserAccounts, getUserCategories])`; mirror it for the template form |
| `TRANSACTION_TYPE_OPTIONS` | `src/lib/constants.ts` | Filter to INCOME/EXPENSE for the type toggle |

---

## 3. Data model recap

From `prisma/schema.prisma` / `docs/entity-types.md`. **One migration** is in scope:
a partial unique index on `RecurringDraft` enforcing at most one PENDING draft per
template (see RecurringDraft key rules below). No model/field changes — index only.

### RecurringTemplate

| Field | Type | Notes |
|---|---|---|
| `id` | `String` | cuid |
| `name` | `String` | Display name, e.g. `"Netflix"` |
| `type` | `TransactionType` | `INCOME` or `EXPENSE` only in this feature |
| `amount` | `Decimal(12,2)` | Expected amount; always positive magnitude |
| `currency` | `String` | Resolved from the chosen account at create time |
| `cadence` | `RecurringCadence` | `DAILY`, `WEEKLY`, `MONTHLY`, `YEARLY` |
| `nextOccurrence` | `DateTime @db.Date` | Calendar date of next scheduled draft; advanced on confirm or dismiss |
| `isActive` | `Boolean` | `true` = active; `false` = paused |
| `userId` | FK | from session — never client-supplied |
| `financialAccountId` | FK | The account the future transaction will use |
| `categoryId` | FK? | Optional |

Key rules:
- `@@index([isActive, nextOccurrence])` — backs the draft-generation query.
- Cascade: hard-deleting a template cascade-deletes all its `RecurringDraft` records. The resulting `Transaction` rows (if any were confirmed) retain `recurringTemplateId = null` via `onDelete: SetNull`.
- Currency is stamped at create time from the chosen account's `currency` field. If the account's currency changes (not a current feature), the template is unaffected.

### RecurringDraft

| Field | Type | Notes |
|---|---|---|
| `id` | `String` | cuid |
| `suggestedDate` | `DateTime @db.Date` | = template's `nextOccurrence` at generation time |
| `suggestedAmount` | `Decimal(12,2)` | = template's `amount` at generation time |
| `status` | `DraftStatus` | `PENDING`, `CONFIRMED`, `DISMISSED` |
| `recurringTemplateId` | FK | Parent template |

Key rules:
- No `userId` on the draft — ownership is established via `draft.recurringTemplate.userId`.
- `@@index([recurringTemplateId, status])` — backs the pending-drafts list.
- **Partial unique index (new migration):** `CREATE UNIQUE INDEX "RecurringDraft_template_pending_unique" ON "RecurringDraft" ("recurringTemplateId") WHERE "status" = 'PENDING';` — guarantees **at most one PENDING draft per template** at the DB level, eliminating the generation race. Prisma cannot express partial indexes in `schema.prisma`, so this is added as **raw SQL inside a `--create-only` migration**; `schema.prisma` is otherwise unchanged. Because it lives in migration history (not the schema diff), `prisma migrate dev` will not try to drop it.
- Confirming creates a `Transaction` + sets `status = CONFIRMED` + advances `nextOccurrence` on the template — all in one `prisma.$transaction`.
- Dismissing sets `status = DISMISSED` + advances `nextOccurrence` — also atomic.
- `PENDING` drafts are the only ones shown in the UI. `CONFIRMED` and `DISMISSED` rows are retained for audit but never surfaced.

---

## 4. Files to create / touch

| Layer | File | Action |
|---|---|---|
| Pure helpers | `src/lib/recurring.ts` | **new** — `advanceNextOccurrence`, `formatCadence`, `isDraftOverdue`, `mapTemplateRow` |
| Validation | `src/lib/validations/recurring.ts` | **new** — `createTemplateSchema`, `updateTemplateSchema` |
| Read fetcher | `src/lib/db/recurring.ts` | **new** — `getTemplates`, `getPendingDrafts`, `generatePendingDrafts` |
| Mutations | `src/actions/recurring.ts` | **new** — create / update / pause / resume / delete template; confirm / dismiss draft |
| Page | `src/app/recurring/page.tsx` | **new** — `force-dynamic`, generates drafts on load, passes data to client view |
| Components | `src/components/recurring/*` | **new** — see §8 |
| Constants | `src/lib/constants.ts` | add `CADENCE_OPTIONS`, `RECURRING_AMOUNT_MAX` |
| Date helper | `src/lib/date.ts` | **touch** — add `startOfUtcDay(date)` (UTC-midnight floor), reused by `isDraftOverdue` and `generatePendingDrafts` |
| Revalidation | `src/actions/transactions.ts` | **touch** — **export** the existing `revalidateTransactionViews()` (currently private) so `confirmDraft` can reuse it. Do **not** add `/recurring` here — manual transactions don't change templates or drafts. |
| Migration | `prisma/migrations/<ts>_recurring_draft_pending_unique/` | **new** — `--create-only` migration adding the partial unique index (raw SQL); `schema.prisma` unchanged |
| Tests | `test/lib/recurring.test.ts`, `test/actions/recurring.test.ts` | **new** |

---

## 5. Pure helpers — `src/lib/recurring.ts`

No Prisma — fully unit-testable without mocks:

```ts
import type { RecurringCadence } from "@/generated/prisma";
import { startOfUtcDay } from "@/lib/date"; // new shared helper — see §4

/**
 * Advance a @db.Date calendar-date string by one cadence unit.
 * Input is a JS Date (midnight UTC from Prisma); output is the same.
 * Rules: DAILY +1d, WEEKLY +7d, MONTHLY +1 calendar month (clamped to last day),
 * YEARLY +1 calendar year.
 */
export function advanceNextOccurrence(date: Date, cadence: RecurringCadence): Date {
  // Work in UTC to match @db.Date storage (no timezone component).
  const d = new Date(date);
  switch (cadence) {
    case "DAILY":
      d.setUTCDate(d.getUTCDate() + 1);
      break;
    case "WEEKLY":
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    case "MONTHLY":
      addMonthsClamped(d, 1);
      break;
    case "YEARLY":
      addMonthsClamped(d, 12);
      break;
  }
  return d;
}

/**
 * Add `months` calendar months in UTC, clamping the day to the last valid day
 * of the target month.
 *
 * ⚠️ JS `setUTCMonth`/`setUTCFullYear` do NOT clamp — they OVERFLOW.
 *    Jan 31 + 1 month  → Mar 3  (not Feb 28)
 *    Feb 29 + 12 months → Mar 1  (not Feb 28)
 * We must clamp explicitly: set day to 1 before shifting the month, then pin
 * to min(originalDay, lastDayOfTargetMonth).
 */
function addMonthsClamped(d: Date, months: number): void {
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  // Day 0 of the *next* month = last day of the target month.
  const lastDay = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)
  ).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
}

/** Human-readable cadence label. */
export function formatCadence(cadence: RecurringCadence): string {
  const MAP: Record<RecurringCadence, string> = {
    DAILY: "Daily",
    WEEKLY: "Weekly",
    MONTHLY: "Monthly",
    YEARLY: "Yearly",
  };
  return MAP[cadence];
}

/**
 * True when a draft's suggestedDate is strictly in the past relative to `now`.
 * Uses the shared `startOfUtcDay` helper so overdue checks, draft generation,
 * and budget windows all derive "today" the same way (no ad-hoc UTC math).
 */
export function isDraftOverdue(suggestedDate: Date, now = new Date()): boolean {
  return suggestedDate < startOfUtcDay(now);
}
```

`startOfUtcDay` to add to `src/lib/date.ts` (floors any `Date` to UTC midnight):

```ts
/** Floor a Date to UTC midnight — the canonical "today" for @db.Date compares. */
export function startOfUtcDay(date: Date = new Date()): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}
```

`mapTemplateRow` (in the same file): converts a Prisma `RecurringTemplate & { category, financialAccount }` include result into a serializable `TemplateRow` type (see §6) that client components can render without touching Prisma types. Use `resolveIcon` from `icon-map.ts` only when building a `CategoryRef` for the template card — not in the pure function itself (icon resolution requires a client import).

---

## 6. Validation — `src/lib/validations/recurring.ts`

Mirror `validations/transaction.ts` (positive magnitude, friendly messages):

```ts
import { z } from "zod";
import { RECURRING_AMOUNT_MAX } from "@/lib/constants";

const amount = z.coerce
  .number()
  .refine((n) => Number.isFinite(n), "Enter a valid amount")
  .refine((n) => n > 0, "Enter an amount greater than 0")
  .refine((n) => n <= RECURRING_AMOUNT_MAX, "That amount is too large");

/** Create a new recurring template. */
export const createTemplateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  type: z.enum(["INCOME", "EXPENSE"]),
  amount,
  cadence: z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]),
  nextOccurrence: z.string().min(1, "Select a start date"),  // "YYYY-MM-DD"
  financialAccountId: z.string().min(1, "Select an account"),
  categoryId: z.string().optional(),
});
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;

/** Edit an existing template. Category, account, type, and currency are immutable. */
export const updateTemplateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  amount,
  cadence: z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]),
});
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
```

Rules:
- `type` accepts only `INCOME` or `EXPENSE` — no `TRANSFER` (see §1 non-goals).
- `currency` is server-resolved from the chosen `financialAccount.currency` — never client-supplied.
- `financialAccountId`, `categoryId`, and `type` are **immutable after create** — changing them would produce a different kind of recurring rule; the user should delete and recreate.
- `nextOccurrence` is a raw `"YYYY-MM-DD"` string from `<input type="date">` (same pattern as `Transaction.date`). The action converts it with **`dateInputToUtc(nextOccurrence)`** from `src/lib/date.ts` — **not** raw `new Date(nextOccurrence)`. (Date-only ISO strings happen to parse as UTC midnight in modern engines, but the bare-constructor behavior has historically varied; using the shared helper makes the intent explicit and matches `createTransaction`.) **Timezone contract:** all recurring dates are treated as **calendar dates** with no time component and persisted as UTC midnight via `@db.Date` — the client's local calendar day is stored verbatim, never shifted.

---

## 7. Read path — `src/lib/db/recurring.ts`

`import "server-only"`. Three fetchers:

### `getTemplates(userId)`

Returns all of the user's templates (active and paused) with their category and account
names — so the user can see what they've set up, manage pause state, and edit.

```ts
export type TemplateRow = {
  id: string;
  name: string;
  type: "INCOME" | "EXPENSE";
  amount: number;          // serializable; magnitude
  currency: string;
  cadence: RecurringCadence;
  nextOccurrence: Date;
  isActive: boolean;
  accountName: string;
  category: { id: string; name: string; icon: string; color: string } | null;
};

export async function getTemplates(userId: string): Promise<TemplateRow[]> {
  const rows = await prisma.recurringTemplate.findMany({
    where: { userId },
    include: {
      category: { select: { id: true, name: true, icon: true, color: true } },
      financialAccount: { select: { name: true } },
    },
    // Active templates first, then soonest-due — management screens care about
    // upcoming activity, not creation history. The UI still groups Active/Paused
    // (§9); the isActive sort keeps the order stable within that split.
    orderBy: [{ isActive: "desc" }, { nextOccurrence: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type as "INCOME" | "EXPENSE",
    amount: Number(r.amount),
    currency: r.currency,
    cadence: r.cadence,
    nextOccurrence: r.nextOccurrence,
    isActive: r.isActive,
    accountName: r.financialAccount.name,
    category: r.category ?? null,
  }));
}
```

### `getPendingDrafts(userId)`

Returns all PENDING drafts belonging to this user's templates, joined to the template
for display (name, type, amount, account).

```ts
export async function getPendingDrafts(userId: string): Promise<DraftRow[]> {
  const rows = await prisma.recurringDraft.findMany({
    where: {
      status: "PENDING",
      recurringTemplate: { userId },
    },
    include: {
      recurringTemplate: {
        include: {
          financialAccount: { select: { name: true } },
          category: { select: { id: true, name: true, icon: true, color: true } },
        },
      },
    },
    orderBy: { suggestedDate: "asc" },
  });
  // Map to serializable DraftRow (strip Prisma types)
  return rows.map(mapDraftRow);
}
```

`DraftRow` type (serializable):

```ts
export type DraftRow = {
  id: string;
  suggestedDate: Date;
  suggestedAmount: number;
  templateId: string;
  templateName: string;
  type: "INCOME" | "EXPENSE";
  currency: string;
  accountName: string;
  category: { id: string; name: string; icon: string; color: string } | null;
};
```

### `generatePendingDrafts(userId)` — **called server-side on every page load**

The MVP substitute for a background scheduler. Idempotent: a template with an existing
PENDING draft is skipped — only one draft is ever outstanding per template.

```ts
export async function generatePendingDrafts(userId: string): Promise<void> {
  const today = startOfUtcDay(new Date()); // shared helper, src/lib/date.ts

  // Templates that are overdue (nextOccurrence <= today) and active
  const due = await prisma.recurringTemplate.findMany({
    where: {
      userId,
      isActive: true,
      nextOccurrence: { lte: today },
    },
    include: {
      drafts: {
        where: { status: "PENDING" },
        select: { id: true },
        take: 1,
      },
    },
  });

  // Insert one PENDING draft per template that doesn't already have one
  const toCreate = due
    .filter((t) => t.drafts.length === 0)
    .map((t) => ({
      recurringTemplateId: t.id,
      suggestedDate: t.nextOccurrence,
      suggestedAmount: t.amount,
    }));

  if (toCreate.length > 0) {
    // skipDuplicates → ON CONFLICT DO NOTHING, which catches the partial unique
    // index (one PENDING draft per template). The drafts.length filter above is
    // just an optimization to avoid pointless insert attempts; the index is the
    // real race guard — two concurrent loads can no longer double-insert.
    await prisma.recurringDraft.createMany({ data: toCreate, skipDuplicates: true });
  }
}
```

> **Why `skipDuplicates` works with a partial index.** Prisma emits `ON CONFLICT DO
> NOTHING` *without* a conflict target, which defers to *any* unique index — including
> the partial one. A losing concurrent insert silently no-ops instead of throwing.

> **Today's UTC midnight.** `@db.Date` is stored as UTC midnight. Use the shared
> `startOfUtcDay(new Date())` helper (§5) rather than re-deriving it — the same floor
> backs `isDraftOverdue`, keeping generation and overdue display perfectly consistent.
> Do not compare against raw `new Date()` (its local-time hours can be > 0 depending on
> the server timezone, excluding templates due "today").

---

## 8. Mutation path — `src/actions/recurring.ts`

`"use server"`. Every action: `auth()` guard → `safeParse` → ownership-scoped Prisma
→ `{ success, error? }` → `revalidatePath`. Copy helpers from `actions/transactions.ts`.

```ts
// Template CRUD + dismiss create no ledger row → only recurring + the
// dashboard draft count need refreshing.
function revalidateRecurringViews() {
  revalidatePath("/recurring");
  revalidatePath("/dashboard");  // dashboard shows pending-draft count
}
```

> **Confirm is special.** `confirmDraft` writes a real `Transaction`, so it must also
> refresh `/transactions` and `/budgets` (a confirmed EXPENSE consumes budget). Rather
> than duplicate that path list, **export** `revalidateTransactionViews()` from
> `actions/transactions.ts` (it already covers `/transactions` + `/dashboard` +
> `/budgets`) and call it from `confirmDraft`, plus `revalidatePath("/recurring")`.
>
> **Future refactor (out of scope here):** once a third feature needs cross-view
> revalidation, lift these helpers into a single `src/lib/revalidation.ts`
> (`revalidateTransactionViews`, `revalidateBudgetViews`, `revalidateRecurringViews`,
> `revalidateDashboardViews`) so action files stop being implicit dependency hubs. Not
> done in this feature — it would touch already-shipped Transactions/Budgets revalidation
> beyond the recurring scope; exporting the one existing helper is the minimal change.

### Template actions

| Action | Signature | Behavior |
|---|---|---|
| `createTemplate` | `(input: CreateTemplateInput)` | Validate; verify account belongs to session user and `isArchived: false`; resolve `currency` from `account.currency`; insert template. |
| `updateTemplate` | `(id, input: UpdateTemplateInput)` | Ownership guard (`findFirst { id, userId }`); update `name`, `amount`, `cadence` only. |
| `pauseTemplate` | `(id)` | Ownership guard; set `isActive = false`. |
| `resumeTemplate` | `(id)` | Ownership guard; set `isActive = true`. |
| `deleteTemplate` | `(id)` | Ownership guard; **hard delete** — `prisma.recurringTemplate.delete`. Cascades to all `RecurringDraft` rows. |
| `getTemplateForEdit` | `(id)` | Auth-guarded proxy over `db/recurring.ts`; returns edit pre-fill (`id`, `name`, `amount`, `cadence`) for the drawer. |

**Account verification in `createTemplate`:**

```ts
const account = await prisma.financialAccount.findFirst({
  where: { id: input.financialAccountId, userId, isArchived: false },
});
if (!account) return { success: false, error: "Account not found" };
const currency = account.currency;

// Category ownership: optional, but if present it must be a system category
// (userId: null) or one owned by this user — never another user's FK. Mirrors
// the exact check in createTransaction (actions/transactions.ts).
if (input.categoryId) {
  const category = await prisma.category.findFirst({
    where: { id: input.categoryId, OR: [{ userId }, { userId: null }] },
    select: { id: true },
  });
  if (!category) return { success: false, error: "Category not found" };
}
```

Currency is taken from the account at template-create time. If the user later changes
an account's currency (post-MVP feature), existing templates are not retroactively
updated.

### Draft actions

#### `confirmDraft(draftId)`

The atomic three-step from `docs/entity-crud-architecture.md`:

```ts
export async function confirmDraft(draftId: string) {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };
  const userId = session.user.id;

  const draft = await prisma.recurringDraft.findUnique({
    where: { id: draftId },
    include: { recurringTemplate: true },
  });

  if (!draft || draft.recurringTemplate.userId !== userId) {
    return { success: false, error: "Not found" };
  }
  if (draft.status !== "PENDING") {
    return { success: false, error: "Draft is no longer pending" };
  }

  const template = draft.recurringTemplate;
  const nextOccurrence = advanceNextOccurrence(template.nextOccurrence, template.cadence);

  // Interactive transaction so we can CLAIM the draft first and bail if a
  // concurrent confirm already took it — guarantees at most one ledger entry
  // per draft despite double-clicks / multiple tabs (idempotent confirm).
  const claimed = await prisma.$transaction(async (tx) => {
    const res = await tx.recurringDraft.updateMany({
      where: { id: draftId, status: "PENDING" }, // status guard = the race gate
      data: { status: "CONFIRMED" },
    });
    if (res.count === 0) return false;           // someone else won the race

    await tx.transaction.create({
      data: {
        type: template.type,
        amount: template.type === "INCOME"
          ? draft.suggestedAmount               // positive for income
          : draft.suggestedAmount.negated(),    // negative for expense
        currency: template.currency,
        date: draft.suggestedDate,
        // Stamp the template name as the merchant so the ledger entry is
        // identifiable. Without it the row has no description and each view
        // falls back differently (feed → category name, dashboard → "Transaction").
        // See §12 "Confirm: transaction description".
        merchant: template.name,
        financialAccountId: template.financialAccountId,
        categoryId: template.categoryId,
        recurringTemplateId: template.id,
        userId,
      },
    });
    await tx.recurringTemplate.update({
      where: { id: template.id },
      data: { nextOccurrence },
    });
    return true;
  });

  if (!claimed) return { success: false, error: "Draft is no longer pending" };

  revalidateTransactionViews(); // exported: /transactions + /dashboard + /budgets
  revalidatePath("/recurring");
  return { success: true };
}
```

> The leading `findUnique` + status pre-check stays for a friendly early error and the
> ownership assertion; the `updateMany` status guard inside the transaction is what
> actually serializes concurrent confirms.

> **Signed amounts.** Transactions use signed amounts: positive = INCOME, negative =
> EXPENSE. `suggestedAmount` on a draft is always a **positive magnitude** (copied from
> `template.amount`). The action derives the sign from `template.type`.
>
> Note this is a **deliberate divergence** from `createTransaction` in
> `actions/transactions.ts`, which negates a rounded JS `number`
> (`type === "EXPENSE" ? -magnitude : magnitude`). Here the magnitude already arrives
> from Prisma as a `Decimal` (`draft.suggestedAmount`), so prefer `Decimal`-native
> negation (`.negated()`, or `.mul(new Prisma.Decimal(-1))`) and never round-trip
> through float. Use whichever you pick consistently in both confirm and any future
> draft-amount path.

#### `dismissDraft(draftId)`

Advances `nextOccurrence` just like confirm does — so the template keeps ticking even
when the user skips an occurrence:

```ts
const claimed = await prisma.$transaction(async (tx) => {
  const res = await tx.recurringDraft.updateMany({
    where: { id: draftId, status: "PENDING" }, // same race gate as confirm
    data: { status: "DISMISSED" },
  });
  if (res.count === 0) return false;
  await tx.recurringTemplate.update({
    where: { id: template.id },
    data: {
      nextOccurrence: advanceNextOccurrence(template.nextOccurrence, template.cadence),
    },
  });
  return true;
});
if (!claimed) return { success: false, error: "Draft is no longer pending" };

revalidateRecurringViews(); // no ledger row created → lighter revalidation
```

Ownership check: same pattern as `confirmDraft` — `findUnique` + join to template, verify
`template.userId === session.user.id` before claiming. The `updateMany` status guard makes
the advance idempotent (a second dismiss flips nothing and returns the "no longer pending"
error).

---

## 9. Page + components

### `src/app/recurring/page.tsx`

`export const dynamic = "force-dynamic"`. Pattern matches `budgets/page.tsx`:

1. `getSessionOrRedirect()` → `userId`.
2. `await generatePendingDrafts(userId)` — run **before** the parallel fetch so the
   drafts query sees freshly-created rows.
3. `Promise.all([ getTemplates(userId), getPendingDrafts(userId), getUserAccounts(userId), getUserCategories(userId) ])`.
   `getUserAccounts` (`src/lib/db/accounts.ts`) and `getUserCategories` (`src/lib/db/categories.ts`) supply the form-data props for `TemplateFormDrawer` — fetched once at page load, not refetched on open.
4. Render inside `<AppShell accounts user>`:
   - `<RecurringPageHeader />` — page title + "New template" CTA (opens drawer).
   - `<DraftsInbox drafts />` — shown only when `drafts.length > 0`; hidden (not shown as empty) when the inbox is clear.
   - `<TemplatesList templates />` — list of all templates (active and paused), with manage actions.
   - `<TemplateFormDrawer accounts categories />` — Sheet drawer mounted once; controlled by local `useState`.
   - `<RecurringEmptyState />` — rendered only when **both** `templates.length === 0`
     **and** `drafts.length === 0`. (Cascade-delete makes a draft-without-template state
     unreachable — `getPendingDrafts` inner-joins to an existing template — but gating on
     both keeps the empty state and the inbox mutually exclusive defensively, so they can
     never render together.)

### `src/components/recurring/drafts-inbox.tsx`

Client. Shows pending drafts as a prioritized action strip:

- Section heading "Pending confirmation" with a count badge.
- Each `<DraftCard>` shows: template name, type icon, amount, suggested date (with
  overdue styling when `isDraftOverdue(draft.suggestedDate)` is true), account name,
  category chip.
- Two actions per card: **Confirm** (primary, green) and **Dismiss** (ghost, neutral).
- Both call their respective action via `useTransition`; on success `router.refresh()`
  + `toast.success`.
- No undo for either action — confirmed = committed, dismissed = intentionally skipped.

### `src/components/recurring/templates-list.tsx`

Client. Two visual sub-sections within one component:

- **Active** templates (header "Recurring rules").
- **Paused** templates (header "Paused", shown only when any exist; dimmed treatment).

Each `<TemplateRow>` shows: name, type badge (Income/Expense), amount + cadence label
(e.g. "€ 12.99 / Monthly"), next occurrence date, account name, category chip.

Row actions (overflow menu or inline icon buttons):
- **Edit** → opens `TemplateFormDrawer` pre-filled via `getTemplateForEdit(id)`.
- **Pause / Resume** → calls `pauseTemplate` / `resumeTemplate`; on success `router.refresh()` + `toast.success`.
- **Delete** → opens a `<ConfirmDeleteDialog>` ("This will delete the template and all
  pending drafts. This cannot be undone."); on confirm calls `deleteTemplate`; on success
  `router.refresh()` + `toast.success`. **No snackbar undo** — hard delete is irreversible.

### `src/components/recurring/template-form-drawer.tsx`

Client. Reuses the Sheet pattern from `budget-form-drawer.tsx` (right panel ≥768px /
bottom sheet via `useMediaQuery + BREAKPOINTS.mobile`).

Fields:

| Field | Input | Notes |
|---|---|---|
| Name | `<input type="text">` | Required, max 100 chars |
| Type | Toggle: Income / Expense | Disabled in edit mode |
| Amount | Large `<input type="number">` | Positive magnitude |
| Cadence | Select: Daily / Weekly / Monthly / Yearly | `CADENCE_OPTIONS` constant |
| First occurrence | `<input type="date">` | Default: today; disabled in edit mode (immutable after create) |
| Account | Select | Populated from `accounts` prop; disabled in edit mode |
| Category | Select (optional) | Populated from `categories` prop; clearable |

`useActionState` → call `createTemplate` / `updateTemplate`; on success `toast.success`,
`router.refresh()`, close drawer.

### `src/components/recurring/confirm-delete-dialog.tsx`

Uses the native `<dialog>` element (matching `delete-account-dialog.tsx` in profile).
No typing-to-confirm required — this is a template, not an account. A single "Delete" /
"Cancel" button pair suffices.

### `src/components/recurring/recurring-empty-state.tsx`

Shown when the user has no templates. Guidance copy + a "New template" CTA that opens
the form drawer. Follows the Onboarding principle: "each empty screen provides active
guidance, not a blank state."

---

## 10. Constants (`src/lib/constants.ts`)

```ts
/** Max recurring template amount accepted by the form. */
export const RECURRING_AMOUNT_MAX = 1_000_000;

/** Cadence options for the template form select. */
export const CADENCE_OPTIONS = [
  { value: "DAILY",   label: "Daily" },
  { value: "WEEKLY",  label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "YEARLY",  label: "Yearly" },
] as const;
```

`TRANSACTION_TYPE_OPTIONS` already exists — the form filters it to `INCOME`/`EXPENSE`
inline rather than creating a separate constant.

---

## 11. Tests (Vitest, `test/` mirrors `src/`)

Per coding standards: cover `src/actions/**` and `src/lib/**`; no component tests.

### `test/lib/recurring.test.ts` (pure helpers — no mocks)

`advanceNextOccurrence`:
- `DAILY`: advances by exactly 1 day (incl. month-end rollover: Jan 31 → Feb 1).
- `WEEKLY`: advances by 7 days.
- `MONTHLY`: advances by 1 calendar month (Jan 31 → Feb 28/29, clamped; Dec 31 → Jan 31).
- `YEARLY`: advances by 1 year (Feb 29 leap year → Feb 28 non-leap).
- Input is mutated into a new `Date` (does not change the original).

`formatCadence`:
- Returns the human-readable label for each enum value.

`isDraftOverdue`:
- Returns `true` when `suggestedDate` is strictly before today (UTC).
- Returns `false` for today (not yet overdue — today is the due date).
- Injectable `now` parameter for determinism.

`startOfUtcDay` (in `test/lib/date.test.ts` alongside the existing date helpers):
- Floors a mid-day UTC timestamp to `00:00:00.000Z` of the same calendar day.
- Is idempotent (flooring an already-floored date returns the same instant).

### `test/actions/recurring.test.ts` (mock `@/lib/prisma` + `@/auth`)

**Template actions:**
- Unauthenticated → `{ success: false }` for every action.
- `createTemplate`: rejects an archived or nonexistent account; **rejects a `categoryId` belonging to another user, accepts a system category (`userId: null`) and an owned one**; resolves `currency` from `account.currency`; inserts with correct `userId`; rejects TRANSFER type (schema-level).
- `updateTemplate`: 404 guard when not owner; updates only `name`/`amount`/`cadence`; **changing `cadence` leaves `nextOccurrence` untouched** (assert the update payload omits `nextOccurrence`).
- `pauseTemplate` / `resumeTemplate`: ownership guard; sets `isActive` flag; **`resumeTemplate` does not write `nextOccurrence`**.
- `deleteTemplate`: ownership guard; calls `prisma.recurringTemplate.delete` with the owned id. **Note:** the cascade to `RecurringDraft` and the `recurringTemplateId → null` `SetNull` on surviving transactions are **DB-level guarantees from the schema**, not exercisable against a mocked Prisma client — the unit test asserts the `delete` call; the cascade/SetNull contract is owned by the migration, not this test.

**Draft actions:**
- `confirmDraft`: 404 when draft doesn't belong to session user; errors when `status !== PENDING`; claims via `updateMany` then creates the transaction + advances `nextOccurrence` inside one interactive `$transaction`; sign of created transaction is negative for EXPENSE, positive for INCOME; `nextOccurrence` advanced by the correct cadence. **Idempotency: when the `updateMany` claim returns `count === 0` (already confirmed), no transaction is created and the action returns the "no longer pending" error.**
- `dismissDraft`: 404 when not owner; errors when not PENDING; claims via `updateMany`, sets `status = DISMISSED`, advances `nextOccurrence` atomically. **Idempotency: a `count === 0` claim performs no advance and returns the error.**

**Draft generation:**
- `generatePendingDrafts`: does not create a draft for a template that already has a PENDING one; creates a draft for a template with `nextOccurrence <= today` and no pending draft; skips inactive templates; skips templates with `nextOccurrence` in the future; **calls `createMany` with `skipDuplicates: true`** (assert the option is passed — the partial unique index's race protection can't be exercised against a mocked client, same caveat as the cascade test).

Run `npm run test:run` **and** `npm run build` green before commit (workflow §4).

---

## 12. Special cases & decisions

| Case | Decision |
|---|---|
| No TRANSFER recurring | The single-account template form cannot model a transfer (two accounts, two legs). TRANSFER is excluded from the type toggle; the Zod schema `z.enum(["INCOME","EXPENSE"])` enforces this server-side. |
| Draft generation on page load | `generatePendingDrafts` runs once per page render (server-side, before data fetches). Idempotent: a template with an existing PENDING draft is skipped. One draft is generated per overdue template — not one per missed period. |
| Multiple missed periods | If `nextOccurrence` is 3 months in the past, one draft is generated for that date. The user must confirm/dismiss it before the next draft appears (on the following page load). `nextOccurrence` advances once per confirm/dismiss — gradual catch-up is by design. **Sharp edge:** for `DAILY` cadence this is pathological — a template overdue 90 days needs 90 confirm/dismiss cycles (across 90 page loads) to catch up, since each action advances `nextOccurrence` by a single day from the *old* overdue date, not toward today. Accepted for MVP; revisit if daily templates prove painful (e.g. loop-advance to today on dismiss). |
| Generation race (prevented) | `generatePendingDrafts` filters templates whose `drafts.length === 0` then `createMany`s with `skipDuplicates: true`, backed by the **partial unique index** `(recurringTemplateId) WHERE status = 'PENDING'` (§3). Two concurrent loads can no longer double-insert: the losing insert hits `ON CONFLICT DO NOTHING` and no-ops. The `drafts.length` filter is now just an optimization; the index is the guarantee. (Confirm idempotency below remains the second layer of defense for the confirm path.) |
| Confirm/dismiss idempotency | `confirmDraft`/`dismissDraft` **claim the draft first** inside an interactive `$transaction` via `updateMany({ where: { id, status: "PENDING" }, data: { status } })` and bail when `count === 0`. The ledger write (or `nextOccurrence` advance) only runs for the caller that flips PENDING→CONFIRMED/DISMISSED, so concurrent confirms / double-clicks / multi-tab produce **at most one** transaction and **one** advance. The pre-check `findUnique` stays for a friendly early error and ownership; the `updateMany` guard is the actual concurrency gate. |
| Confirm writes to the suggested (past) date | A confirmed draft creates its `Transaction` with `date = draft.suggestedDate` (the original overdue date), **not** today. This is intentional: the ledger entry reflects when the recurrence was due. Consequence: confirming an overdue draft can post spend into an already-elapsed budget month — desired and correct, not a bug. |
| Dismiss is irreversible | Dismissing skips a real occurrence, advances `nextOccurrence`, and has **no undo** (mirrors delete). The user silently forgoes that period's transaction. Accepted — dismiss is an intentional "skip this one." |
| Today's UTC midnight | `generatePendingDrafts` and `isDraftOverdue` both derive `today` via the shared `startOfUtcDay(new Date())` helper (§5, added to `src/lib/date.ts`) to match `@db.Date` storage. Using raw `new Date()` risks a time-of-day comparison that excludes templates due "today" from certain server timezones. |
| Confirm: signed amount | `template.amount` and `draft.suggestedAmount` are always positive magnitudes. The action negates for EXPENSE using Prisma's `Decimal.negated()` — never float arithmetic. |
| Confirm: transaction description | The created `Transaction` stamps **`merchant = template.name`**. A `Transaction` has no dedicated description/name column — the displayed label is derived from `merchant`. Without this stamp a draft-born row has no human label, and the two views diverge: the feed (`legDescription`, `src/lib/transactions.ts`) falls back `merchant → category.name → type` (showing the category, e.g. "Subscriptions"), while the dashboard (`getRecentTransactions`, `src/lib/db/dashboard.ts`) falls back `merchant ?? note ?? "Transaction"` (showing "Transaction"). Stamping the template name — which `merchant` was designed for ("Merchant name; future-proofs subscription detection") — makes **both** views show "Netflix" because `merchant` is first in both chains. This is the spec-correct choice; do **not** instead retroactively mutate display fallbacks. _(The two views' differing fallback chains for genuinely merchant-less manual transactions is a separate, pre-existing inconsistency, out of scope here.)_ |
| Dismiss advances nextOccurrence | Dismissing is "skip this one, keep the series running." The template's `nextOccurrence` advances so the next load generates a fresh draft for the upcoming period, not another overdue draft for the same skipped one. |
| Edit immutability | Only `name`, `amount`, and `cadence` are editable. `type`, `financialAccountId`, `categoryId`, and `nextOccurrence` (first-occurrence date) are fixed after create; the form disables them in edit mode. To change identity-defining fields the user deletes and recreates. **Why `nextOccurrence` is immutable in MVP:** editing a live schedule's anchor while a PENDING draft already exists invites off-by-one drift between the draft's `suggestedDate` and the new anchor. It is **not** identity-changing, so allowing an edit is a defensible post-MVP upgrade once the draft-vs-anchor reconciliation is specified — deferred, not rejected. **Clean upgrade path:** permit editing `nextOccurrence` **only when the template has no PENDING draft** — that sidesteps the drift problem entirely without needing to reconcile an in-flight draft against the new anchor. |
| Cadence edit semantics | Changing `cadence` does **not** recompute `nextOccurrence`. The existing anchor stands; the new cadence applies only to **future** advances (the next confirm/dismiss). Example: a `MONTHLY` template due Jun 20 switched to `YEARLY` still surfaces its Jun 20 draft, then advances to Jun 20 next year. No retroactive reschedule. |
| Resume after pause | `resumeTemplate` flips `isActive = true` and does **not** touch `nextOccurrence`. If the template is overdue at resume time, the next page load's `generatePendingDrafts` creates a draft immediately — no backlog replay, no forward jump to "today". Pausing never auto-dismisses an existing PENDING draft. |
| Currency stamped at create | `currency` is taken from `account.currency` at template-create time. Changing an account's currency later (post-MVP) does not retroactively update templates. |
| Delete is irreversible | Hard delete + cascade; no snackbar undo. Gates behind a `ConfirmDeleteDialog`. If the user accidentally deletes, there is no recovery path in MVP. |
| Delete with a PENDING draft | Deleting a template **immediately removes all its PENDING drafts** via cascade — they are not auto-confirmed, auto-dismissed, or converted to transactions first. Previously-confirmed drafts have already produced `Transaction` rows; those rows survive with `recurringTemplateId` set to `null` (`onDelete: SetNull`). The `ConfirmDeleteDialog` copy already warns "this will delete the template and all pending drafts." |
| Draft snapshot immutability | A `RecurringDraft` captures `suggestedAmount`/`suggestedDate` from the template **at generation time** and is never mutated afterward. Editing the template's `amount` (or `cadence`) affects only **future** drafts — any already-generated PENDING draft keeps its original snapshot. To apply a new amount immediately the user has two paths: dismiss the stale draft and let the next generation use the updated template, or confirm the old amount and edit the resulting `Transaction`. This keeps "what you confirm is what you reviewed" honest. **Linked non-goal:** combined with §1's "no per-draft amount edit at confirm," these two paths are the *only* ways to reconcile an edited amount with a live draft. If that friction proves real, the intended fix is the deferred **editable-amount-at-confirm-time** (§1) — **not** retroactively mutating drafts on template edit, which would break the snapshot guarantee. Conscious call, deferred. |
| Paused templates | Draft generation skips inactive (`isActive: false`) templates. Existing PENDING drafts remain until explicitly dismissed; pausing does not auto-dismiss them. |
| Dashboard integration | The dashboard "Pending Drafts" count on the actionable insights strip comes from the existing `getDashboardSummary` fetcher. `revalidatePath("/dashboard")` is called on every draft confirm/dismiss to keep the count fresh. |
| Revalidation ownership | A manual transaction does **not** change templates or pending drafts, so `revalidateTransactionViews()` is **not** extended to touch `/recurring` (an earlier draft of this spec had this backwards). The dependency runs the other way: `confirmDraft` writes a real transaction, so it reuses the **exported** `revalidateTransactionViews()` (`/transactions` + `/dashboard` + `/budgets` — a confirmed EXPENSE consumes budget) **plus** `revalidatePath("/recurring")`. `dismissDraft` and template CRUD create no ledger row and use the lighter `revalidateRecurringViews()` only. |
| UI freshness (MVP) | Recurring stays **refresh-driven** (`router.refresh()` after each action) to match Transactions and Budgets — no optimistic updates in MVP. Documented here to prevent implementation drift toward bespoke optimistic state. |

---

## 13. Workflow (per `context/ai-interaction.md`)

1. **Document** this feature in `context/current-feature.md` (Goals/Notes).
2. **Branch** `feature/recurring`.
3. **Migration first**: `prisma migrate dev --create-only --name recurring_draft_pending_unique`, hand-edit the generated SQL to the partial unique index (§3), then `prisma migrate dev` to apply. Run `prisma migrate status` to confirm sync. Do this **before** writing `generatePendingDrafts` so `skipDuplicates` has the index to lean on.
4. **Implement** §4 files in order: pure helpers → validation → DB fetcher → actions → page → components.
5. **Test**: write Vitest specs (§11); `npm run test:run` + `npm run build`; verify in the browser (create template, see draft appear on reload, confirm draft → check `/transactions`, dismiss → verify `nextOccurrence` advances, pause/resume, delete).
6. **Iterate**, then **commit** (only on green; conventional `feat:`; no agent attribution in message), **merge** to `main`, **delete** branch, mark done in `current-feature.md` history.

---

## 14. Acceptance criteria

- [ ] `/recurring` lists all templates (active + paused) with name, type, amount, cadence, next-occurrence date, account, and category.
- [ ] On page load, `generatePendingDrafts` creates one PENDING draft per active overdue template that has no existing PENDING draft (idempotent on repeated loads).
- [ ] Drafts inbox appears above the templates list when `pendingDrafts.length > 0` and is hidden (not shown as an empty state) when the inbox is clear.
- [ ] Each draft card shows template name, amount, suggested date (with overdue styling when past), account, and category.
- [ ] Confirming a draft creates a correctly-signed `Transaction` (negative for EXPENSE, positive for INCOME), marks the draft `CONFIRMED`, and advances `nextOccurrence` — all atomically.
- [ ] The created `Transaction` stamps `merchant = template.name` so it shows the template name (e.g. "Netflix") in both the transactions feed and the dashboard recent-transactions list, not the category name or a bare "Transaction" label.
- [ ] Dismissing a draft sets `status = DISMISSED` and advances `nextOccurrence` — also atomically.
- [ ] After confirm or dismiss the page refreshes and the draft disappears from the inbox.
- [ ] Creating a template stores `currency` from the chosen account, never from the form.
- [ ] TRANSFER type is rejected at the schema level (not just the UI).
- [ ] Editing a template updates only `name`, `amount`, and `cadence`; all other fields are disabled in the form.
- [ ] Pausing stops draft generation for that template; resuming re-enables it.
- [ ] Deleting a template requires a confirmation dialog; hard-deletes the template and its drafts; affected `Transaction.recurringTemplateId` becomes `null`.
- [ ] `advanceNextOccurrence` handles month-end clamping (e.g. Jan 31 → Feb 28/29) and year-end wrap (Dec 31 → Jan 31 next year).
- [ ] `isDraftOverdue` returns `false` for a draft due today (today is the due date, not overdue).
- [ ] `generatePendingDrafts` does not create a second draft for a template that already has a PENDING one, and calls `createMany` with `skipDuplicates: true`.
- [ ] The partial unique index `RecurringDraft(recurringTemplateId) WHERE status = 'PENDING'` exists via a `--create-only` migration; `prisma migrate status` is in sync and `schema.prisma` is unchanged.
- [ ] `createTemplate` rejects a `categoryId` owned by another user and accepts system (`userId: null`) or owned categories.
- [ ] `confirmDraft` / `dismissDraft` are idempotent: a second concurrent call (draft already non-PENDING) creates no transaction / performs no advance and returns an error.
- [ ] Editing `cadence` leaves `nextOccurrence` unchanged; resuming a paused template leaves `nextOccurrence` unchanged.
- [ ] Editing a template does **not** mutate an existing PENDING draft — the draft keeps its original `suggestedAmount` and `suggestedDate`; only future drafts reflect the new values.
- [ ] Deleting a template with a PENDING draft removes that draft (no confirm/dismiss/convert first); confirmed transactions survive with `recurringTemplateId = null`.
- [ ] `confirmDraft` reuses the exported `revalidateTransactionViews()` (refreshes `/budgets`) plus `revalidatePath("/recurring")`; `revalidateTransactionViews()` itself does **not** reference `/recurring`.
- [ ] `npm run test:run` and `npm run build` pass; the only schema-related change is the one partial-index migration above (no model/field changes, no `db push`).
