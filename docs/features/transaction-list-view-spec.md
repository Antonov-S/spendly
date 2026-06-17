# Transaction List View (Part 1 — Read)

> **Scope:** The read-only `/transactions` feed — data fetching, filters, search, date grouping, transfer collapse, pagination, and empty/loading states.
>
> **Depended on by:** [transaction-drawer-spec.md](transaction-drawer-spec.md) (Part 2) adds create/edit/delete via the slide-in drawer and the snackbar-undo loop.
>
> **Seam:** This part ships as a browsable-but-not-yet-editable feed. The "Add transaction" CTA and feed rows render, but are **inert in Part 1 — they do nothing on click**. The entire drawer (open/close shell + form + write actions) is built in Part 2. Do not stub an empty drawer shell here. No write actions exist in Part 1.

## Overview

The `/transactions` page is the full transaction feed. It provides date-grouped browsing, type filtering, structural filters, and text search. All transaction create/edit operations open in the slide-in drawer (Part 2) — never a new page.

## Route

`/transactions`

## Architecture & Data Fetching

This page follows the **established repo pattern** (same as `/dashboard` and `/profile`): a server component marked `force-dynamic` that fetches Prisma directly via a `server-only` fetcher. It does **not** use React Query / SWR (neither is installed) and does **not** drive the page from the `/api/transactions` route.

- **Reads:** Filters and search live in **URL search params** (e.g. `?type=expense&from=2026-06-01&to=2026-06-30&category=<id>&q=coffee`). The server component reads `searchParams`, passes them to `getTransactions(...)` in `src/lib/db/transactions.ts`, and renders server-side. This makes filter state shareable, bookmarkable, and back/forward-navigable. Filter controls are a small client component that updates the URL (`router.replace` with the new query string).
- **Writes:** Out of scope for Part 1 — see [transaction-drawer-spec.md](transaction-drawer-spec.md).
- **`/api/transactions` is documented as the future mobile/export surface**, not the mechanism this page uses. It is out of scope unless explicitly built.
- **Loading state:** Wrap the feed in `<Suspense>` with a skeleton list while the fetcher resolves.

## Layout

The page uses the standard app shell (sidebar + topbar). The main content area contains:

1. **Page header** — title ("Transactions") left-aligned; "Add transaction" CTA button right-aligned (rendered but inert in Part 1; opens the slide-in drawer in Part 2).
2. **Filter bar** — type pills (All / Income / Expense / Transfer) + structural filters (date range, category, account) + search input.
3. **Transaction feed** — date-grouped rows.

## Feed Structure

Transactions are grouped by calendar date with sticky section headers. Grouping compares each transaction's `@db.Date` against the **user's local "today"** (not server UTC), consistent with the no-UTC-conversion calendar-date rule:

- `Today` — matches the user's local date
- `Yesterday`
- Date string for anything older (e.g. `Jun 12, 2026`)

Each row has five columns matching the desktop mockup:

| Column | Content | Notes |
|---|---|---|
| Description | Merchant name (if set) or category name | Left-aligned; falls back to transaction type label |
| Category | Category icon + name | `null` renders as "Uncategorized" with `HelpCircle` icon; hidden/blank for transfers |
| Date | Calendar date | Formatted as `MMM D` within a group header; omitted inside the group |
| Account | Account name | Shows both accounts on a transfer row |
| Amount | Signed amount in the row's own currency | Right-aligned; green for positive (INCOME), red for negative (EXPENSE), grey for TRANSFER |

Each row has a left border accent colored by `TransactionType`. **Reuse the existing `TYPE_BORDER_COLOR` lookup** (currently in `src/components/dashboard/transactions-panel.tsx`) rather than re-hardcoding hex values:
- INCOME → green (`#1D9E75`)
- EXPENSE → red (`#E24B4A`)
- TRANSFER → grey (`#888780`)

**Currency:** Each row renders in **its own account's currency** with no conversion. Mixed currencies in the same feed are expected and fine here — unlike the Dashboard hero, this page never aggregates across currencies, so no "mixed currencies" warning applies.

## Transfers (read / collapse)

A transfer pair has `isTransferLeg = true` on both legs and a shared `transferPairId`. The query returns both legs; the view collapses them. (Transfer **edit/delete** behavior is Part 2.)

### Collapse algorithm

- **All accounts selected:** Dedupe by `transferPairId`. Render **one** row using the **outflow leg** (the negative-amount leg) as canonical. Derive the "From → To" account label from the two legs' `financialAccountId`s. Show the magnitude once, in grey.
- **Single account scoped:** Show only the leg belonging to that account, with a transfer indicator icon (Lucide `ArrowLeftRight`). The other account is still named as the counterparty.
- **Type = Transfer filter** still applies the collapse above.

### Pagination interaction

Because a pair can straddle a `LIMIT` boundary, **collapse transfers before applying the page limit** (collapse in the fetcher after retrieving rows for the page window, fetching both legs of any boundary pair together — or fetch by `transferPairId` groups). Do not naively `LIMIT` raw legs.

## Filter Bar

### Type pills (mutually exclusive)

`All` | `Income` | `Expense` | `Transfer`

Filters on `Transaction.type`. Default is `All`. Pill values are constants (no magic strings).

### Structural filters (independent, additive)

- **Date range** — calendar date picker for start/end. Filters on `Transaction.date` using the `@db.Date` calendar date directly (no UTC conversion).
- **Category** — multi-select category picker; shows system + user categories. **Ignored when type = Transfer** (transfers have no category).
- **Account** — driven by the global account selector in the topbar. When a specific account is active, only transactions for that `financialAccountId` are shown.

### Search

Free-text input scoped to `merchant`, `note`, and category `name`. **No global search** — this input only exists on this page. Search is additive with all structural filters (AND semantics). Backed by the `q` search param; debounce client-side before updating the URL.

## Data Source

`getTransactions(...)` queries `Transaction` where:
- `userId = session.user.id`
- `deletedAt IS NULL`
- parent `FinancialAccount.isArchived = false` (archived accounts' transactions remain queryable but are excluded from the default feed unless that account is explicitly selected via the account filter)
- plus any active filters (type, date range, categoryId, search)

Include relations: `category`, `financialAccount`.

Order by `date DESC`, then `createdAt DESC` within the same date.

### Pagination

Default page size is a constant in `src/lib/constants.ts` (e.g. `TRANSACTIONS_PAGE_SIZE = 50`). Use **cursor or "load more"** pagination (not offset) keyed on `(date, createdAt, id)`. Performance for > 10K transactions per user remains out of scope.

## Empty States

- **No transactions at all** — "No transactions yet. Add your first one." with a prominent CTA.
- **Filters active, no results** — "No transactions match your filters." with a "Clear filters" link that resets the URL params.
- **Loading** — skeleton row list via Suspense.

## Testing (Vitest)

Per coding standards, cover `src/lib/**` (no component tests). Extract pure, testable helpers:

- `groupTransactionsByDate(txns, localToday)` — Today / Yesterday / date bucketing
- `collapseTransfers(legs, scopedAccountId?)` — pair dedupe + From→To derivation
- `buildTransactionWhere(filters)` — filters → Prisma `where` mapping (type, date range, category, search, archived exclusion, soft-delete)

Mock `@/lib/prisma` and `@/auth` at the module boundary; never hit a real DB.

## Responsive Behavior

- **≥ 1024px** — full 5-column table, full sidebar
- **768–1024px** — icon-only sidebar; table columns may compress; Date and Account columns can truncate
- **< 768px** — hamburger sidebar, bottom nav bar. Table collapses to a card-style list: description + amount on one line, category + date below.
