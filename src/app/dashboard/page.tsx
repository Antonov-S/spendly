export const dynamic = "force-dynamic";

import { getSessionOrRedirect } from "@/lib/auth/guards";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { MetricStrip } from "@/components/dashboard/metric-strip";
import { TransactionsPanel } from "@/components/dashboard/transactions-panel";
import { BudgetsPanel } from "@/components/dashboard/budgets-panel";
import { GoalsWidget } from "@/components/dashboard/goals-widget";
import {
  getDashboardSummary,
  getBalanceTrend,
  getRecentTransactions,
  getBudgetsData,
  getGoals,
} from "@/lib/db/dashboard";

export default async function DashboardPage() {
  const session = await getSessionOrRedirect();

  const today = new Date();
  const month = today.getMonth() + 1;
  const year = today.getFullYear();

  const userId = session.user.id;

  const [summary, balanceTrend, { rows: transactions, count }, { rows: budgets, summary: budgetSummary }, goals] =
    await Promise.all([
      getDashboardSummary(userId, month, year),
      getBalanceTrend(userId, month, year),
      getRecentTransactions(userId, 20),
      getBudgetsData(userId, month, year),
      getGoals(userId),
    ]);

  return (
    <DashboardShell
      summary={summary}
      balanceTrend={balanceTrend}
      user={{
        name: session.user.name ?? null,
        email: session.user.email ?? null,
        image: session.user.image ?? null,
      }}
    >
      <MetricStrip summary={summary} />

      {/* Content columns: transactions (1.4fr) + budgets & goals (1fr) */}
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-[1.4fr_1fr]">
        <TransactionsPanel rows={transactions} count={count} />
        <div className="flex flex-col gap-2">
          <BudgetsPanel rows={budgets} summary={budgetSummary} />
          <GoalsWidget goals={goals} />
        </div>
      </div>
    </DashboardShell>
  );
}
