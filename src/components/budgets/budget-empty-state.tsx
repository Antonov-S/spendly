"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Wallet } from "lucide-react";
import { toast } from "sonner";
import { seedPresetBudgets } from "@/actions/budgets";

interface BudgetEmptyStateProps {
  period: { month: number; year: number };
}

export function BudgetEmptyState({ period }: BudgetEmptyStateProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleSeed() {
    startTransition(async () => {
      const res = await seedPresetBudgets(period.month, period.year);
      if (!res.success) {
        toast.error(res.error ?? "Could not add starter budgets.");
        return;
      }
      const created = res.data?.created ?? 0;
      toast.success(
        created > 0
          ? `Added ${created} ${created === 1 ? "budget" : "budgets"}`
          : "No new budgets to add"
      );
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface px-6 py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-ink-3">
        <Wallet size={22} />
      </span>
      <h2 className="mt-4 text-[15px] font-medium text-ink">
        No budgets this month
      </h2>
      <p className="mt-1.5 max-w-xs text-[12px] text-ink-2">
        Set a spending ceiling per category to see how each transaction consumes
        your budget. Start with a few common categories.
      </p>
      <button
        type="button"
        onClick={handleSeed}
        disabled={isPending}
        className="mt-5 rounded-lg bg-success px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {isPending ? "Adding…" : "Use starter budgets"}
      </button>
    </div>
  );
}
