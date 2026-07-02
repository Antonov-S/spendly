# Split Transactions — Implementation Spec

> **Status: Not started.** POST-MVP-ROADMAP **§17**, Delivery Sequence **slot #9** — the first
> committed item after Transaction Tags (§16) and the **highest-blast-radius** non-AI win in the
> committed tier. One transaction split across multiple categories: €80 at a supermarket = €55
> Groceries + €25 Household. More accurate budgeting and *more* conscious categorization — squarely
> on-thesis (it asks the user to think about what a purchase actually was, not less).

This spec follows [entity-crud-architecture.md](../entity-crud-architecture.md) and the field rules in
[entity-types.md](../entity-types.md). Unlike Tags — which added two isolated tables that no aggregation
had to know about — **Splits deliberately changes how spend-per-category is computed**. That is the
whole risk of this slice, so §7 (Aggregation) is the load-bearing section; the schema and UI are the
easy parts.

---

## 1. Why this slice

A single `categoryId` forces every purchase into one bucket. Real purchases routinely aren't:

- A **supermarket run** is Groceries *and* Household *and* sometimes Pet.
- A **big-box / online order** mixes Clothing, Electronics-as-Miscellaneous, Gifts.
- A **restaurant + drinks** night could be Dining plus Entertainment.

Today the user picks the dominant category and the budget math quietly loses the rest. Splits let the
transaction stay **one row / one amount** (so balances and the ledger are untouched) while its spend is
**attributed across categories** for budgets and Reports. This is on-thesis: it *adds* a small moment of
conscious categorization, it never automates one away.

**Why a child table, not sub-transactions.** ROADMAP §17 and the open decisions land on a
`TransactionSplit` child table over "linked sub-transactions". Sub-transactions would each hit the
ledger, double-count into balances, and pollute the feed/transfers model. A child table keeps the
**parent `amount` the single source of truth** — derived balances (`startingBalance + SUM(amount)`) are
provably unaffected — and confines the change to the two places that aggregate *by category*.

**Not a Pro feature.** Splitting is core categorization accuracy, not analytical depth — free on both
tiers (same stance as Tags and user categories). Monetization gates nothing here.

---

## 2. Scope

### In scope

- **Schema:** a single new `TransactionSplit` child model (`transactionId`, `categoryId?`, `amount`,
  `note?`). One additive migration (`add_transaction_splits`) that — exactly like Tags — adds a table and
  **changes no existing table**. There is **no `isSplit` column**: split status is *derived* from the
  presence of child rows (§3), so there is no flag to keep in sync and no backfill.
- **Validation:** a `splits` array threaded into `createTransactionSchema` / `updateTransactionSchema`,
  with the cross-field rule that split lines **sum to the transaction amount** and that split-mode and a
  top-level `categoryId` are mutually exclusive.
- **Write path:** `createTransaction` / `updateTransaction` extended to atomically write/replace the
  split rows in the **same `$transaction`** they already use for tags — they stay the sole writers.
- **Aggregation (the core):** budget spend (`getBudgets`, `getBudgetsData`) and the Reports category
  breakdown (`getCategoryBreakdown`) rewired to attribute a split transaction's amount to its **split
  lines**, not the parent row (which is excluded from the single-category sum precisely *because* it has
  child lines) — union of two `groupBy`s, no double count.
- **Feed:** a split transaction shows as **one row** labelled `Split` (its category cell), expandable to
  reveal its per-category lines. Split lines are included in the feed query for split parents only.
- **Drawer:** a "Split transaction" affordance (expense only) that swaps the single Category field for a
  list of split rows (category + amount + optional note) with a live running total and a
  **must-sum-to-total** gate on Save.
- **Export:** JSON gains a nested `splits` array per transaction (`schemaVersion` bump 1 → 2); CSV
  labels a split transaction's Category column `Split` (see §8 for the ledger-reconciliation rationale).
- A centralized touch to `revalidateTransactionViews()` scope (already covers the affected pages — §11).
- Vitest unit tests for the new validation rule, the actions' split write/replace + ownership, and the
  aggregation-merge helper.

### Out of scope (explicit)

- **Splitting transfers.** Splits are **EXPENSE-only** in v1 — the drawer only offers it for expenses,
  and `createTransfer` / `updateTransfer` are untouched. (A transfer is a money *move*, not a spend; it
  has no category to split.) Documented in §6.
- **Splitting income.** The supermarket use case is spend attribution; income splitting has no budget/
  Reports consumer (budgets are EXPENSE-only). EXPENSE-only keeps the aggregation change one-directional.
- **Splits across accounts.** A split's lines all belong to the parent's single account (ROADMAP §17
  open decision — "no, single account"). There is no `financialAccountId` on `TransactionSplit`.
