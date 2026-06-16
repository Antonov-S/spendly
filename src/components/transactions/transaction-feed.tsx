"use client";

import { useState, useTransition } from "react";
import { groupTransactionsByDate } from "@/lib/transactions";
import { loadMoreTransactions } from "@/actions/transactions";
import { TransactionRow } from "@/components/transactions/transaction-row";
import { useAppShell } from "@/components/layout/app-shell";
import { cn } from "@/lib/utils";
import type { FeedTransaction, TransactionFilters } from "@/types/transactions";

const ROW_GRID =
  "grid items-center gap-3 grid-cols-[1fr_auto] md:grid-cols-[minmax(0,1.7fr)_1.1fr_1fr_minmax(72px,auto)]";

interface TransactionFeedProps {
  initialRows: FeedTransaction[];
  initialCursor: string | null;
  filters: TransactionFilters;
  /** Server "now" (ms) used to anchor Today/Yesterday consistently across SSR. */
  nowMs: number;
}

export function TransactionFeed({
  initialRows,
  initialCursor,
  filters,
  nowMs,
}: TransactionFeedProps) {
  const { openDrawer } = useAppShell();
  const [extraRows, setExtraRows] = useState<FeedTransaction[]>([]);
  const [cursor, setCursor] = useState(initialCursor);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Re-sync when the server sends a fresh first page (e.g. after a write +
  // router.refresh()): drop the locally appended pages and reset the cursor.
  const [prevInitial, setPrevInitial] = useState(initialRows);
  if (prevInitial !== initialRows) {
    setPrevInitial(initialRows);
    setExtraRows([]);
    setCursor(initialCursor);
  }

  const rows = [...initialRows, ...extraRows];
  const groups = groupTransactionsByDate(rows, new Date(nowMs));

  function handleLoadMore() {
    if (!cursor) return;
    setError(null);
    startTransition(async () => {
      const res = await loadMoreTransactions(filters, cursor);
      if (res.success && res.data) {
        setExtraRows((prev) => [...prev, ...res.data!.rows]);
        setCursor(res.data.nextCursor);
      } else {
        setError(res.error ?? "Could not load more transactions.");
      }
    });
  }

  return (
    <section className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface">
      {/* Column header */}
      <div
        className={cn(
          ROW_GRID,
          "border-b border-line px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-ink-3"
        )}
      >
        <span>Description</span>
        <span className="hidden md:block">Category</span>
        <span className="hidden md:block">Account</span>
        <span className="text-right">Amount</span>
      </div>

      {/* Date-grouped rows */}
      <div className="flex flex-col">
        {groups.map((group) => (
          <div key={group.label}>
            <div className="sticky top-0 z-10 bg-app/80 px-4 py-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-3 backdrop-blur">
              {group.label}
            </div>
            {group.items.map((txn) => (
              <TransactionRow
                key={txn.id}
                txn={txn}
                onSelect={() => openDrawer(txn.id)}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Load more */}
      {(cursor || error) && (
        <div className="flex flex-col items-center gap-2 px-4 py-3">
          {error && <p className="text-[11px] text-danger">{error}</p>}
          {cursor && (
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={isPending}
              className="rounded-md border border-line bg-surface px-4 py-1.5 text-[12px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-60"
            >
              {isPending ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
