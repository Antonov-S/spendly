import { ArrowUpRight } from "lucide-react";
import { Logo } from "@/components/dashboard/logo";
import { Sparkline } from "@/components/dashboard/sparkline";
import { MetricStrip } from "@/components/dashboard/metric-strip";
import { BudgetsPanel } from "@/components/dashboard/budgets-panel";
import { GoalsWidget } from "@/components/dashboard/goals-widget";
import { formatCurrency, formatSigned } from "@/lib/format";
import {
  MARKETING_SUMMARY,
  MARKETING_BALANCE_TREND,
  MARKETING_BUDGETS,
  MARKETING_BUDGET_SUMMARY,
  MARKETING_GOALS,
} from "@/lib/marketing/dashboard-snapshot";

/**
 * Phase-4 "clarity" reveal: a realistic Spendly dashboard inside a browser
 * window frame, built from the real dashboard components and the typed
 * marketing snapshot. This is the static poster frame — server-rendered into
 * the initial HTML so the hero is a complete experience without JS, and the
 * target the cube animation resolves into.
 */
export function DashboardPreview() {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-app shadow-2xl shadow-black/40">
      {/* Browser window chrome — a realistic app frame, not a phone outline. */}
      <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2.5">
        <span className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-danger/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
        </span>
        <span className="ml-2 flex-1 truncate rounded-md bg-app px-3 py-1 text-center text-[10px] text-ink-3">
          spendly.app/dashboard
        </span>
        <Logo showWordmark={false} />
      </div>

      {/* Dashboard body */}
      <div className="flex flex-col gap-3 p-4">
        {/* Hero balance block (static — period pills / Add CTA omitted). */}
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-ink-3">
            Total balance · {MARKETING_SUMMARY.periodLabel}
          </p>
          <div className="mt-1 flex items-center gap-4">
            <p className="text-[28px] font-medium leading-none text-ink">
              {formatCurrency(MARKETING_SUMMARY.totalBalance)}
            </p>
            <Sparkline data={MARKETING_BALANCE_TREND} className="mt-0.5" />
          </div>
          <p className="mt-2 flex items-center gap-1 text-[11px] text-success">
            <ArrowUpRight size={13} />
            {formatSigned(MARKETING_SUMMARY.balanceDelta)} this month
          </p>
        </div>

        <MetricStrip summary={MARKETING_SUMMARY} />

        {/* Budget usage + savings goal progress. */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.4fr_1fr]">
          <BudgetsPanel
            rows={MARKETING_BUDGETS}
            summary={MARKETING_BUDGET_SUMMARY}
          />
          <GoalsWidget goals={MARKETING_GOALS} />
        </div>
      </div>
    </div>
  );
}
