# Fix Spec: Dashboard Dead Controls

Two dashboard header/panel controls render but back no function — a violation of the
project principle *"never UI without backing function"* (project-overview.md → Product
Philosophy #6). One gets wired up, one gets removed. Both live on `/dashboard`.

Branch: `fix/dashboard-dead-controls`

---

## Issue 1 — "See all →" does nothing

### Current behaviour

The "Recent transactions" panel header renders a `See all →` control as a bare
`<button type="button">` with no `onClick` / no navigation —
[transactions-panel.tsx:36-41](../../src/components/dashboard/transactions-panel.tsx#L36-L41).
Clicking it does nothing.

### Desired behaviour

It should navigate to `/transactions` (the full transaction feed) — the obvious target,
and the page already exists.

### Fix

Replace the `<button>` with a Next.js `<Link href="/transactions">`, keeping the existing
classes (`ml-auto text-[11px] text-info transition-opacity hover:opacity-80`). Import
`Link` from `next/link`. No new props, no handler threading — `TransactionsPanel` stays a
server component.

```tsx
import Link from "next/link";

<Link
  href="/transactions"
  className="ml-auto text-[11px] text-info transition-opacity hover:opacity-80"
>
  See all →
</Link>
```

---

## Issue 2 — Week / Month / Year period pills do nothing

### Current behaviour

The dashboard `PageHeader` renders a Week / Month / Year pill group driven by a purely
local `useState<Period>` that nothing reads —
[page-header.tsx:19](../../src/components/dashboard/page-header.tsx#L19) and
[page-header.tsx:42-58](../../src/components/dashboard/page-header.tsx#L42-L58). Selecting a
pill re-styles the active button but changes no data: the hero balance, metric strip, and
sparkline are all server-fetched for the **current calendar month** and never re-query.

### Decision — remove, don't wire

Per the user, the pills are **removed**, not wired. Rationale: the Dashboard is a
*current-state* screen by design (*"Dashboard is for state, Reports is for analysis — never
the same screen"*, Product Philosophy #2). Period-scoped analysis already lives on
`/reports` with its own real period selector (`REPORT_PERIOD_OPTIONS`, 1m/3m/12m). Adding a
second, differently-scaled period control (Week/Month/Year) to the dashboard would either
duplicate Reports or blur the state/analysis split. Removing the dead control is the
smallest honest fix.

The balance **sparkline stays** — it is already wired to real data via `getBalanceTrend`
([dashboard.ts:95](../../src/lib/db/dashboard.ts#L95)) and is not affected by this change.

### Fix

In [page-header.tsx](../../src/components/dashboard/page-header.tsx):

- Delete the period pill group (the inner `<div className="flex items-center gap-0.5 …">`
  block, lines ~42-58).
- Delete the `useState<Period>` line and the now-unused imports: `useState` (from `react`),
  `PERIOD_OPTIONS` / `DEFAULT_PERIOD` / `Period` (from `@/lib/system-constants`), and `cn`
  if it becomes unused (it is only used by the pill `className`). Verify before deleting.
- The right-hand cluster keeps only the **Add** CTA button. Re-check the wrapper flex
  classes so the Add button still sits hard-right on mobile and desktop (the
  `justify-between … sm:justify-end` wrapper can stay; with one child it right-aligns).
- `PageHeader` may no longer need `"use client"` if the Add button's `ononAdd` is its only
  remaining interactivity — it still receives `onAdd` (a function prop) and renders an
  `onClick`, so **keep `"use client"`**.

### Constants cleanup

`PERIOD_OPTIONS`, `Period`, and `DEFAULT_PERIOD` in
[system-constants.ts:154-157](../../src/lib/system-constants.ts#L154-L157) exist **only** for
this pill group (confirmed: the only non-doc consumer is `page-header.tsx`; Reports uses its
own `REPORT_PERIOD_OPTIONS`). Remove all three once the pills are gone, so no orphaned
constant remains. (Do **not** touch `REPORT_PERIOD_OPTIONS` or any `*Period*` symbol under
`report-period`/`budget-period` — those are unrelated.)

---

## What we are not doing

- **Not** wiring the period pills to real period-scoped dashboard queries (explicitly
  declined — would duplicate `/reports`).
- **Not** touching the sparkline or `getBalanceTrend` — it already shows real data.
- **Not** changing the metric strip, insights strip, or any fetcher.

## Testing

### Unit (Vitest)

No new server-action or utility logic. The only `src/lib` change is the constant deletion,
which has no test surface (the removed constants are not unit-tested). Existing suites must
stay green — `npm run test:run`.

### Build / lint

`npm run build` and `npm run lint` must pass — in particular ESLint `no-unused-vars` confirms
the import/constant cleanup is complete (a leftover unused import or constant will surface
here).

### Manual

1. `/dashboard` → "Recent transactions" → click **See all →** → lands on `/transactions`.
2. `/dashboard` header no longer shows Week / Month / Year pills; the **Add** button remains
   right-aligned at mobile (375px) and desktop (1440px) widths.
3. The balance sparkline still renders to the right of the Total balance figure and reflects
   real month-to-date movement.
