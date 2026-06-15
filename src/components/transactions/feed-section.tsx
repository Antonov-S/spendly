import { getTransactions } from "@/lib/db/transactions";
import { TransactionFeed } from "@/components/transactions/transaction-feed";
import { EmptyState } from "@/components/transactions/empty-state";
import type { TransactionFilters } from "@/types/transactions";

interface FeedSectionProps {
  userId: string;
  filters: TransactionFilters;
  hasActiveFilters: boolean;
  /** Server "now" (ms) anchoring date groups. */
  nowMs: number;
}

/**
 * Async server component that fetches the first page and hands it to the client
 * feed. Suspends (showing the skeleton) until the query resolves.
 */
export async function FeedSection({
  userId,
  filters,
  hasActiveFilters,
  nowMs,
}: FeedSectionProps) {
  const { rows, nextCursor } = await getTransactions(userId, filters);

  if (rows.length === 0) {
    return <EmptyState variant={hasActiveFilters ? "no-results" : "empty"} />;
  }

  return (
    <TransactionFeed
      initialRows={rows}
      initialCursor={nextCursor}
      filters={filters}
      nowMs={nowMs}
    />
  );
}
