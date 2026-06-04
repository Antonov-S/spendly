import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { MetricStrip } from "@/components/dashboard/metric-strip";
import { TransactionsPanel } from "@/components/dashboard/transactions-panel";
import { BudgetsPanel } from "@/components/dashboard/budgets-panel";
import { GoalsWidget } from "@/components/dashboard/goals-widget";
import { MOCK_SUMMARY } from "@/lib/mock-data";

export default function DashboardPage() {
  return (
    <DashboardShell summary={MOCK_SUMMARY}>
      <MetricStrip summary={MOCK_SUMMARY} />

      {/* Content columns: transactions (1.4fr) + budgets & goals (1fr) */}
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-[1.4fr_1fr]">
        <TransactionsPanel />
        <div className="flex flex-col gap-2">
          <BudgetsPanel />
          <GoalsWidget />
        </div>
      </div>
    </DashboardShell>
  );
}
