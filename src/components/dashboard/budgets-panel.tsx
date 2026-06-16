import Link from "next/link";
import { CategoryIcon } from "@/components/dashboard/category-icon";
import { formatCurrency } from "@/lib/format";
import { budgetState, budgetPercent, budgetColor } from "@/lib/budget";
import { cn } from "@/lib/utils";
import type { BudgetRow, BudgetSummary } from "@/types/dashboard";

interface BudgetsPanelProps {
  rows: BudgetRow[];
  summary: BudgetSummary;
}

export function BudgetsPanel({ rows, summary }: BudgetsPanelProps) {
  const monthName = new Date().toLocaleString("en-US", { month: "long" });

  return (
    <section className="flex flex-col rounded-xl border border-line bg-surface">
      {/* Panel header */}
      <div className="flex items-center gap-2 px-4 py-3.5">
        <h2 className="text-[13px] font-medium text-ink">Budgets</h2>
        <span className="text-[11px] text-ink-3">
          {summary.categoryCount} categories
        </span>
        <Link
          href="/budgets"
          className="ml-auto text-[11px] text-info transition-opacity hover:opacity-80"
        >
          Manage →
        </Link>
      </div>

      {/* Remaining summary */}
      <div className="border-y border-line px-4 py-3">
        <p className="text-[10px] font-medium uppercase tracking-wide text-ink-3">
          Remaining in {monthName}
        </p>
        <p className="mt-1 text-[20px] font-medium leading-none text-ink">
          {formatCurrency(summary.remaining)}
        </p>
        <p className="mt-1.5 text-[11px] text-ink-2">
          of {formatCurrency(summary.total)} budget · {summary.daysLeft} days
          left
        </p>
      </div>

      {/* Budget rows */}
      <div className="flex flex-col gap-3.5 px-4 py-4">
        {rows.map((budget) => {
          const state = budgetState(budget.spent, budget.limit);
          const percent = budgetPercent(budget.spent, budget.limit);
          const color = budgetColor(state);
          return (
            <div key={budget.id} className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <CategoryIcon category={budget.category} size="sm" />
                <span className="text-[12px] text-ink">
                  {budget.category.name}
                </span>
                <span
                  className={cn(
                    "ml-auto text-[11px] tabular-nums",
                    state === "danger" ? "text-danger" : "text-ink-3"
                  )}
                >
                  {formatCurrency(budget.spent)} / {formatCurrency(budget.limit)}
                </span>
              </div>
              {/* Progress track. `data-budget-track` is an inert alignment
                  hook the marketing hero animation uses to land its cube bars
                  on the real bars; it has no effect on the dashboard. */}
              <div
                data-budget-track
                className="h-1 w-full overflow-hidden rounded-full bg-surface-2"
              >
                <div
                  className="h-full rounded-full"
                  style={{ width: `${percent}%`, backgroundColor: color }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
