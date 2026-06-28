# Trash UI Spec

> A **"Recently deleted"** surface for soft-deleted **transactions** — view,
> **restore**, or **permanently delete** them beyond the 8-second snackbar undo.
> Almost all the plumbing already exists (`Transaction.deletedAt`,
> `restoreTransaction`, `@@index([deletedAt])`); this slice adds **one read
> fetcher**, **one hard-delete action**, a **`/trash` page**, and a small set of
> list/row/confirm components. No schema change.

_Status: ✅ shipped (`feature/trash-ui`) • Feature: Trash UI • POST-MVP §8 • Delivery slot 6 • Last updated: 2026-06-28_

Authoritative sources: `docs/POST-MVP-ROADMAP.md` §8 + Delivery Sequence row 6;
`docs/project-overview.md` (Architecture "Soft delete + snackbar undo"; "Dedicated
Trash UI with restore flow" in Out of Scope — graduates in here);
`docs/features/transaction-drawer-spec.md` + `docs/features/transaction-list-view-spec.md`
(the shipped soft-delete / restore / feed stack this extends).

This is a **superset** of the transactions read/write stack: every existing rule
(row-level ownership, transfer pairs, EUR-only, derived balances, `force-dynamic`
page) still holds. Trash adds a `deletedAt != null` read path, a permanent-delete
mutation, and a recovery surface — it does **not** touch the live feed's behavior.

---

## 1. Goal

A signed-in user can open a **Recently deleted** surface that lists their
soft-deleted transactions (newest deletion first) and, per row:

- **Restore** — clears `deletedAt`, returning the transaction to the live feed,
  balances, and budget spend (reuses the existing `restoreTransaction`). The
  restored transaction reappears in its **normal chronological position** in the
  Transactions list — sorted by its own `date`, exactly as before deletion — **not**
  bumped to the top as if newly created. (This follows from the feed's existing
  `date desc, createdAt desc, id desc` sort since restore touches only `deletedAt`;
  it is stated here and in §8/D12 so no future change accidentally re-stamps a
  "restored-at" ordering.)
- **Delete forever** — a permanent, irreversible hard delete (confirm-gated).

This is the safety net the MVP deliberately deferred to the 8-second snackbar:
once the snackbar dismisses, a delete is currently unrecoverable from the UI. Trash
turns that into a recoverable state without weakening the conscious-capture model
(nothing is auto-restored; the user explicitly acts).

### Non-goals (explicit)

- **Transactions only.** Only `Transaction` soft-deletes today — goals, budgets,
  accounts, and categories are **hard-deleted** (no `deletedAt`). "Trash for
  everything" is a separate, larger effort and is **out of scope** (the roadmap
  says so explicitly). Scope this slice to transactions.
- **No auto-purge / no cron in v1.** There is no scheduled job to permanently
  remove old trashed rows — matching the app's cron-free stance (budget rollover,
  recurring drafts compute lazily). Items stay in trash until the user restores or
  permanently deletes them. A time-based purge policy is a deferred follow-up
  (§11), gated on real need.
- **No account-filter scoping in v1.** Trash is a flat recovery list of **all**
  the user's deleted transactions, independent of the topbar account selector
  (it is a recovery surface, not an analysis surface). See §10 decision D5.
- **Not editable.** A trashed row cannot open the edit drawer — it must be
  restored first. The only actions are Restore and Delete forever.
- **Not a Pro gate.** Recovery of your own data is core trust, free for everyone
  (same stance as export — "a finance app that withholds user data erodes trust").

---

## 2. What already exists (reuse, don't rebuild)

