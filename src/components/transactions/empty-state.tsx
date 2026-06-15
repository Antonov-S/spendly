import Link from "next/link";
import { Inbox, SearchX } from "lucide-react";

interface EmptyStateProps {
  /** "empty" = user has no transactions; "no-results" = filters matched none. */
  variant: "empty" | "no-results";
}

export function EmptyState({ variant }: EmptyStateProps) {
  if (variant === "no-results") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-surface px-6 py-16 text-center">
        <SearchX size={28} className="text-ink-3" />
        <p className="text-[13px] text-ink-2">
          No transactions match your filters.
        </p>
        <Link
          href="/transactions"
          className="text-[12px] font-medium text-info transition-opacity hover:opacity-80"
        >
          Clear filters
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-surface px-6 py-16 text-center">
      <Inbox size={28} className="text-ink-3" />
      <p className="text-[13px] text-ink-2">No transactions yet.</p>
      <p className="text-[11px] text-ink-3">
        Add your first one to start tracking.
      </p>
    </div>
  );
}
