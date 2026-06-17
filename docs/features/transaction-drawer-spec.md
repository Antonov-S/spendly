# Transaction Drawer & Edit (Part 2 — Write)

> **Scope:** The slide-in drawer (create / edit) and every write path — server actions, Zod validation, amount/sign convention, soft delete + snackbar undo, and the transfer edit/delete policy.
>
> **Depends on:** [transaction-list-view-spec.md](transaction-list-view-spec.md) (Part 1) — the read-only feed, fetcher, and filter/search params. This part wires the feed's "Add transaction" CTA and row clicks to the drawer, and adds the delete/undo loop.
>
> **Shared with:** `/dashboard` (its "Add" CTA opens the same drawer). The existing mockup lives at `src/components/dashboard/transaction-drawer.tsx`.
>
> **Picks up from Part 1:** Part 1 renders the "Add transaction" CTA and feed rows as inert (no click handlers, no drawer shell). This part builds the drawer from scratch — open/close state, the form, and all write actions — and wires both the CTA (create) and row clicks (edit) to it.

## Architecture & Data Fetching (write side)

Writes use **Server Actions** in `src/actions/transaction.ts` (per coding standards — API routes are reserved for webhooks, uploads, and future mobile/CLI clients). Each action:

- Validates ownership (`userId` from the authenticated session — never trust client-supplied IDs).
- Validates input with **Zod** schemas in `src/lib/validations/transaction.ts`.
- Returns the `{ success, data, error }` pattern.
- Calls `revalidatePath("/transactions")` (and `/dashboard` where relevant) on success.

> `/api/transactions*` routes remain documented in the project overview as the future mobile/export surface and are **not** implemented as part of this feature.

## Amount & Sign Convention

- Storage is **signed**: positive for INCOME / transfer inflow, negative for EXPENSE / transfer outflow (matches the balance formula `startingBalance + SUM(amount WHERE deletedAt IS NULL)`).
- In the drawer the user always enters a **positive magnitude**; the server action derives the sign from the type toggle.
- All create / edit / transfer inputs are validated with Zod before any DB write.

## Drawer (Create / Edit)

Reuse and extend the existing drawer at `src/components/dashboard/transaction-drawer.tsx`. Since both `/dashboard` and `/transactions` open it, **promote it to a shared location** (e.g. `src/components/transactions/transaction-drawer.tsx`) rather than duplicating.

Open behavior:
- Desktop: fixed right panel, `w-[420px]`, slides in with `300ms ease-in-out`, backdrop overlay
- Mobile: bottom sheet, ~90vh, slides up from bottom

Drawer fields (in order):

1. Type toggle — `Income` / `Expense` / `Transfer`
2. Amount — large numeric input (positive magnitude; sign derived from type)
3. Date — date picker (sends the user's local date string; no UTC conversion)
4. Category — selector (system + user categories; **hidden for Transfer** type)
5. Account — selector (active accounts only; archived excluded). For transfers, shows "From" and "To" selectors (must differ).
6. Merchant — optional text field
7. Note — optional text field
8. Save button

Both **create** (opened from the "Add transaction" CTA) and **edit** (opened by clicking a feed row) use this same drawer; edit pre-fills from the clicked transaction.

## Transfers — Edit / Delete Policy

A transfer is two `Transaction` rows sharing a `transferPairId`, both with `isTransferLeg = true`.

- **Delete:** Soft-deletes **both legs** (all rows sharing the `transferPairId`) in a single server action. The snackbar undo restores both.
- **Edit (normal UX, delete-and-recreate internally):** The user experience is a **standard edit flow** — clicking a transfer row opens the drawer with editable fields and a Save button, identical to editing any transaction. Internally, `updateTransfer()` does **not** mutate the existing legs. It runs as a single atomic operation: **soft-delete both existing legs** (the old `transferPairId`) and **create a fresh transfer pair** (new `transferPairId`, two new legs) with the updated values.
  - **Why:** This keeps the backend simple and reliable while giving users an intuitive edit experience. It reuses the already-tested `createTransfer` and transfer-delete logic instead of writing fragile two-row mirroring, minimizing the risk of transfer-synchronization bugs.
  - **Atomicity (required):** The soft-delete + recreate must be wrapped in a single `prisma.$transaction`. A failure must never leave the old pair deleted without a replacement.
  - The recreated legs get new IDs/`createdAt`; the old legs remain soft-deleted in the DB (consistent with the soft-delete policy). Neither leg may be recategorized (enforced by `isTransferLeg`).

## Soft Delete & Snackbar Undo

Deleting a transaction sets `deletedAt` and removes it from the feed immediately (the Part 1 query filters `deletedAt IS NULL`). An 8-second snackbar offers an undo action that clears `deletedAt`. Transfers soft-delete both legs together (see above). No Trash UI in MVP — undo via snackbar is the only recovery path.

## Server Actions

| Action | Purpose |
|---|---|
| `createTransaction(input)` | Create income or expense; derives sign from type |
| `createTransfer(input)` | Create two linked legs sharing a new `transferPairId`, both `isTransferLeg = true` |
| `updateTransaction(id, input)` | Update a non-transfer (income/expense) transaction's fields in place |
| `updateTransfer(pairId, input)` | Atomic delete-and-recreate: in one `prisma.$transaction`, soft-delete both old legs and create a new pair with updated values |
| `deleteTransaction(id)` | Soft delete; if a transfer leg, soft-deletes both legs of the pair |
| `restoreTransaction(id)` | Snackbar undo — clears `deletedAt` (both legs for transfers) |

All actions: validate ownership (`userId` from session), validate input with Zod, return `{ success, data, error }`, and `revalidatePath("/transactions")`.

## Testing (Vitest)

Per coding standards, cover `src/actions/**` and any new `src/lib/**` helpers (no component tests). Server-action tests:

- Ownership enforcement (rejects IDs not owned by the session user)
- Sign derivation from the type toggle
- Transfer two-leg creation (shared `transferPairId`, both `isTransferLeg = true`)
- `updateTransfer` — old pair soft-deleted + new pair created within one `$transaction`
- `deleteTransaction` — both legs soft-deleted for a transfer
- `restoreTransaction` — both legs restored

Mock `@/lib/prisma` and `@/auth` at the module boundary; never hit a real DB.

## Responsive Behavior

- Desktop (≥ 768px): drawer is a fixed right panel, `w-[420px]`.
- Mobile (< 768px): drawer becomes a bottom sheet (~90vh), slides up from the bottom.