| Asset | Location | Use |
|---|---|---|
| `deletedAt` soft-delete column + `@@index([deletedAt])` | `prisma/schema.prisma` `Transaction` | Read `deletedAt != null`; no schema change |
| `restoreTransaction(id)` | `src/actions/transactions.ts` | **Reuse unchanged** — already clears `deletedAt` for a single tx **and** both legs of a transfer pair, ownership-checked |
| `deleteTransaction(id)` | `src/actions/transactions.ts` | The soft-delete that feeds trash — unchanged (only needs its revalidation extended, §7) |
| `revalidateTransactionViews()` | `src/lib/revalidation.ts` | Extend to also touch `/trash` so deletes/restores/purges keep trash fresh |
| Transfer collapse | `collapseTransfers` in `src/lib/transactions.ts` | Reuse (all-accounts mode) so a deleted transfer shows as **one** row |
| Feed row visuals | `src/components/transactions/*` (type border color, category icon, amount formatting) | Mirror the look in a new read-only `TrashRow` (different affordances — Restore / Delete forever, not click-to-edit) |
| Confirm dialog pattern | native `<dialog>` `ConfirmDeleteDialog` in `src/components/goals/`, `src/components/recurring/` | Mirror for the "Delete forever" confirm (irreversible copy) |
| Snackbar undo | Sonner `<Toaster />` in `AppShell` | After a permanent delete, **no** undo (it's irreversible); after a restore, a confirmation toast only |
| Page shell + guard | `AppShell`, `requireOnboarded()`, `getSidebarUser` | `/trash` is a `force-dynamic` `AppShell` page like `/transactions` |
| Help content | `transactions` section in `src/lib/help/content.ts` | **Flip the "no Trash view" copy** to describe the recovery surface (maintenance contract, §9) |

---

## 3. Data model

**No schema change.** `Transaction.deletedAt` and `@@index([deletedAt])` already
exist; the index makes the `deletedAt != null` scan cheap at MVP volumes. The only
column trash reads beyond the feed's projection is `deletedAt` itself (to order and
label "deleted X ago").

---

## 4. Read path — `getDeletedTransactions`

A new server-only fetcher in `src/lib/db/transactions.ts` (sits beside
`getTransactions`). It is **separate** from the feed query: `buildTransactionWhere`
hardcodes `deletedAt: null`, and trash must include rows on **archived** accounts
(their history stays intact and recoverable), so trash does not reuse that helper.

```ts
// src/lib/db/transactions.ts  (new export)
export async function getDeletedTransactions(
  userId: string
): Promise<TrashTransaction[]>
```

Behavior:

- `where: { userId, deletedAt: { not: null } }` — **no** archived-account
  exclusion (a deleted transaction is recoverable regardless of its account's
  archive state).
- `orderBy: [{ deletedAt: "desc" }, { id: "desc" }]` — most recently trashed first.
- `take: TRANSACTIONS_PAGE_SIZE` (reuse the existing constant). Trash is expected
  to be small; a single bounded fetch is enough for v1. **No cursor/load-more** —
  if real usage shows deep trashes, add the same cursor pattern `getTransactions`
  uses (decision D4).
- `include: FEED_INCLUDE` (category name/color/icon + account name), same as the
  feed, so rows render identically.
- **Transfer collapse:** both legs of a transfer are soft-deleted together (they
  share `deletedAt` set in the same `updateMany`), so a single `take` window keeps
  them together. Map legs to `TransactionLeg`, then run `collapseTransfers(legs)`
  (all-accounts mode → outflow leg canonical, inflow names the counterparty). No
  separate counterparty backfill query is needed — both legs are already in the
  deleted set.

### 4.1 Row shape — `TrashTransaction`

Declared in `src/types/transactions.ts` (a plain type, not a re-export from a
`"use server"` file — see the project memory on Turbopack type re-exports). It is
`FeedTransaction` plus the deletion timestamp:

```ts
export interface TrashTransaction extends FeedTransaction {
  /** When the row was soft-deleted (drives "deleted X ago"). */
  deletedAt: Date;
}
```

`collapseTransfers` returns `FeedTransaction[]`; the fetcher attaches `deletedAt`
from the canonical leg when projecting. (If cleaner, add a thin local mapper rather
than widening the shared collapse helper — keep `collapseTransfers` untouched.)

---

## 5. Write path — `hardDeleteTransaction` (+ optional `emptyTrash`)

A new action in `src/actions/transactions.ts`, following the existing
`MutationResult` convention (`{ success, error? }`), `auth()`-guarded, ownership-
scoped, `try/catch` with a `console.error` + friendly message.

```ts
export async function hardDeleteTransaction(id: string): Promise<MutationResult>
```

Behavior:

1. Auth → `NOT_AUTHED` if no session.
2. Find `existing = prisma.transaction.findFirst({ where: { id, userId, deletedAt: { not: null } }, select: { id, transferPairId } })`.
   - **Only already-soft-deleted rows are hard-deletable here** — a live
     transaction cannot be permanently deleted from trash (defense in depth; the
     UI never offers it on a live row anyway). Not found → `"Transaction not found."`
3. If `transferPairId`: `prisma.transaction.deleteMany({ where: { transferPairId, userId, deletedAt: { not: null } } })` — **both legs** vanish together (mirrors how `deleteTransaction` soft-deletes both).
   Else: `prisma.transaction.delete({ where: { id } })`.
