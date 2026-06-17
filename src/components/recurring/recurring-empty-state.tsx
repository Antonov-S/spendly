"use client";

import { RefreshCw } from "lucide-react";

interface RecurringEmptyStateProps {
  onCreate: () => void;
}

export function RecurringEmptyState({ onCreate }: RecurringEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface px-6 py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-ink-3">
        <RefreshCw size={22} />
      </span>
      <h2 className="mt-4 text-[15px] font-medium text-ink">
        No recurring templates yet
      </h2>
      <p className="mt-1.5 max-w-xs text-[12px] text-ink-2">
        Set up standing rules for rent, subscriptions, or salary. Each period
        Spendly suggests a draft you confirm — never a silent ledger entry.
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="mt-5 rounded-lg bg-success px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
      >
        New template
      </button>
    </div>
  );
}
