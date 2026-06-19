"use client";

import { Target } from "lucide-react";

interface GoalEmptyStateProps {
  onCreate: () => void;
}

export function GoalEmptyState({ onCreate }: GoalEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface px-6 py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-ink-3">
        <Target size={22} />
      </span>
      <h2 className="mt-4 text-[15px] font-medium text-ink">
        Set your first savings goal
      </h2>
      <p className="mt-1.5 max-w-xs text-[12px] text-ink-2">
        Pick a target amount and track your progress with manual contributions —
        no linked accounts, just honest savings.
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="mt-5 rounded-lg bg-success px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
      >
        Create a goal
      </button>
    </div>
  );
}