4. `revalidateTransactionViews()` → `{ success: true }`.

This is a true `delete` (row removed), not another `deletedAt` write. It is
**irreversible** — there is no undo and no snackbar (§6).

### 5.1 Optional — `emptyTrash()`

A convenience "Empty trash" that hard-deletes every trashed row for the user:

```ts
export async function emptyTrash(): Promise<MutationResult>
// prisma.transaction.deleteMany({ where: { userId, deletedAt: { not: null } } })
```

Recommended to **include** (it is one `deleteMany` and a confirm dialog), but it is
the only genuinely new bulk path — if scope needs trimming, ship per-row
"Delete forever" first and add "Empty trash" as a fast follow. Confirm-gated with
explicit irreversible copy and the count ("Permanently delete 12 transactions?").

---

## 6. UI

A new `/trash` route + a small component set under `src/components/trash/`.

### 6.1 Page — `src/app/trash/page.tsx`

- `export const dynamic = "force-dynamic"` + `export const metadata = { title: "Trash" }` (root template makes it `"Trash — Spendly"`).
- `const session = await requireOnboarded()` — same guard as `/transactions` (a
  non-onboarded user has nothing in trash; keep it consistent with the data
  surfaces). Add `/trash` to `auth.config.ts` `isProtected`.
- `Promise.all([getUserAccounts, getSidebarUser, getDeletedTransactions])`, render
  inside `<AppShell>` (so the sidebar/topbar are present and consistent).
- `nowMs = Date.now()` passed down for "deleted X ago" relative labels (anchored to
  the request, not import time).

### 6.2 Components

- **`TrashView`** (client) — coordinator. Holds the list, fires `restoreTransaction`
  / `hardDeleteTransaction` via `useTransition`, shows Sonner toasts, and
  `router.refresh()` after each action.
  - **"Empty trash" affordance (D9): hidden when the list is empty**, not rendered-
    but-disabled. The empty state (`TrashEmptyState`) already communicates "nothing
    here"; a disabled destructive button beside it is noise and risks a no-op
    confirm dialog. Render the button only when `rows.length > 0` (→
    `ConfirmDeleteDialog` → `emptyTrash`, count in the copy).
  - **Toast behavior under rapid actions (D10): one toast per action, but throttle
    successive successes into a rolling summary** so restoring several rows in a row
    doesn't stack N identical toasts. Use a **single reused Sonner toast id** per
    action kind (`toast.success(msg, { id: "trash-restore" })` / `"trash-delete"`):
    each new success replaces the prior toast rather than stacking, and the message
    can carry a running count when fired within the toast's visible window (e.g.
    "Restored" → "Restored 2" → "Restored 3"). Errors are **not** deduped — each
    failure shows its own toast so nothing is silently swallowed. Restore is the
    only reversible-feeling action, so it gets no Undo button (the row is already
    back in the feed); permanent delete gets no Undo (irreversible).
- **`TrashRow`** — read-only row mirroring the feed row visuals (type-color left
  border, category icon, description, account, signed amount) **plus** a deletion
  metadata line and two trailing buttons: **Restore** and **Delete forever**. Not
  a click-to-edit button.
  - **Deletion label (D8): show both relative and absolute** — `"Deleted 3 days
    ago · Jun 25"`. The relative half ("3 days ago") gives at-a-glance recency; the
    absolute half (`MMM D`, year appended when not the current year) stays useful
    once the row is old, where a bare relative label degrades to a vague "2 months
    ago". The relative part is derived from `deletedAt` against the `nowMs` passed
    from the page; the absolute part formats `deletedAt` with `timeZone: "UTC"`
    (consistent with the feed's date formatting). A small pure helper
    (`formatDeletedAt(deletedAt, nowMs)` in `src/lib/transactions.ts`) owns this so
    it is unit-testable.
- **`ConfirmDeleteDialog`** — native `<dialog>`, irreversible copy
  ("This permanently deletes the transaction. This can't be undone."). For a
  transfer row, the copy notes **both sides** of the transfer are removed.
- **`TrashEmptyState`** — calm empty treatment: "Trash is empty. Deleted
  transactions show up here so you can restore them." (Active guidance per the
  "never a blank state" principle.) A link back to `/transactions`.

### 6.3 Discoverability / entry point