- **Per-split tags, merchants, or dates.** A split line carries only `categoryId`, `amount`, optional
  `note`. Tags/merchant/date/account stay on the parent. (Per-split tags is a future refinement; the
  join model doesn't need it for v1.)
- **Import of splits.** The `/import` pipeline is knowingly left untouched — an imported transaction is
  never split (CSV has no split concept; a Spendly JSON import ignores any `splits` array in v1). Same
  deliberate deferral pattern as Tags' export/import. A lossless JSON round-trip of splits is a clean
  additive follow-up (read-on-import, guarded by `schemaVersion`). See §12.
- **A Reports "split breakdown" chart or a split filter pill.** Splits already flow into the existing
  category breakdown correctly (§7); a dedicated "show only split transactions" filter is deferred.
- **Search over split lines — deferred, and worth flagging.** `/transactions` search ignores split-line
  categories and notes in v1. A user searching a category name will **not** surface a transaction merely
  *split* into that category unless another field matches — a reasonable expectation this v1 doesn't meet.
  Called out prominently (not buried) because it's the least-obvious gap; additive follow-up in §7.
- **Rollover interaction changes.** Rollover already derives from per-category spend; because splits feed
  that same per-category spend map (§7), rollover works with **zero** rollover-code changes. Verified as
  a consequence, not a feature.
- **Soft delete / undo for split lines.** Splits have no `deletedAt`; they follow the parent —
  soft-deleting the transaction hides them (they're excluded because the parent is excluded), restoring
  brings them back, hard-delete cascades them away. No independent lifecycle.

---

## 3. Data model

**One new child table, zero existing-table changes.** A regular `prisma migrate dev` migration
(`add_transaction_splits`). No column added and no backfill — an existing transaction is simply one with
zero split rows.

```prisma
// ─── Transaction (existing model — NO new column) ────────────
model Transaction {
  // …all existing fields unchanged…
  // …existing relations…
  splits   TransactionSplit[]   // presence of ≥ 1 row ⇒ this transaction is split
}

// ─── TransactionSplit ─────────────────────────────────────────
// A line of a split transaction. The parent Transaction.amount stays the single
// source of truth for balances; splits ONLY re-attribute that amount across
// categories for budget + Reports aggregation. Split amounts are POSITIVE
// magnitudes that sum to abs(parent.amount). EXPENSE parents only (v1).
model TransactionSplit {
  id            String   @id @default(cuid())
  amount        Decimal  @db.Decimal(12, 2) // positive magnitude; SUM = abs(parent.amount)
  note          String?
  createdAt     DateTime @default(now())

  transactionId String
  categoryId    String?  // SetNull on category delete → renders Uncategorized

  transaction Transaction @relation(fields: [transactionId], references: [id], onDelete: Cascade)
  category    Category?   @relation(fields: [categoryId], references: [id], onDelete: SetNull)

  @@index([transactionId])
  @@index([categoryId])
}
```

Add the back-relation `splits TransactionSplit[]` to `Category` as well (mirrors the existing
`transactions`, `budgets`, `recurringTemplates` relations; required by Prisma for the FK).

**Design rules baked into the model:**

- **Split status is derived, never stored.** A transaction is "split" iff it has ≥ 1 `TransactionSplit`
  row. Because there is no `isSplit` column, there is no flag that can drift from reality and no invariant
  to police. The server computes `isSplit = splits.length > 0` when it maps a row for the client (§5.1);
  it is a derived output, never a persisted input.
- **The double-count guard is structural, not an invariant.** Category aggregation query (a) sums
  transactions with **no** split lines (`splits: { none: {} }`); query (b) sums the split lines. A split
  parent is excluded from (a) *because it has children*, and re-enters only via (b) — it can never be in
  both. This holds **regardless of the parent's own `categoryId`**, which is what makes the whole class of
  "flag out of sync → double count" bug impossible here (contrast Tags, where nothing needed guarding).
- **Parent `categoryId` is still nulled on split — for display, not correctness.** The write nulls the
  parent's `categoryId` when it has lines so the feed/edit surfaces don't show a stale single category
  beside the `Split` chip. Since query (a) already excludes any row with children, a stray non-null value
  would *not* double-count; nulling it is cleanliness only — hence **no CHECK constraint and no migration
  to an existing table** are needed.
- **Split amounts are positive magnitudes.** They sum to `abs(parent.amount)`. Every aggregation already
  does `Math.abs(Number(...))`, so positive split sums drop straight in. Storing them positive also makes
  the "sum to total" validation and the drawer running-total read naturally.
- **`onDelete: Cascade`** from `Transaction` — hard-deleting a transaction (trash "delete forever",
  `emptyTrash`) removes its splits. **Soft delete leaves them in place** (correct — restore must recover
  them); they're simply not aggregated while the parent is `deletedAt != null`.
- **`onDelete: SetNull`** from `Category` — deleting a user category nulls its split lines (they render
  Uncategorized), mirroring the existing `Transaction.categoryId` SetNull. The user-category delete
  confirm copy on `/settings` should mention splits alongside transactions (§9, §13).

---

## 4. Validation (`src/lib/validations/transaction.ts`)

Add a `splits` array and a cross-field superRefine. Split-mode is signalled by a non-empty `splits`
array; when present, the top-level `categoryId` must be absent/null.

```ts
// A single split line. categoryId is REQUIRED per line (a split without a category
// is meaningless); note is optional free text. amount is a positive magnitude.
const splitLine = z.object({
  categoryId: z.string().min(1, "Pick a category for each split"),
  amount, // reuses the existing positive-magnitude schema
  note: optionalText(SPLIT_NOTE_MAX), // shorter than the transaction NOTE_MAX (§10)
});

const splits = z
  .array(splitLine)
  .max(SPLIT_MAX_LINES, `Up to ${SPLIT_MAX_LINES} splits`)
  .optional()
  .transform((v) => v ?? []);

export const createTransactionSchema = z
  .object({
    type: z.enum(["INCOME", "EXPENSE"]),
    amount,
    date: dateString,
    financialAccountId: z.string().min(1, "Select an account"),
    categoryId: z.string().min(1).nullish().transform((v) => v ?? null),
    merchant: optionalText(MERCHANT_MAX),
    note: optionalText(NOTE_MAX),
    tagIds,
    splits,
  })
  .superRefine((data, ctx) => {
    if (data.splits.length === 0) return; // not a split — nothing to check

    // 1. Split mode is EXPENSE only.
    if (data.type !== "EXPENSE")
      ctx.addIssue({ code: "custom", path: ["splits"], message: "Only expenses can be split" });

    // 2. Must be a real split (≥ 2 lines) — a single line is just a category.
    if (data.splits.length < SPLIT_MIN_LINES)
      ctx.addIssue({ code: "custom", path: ["splits"], message: `Add at least ${SPLIT_MIN_LINES} splits` });

    // 3. Split mode and a single category are mutually exclusive.
    if (data.categoryId)
      ctx.addIssue({ code: "custom", path: ["categoryId"], message: "Remove the category to split" });

    // 4. Lines must sum to the transaction amount (to the cent).
    const sum = round2(data.splits.reduce((a, s) => a + s.amount, 0));
    if (sum !== round2(data.amount))
      ctx.addIssue({ code: "custom", path: ["splits"], message: "Splits must add up to the total" });
  });
```

`updateTransactionSchema = createTransactionSchema` (same shape, as today). `round2` is the existing
cent-rounding helper (extract it to a shared `src/lib/money.ts` if it isn't importable into validations —
today it's a private in `actions/transactions.ts`; the validation needs its own copy or the shared
export). **Decision:** extract `round2` to `src/lib/money.ts` and import in both places (single source of
the cent rule — matches the "no magic values" standard). This is the only refactor outside the feature.

---

## 5. DB reads

### 5.1 Feed include (`src/lib/db/transactions.ts`)

Extend `FEED_INCLUDE` so split parents carry their lines for the expandable row. Only split transactions
have any; the include is cheap for the rest.

> **Perf note (accepted).** Adding `splits` to `FEED_INCLUDE` makes Prisma issue the extra relation load
> for **every** page row, not just split ones (most rows come back with `splits: []`). At
> `TRANSACTIONS_PAGE_SIZE` this is one additional batched query per page — acceptable, and simpler than a
> conditional/second fetch. If the feed ever paginates much larger pages, revisit by loading split lines
> lazily on row-expand (the derived `isSplit` flag still tells the client which rows have detail to fetch).

```ts
const FEED_INCLUDE = {
  category: { select: { name: true, color: true, icon: true } },
  financialAccount: { select: { name: true } },
  tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
  splits: {
    select: {
      id: true,
      amount: true,
      note: true,
      category: { select: { name: true, color: true, icon: true } },
    },
    orderBy: { amount: "desc" }, // largest slice first, stable render order
  },
} satisfies Prisma.TransactionInclude;
```

`toLeg` **derives** `isSplit = tx.splits.length > 0` and maps a `splits: FeedSplit[]` array (category
resolved, amount `Number`-ed, Uncategorized fallback for a null category — reuse `UNCATEGORIZED`).
`collapseTransfers` passes both through unchanged (a split parent is never a transfer, so collapse never
merges it).

> **Line ordering — `amount desc`, not entry order (documented trade-off).** Lines render largest-slice-
> first: a deterministic, meaningful default that needs no extra column. It **deliberately does not
> preserve the order the user typed** — the receipt may reorder vs. entry. Entry-order preservation would
> require a `position Int` on `TransactionSplit` (written from the drawer's array index and used as the
> `orderBy`); that is the clean future seam if it's ever wanted, and it's an additive column — not built in
> v1.

### 5.2 Split-aware category spend — the shared aggregation helper

The two-groupBy union is needed in **three** fetchers (`getBudgets`, `getBudgetsData`,
`getCategoryBreakdown`). Extract it once to `src/lib/db/split-spend.ts` (server-only) so the merge rule
lives in exactly one place and is unit-testable:

```ts
/**
 * Per-category EXPENSE spend for a window, correctly attributing split
 * transactions to their lines. Returns a Map<categoryId, positiveMagnitude>.
 *
 * Two aggregations, merged additively (no double count):
 *   (a) EXPENSE rows with NO split lines, grouped by categoryId (`splits: { none: {} }`)
 *   (b) split LINES grouped by categoryId, scoped through the parent transaction
 * The parent of a split row is excluded from (a) because it HAS children; its
 * amount re-enters only via (b). `categoryIds` (optional) restricts to budgeted ids.
 */
export async function getCategorySpend(
  userId: string,
  window: { from: Date; to: Date },
  opts?: { accountFilter?: Prisma.FinancialAccountWhereInput; categoryIds?: string[] }
): Promise<Map<string, number>>;
```

Both queries share the parent-scope predicate (`userId`, `deletedAt: null`, `type: "EXPENSE"`, the date
window, and — for Reports — the account clause). For (b) that predicate is expressed on the relation:
`where: { transaction: { …parentScope… }, ...(categoryIds ? { categoryId: { in } } : {}) }`. Both sums
are `Math.abs`-ed and added into the map. Null split `categoryId` (post-SetNull) is dropped from the map
(it lands in Uncategorized for Reports via the existing null-bucket path; for budgets a null category has
no budget row, so it's irrelevant).

> **Read-path, eventual-consistency (by design).** The two `groupBy`s are **not** wrapped in a
> `$transaction` — this is display aggregation, not a mutation invariant. A concurrent write landing
> between (a) and (b) at worst produces a momentarily off-by-one-transaction total that self-corrects on
> the next render (the same freshness contract every other read fetcher already has). Wrapping them would
> buy nothing and cost a serializable read. The atomicity that *matters* — a parent and its lines never
> existing apart — is enforced on the **write** side (§6), so no read can ever observe a half-written split.

> **Note — budget spend was already one clean `groupBy` (see the shipped
> [budgets-groupby fix](../fixes/budgets-groupby-spend-spec.md)); this replaces that single call with the
> helper's two-call union.** The helper returns the identical `Map<categoryId, number>` shape the callers
> already consume, so the call sites change by one line each.

---

## 6. Write path (`src/actions/transactions.ts`)

`createTransaction` / `updateTransaction` stay the **sole writers**. The split write joins the existing
atomic `$transaction` that already handles tags.

**Ownership check (mirrors `resolveOwnedTagIds`).** Add `resolveOwnedSplitCategories(userId, splits)`:
collect the distinct `categoryId`s, one `category.count({ where: { id: { in }, OR: [{ userId }, { userId: null }] } })`, all-or-nothing — an unknown/foreign category id fails the whole write with `"Category not found."` (never silently drops a line).

**`createTransaction`** (the split branch):

```ts
const isSplit = splits.length > 0; // local only — never persisted (no isSplit column)
// (validation already guaranteed: EXPENSE, ≥2 lines, no top-level categoryId, sums match)
if (isSplit) {
  const owned = await resolveOwnedSplitCategories(userId, splits);
  if (!owned.ok) return { success: false, error: owned.error };
}

await prisma.$transaction(async (tx) => {
  const created = await tx.transaction.create({
    data: {
      userId, type,
      amount: -magnitude,            // EXPENSE → negative; parent amount is authoritative
      currency: account.currency,
      date: dateInputToUtc(date),
      financialAccountId,
      categoryId: isSplit ? null : (categoryId ?? null), // nulled for display when split (§3)
      merchant, note,
    },
    select: { id: true },
  });
  if (isSplit) {
    await tx.transactionSplit.createMany({
      data: splits.map((s) => ({
        transactionId: created.id,
        categoryId: s.categoryId,
        amount: round2(s.amount), // positive magnitude
        note: s.note,
      })),
    });
  }
  // …existing tag createMany…
});
```

**`updateTransaction`.** Splits are **replaced** inside the atomic txn (`deleteMany` →
`createMany`) whenever the transaction is (or becomes, or stops being) a split — simpler and
correctness-safe. No unchanged-set optimization (unlike tags): split lines carry amounts+notes, equality
is more work than it saves, and edits to a split are inherently a full re-entry. The update nulls/sets
`categoryId` accordingly, so toggling split-mode on/off on an existing transaction is handled by the
`deleteMany` + presence-or-absence of new lines — no stored flag to flip:

```ts
await prisma.$transaction(async (tx) => {
  await tx.transaction.update({
    where: { id },
    data: { type, amount: -magnitude, currency, date, financialAccountId,
            categoryId: isSplit ? null : (categoryId ?? null), merchant, note },
  });
  await tx.transactionSplit.deleteMany({ where: { transactionId: id } });
  if (isSplit)
    await tx.transactionSplit.createMany({ data: /* …lines… */ });
  // …existing tag replace…
});
```

Split rows are written with `createMany` (not per-row `create`s). This is intentional and safe **because a
split line is pure attribution data with no per-row lifecycle** — no `deletedAt`, no derived counters, no
cascade *out* of it, nothing to revalidate per line. Should Prisma client extensions / query middleware
ever be introduced for other models, split rows deliberately need none of it (a one-line comment at the
`createMany` call should say so), so the batched insert stays correct.

**`getTransactionForEdit`** additionally selects `splits` (category id + amount + note per line), deriving
`isSplit` from their presence and mapping them into `EditableTransaction.splits` so the drawer re-opens in
split mode pre-filled.

Transfers are unaffected — `createTransfer` / `updateTransfer` never receive `splits` and never create
split rows.

---

## 7. Aggregation — the load-bearing change

Three fetchers switch from "sum by the transaction's own category" to "sum via `getCategorySpend`". This
is the only behavioural change users can observe beyond the drawer/feed, so it is spec'd exactly.

1. **`getBudgets`** (`src/lib/db/budgets.ts`) — replace the single
   `prisma.transaction.groupBy({ by: ["categoryId"], where: { …, type: "EXPENSE", date window } })`
   with `getCategorySpend(userId, { from: monthStart, to: nextMonthStart }, { categoryIds: budgets.map(b => b.categoryId) })`.
   `spentMap` is now that returned map. Everything downstream (`mapBudgetRow`, rollover carry,
   `summarizeBudgets`) is unchanged.

2. **`resolveRolloverCarry`** (same file) — its inner per-month `transaction.groupBy` must **also** become
   `getCategorySpend` for the same reason (a prior month's spend that was split must count against that
   month's budget when carried). Same one-line swap, scoped to the `ids` in the run. **This is easy to
   miss** — rollover walks its own months and would otherwise under-count split spend in carried periods.

3. **`getBudgetsData`** (`src/lib/db/dashboard.ts`) — identical swap to (1); it keeps its own
   `lte: monthEnd` window (note the dashboard uses an inclusive end-of-month while `/budgets` uses the
   half-open `nextMonthStart`; pass each its existing window into the helper — the helper is
   window-agnostic).

4. **`getCategoryBreakdown`** (`src/lib/db/reports.ts`) — replace its EXPENSE `groupBy` with
   `getCategorySpend(userId, { from, to }, { accountFilter: reportTxWhere(...).financialAccount })`, then
   resolve names/icons/colors over the union of category ids (unchanged batched `category.findMany`, plus
   the `UNCATEGORIZED` bucket for any null split category). Sorting/filtering (`total > 0`, desc)
   unchanged.

**Untouched aggregations (verified, and why):**

- **`getMonthlyComparison` / cashflow / income-vs-expenses** — bucket by *amount+date only*, not by
  category. A split transaction's parent amount is unchanged, so income/expense/cashflow totals are
  identical whether or not it's split. **No change.**
- **`getAccountBalanceHistory` and all balance derivation** — sum `Transaction.amount`; the parent amount
  is authoritative and unchanged. **No change** (this is the core guarantee of the child-table design).
- **`getReportTxCount`** — counts transactions, not categories. A split is still one transaction. **No
  change.**

**Free-rider surfaces (inherit splits automatically — swept and confirmed, like the rollover slice did):**

- **Dashboard insights strip / `countAtRiskBudgets` (`src/lib/insights.ts`)** — the at-risk count is
  derived from `getBudgetsData`'s already-computed per-budget `spent`. Because that `spent` now flows
  through `getCategorySpend` (§7.3), a category pushed over 80% *by split spend* is flagged with **zero**
  insights-code change. Verified as a consequence — add one assertion in the insights test on a
  split-fed fixture so the coupling can't silently regress.
- **Budget rollover carry** — already covered in §7.2 (its inner month walk must use `getCategorySpend`);
  called out here too because rollover is the non-obvious one that reads spend for *past* months.
- **Feed search (`q`) — deliberately NOT extended.** Search covers merchant / note / category name / tag
  name (`buildTransactionWhere`). Split **line** notes and split-line category names are **not** searched
  in v1 (matching the Tags precedent of not over-reaching the search join). A user searching a category
  name still finds a transaction split into that category *only* if some other field matches — documented
  limitation, not a bug. Extending search into `splits.some.category.name` / `splits.some.note` is a clean
  additive follow-up if telemetry shows demand.

> **Conservation property (the core thing to test).** For any window, `Σ getCategorySpend()` over all
> categories **must equal** `Σ abs(amount)` of all in-window non-deleted EXPENSE transactions — splitting
> re-attributes spend, it never creates or destroys it. The child-table design makes double-counting
> *structurally* impossible (§3), but a unit test still asserts this on a fixture of both split and
> non-split expenses, and §13 adds a before/after-conversion invariance test across every consuming surface.

---

## 8. Export (`src/lib/db/export.ts`, JSON + CSV)

ROADMAP §17: "Export must represent splits." Realized asymmetrically, matching the export spec's existing
CSV-ledger-vs-JSON-dump split of concerns:

- **JSON (lossless, in scope).** `getTransactionsForExport` selects `splits`
  (`categoryId`, `amount`, `note`); each transaction in the JSON `transactions` array gains a **derived**
  `isSplit: boolean` and `splits: { categoryId, amount, note }[]` (`[]` when not split). Bump the
  envelope `schemaVersion` **1 → 2** (the envelope was versioned "from day one" for exactly this).
  Import continues to accept both `1` and `2` but **ignores** `splits` in v1 (documented deferral, §12).
  > **For future readers of the export format:** `isSplit` in the JSON is a **computed convenience field**
  > (emitted as `splits.length > 0`), **not** a column in the data model — there is no `Transaction.isSplit`
  > in the schema (§3). `splits` is the sole source of truth; treat `isSplit` as read-only derived output.
- **CSV (reconciliation ledger, category label only).** A split transaction stays **one row** with the
  Category column reading `Split` (constant `SPLIT_LABEL`). CSV is a flat `SUM(Amount)`-reconciling
  ledger — emitting per-split child rows *and* the parent would break reconciliation, and emitting only
  child rows would break the one-row-per-transaction contract. Per-category CSV attribution of splits is
  an analytical concern already served by JSON; deferred for CSV. No `schemaVersion` concept applies to
  CSV.

`EXPORT_ENTITY_CLASS` is unchanged — `transactionSplit` is not a top-level export entity; it rides inside
the `transaction` "bound" class as nested data (like goal contributions ride inside `goal`).

---

## 9. UI

### 9.1 Transaction drawer (`src/components/transactions/transaction-drawer.tsx`)

Expense-only "Split" mode. When `type === "EXPENSE"`, the Category field row gains a **"Split"** toggle
(text button, neutral styling — this is not an AI affordance, so no `--color-ai`).

**Wireframe — the split editor (replaces the single Category field when toggled on):**

```
 Category                                   [ Split ✕ ]     ← toggle (✕ = leave split mode)
 ┌───────────────────────────────────────────────────────┐
 │  ▾ Groceries        €  55.00   note (optional)     🗑  │  ← line 1: category · amount · note · remove
 │  ▾ Household        €  25.00   cleaning supplies   🗑  │  ← line 2
 │  ▾ Pick a category… €   0.00                       🗑  │  ← line 3: uncategorized while editing (OK)
 │                                                        │
 │  + Add split                          (max 20 lines)   │
 ├───────────────────────────────────────────────────────┤
 │  Total €80.00 · €0.00 left ✓        [ Distribute rem. ] │  ← running total + one-click remainder
 └───────────────────────────────────────────────────────┘
      indicator: "€0.00 left" green · "€X left/over" amber · Save gated until 0 & all categorized
```

> Layout only — a developer sketch, not final visual design (spacing/tokens follow the existing drawer
> `Field` rows and shadcn inputs). On mobile the three inputs stack within each line row; the running-total
> footer stays pinned above Save.

Toggling on:

- Hides the single `<CategoryPickerField>` and shows a **split editor**: a list of rows, each a
  `<CategoryPickerField>` + a small amount input + an optional note input + a remove-row button, and an
  "+ Add split" button (capped at `SPLIT_MAX_LINES`).
- Shows a **running total line**: `Σ splits` vs the transaction `amount`, with a live
  remaining/over indicator (`€0.00 left` green / `€X over` or `€X left` amber) plus a one-click
  **"Distribute remaining"** button that assigns the current leftover to the last (or focused) line —
  the fast path for uneven-cent receipts. Reuse `formatCurrency`.
- **Amounts first, categories after (the receipt workflow).** A line may be left **uncategorized while
  editing** — enter all the amounts, then categorize. The only *hard* requirement is the **Save gate**:
  balanced total **and** every line categorized. (Requiring categories at Save, not before, keeps large
  receipts frictionless without weakening the conscious-attribution thesis — an all-uncategorized split
  would defeat the point of splitting.)
- Seeds two empty rows on first toggle (min is 2). Switching `type` away from EXPENSE, or toggling Split
  off, clears the split rows and restores the single-category field.
- On edit-open of an existing split (`editData.isSplit`), starts in split mode with the lines pre-filled.

**The sum/remaining math is a pure, testable helper — not inline component logic.** Because components
aren't unit-tested (project standard), the one piece of real logic here is extracted to
`src/lib/split.ts` and imported by the drawer:

```ts
/** Remaining = total − Σ split magnitudes, rounded to the cent. 0 = balanced, <0 = over. */
export function splitRemaining(total: number, lines: { amount: number }[]): number;
/** True when a split draft is submittable: ≥ SPLIT_MIN_LINES, every line has a category, remaining === 0. */
export function isSplitBalanced(total: number, lines: SplitDraft[]): boolean;
/** Return the lines with `splitRemaining` added to the target line (default: last). Powers "Distribute remaining". */
export function assignRemainder(total: number, lines: SplitDraft[], targetIndex?: number): SplitDraft[];
```

The drawer renders the indicator from `splitRemaining`, wires the button to `assignRemainder`, and gates
Save on `isSplitBalanced`; §13 unit-tests all three (rounding, over/under, missing-category, min-lines,
remainder distribution). The server re-validates the sum regardless (§4) — the client gate is UX, the
server is the source of truth.

> **Precision contract for `assignRemainder`.** The remainder it adds is `splitRemaining` (already
> cent-rounded), and it applies that to the target line's already-cent-rounded amount, `round2`-ing the
> result. Because both operands are cents, repeated Distribute clicks / edits **cannot accumulate
> floating-point drift** — each pass lands exactly on a 2-decimal value, and a second pass on a balanced
> split is a no-op (§13 asserts both).

**Unspecified behaviors, now decided:**

- **Total amount changes while lines exist** → **force manual reconcile**, do *not* auto-scale. Changing
  the transaction total simply re-computes `splitRemaining` (Save re-gates); the user adjusts the lines or
  clicks "Distribute remaining". Auto-scaling silently rewrites amounts the user typed — off-thesis for a
  conscious-capture app.
- **Remainder / uneven cents — solved in v1 by "Distribute remaining."** A 3-way split of €10 can't hit
  exact cents by hand; the one-click action (`assignRemainder`) drops the leftover onto the target line.
  Percentage-based entry remains the deferred convenience (§15), but the common receipt case is handled.
- **AI Suggest** (Pro category suggestion) is **hidden in split mode** — it targets the single Category
  field, which isn't present. **Quick add** (NL parse) only ever yields a single-category draft; it does
  not produce splits, and is unaffected (a user can split *after* a quick-add pre-fill by toggling Split).

State: `const [isSplit, setIsSplit] = useState(false)` + `const [splits, setSplits] = useState<SplitDraft[]>([])`. On Save, when `isSplit`, send `splits` and omit `categoryId`.

Tags remain available on a split transaction (they're parent-level). Merchant/note stay parent-level; the
per-line `note` is a short "what was this slice" label, distinct from the transaction note (its own
shorter cap — `SPLIT_NOTE_MAX`, §10).

### 9.2 Feed row (`src/components/transactions/transaction-row.tsx`)

A split transaction renders its Category cell as a **`Split · N`** chip (using a distinct Lucide icon,
e.g. `SplitSquareHorizontal`, neutral color) instead of a single category. The row is
**expandable** revealing the split lines: each line shows its category icon+name, optional note, and
`formatCurrency(amount)`. Collapsed by default. The amount column still shows the single parent total
(unchanged).

**Disclosure control + a11y (match the Reports slice's rigor).** Use a **dedicated** disclosure control,
not the whole row — the row already click-to-edits, and overloading it would make expand vs. edit
ambiguous. The control is a real `<button>` with `aria-expanded={open}` and `aria-controls="<panel-id>"`;
the revealed panel has the matching `id`. The `Split · N` chip is not the only signal (icon + text), and
the caret rotation is decorative (`aria-hidden`). Keyboard: the disclosure is tab-reachable and toggles on
Enter/Space, independent of the row's edit affordance.

> **Deviation to document (mirrors Tags):** the expandable split detail renders on the full
> `/transactions` feed only. The dashboard's compact recent-transactions list (separate `TransactionRow`
> type/component) shows the `Split · N` chip but is **not** expandable — it links to `/transactions` for
> detail. `SPLIT_MAX_LINES` stays the shared constant.

### 9.3 Settings — user-category delete copy

The existing `confirm-delete-dialog` for user categories (§ user-category-management) states transactions
go to Uncategorized. Extend the copy to note **split lines** in that category also fall back to
Uncategorized (the `SetNull` in §3). One-line copy change; no logic change.

---

## 10. Constants & types

**`src/lib/system-constants.ts`** (system-level numeric rules):
- `SPLIT_MIN_LINES = 2` — a split needs at least two categories to mean anything.
- `SPLIT_MAX_LINES = 20` — per-transaction cap (mirrors `TAG_MAX_PER_TRANSACTION`'s bounding intent).
- `SPLIT_NOTE_MAX = 120` — per-line note cap. Deliberately shorter than the transaction `NOTE_MAX`
  (~500): a split-line note is a terse "what was this slice" label, not a full memo. Reusing the big
  transaction cap here would let a line note dwarf its own amount in the UI.

**`src/lib/constants.ts`** (UI/domain strings):
- `SPLIT_LABEL = "Split"` — the pseudo-category label for feed cells + CSV Category column.
- `SPLIT_ICON = "SplitSquareHorizontal"` — the Lucide name for the split chip.

**`src/lib/money.ts`** (new, or fold into an existing util): `round2(n)` extracted from
`actions/transactions.ts` so validation and actions share one cent-rounding rule.

**`src/lib/split.ts`** (new, pure): `splitRemaining` + `isSplitBalanced` + `assignRemainder` (§9.1) + the
`SplitDraft` type — the drawer's sum/gate/distribute logic, extracted so it's unit-testable without
rendering the component.

**`src/types/transactions.ts`:**
- `FeedSplit { id: string; category: FeedCategory | null; amount: number; note: string | null }`.
- `FeedTransaction` / `TransactionLeg` gain `isSplit: boolean` (derived server-side from `splits.length`)
  and `splits: FeedSplit[]` (empty unless split).
- `EditableTransaction` gains `isSplit?: boolean` and `splits?: { categoryId: string; amount: number; note: string | null }[]`.

**`src/types/export.ts`:** `ExportTransactionRow` gains `isSplit: boolean` and
`splits: { categoryId: string | null; amount: number; note: string | null }[]`; bump the envelope
`schemaVersion` type/const to `2`.

---

## 11. Revalidation

No new helper. Splitting changes budget + Reports + feed + dashboard numbers, and
`revalidateTransactionViews()` already revalidates `/transactions`, `/dashboard`, `/budgets`, and
`/reports` (it was extended for budgets in the Budgets CRUD slice). Confirm `/reports` is in its path;
if not, add it. The write actions already call it — no action change beyond the split write itself.

---

## 12. Deferred round-trip (import) — documented, not an oversight

Like Tags' export/import deferral, this slice **writes** splits into the JSON export but **does not read**
them back on import. Rationale: `/import` maps flat external files (CSV/YNAB/Mint) that have no split
concept, and adding split re-hydration to the JSON path means categ/amount resolution + the sum-invariant
re-check inside the import pipeline — a self-contained follow-up slice, not a line item here. Consequence:
a JSON export → import round-trip preserves the transaction and its parent amount but **flattens** a split
back to Uncategorized (no category, since split parents store `categoryId: null`). The additive follow-up
(read `splits` when `schemaVersion >= 2`, re-validate the sum, write `TransactionSplit` rows) closes it
without a schema change.

> **Treat split import as the top post-release follow-up.** This is the **only functional round-trip gap**
> in the feature: a user who exports and re-imports their own data silently loses split attribution.
> Because the JSON envelope already carries `schemaVersion`, closing it is small and self-contained — it
> should land shortly after this slice, not sit in the backlog. Flag it explicitly in the import spec's
> "known limitations" until then.

---

## 13. Testing (Vitest — `src/actions/**` + `src/lib/**` only)

- **`test/lib/validations/transaction.test.ts`** (extend): split superRefine — rejects non-EXPENSE
  splits, `< SPLIT_MIN_LINES`, top-level category + splits together, and a sum mismatch (off by a cent);
  accepts a valid 2-line and `SPLIT_MAX_LINES`-line split; `> SPLIT_MAX_LINES` rejected.
- **`test/actions/transactions.test.ts`** (extend): `createTransaction` writes parent
  (`categoryId: null`, signed amount, **no** persisted `isSplit`) + N split rows atomically; foreign split
  category id → all-or-nothing `"Category not found."`; `updateTransaction` replaces split lines and
  toggles split-mode both directions (single→split nulls the category; split→single deletes lines and
  restores a category); transfer path never creates split rows.
- **`test/lib/db/split-spend.test.ts`** (new): the double-count invariant (Σ per-category == Σ abs(EXPENSE
  amount)); a split transaction contributes to *each* line's category, not the parent; a null split
  category is dropped from the budget map; `categoryIds` filter scopes correctly; `accountFilter` scopes
  the split-line query through the parent relation.
- **`test/lib/db/budgets.test.ts`** (extend): a budgeted category's `spent` includes split-line spend
  from a transaction whose parent category is null.
- **`test/lib/split.test.ts`** (new): `splitRemaining` (balanced → 0, over → negative, under → positive,
  cent rounding of a 3-way €10); `isSplitBalanced` (rejects `< SPLIT_MIN_LINES`, a line missing a
  category, and a non-zero remainder; accepts an exact split); `assignRemainder` (leftover lands on the
  target/last line and the result is balanced; a no-op when already balanced).
- **`test/lib/money.test.ts`** (new, if `round2` moves): the extracted cent-rounding rule (`0.1 + 0.2`,
  half-up boundary) — cheap, and it now backs both validation and the write actions.
- **`test/lib/insights.test.ts`** (extend): `countAtRiskBudgets` flags a budget pushed over the threshold
  by **split-fed** spend — the one assertion that pins the free-rider coupling (§7) so it can't regress.
- **`test/lib/db/split-invariance.test.ts`** (new — the cross-surface guard suggested in review):
  converting a transaction from single-category to a split of the **same total** must leave every derived
  total invariant. On one mocked fixture, assert *before == after* for: the grand total of
  `getCategorySpend` (Budgets/Reports feed), income-vs-expenses / cashflow buckets (unchanged by
  construction — §7), and a rollover-carry period that includes the converted month. Only per-category
  attribution moves; overall spend is conserved. (Unit-level with mocked prisma per the standards — not a
  live-DB integration test, but it exercises all four consuming code paths against the same data.)

Mock `@/lib/prisma` per the standards; no live DB. Target parity with prior slices (build + lint clean,
full suite green).

---

## 14. Migration

`prisma migrate dev --name add_transaction_splits` — creates the `TransactionSplit` table plus its two
indexes + FKs. Like the Tags migration it is **purely additive and touches no existing table**: split
status is derived from child rows, so there is **no `Transaction.isSplit` column** and — because the
double-count guard is structural (§3) — **no CHECK constraint** to hand-write or maintain. No data step,
so a single ordinary migration (no `--create-only` follow-up). Apply to the `development` Neon branch per
the standard workflow (production deferred to the normal deploy). Run `prisma migrate status` before
commit.

---

## 15. Open decisions (resolve before/while building)

1. **Split toggle placement** — inline "Split" text button on the Category row (recommended, keeps it
   discoverable at the point of categorizing) vs. a type-toggle-style third mode. Recommend inline button.
2. **Split amount entry** — enter each line's **amount** with a live remaining indicator (recommended,
   matches receipts) vs. enter **percentages**. Recommend amounts; percentages can be a later convenience.
3. **`round2` home** — new `src/lib/money.ts` (recommended) vs. exporting the existing private from
   `actions/transactions.ts`. Recommend the shared lib (validations shouldn't import from actions).
4. **Feed expand affordance** — dedicated disclosure caret (recommended, avoids clashing with
   row-click-to-edit) vs. click-row-to-expand + separate edit control.
5. **CSV split representation** — `Split` label only (recommended, preserves ledger reconciliation) vs. a
   "split detail" companion export — recommend label-only for v1. (The drawer's **"Distribute remaining"**
   helper is now **in v1 scope**, §9.1 — no longer an open question.)
6. **Confirm import deferral** — ship JSON export `schemaVersion: 2` now, read-on-import as a
   **high-priority follow-up** (recommended, controls blast radius) vs. do both in this slice. Recommend
   defer, but treat the round-trip gap as the top post-release item (§12).
7. **Split status: derived (chosen) vs. a stored `isSplit` column.** **Derive** from child-row existence
   (`splits: { some/none }`) — chosen. It removes an invariant that would otherwise have to hold forever,
   makes double-counting *structurally* impossible (§3), keeps the migration additive-only (no
   existing-table change, no CHECK constraint), and simplifies future imports/migrations/debugging. The
   stored-boolean alternative buys only a marginally cheaper feed filter and a 1-field edit check; it was
   considered and **rejected**. Revisit solely if the `splits: { none: {} }` anti-join ever shows up as a
   real query cost at scale (it won't at MVP volumes).

---

## 16. Docs to update on completion

- **`docs/POST-MVP-ROADMAP.md`** — mark §17 + Delivery Sequence slot #9 ✅ Shipped; add the realized
  decisions (child table with **derived** split status / no `isSplit` column, EXPENSE-only, single-account,
  derive-via-`getCategorySpend`, "Distribute remaining" in v1, JSON `schemaVersion: 2`, import deferred).
- **`docs/project-overview.md`** — Transactions feature note (splits: one row, category-attributed);
  schema mirror gains **`TransactionSplit`** (no `Transaction` column — split status is derived); Data
  Portability note on the JSON `splits` field + the import round-trip limitation.
- **`docs/features/data-export-spec.md`** / **`data-import-spec.md`** — `schemaVersion: 2` envelope with
  `splits`; import "known limitation" (splits ignored in v1) flagged as a **high-priority follow-up** (§12).
  Note the search limitation (split categories/notes not searched) where search behaviour is documented.
- **`docs/features/entity-types.md`** + **`entity-crud-architecture.md`** — the `TransactionSplit` child
  and the split-aware aggregation path.
- **`/help`** content — a one-line "you can split a purchase across categories" explainer under
  Transactions (per the Help maintenance contract).
- **`docs/current-feature.md`** — document at start, mark complete + add the History entry at the end.
