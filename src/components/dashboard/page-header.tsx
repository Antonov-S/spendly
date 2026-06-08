"use client";

import { useState } from "react";
import { ArrowUpRight, Plus } from "lucide-react";
import { PERIOD_OPTIONS, DEFAULT_PERIOD } from "@/lib/system-constants";
import type { Period } from "@/lib/system-constants";
import { formatCurrency, formatSigned } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Sparkline } from "@/components/dashboard/sparkline";
import type { DashboardSummary } from "@/types/dashboard";

interface PageHeaderProps {
  summary: DashboardSummary;
  balanceTrend: number[];
  onAdd: () => void;
}

export function PageHeader({ summary, balanceTrend, onAdd }: PageHeaderProps) {
  const [period, setPeriod] = useState<Period>(DEFAULT_PERIOD);

  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      {/* Hero balance block */}
      <div>
        <p className="text-[10px] font-medium uppercase tracking-wide text-ink-3">
          Total balance · {summary.periodLabel}
        </p>
        <div className="mt-1 flex items-center gap-4">
          <p className="text-[28px] font-medium leading-none text-ink">
            {formatCurrency(summary.totalBalance)}
          </p>
          <Sparkline data={balanceTrend} className="mt-0.5" />
        </div>
        <p className="mt-2 flex items-center gap-1 text-[11px] text-success">
          <ArrowUpRight size={13} />
          {formatSigned(summary.balanceDelta)} this month
        </p>
      </div>

      {/* Period pills + Add CTA. Full-width on mobile so Add sits hard-right. */}
      <div className="flex w-full items-center justify-between gap-4 sm:w-auto sm:justify-end">
        <div className="flex items-center gap-0.5 rounded-md border border-line bg-surface p-0.5">
          {PERIOD_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setPeriod(option)}
              className={cn(
                "rounded px-2.5 py-1 text-[11px] transition-colors",
                period === option
                  ? "bg-surface-2 text-ink"
                  : "text-ink-3 hover:text-ink-2"
              )}
            >
              {option}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-1.5 rounded-lg bg-success px-4 py-2 text-[13px] font-semibold text-white ring-1 ring-inset ring-white/15 transition-colors hover:bg-success/90"
        >
          <Plus size={16} strokeWidth={2.5} />
          Add
        </button>
      </div>
    </div>
  );
}