**Decision (D1): a dedicated `/trash` route, linked from the Transactions page
header — not a new permanent sidebar item.** A "Recently deleted" link in
`transactions-header.tsx` keeps the daily-use sidebar lean (the spec keeps Trash
out of the primary nav, like Accounts is a config surface). (Alternative considered:
a Settings "Data & privacy" tab — rejected because trash is tightly coupled to the
transactions feed, and a list surface wants its own route. See §10.)

**Count badge (D11): show a count next to the link, sourced from a cheap `count`
query.** The link reads e.g. "Recently deleted · 3" (the link is suppressed/plain
when the count is 0, so we never advertise an empty trash). The count comes from a
new `getDeletedTransactionCount(userId)` — `prisma.transaction.count({ where: {
userId, deletedAt: { not: null } } })`, covered by `@@index([deletedAt])` — folded
into the `/transactions` page's existing `Promise.all` (one extra cheap query, no
new round-trip pattern). **Refresh:** because `revalidateTransactionViews()` already
fires on every soft-delete / restore / hard-delete and the `/transactions` page is
`force-dynamic`, the badge recomputes on the next render of that page — no polling,
no client subscription. The badge is a freshness-on-navigation signal, not a live
counter (consistent with the rest of the app's `revalidatePath` model).
`getDeletedTransactionCount` is reused by `TrashView` to drive the "Empty trash"
copy count (single source).

### 6.4 Mobile / responsive

Reuse the feed's responsive treatment: the row's trailing action buttons collapse
to an overflow/stacked layout under `BREAKPOINTS.mobile`, matching how the feed
cards already render. No bottom-nav entry (Trash is not daily-use).

---

## 7. Revalidation & freshness

Extend `revalidateTransactionViews()` in `src/lib/revalidation.ts` to also
`revalidatePath("/trash")`. This single change means:

- A normal `deleteTransaction` (soft delete) immediately surfaces the row in trash.
- `restoreTransaction` removes it from trash and returns it to the feed/dashboard/budgets.
- `hardDeleteTransaction` / `emptyTrash` drop it from trash.

`/trash` is `force-dynamic` and `TrashView` also calls `router.refresh()` after its
own actions, so the list is never stale. The comment on `revalidateTransactionViews`
should be updated to mention `/trash` (it currently enumerates the surfaces it
touches).

---

## 8. Edge cases

- **Transfer in trash.** Both legs share `deletedAt`; they collapse to one row.
  Restore restores both (existing `restoreTransaction` keys off `transferPairId`);
  Delete forever removes both (`deleteMany` by `transferPairId`). The confirm copy
  flags this.
- **Ordering after restore (D12).** Restore clears **only** `deletedAt` — it does
  **not** touch `date`, `createdAt`, or any ordering key. The transaction therefore
  reappears in its **original chronological position** in the feed (the feed orders
  by `date desc, createdAt desc, id desc`), exactly where it was before deletion —
  not bumped to the top. This is the desired behavior: restore is an undo, not a
  re-creation. No "restored-at" concept is introduced.
- **Restore onto an archived account.** Allowed — the transaction reappears in that
  account's history (archived accounts keep their transactions "intact and
  queryable" per the architecture). It will **not** show in all-accounts dashboard
  totals (archived accounts are excluded there) but is visible when that account is
  selected — consistent with existing archived-account rules. No special handling.
- **Restore when the category was hard-deleted.** `categoryId` was `SetNull` on
  category delete, so the row restores as **Uncategorized** — renders correctly via
  the existing fallback. No action needed.
- **Ownership.** Every query/mutation filters by session `userId`; a foreign or
  non-existent id returns `"Transaction not found."` (never leaks existence).
- **Hard-deleting a row that's already gone** (double-click / stale list): the
  `findFirst` returns null → friendly not-found; the `deleteMany` is a safe no-op.
- **Empty trash with zero rows.** No-op `deleteMany` (count 0); UI shows the empty
  state. Confirm dialog can be suppressed when count is 0.

---

## 9. Help / maintenance contract

The Help FAQ currently tells users there is **no** Trash view. Two lines in
`src/lib/help/content.ts` must flip (the maintenance contract from the Help spec
§13 makes this slice responsible):

- The transactions explainer line (~L86): _"Deletes are soft, with an 8-second
  snackbar undo. After that it's gone from the app — there's no Trash view…"_ →
  rewrite to: deletes are soft with an 8-second undo, **and** deleted transactions
  can be restored (or permanently removed) from **Recently deleted / Trash** until
  you clear them.
- The "Common questions" delete line (~L142) → mention the Trash recovery path.

Also update `docs/project-overview.md` Out-of-Scope: move **"Dedicated Trash UI
with restore flow"** out of the post-MVP list (it ships here) — same reframing the
roadmap does for other graduated items. Add a `/trash` row to the Routes table.

---

## 10. Decisions (resolve-on-read; defaults chosen)

- **D1 — Surface:** dedicated **`/trash` route**, linked from the Transactions
  header. (Rejected: a Settings tab — trash is a list coupled to the feed.)
- **D2 — Scope:** **transactions only.** Goals/budgets/accounts/categories are
  hard-deleted today; "trash for everything" is a separate effort.
- **D3 — Purge:** **no auto-purge / no cron in v1.** Manual per-row "Delete forever"
  (+ optional "Empty trash"). A retention policy is a later, evidence-gated
  follow-up (§11).
- **D4 — Pagination:** **single bounded fetch** (`TRANSACTIONS_PAGE_SIZE`). Add the
  feed's cursor/load-more only if trashes get deep in practice.
- **D5 — Account scoping:** **ignored** — trash is a flat, all-accounts recovery
  list (the topbar selector does not filter it in v1).
- **D6 — Pro gate:** **none** — recovering your own data is core trust, free.
- **D7 — `emptyTrash`:** **include** (one `deleteMany` + confirm); ship per-row
  first if scope must be trimmed.
- **D8 — Deletion label:** **relative + absolute** ("Deleted 3 days ago · Jun 25"),
  via a pure `formatDeletedAt` helper (§6.2).
- **D9 — "Empty trash" when empty:** **hidden**, not disabled (§6.2).
- **D10 — Toasts under rapid actions:** **one reused toast id per action kind** with
  a rolling count; errors not deduped (§6.2).
- **D11 — Header badge:** **count shown** from a cheap `getDeletedTransactionCount`
  in the `/transactions` `Promise.all`; refreshes on navigation via the existing
  `revalidateTransactionViews()` (§6.3). Link/badge suppressed at count 0.
- **D12 — Order after restore:** **original chronological position** — restore
  clears only `deletedAt`, never re-stamps `date`/`createdAt` (§8).

---

## 11. Out of scope (deferred follow-ups)

- Trash for goals / budgets / accounts / categories (needs `deletedAt` on each —
  a much larger effort).
- Time-based auto-purge / retention policy + the cron to run it.
- Bulk multi-select restore/delete (beyond the all-or-nothing "Empty trash").
- Account-scoped trash views; trash search/filters.

---

## 12. Testing

Per coding-standards: test `src/actions/**` + `src/lib/**`; no component tests; mock
`@/lib/prisma` and `@/auth` at the module boundary.

- **`test/actions/transactions.test.ts`** (extend the existing suite):
  - `hardDeleteTransaction` — unauth → `NOT_AUTHED`; not-found / foreign id →
    error; **rejects a live (`deletedAt: null`) row** (where-clause asserts
    `deletedAt: { not: null }`); single soft-deleted row → `delete` called;
    transfer → `deleteMany` by `transferPairId`; success path calls
    `revalidateTransactionViews`.
  - `emptyTrash` (if shipped) — `deleteMany` scoped to `{ userId, deletedAt: { not: null } }`; zero-row no-op; auth guard.
  - (Spot-check that `restoreTransaction` is reused unchanged — no new test needed
    beyond its existing coverage.)
- **`test/lib/db/transactions.test.ts`** (new or extended): `getDeletedTransactions`
  where-shape (`deletedAt: { not: null }`, ordered by `deletedAt desc`, **no**
  archived-account exclusion), and that a deleted transfer collapses to one row;
  `getDeletedTransactionCount` where-shape.
- **`test/lib/transactions.test.ts`** (extend): `formatDeletedAt` — relative buckets
  (today / "1 day ago" / "N days ago") + absolute suffix, year appended only when
  not the current year, UTC-stable.
- Pure transfer collapse is already covered by `collapseTransfers` tests — reused.

Run `npm run test:run` + `npm run build` + lint clean before commit. Migrations:
none (no schema change), but run `prisma migrate status` to confirm in sync.

---

## 13. Workflow

One `/feature` slice on branch **`feature/trash-ui`**: document in
`current-feature.md`, implement, add the Vitest coverage above, verify in the
browser (delete a tx → it appears in `/trash` → restore brings it back → delete
forever removes it; transfer round-trip; empty state), commit per
`docs/ai-interaction.md` (no Claude attribution), merge, delete branch, mark
complete + add a History entry. Commit this spec **with** the implementation
(project memory: spec files ship in the same commit as the code).
