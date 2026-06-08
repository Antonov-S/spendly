import { formatCurrency } from "@/lib/format";
import type { GoalRow } from "@/types/dashboard";

interface GoalsWidgetProps {
  goals: GoalRow[];
}

export function GoalsWidget({ goals }: GoalsWidgetProps) {
  return (
    <section className="flex flex-col rounded-xl border border-line bg-surface">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3.5">
        <h2 className="text-[13px] font-medium text-ink">Goals</h2>
        <span className="text-[11px] text-ink-3">{goals.length} active</span>
        <button
          type="button"
          className="ml-auto text-[11px] text-info transition-opacity hover:opacity-80"
        >
          View all →
        </button>
      </div>

      {/* Goal rows */}
      <div className="flex flex-col gap-3.5 border-t border-line px-4 py-4">
        {goals.map((goal) => {
          const percent = Math.min(
            100,
            Math.round((goal.saved / goal.target) * 100)
          );
          return (
            <div key={goal.id} className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-ink">{goal.name}</span>
                {goal.overdue && (
                  <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-warning">
                    Overdue
                  </span>
                )}
                <span className="ml-auto text-[11px] tabular-nums text-ink-3">
                  {formatCurrency(goal.saved)} / {formatCurrency(goal.target)}
                </span>
              </div>
              {/* Progress track */}
              <div className="flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${percent}%`,
                      backgroundColor: goal.color,
                    }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-ink-3">
                  {percent}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
